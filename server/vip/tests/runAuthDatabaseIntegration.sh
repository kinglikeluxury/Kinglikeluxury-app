#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${VIP_QA_EMPTY_ENV_CONFIRMED:-}" ]]; then
  printf '%s\n' "Refusing: launch this runner through the documented env -i command."
  exit 2
fi

command -v initdb >/dev/null
command -v pg_ctl >/dev/null
command -v psql >/dev/null
command -v node >/dev/null

PGDATA="$(mktemp -d /tmp/kinglike-vip-pg-XXXXXXXX)"
SOCKET_DIR="$(mktemp -d /tmp/kinglike-vip-sock-XXXXXXXX)"
STORAGE_DIR="$(mktemp -d /tmp/kinglike-vip-files-XXXXXXXX)"
chmod 700 "$PGDATA" "$SOCKET_DIR" "$STORAGE_DIR"
OUTFILE="$(pwd)/server/vip/tests/.auth-database-integration-${$}.mjs"
RECEIPT_OUTFILE="$(pwd)/server/vip/tests/.vip-receipt-http-test.mjs"
if [[ -e "$RECEIPT_OUTFILE" ]]; then
  printf '%s\n' "Refusing: a pre-existing receipt test bundle would be overwritten."
  exit 4
fi

STARTED=0
cleanup() {
  set +e
  if [[ "$STARTED" == "1" && -f "$PGDATA/postmaster.pid" ]]; then
    pg_ctl -D "$PGDATA" -m immediate -w stop >/dev/null 2>&1
  fi
  rm -rf -- "$PGDATA" "$SOCKET_DIR" "$STORAGE_DIR"
  rm -f -- "$OUTFILE" "$RECEIPT_OUTFILE"
  if [[ ! -e "$PGDATA" && ! -e "$SOCKET_DIR" && ! -e "$STORAGE_DIR" && ! -e "$OUTFILE" && ! -e "$RECEIPT_OUTFILE" ]]; then
    printf '%s\n' "temporary_postgres_storage_build=stopped_and_removed"
  else
    printf '%s\n' "temporary_resource_cleanup=failed"
  fi
}
trap cleanup EXIT INT TERM

RUN_ID="r${$}_$(date +%s)"
ROLE="vipqa_${RUN_ID}"
PORT="$(node -e 'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
SUPERUSER="$(id -un)"

initdb -D "$PGDATA" --username="$SUPERUSER" --auth-local=trust --auth-host=reject --no-sync >/dev/null
cat >"$PGDATA/pg_hba.conf" <<'EOF'
local all all trust
host all all 127.0.0.1/32 trust
host all all 0.0.0.0/0 reject
host all all ::/0 reject
EOF

pg_ctl -D "$PGDATA" \
  -l "$PGDATA/server.log" \
  -o "-h 127.0.0.1 -p $PORT -k $SOCKET_DIR -c listen_addresses=127.0.0.1 -c unix_socket_directories=$SOCKET_DIR" \
  -w start >/dev/null
STARTED=1

# Prove the only TCP listener for this port is IPv4 loopback before making
# even the initial read-only database identity query.
node - "$PORT" <<'NODE'
const fs = require("node:fs");
const port = Number(process.argv[2]).toString(16).toUpperCase().padStart(4, "0");
const rows = [];
for (const file of ["/proc/net/tcp", "/proc/net/tcp6"]) {
  let contents;
  try {
    contents = fs.readFileSync(file, "utf8");
  } catch (error) {
    if (file.endsWith("/tcp6") && error.code === "ENOENT") continue;
    throw error;
  }
  const lines = contents.trim().split(/\r?\n/).slice(1);
  for (const line of lines) {
    const fields = line.trim().split(/\s+/);
    const [address, hexPort] = fields[1].split(":");
    if (hexPort === port && fields[3] === "0A") {
      rows.push({ file, address });
    }
  }
}
if (rows.length !== 1 || rows[0].file !== "/proc/net/tcp" || rows[0].address !== "0100007F") {
  console.error("Loopback listener verification failed");
  process.exit(1);
}
console.log("postgres_listener=127.0.0.1_only");
NODE

env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp \
  VIP_TEST_EXPECTED_DATA_DIRECTORY="$PGDATA" PGPORT="$PORT" \
  node --import tsx --input-type=module -e \
  'import {assertTemporaryPostgresProcessIdentity} from "./server/vip/qaLocalPostgresIdentity.ts"; assertTemporaryPostgresProcessIdentity(process.env.VIP_TEST_EXPECTED_DATA_DIRECTORY,Number(process.env.PGPORT)); console.log("postgres_process_identity=verified")'

IDENTITY="$(
  psql -XAtq -F '|' -h 127.0.0.1 -p "$PORT" -U "$SUPERUSER" -d postgres \
    -c "SELECT current_database(),current_user,host(inet_server_addr()),inet_server_port()"
)"
if [[ "$IDENTITY" != "postgres|$SUPERUSER|127.0.0.1|$PORT" ]]; then
  printf '%s\n' "Refusing: initial read-only database identity did not match the fresh loopback cluster."
  exit 3
fi
printf '%s\n' "postgres_initial_database_identity=verified"

psql -Xq -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U "$SUPERUSER" -d postgres \
  -c "CREATE ROLE $ROLE LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT"
psql -Xq -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U "$SUPERUSER" -d postgres \
  -c "CREATE DATABASE vipdb OWNER $ROLE"

env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp \
  node server/vip/tests/buildAuthDatabaseIntegration.mjs "$OUTFILE"

DATABASE_URL="postgresql://$ROLE@127.0.0.1:$PORT/vipdb?sslmode=disable"
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp \
  NODE_ENV=test \
  KINGLIKE_VIP_ENABLED=true \
  SESSION_SECRET="synthetic-only-session-secret-for-local-otp-rate-limits" \
  VIP_TEST_RUN_ID="$RUN_ID" \
  VIP_TEST_DATABASE_URL="$DATABASE_URL" \
  VIP_TEST_EXPECTED_DATA_DIRECTORY="$PGDATA" \
  VIP_TEST_STORAGE_DIR="$STORAGE_DIR" \
  PGPORT="$PORT" \
  node "$OUTFILE"

# The receipt suite gets a separate, freshly recreated database so the auth
# migration and limiter fixtures cannot leak into its minimal VIP-only schema.
psql -Xq -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U "$SUPERUSER" -d postgres \
  -c "DROP DATABASE vipdb"
psql -Xq -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U "$SUPERUSER" -d postgres \
  -c "CREATE DATABASE vipdb OWNER $ROLE"
psql -Xq -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U "$ROLE" -d vipdb \
  -f server/vip/migrations/000_qa_users_only.sql
psql -Xq -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U "$ROLE" -d vipdb \
  -f server/vip/migrations/001_vip_foundation.sql
env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp \
  node server/vip/tests/buildReceiptHttpIntegration.mjs

env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp \
  NODE_ENV=test \
  VIP_TEST_RUN_ID="$RUN_ID" \
  VIP_TEST_DATABASE_URL="$DATABASE_URL" \
  VIP_TEST_EXPECTED_DATA_DIRECTORY="$PGDATA" \
  VIP_TEST_STORAGE_DIR="$STORAGE_DIR" \
  PGPORT="$PORT" \
  node --test "$RECEIPT_OUTFILE"
