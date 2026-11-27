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
chmod 700 "$PGDATA" "$SOCKET_DIR"
STARTED=0

cleanup() {
  set +e
  if [[ "$STARTED" == "1" && -f "$PGDATA/postmaster.pid" ]]; then
    pg_ctl -D "$PGDATA" -m immediate -w stop >/dev/null 2>&1
  fi
  rm -rf -- "$PGDATA" "$SOCKET_DIR"
  if [[ ! -e "$PGDATA" && ! -e "$SOCKET_DIR" ]]; then
    printf '%s\n' "provision_test_postgres=stopped_and_removed"
  else
    printf '%s\n' "provision_test_cleanup=failed"
  fi
}
trap cleanup EXIT INT TERM

PORT="$(node -e 'const net=require("node:net");const s=net.createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
SUPERUSER="$(id -un)"
initdb -D "$PGDATA" --username="$SUPERUSER" --auth-local=trust --auth-host=reject --no-sync >/dev/null
cat >"$PGDATA/pg_hba.conf" <<'EOF'
local all all trust
host all all 127.0.0.1/32 trust
host all all 0.0.0.0/0 reject
host all all ::/0 reject
EOF
pg_ctl -D "$PGDATA" -l "$PGDATA/server.log" \
  -o "-h 127.0.0.1 -p $PORT -k $SOCKET_DIR -c listen_addresses=127.0.0.1 -c unix_socket_directories=$SOCKET_DIR" \
  -w start >/dev/null
STARTED=1

node - "$PORT" <<'NODE'
const fs=require("node:fs");
const port=Number(process.argv[2]).toString(16).toUpperCase().padStart(4,"0");
const listeners=[];
for(const file of ["/proc/net/tcp","/proc/net/tcp6"]){
  let text;
  try{text=fs.readFileSync(file,"utf8");}
  catch(error){if(file.endsWith("/tcp6")&&error.code==="ENOENT")continue;throw error;}
  for(const line of text.trim().split(/\r?\n/).slice(1)){
    const fields=line.trim().split(/\s+/);
    const [address,hexPort]=fields[1].split(":");
    if(hexPort===port&&fields[3]==="0A")listeners.push({file,address});
  }
}
if(listeners.length!==1||listeners[0].file!=="/proc/net/tcp"||listeners[0].address!=="0100007F"){
  console.error("Temporary PostgreSQL loopback listener check failed");
  process.exit(1);
}
console.log("provision_test_listener=127.0.0.1_only");
NODE

env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp \
  VIP_QA_EXPECTED_DATA_DIRECTORY="$PGDATA" VIP_QA_EXPECTED_PORT="$PORT" \
  node --import tsx --input-type=module -e \
  'import {assertTemporaryPostgresProcessIdentity} from "./server/vip/qaLocalPostgresIdentity.ts"; assertTemporaryPostgresProcessIdentity(process.env.VIP_QA_EXPECTED_DATA_DIRECTORY,Number(process.env.VIP_QA_EXPECTED_PORT)); console.log("provision_test_process_identity=verified")'

IDENTITY="$(psql -XAtq -F '|' -h 127.0.0.1 -p "$PORT" -U "$SUPERUSER" -d postgres \
  -c "SELECT current_database(),current_user,host(inet_server_addr()),inet_server_port()")"
if [[ "$IDENTITY" != "postgres|$SUPERUSER|127.0.0.1|$PORT" ]]; then
  printf '%s\n' "Refusing: initial database identity mismatch."
  exit 3
fi
printf '%s\n' "provision_test_initial_database_identity=verified"

psql -Xq -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U "$SUPERUSER" -d postgres \
  -c "CREATE ROLE vipqa_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'Synthetic-Migrator-QA-2026!'"
psql -Xq -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U "$SUPERUSER" -d postgres \
  -c "CREATE ROLE vipqa_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT PASSWORD 'Synthetic-Runtime-QA-2026!'"
psql -Xq -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" -U "$SUPERUSER" -d postgres \
  -c "CREATE DATABASE vipqa_demo OWNER vipqa_migrator TEMPLATE template0 ENCODING 'UTF8'"

for migration in \
  server/vip/migrations/000_qa_users_only.sql \
  server/vip/migrations/001_vip_foundation.sql \
  server/vip/migrations/003_qa_sessions.sql \
  server/vip/migrations/002_railway_qa_identity.sql; do
  psql -Xq -v ON_ERROR_STOP=1 -h 127.0.0.1 -p "$PORT" \
    -U vipqa_migrator -d vipqa_demo -f "$migration"
done

MIGRATOR_URL="postgresql://vipqa_migrator:Synthetic-Migrator-QA-2026!@127.0.0.1:$PORT/vipqa_demo"
RUNTIME_URL="postgresql://vipqa_runtime:Synthetic-Runtime-QA-2026!@127.0.0.1:$PORT/vipqa_demo"
ENVIRONMENT_ID="a45d1f9e-4a24-4c84-99bc-90b48e2d41c7"

run_provisioner() {
  env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp NODE_ENV=test \
    KINGLIKE_VIP_QA_PROVISION_EXECUTE=true \
    KINGLIKE_VIP_QA_PROVISION_MODE=local-test \
    KINGLIKE_VIP_QA_PROVISION_APPROVED=true \
    KINGLIKE_VIP_QA_MIGRATION_DATABASE_URL="$MIGRATOR_URL" \
    KINGLIKE_VIP_QA_PROVISION_HOST=127.0.0.1 \
    KINGLIKE_VIP_QA_PROVISION_DATABASE=vipqa_demo \
    KINGLIKE_VIP_QA_PROVISION_MIGRATOR_ROLE=vipqa_migrator \
    KINGLIKE_VIP_QA_PROVISION_RUNTIME_ROLE=vipqa_runtime \
    KINGLIKE_VIP_QA_PROVISION_ADDRESS=127.0.0.1 \
    KINGLIKE_VIP_QA_PROVISION_ENVIRONMENT_ID="$ENVIRONMENT_ID" \
    KINGLIKE_VIP_QA_PROVISION_ADMIN_PASSWORD='Synthetic-Admin-QA-2026!' \
    KINGLIKE_VIP_QA_PROVISION_BUYER_PASSWORD='Synthetic-Buyer-QA-2026!' \
    KINGLIKE_VIP_QA_PROVISION_SELLER_PASSWORD='Synthetic-Seller-QA-2026!' \
    KINGLIKE_VIP_QA_PROVISION_FINANCE_PASSWORD='Synthetic-Finance-QA-2026!' \
    VIP_QA_LOCAL_TEST=true \
    VIP_QA_EXPECTED_DATA_DIRECTORY="$PGDATA" \
    VIP_QA_EXPECTED_PORT="$PORT" \
    node --import tsx server/vip/qaRailwayProvision.ts
}

run_provisioner

env -i PATH="$PATH" HOME="$HOME" TMPDIR=/tmp NODE_ENV=test \
  VIP_QA_RUNTIME_TEST_DATABASE_URL="$RUNTIME_URL" \
  VIP_QA_EXPECTED_DATA_DIRECTORY="$PGDATA" \
  VIP_QA_EXPECTED_PORT="$PORT" \
  node --import tsx --test server/vip/tests/qaRailwayProvisionIntegration.mjs

if run_provisioner >/dev/null 2>&1; then
  printf '%s\n' "provisioner_nonempty_refusal=failed"
  exit 5
fi
printf '%s\n' "provisioner_nonempty_refusal=passed"
