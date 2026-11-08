import assert from "node:assert/strict";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pgBin = path.dirname(execFileSync("bash", ["-lc", "command -v initdb"], { encoding: "utf8" }).trim());
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "kinglike-staging-startup-"));
const dataDir = path.join(tempRoot, "data");
const socketDir = path.join(tempRoot, "socket");
const pgPort = await freePort();
let pgStarted = false;

async function freePort() {
  const server = await import("node:net").then(({ createServer }) => createServer());
  await new Promise((resolve, reject) => server.listen(0, "127.0.0.1", error => error ? reject(error) : resolve()));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

function pgCommand(name, args) {
  const result = spawnSync(path.join(pgBin, name), args, { encoding: "utf8" });
  if (result.status !== 0) throw new Error(`${name} failed (${result.status})`);
}

function makeEnv(overrides = {}) {
  const env = {};
  const strip = /(DATABASE_URL|_SECRET|_TOKEN|_KEY|PASSWORD|TWILIO|META_|WHATSAPP|RESEND|VAPID|CLOUDINARY|GMAIL|BOG_|STRIPE|OPENAI|RUNPOD)/i;
  for (const [key, value] of Object.entries(process.env)) if (!strip.test(key)) env[key] = value;
  Object.assign(env, {
    APP_DEPLOYMENT_MODE: "staging",
    NODE_ENV: "production",
    APP_STAGING_DATABASE_URL: `postgresql://runner@127.0.0.1:${pgPort}/kinglike_staging_test`,
    APP_STAGING_DATABASE_EXPECTED_HOST: "127.0.0.1",
    APP_STAGING_DATABASE_EXPECTED_NAME: "kinglike_staging_test",
    APP_STAGING_DATABASE_CONFIRMATION: "synthetic-local-test",
    APP_STAGING_STORAGE_CONFIRMATION: "synthetic-local-test",
    PRODUCTION_DATABASE_HOST: "production.invalid",
    PRODUCTION_DATABASE_NAME: "kinglike_production",
    NEON_DATABASE_URL: "postgresql://synthetic@production.invalid/kinglike_production",
    SESSION_SECRET: "synthetic-only-staging-startup-test-secret",
    ENABLE_BACKGROUND_SCHEDULERS: "true",
    ENABLE_META_LEADS_PROCESSOR: "true",
    META_LEAD_PULL_SYNC_ENABLED: "true",
    WHATSAPP_EMPLOYEE_MONITORING_ENABLED: "true",
    WHATSAPP_META_ONBOARDING_ENABLED: "true",
    ENABLE_EMAIL_NURTURING: "true",
    ...overrides,
  });
  return env;
}

function launch(env) {
  const appPort = Number(env.PORT);
  return spawn(process.execPath, [
    "--import", path.join(root, "scripts/staging-egress-fence.cjs"),
    "--import", "tsx",
    "server/index.ts",
  ], {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForHealth(child, url, timeoutMs = 25000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (child.exitCode !== null) throw new Error("server exited before health check");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) });
      if (response.status === 200) return;
    } catch {}
    await delay(150);
  }
  throw new Error("server did not become healthy before timeout");
}

async function waitForExit(child, timeoutMs = 15000) {
  if (child.exitCode !== null) return child.exitCode;
  return await Promise.race([
    new Promise(resolve => child.once("exit", code => resolve(code))),
    delay(timeoutMs).then(() => {
      child.kill("SIGKILL");
      throw new Error("server process exceeded shutdown/startup timeout");
    }),
  ]);
}

function collect(child) {
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  return () => output;
}

async function expectPreflightFailure(name, override) {
  const port = await freePort();
  const child = launch(makeEnv({ PORT: String(port), ...override }));
  const output = collect(child);
  const code = await waitForExit(child);
  assert.notEqual(code, 0, `${name}: expected startup failure`);
  assert.doesNotMatch(output(), /postgres(?:ql)?:\/\/|password|token|secret/i, `${name}: no credentials in logs`);
  assert.match(output(), /STAGING_DATABASE_ISOLATION_NOT_VERIFIED|APP_STAGING_DATABASE_URL is required/, name);
  console.log(`PASS expected closed startup: ${name}`);
}

try {
  await mkdir(dataDir, { mode: 0o700 });
  await mkdir(socketDir, { mode: 0o700 });
  pgCommand("initdb", ["-D", dataDir, "-U", "runner", "-A", "trust", "--no-locale"]);
  const start = spawnSync(path.join(pgBin, "pg_ctl"), [
    "-D", dataDir, "-l", path.join(tempRoot, "postgres.log"),
    "-o", `-k ${socketDir} -h 127.0.0.1 -p ${pgPort}`, "-w", "start",
  ], { encoding: "utf8" });
  if (start.status !== 0) throw new Error("temporary loopback PostgreSQL failed to start");
  pgStarted = true;
  pgCommand("createdb", ["-h", "127.0.0.1", "-p", String(pgPort), "-U", "runner", "kinglike_staging_test"]);

  await expectPreflightFailure("missing staging URL", { APP_STAGING_DATABASE_URL: undefined });
  await expectPreflightFailure("wrong expected host", { APP_STAGING_DATABASE_EXPECTED_HOST: "wrong.invalid" });
  await expectPreflightFailure("wrong expected DB name", { APP_STAGING_DATABASE_EXPECTED_NAME: "wrong_database" });
  await expectPreflightFailure("production host collision", { PRODUCTION_DATABASE_HOST: "127.0.0.1" });
  await expectPreflightFailure("production name collision", { PRODUCTION_DATABASE_NAME: "kinglike_staging_test" });

  const unavailablePort = await freePort();
  await expectPreflightFailure("unavailable staging DB", {
    APP_STAGING_DATABASE_URL: `postgresql://runner@127.0.0.1:${unavailablePort}/kinglike_staging_test`,
  });

  const appPort = await freePort();
  const child = launch(makeEnv({ PORT: String(appPort) }));
  const output = collect(child);
  try {
    await waitForHealth(child, `http://127.0.0.1:${appPort}/health`);
    const blocked = await fetch(`http://127.0.0.1:${appPort}/api/auth/send-verification`, { method: "POST" });
    assert.equal(blocked.status, 503);
    child.kill("SIGTERM");
    const code = await waitForExit(child);
    assert.equal(code, 0, "server should stop cleanly on SIGTERM");
    assert.match(output(), /\[EGRESS_FENCE\] blocked_attempts=0/);
    assert.match(output(), /\[StagingIsolation\] external messaging, Meta integrations, webhooks, and scheduled jobs disabled/);
    assert.doesNotMatch(output(), /Queue processor started|PullSync scheduler started|\[CountryBackfill\]/i);
    assert.doesNotMatch(output(), /postgres(?:ql)?:\/\/|password|token|secret/i);
    console.log("PASS full Staging server HTTP startup, blocked OTP route, clean shutdown, zero public egress");
  } catch (error) {
    child.kill("SIGKILL");
    throw error;
  }
} finally {
  if (pgStarted) {
    spawnSync(path.join(pgBin, "pg_ctl"), ["-D", dataDir, "-m", "fast", "stop"], { encoding: "utf8" });
  }
  await rm(tempRoot, { recursive: true, force: true });
}
