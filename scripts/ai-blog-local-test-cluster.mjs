/**
 * LOCAL TEST UTILITY — NOT APPROVED FOR EXECUTION.
 *
 * This file is intentionally not wired to npm scripts, application startup,
 * CI, or deployment. Do not run it until an independent security review has
 * approved the implementation and the exact local environment.
 *
 * When manually invoked, this utility creates a disposable PostgreSQL cluster
 * under a unique private temporary directory, verifies only that cluster, then
 * stops and removes only its own resources. It does not run migrations,
 * application tests, quota tests, or call Gemini/Google or any external API.
 */
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";

const DATABASE = "ai_blog_drafts_test";
const ROLE = "ai_blog_test_user";
const PREFIX = "kinglike-ai-blog-test-";
const SAFE_ERROR = "AI_BLOG_LOCAL_TEST_CLUSTER";
// Pinned Nix store path: do not replace with PATH lookup. If this immutable
// package path is absent or fails ownership checks, stop before creating files.
const PG_BIN_DIR = "/nix/store/bgwr5i8jf8jpg75rr53rz3fqv5k8yrwp-postgresql-16.10/bin";

function fail(stage, code) {
  const error = new Error(`${SAFE_ERROR} stage=${stage} code=${code}`);
  error.safeLine = error.message;
  throw error;
}

function getPinnedExecutables() {
  const dir = lstatSync(PG_BIN_DIR);
  if (
    !dir.isDirectory() ||
    dir.isSymbolicLink() ||
    dir.uid !== 0 ||
    (dir.mode & 0o022) !== 0 ||
    realpathSync(PG_BIN_DIR) !== PG_BIN_DIR
  ) {
    fail("preflight", "PINNED_POSTGRES_DIRECTORY_INVALID");
  }
  const result = {};
  for (const name of ["initdb", "pg_ctl", "psql", "postgres"]) {
    const file = path.join(PG_BIN_DIR, name);
    const info = lstatSync(file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.uid !== 0 ||
      (info.mode & 0o022) !== 0 ||
      (info.mode & 0o111) === 0 ||
      realpathSync(file) !== file
    ) {
      fail("preflight", "PINNED_POSTGRES_BINARY_INVALID");
    }
    result[name] = file;
  }
  return result;
}

function commandEnvironment() {
  return { PATH: PG_BIN_DIR, LC_ALL: "C" };
}

function run(executable, args, input) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    env: commandEnvironment(),
    input,
    maxBuffer: 1024 * 1024,
    timeout: 30_000,
  });
  if (result.error || result.signal || result.status === null) {
    fail("process", "LOCAL_POSTGRES_COMMAND_FAILED");
  }
  return result;
}

function requireCommandSuccess(result, stage, code) {
  if (result.status !== 0) fail(stage, code);
}

function assertPrivateDirectory(directory) {
  const info = lstatSync(directory);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid() ||
    (info.mode & 0o777) !== 0o700 ||
    realpathSync(directory) !== directory
  ) {
    fail("filesystem", "PRIVATE_DIRECTORY_CHECK_FAILED");
  }
}

function selectLoopbackPort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once("error", () => reject(new Error("PORT_PROBE_FAILED")));
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        probe.close(() => reject(new Error("PORT_PROBE_FAILED")));
        return;
      }
      const port = address.port;
      probe.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

function hasListenerOnPort(port) {
  const listeners = [];
  for (const [table, family] of [["/proc/net/tcp", "ipv4"], ["/proc/net/tcp6", "ipv6"]]) {
    try {
      const lines = readFileSync(table, "utf8").trim().split(/\r?\n/).slice(1);
      for (const line of lines) {
        const fields = line.trim().split(/\s+/);
        if (fields[3] === "0A" && Number.parseInt(fields[1].split(":").at(-1), 16) === port) {
          listeners.push({ family, address: fields[1].split(":")[0] });
        }
      }
    } catch {
      fail("isolation", "LISTENER_CHECK_UNAVAILABLE");
    }
  }
  return listeners;
}

function inspectPostmaster(dataDirectory, postgresExecutable) {
  const pidFile = path.join(dataDirectory, "postmaster.pid");
  if (!existsSync(pidFile)) return undefined;
  try {
    const pidInfo = lstatSync(pidFile);
    if (
      !pidInfo.isFile() ||
      pidInfo.isSymbolicLink() ||
      pidInfo.uid !== process.getuid() ||
      (pidInfo.mode & 0o077) !== 0
    ) return null;
    const [pidLine, directoryLine] = readFileSync(pidFile, "utf8").split(/\r?\n/);
    const pid = Number(pidLine);
    if (!Number.isSafeInteger(pid) || pid < 2 || directoryLine !== dataDirectory) return null;
    const commandLine = readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0").filter(Boolean);
    const dataArg = commandLine.findIndex((value) => value === "-D");
    const compactDataArg = commandLine.find((value) => value.startsWith("-D") && value.length > 2);
    if (
      (dataArg < 0 || commandLine[dataArg + 1] !== dataDirectory) &&
      compactDataArg !== `-D${dataDirectory}`
    ) return null;
    const procInfo = lstatSync(`/proc/${pid}`);
    if (!procInfo.isDirectory() || procInfo.uid !== process.getuid()) return null;
    if (realpathSync(`/proc/${pid}/exe`) !== postgresExecutable) return null;
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    const statClose = stat.lastIndexOf(")");
    if (statClose < 0) return null;
    const fields = stat.slice(statClose + 1).trim().split(/\s+/);
    const startTime = fields[19];
    if (!/^\d+$/.test(startTime ?? "")) return null;
    return {
      pid,
      startTime,
      executable: postgresExecutable,
      dataDirectory,
      pidDevice: pidInfo.dev,
      pidInode: pidInfo.ino,
    };
  } catch {
    return null;
  }
}

function samePostmaster(first, second) {
  return Boolean(
    first &&
    second &&
    first.pid === second.pid &&
    first.startTime === second.startTime &&
    first.executable === second.executable &&
    first.dataDirectory === second.dataDirectory &&
    first.pidDevice === second.pidDevice &&
    first.pidInode === second.pidInode
  );
}

function writePrivateFile(file, contents) {
  writeFileSync(file, contents, { mode: 0o600, flag: "wx" });
  chmodSync(file, 0o600);
}

function prepareClusterFiles(dataDirectory, socketDirectory, port, osUser) {
  const config = path.join(dataDirectory, "postgresql.conf");
  const hba = path.join(dataDirectory, "pg_hba.conf");
  const ident = path.join(dataDirectory, "pg_ident.conf");
  for (const file of [config, hba, ident]) {
    const info = lstatSync(file);
    if (!info.isFile() || info.isSymbolicLink() || info.uid !== process.getuid()) {
      fail("filesystem", "CLUSTER_FILE_CHECK_FAILED");
    }
  }
  writeFileSync(config, [
    "listen_addresses = '127.0.0.1'",
    `port = ${port}`,
    `unix_socket_directories = '${socketDirectory}'`,
    "password_encryption = 'scram-sha-256'",
    "log_statement = 'none'",
    "log_min_error_statement = 'panic'",
    "log_connections = off",
    "log_disconnections = off",
    "hba_file = 'pg_hba.conf'",
    "ident_file = 'pg_ident.conf'",
    "",
  ].join("\n"), { flag: "a" });
  writeFileSync(hba, [
    "local all postgres peer map=local_admin",
    "local all all reject",
    `host ${DATABASE} ${ROLE} 127.0.0.1/32 scram-sha-256`,
    "host all all 0.0.0.0/0 reject",
    "host all all ::/0 reject",
    "",
  ].join("\n"));
  writeFileSync(ident, `local_admin ${osUser} postgres\n`);
  for (const file of [config, hba, ident]) chmodSync(file, 0o600);
}

function verifyMarker(root, marker) {
  try {
    assertPrivateDirectory(root);
    const info = lstatSync(marker.path);
    return info.isFile() &&
      !info.isSymbolicLink() &&
      info.uid === process.getuid() &&
      (info.mode & 0o777) === 0o600 &&
      readFileSync(marker.path, "utf8") === marker.value;
  } catch {
    return false;
  }
}

function containsSymlink(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    const info = lstatSync(entryPath);
    if (info.isSymbolicLink()) return true;
    if (info.isDirectory() && containsSymlink(entryPath)) return true;
  }
  return false;
}

function cleanup({ root, dataDirectory, marker, pgCtl, port, started, initialized }) {
  if (!root || !verifyMarker(root, marker)) return "RETAINED_MARKER_CHECK_FAILED";

  const pid = ownedPostmasterPid(dataDirectory);
  if (pid === null) return "RETAINED_POSTMASTER_IDENTITY_UNCERTAIN";
  if (pid !== undefined) {
    const stop = run(pgCtl, ["-D", dataDirectory, "-m", "fast", "-w", "-t", "20", "stop"]);
    if (stop.status !== 0) return "RETAINED_STOP_FAILED";
  } else if (initialized) {
    const status = run(pgCtl, ["-D", dataDirectory, "status"]);
    if (status.status !== 3) return "RETAINED_SERVER_STATUS_UNCERTAIN";
  }

  if (ownedPostmasterPid(dataDirectory) !== undefined) return "RETAINED_POSTMASTER_STILL_PRESENT";
  if (Number.isInteger(port) && hasListenerOnPort(port)) return "RETAINED_PORT_STILL_LISTENING";
  if (!verifyMarker(root, marker)) return "RETAINED_MARKER_CHECK_FAILED";

  try {
    if (containsSymlink(root)) return "RETAINED_UNEXPECTED_SYMLINK";
    rmSync(root, { recursive: true, force: false, maxRetries: 0 });
    return "REMOVED";
  } catch {
    return "RETAINED_CLEANUP_FAILED";
  }
}

async function main() {
  let stage = "preflight";
  let root;
  let dataDirectory;
  let pgCtl;
  let port;
  let started = false;
  let initialized = false;
  let resultLine;
  let marker;

  try {
    if (process.getuid?.() === 0) fail(stage, "ROOT_EXECUTION_FORBIDDEN");
    const osUser = os.userInfo().username;
    if (!/^[a-z_][a-z0-9_-]{0,31}$/i.test(osUser)) fail(stage, "OS_USER_UNSUPPORTED");

    const binaries = ["initdb", "pg_ctl", "psql", "postgres"].map(findExecutable);
    if (binaries.some((binary) => !binary) || new Set(binaries.map((binary) => path.dirname(binary))).size !== 1) {
      fail(stage, "POSTGRES_BINARIES_UNAVAILABLE_OR_MIXED");
    }
    const [initdb, foundPgCtl, psql] = binaries;
    pgCtl = foundPgCtl;

    const tempBase = "/tmp";
    const tempInfo = lstatSync(tempBase);
    if (
      !tempInfo.isDirectory() ||
      tempInfo.isSymbolicLink() ||
      realpathSync(tempBase) !== tempBase ||
      (tempInfo.mode & 0o1777) !== 0o1777
    ) {
      fail(stage, "TEMP_BASE_NOT_CANONICAL");
    }
    root = mkdtempSync(path.join(tempBase, PREFIX));
    chmodSync(root, 0o700);
    assertPrivateDirectory(root);
    dataDirectory = path.join(root, "data");
    const socketDirectory = path.join(root, "socket");
    mkdirSync(dataDirectory, { mode: 0o700 });
    mkdirSync(socketDirectory, { mode: 0o700 });
    marker = {
      path: path.join(root, ".owner-marker"),
      value: `${randomBytes(24).toString("hex")}\n`,
    };
    writePrivateFile(marker.path, marker.value);

    stage = "cluster_init";
    requireCommandSuccess(
      run(initdb, ["-D", dataDirectory, "--username=postgres", "--auth-local=peer", "--auth-host=scram-sha-256", "--no-instructions"]),
      stage,
      "INITDB_FAILED",
    );
    initialized = true;

    stage = "configuration";
    port = await selectLoopbackPort();
    if (hasListenerOnPort(port)) fail(stage, "SELECTED_PORT_UNAVAILABLE");
    prepareClusterFiles(dataDirectory, socketDirectory, port, osUser);

    stage = "server_start";
    requireCommandSuccess(
      run(pgCtl, ["-D", dataDirectory, "-l", path.join(root, "postgres.log"), "-w", "-t", "25", "start"]),
      stage,
      "PG_CTL_START_FAILED",
    );
    started = true;
    if (hasListenerOnPort(port)) {
      // The SQL identity check below must prove that this listener is our server.
    } else {
      fail(stage, "LOOPBACK_LISTENER_NOT_FOUND");
    }

    stage = "role_database_setup";
    const password = randomBytes(32).toString("base64url");
    const sql = [
      `CREATE ROLE ${ROLE} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT PASSWORD '${password}';`,
      `CREATE DATABASE ${DATABASE} OWNER ${ROLE};`,
      `REVOKE ALL ON DATABASE ${DATABASE} FROM PUBLIC;`,
      `GRANT CONNECT ON DATABASE ${DATABASE} TO ${ROLE};`,
      "",
    ].join("\n");
    requireCommandSuccess(
      run(psql, ["-X", "-w", "-v", "ON_ERROR_STOP=1", "-h", socketDirectory, "-U", "postgres", "-d", "postgres"], sql),
      stage,
      "TEST_ROLE_DATABASE_SETUP_FAILED",
    );

    stage = "identity_check";
    const client = new pg.Client({
      host: "127.0.0.1",
      port,
      database: DATABASE,
      user: ROLE,
      password,
      ssl: false,
      connectionTimeoutMillis: 5000,
      application_name: "kinglike-ai-blog-local-test-cluster",
    });
    try {
      await client.connect();
      const query = await client.query(
        "SELECT current_database() AS database_name, current_user AS user_name, inet_server_addr()::text AS server_address, inet_server_port() AS server_port, current_setting('data_directory') AS data_directory",
      );
      const identity = query.rows[0];
      if (
        identity?.database_name !== DATABASE ||
        identity?.user_name !== ROLE ||
        identity?.server_address !== "127.0.0.1" ||
        Number(identity?.server_port) !== port ||
        realpathSync(identity?.data_directory ?? "") !== dataDirectory
      ) {
        fail(stage, "POSTGRES_IDENTITY_MISMATCH");
      }
      resultLine = `PASS stage=identity_check code=LOCAL_CLUSTER_IDENTITY_VERIFIED port=${port}`;
    } finally {
      await client.end().catch(() => fail("connection_close", "CLIENT_CLOSE_FAILED"));
    }
  } catch (error) {
    resultLine = error?.safeLine ?? `${SAFE_ERROR} stage=${stage} code=LOCAL_TEST_FAILED`;
  } finally {
    if (root && marker && dataDirectory && pgCtl) {
      let cleanupResult;
      try {
        cleanupResult = cleanup({ root, dataDirectory, marker, pgCtl, port, started, initialized });
      } catch {
        cleanupResult = "RETAINED_CLEANUP_CHECK_FAILED";
      }
      if (cleanupResult !== "REMOVED") resultLine = `${SAFE_ERROR} stage=cleanup code=${cleanupResult}`;
    } else if (root) {
      resultLine = `${SAFE_ERROR} stage=cleanup code=RETAINED_SETUP_INCOMPLETE`;
    }
  }

  console.log(resultLine ?? `${SAFE_ERROR} stage=runtime code=NO_RESULT`);
  if (!resultLine?.startsWith("PASS ")) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => {
    console.error(`${SAFE_ERROR} stage=runtime code=LOCAL_TEST_FAILED`);
    process.exitCode = 1;
  });
}
