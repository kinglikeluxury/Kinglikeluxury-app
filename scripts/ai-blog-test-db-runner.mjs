import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";

const safePairs = new Set([
  "configuration:TEST_DATABASE_CONFIG_INVALID",
  "tcp_connect:TCP_CONNECTION_REFUSED",
  "tcp_connect:TCP_CONNECTION_TIMEOUT",
  "tcp_connect:POSTGRES_DATABASE_NOT_FOUND",
  "tcp_connect:DATABASE_OPERATION_FAILED",
  "postgres_authentication:POSTGRES_AUTHENTICATION_FAILED",
  "postgres_authentication:POSTGRES_HBA_REJECTED",
  "postgres_authentication:POSTGRES_ROLE_NOT_FOUND",
  "postgres_authentication:POSTGRES_CONNECTION_REJECTED",
  "identity_check:DATABASE_IDENTITY_MISMATCH",
  "identity_check:DATABASE_OPERATION_FAILED",
  "migration:DATABASE_OPERATION_FAILED",
  "pool_close:DATABASE_CLOSE_FAILED",
  "script_runtime:SCRIPT_RUNTIME_FAILED",
]);

const safeLinePattern = /^AI_BLOG_TEST_DB_ERROR stage=([a-z_]+) code=([A-Z_]+)$/;
const successLine = "Verified isolated PostgreSQL target: ai_blog_drafts_test on loopback.";

export function extractSafeDiagnostic(stdout = "", stderr = "") {
  for (const line of `${stdout}\n${stderr}`.split(/\r?\n/)) {
    const match = line.trim().match(safeLinePattern);
    if (!match) continue;
    const pair = `${match[1]}:${match[2]}`;
    if (safePairs.has(pair)) return { stage: match[1], code: match[2] };
  }
  return undefined;
}

export function formatRunnerResult({ status, signal, error, stdout = "", stderr = "" }) {
  if (error) {
    return {
      ok: false,
      exitCode: 1,
      line: "AI_BLOG_TEST_DB_ERROR stage=runner_startup code=RUNNER_START_FAILED exit_code=127",
    };
  }

  const childExitCode = Number.isInteger(status) ? status : 1;
  const diagnostic = extractSafeDiagnostic(stdout, stderr);
  if (childExitCode !== 0) {
    if (diagnostic) {
      return {
        ok: false,
        exitCode: childExitCode,
        line: `AI_BLOG_TEST_DB_ERROR stage=${diagnostic.stage} code=${diagnostic.code} exit_code=${childExitCode}`,
      };
    }
    return {
      ok: false,
      exitCode: childExitCode,
      line: `AI_BLOG_TEST_DB_ERROR stage=script_startup code=SCRIPT_STARTUP_FAILED exit_code=${childExitCode}`,
    };
  }

  if (`${stdout}\n${stderr}`.split(/\r?\n/).some((line) => line.trim() === successLine)) {
    return {
      ok: true,
      exitCode: 0,
      line: "AI_BLOG_TEST_DB_RESULT stage=complete code=VERIFY_OK exit_code=0",
    };
  }

  return {
    ok: false,
    exitCode: 1,
    line: `AI_BLOG_TEST_DB_ERROR stage=script_startup code=SCRIPT_PROTOCOL_FAILED exit_code=${childExitCode}`,
  };
}

export function runVerify(args = process.argv.slice(2)) {
  const command = args[0] ?? "verify";
  if (command !== "verify") {
    console.error("AI_BLOG_TEST_DB_ERROR stage=runner_startup code=RUNNER_ARGUMENTS_INVALID exit_code=2");
    process.exitCode = 2;
    return;
  }

  const scriptPath = path.resolve("scripts/ai-blog-test-db.ts");
  const child = spawnSync(
    process.execPath,
    ["--import", "tsx", scriptPath, "verify"],
    { encoding: "utf8", maxBuffer: 1024 * 1024 },
  );
  const result = formatRunnerResult(child);
  (result.ok ? console.log : console.error)(result.line);
  process.exitCode = result.exitCode;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    runVerify();
  } catch {
    console.error("AI_BLOG_TEST_DB_ERROR stage=runner_startup code=RUNNER_START_FAILED exit_code=127");
    process.exitCode = 1;
  }
}
