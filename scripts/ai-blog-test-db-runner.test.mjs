import assert from "node:assert/strict";
import test from "node:test";
import { extractSafeDiagnostic, formatRunnerResult } from "./ai-blog-test-db-runner.mjs";

test("runner accepts only allowlisted diagnostic lines", () => {
  assert.deepEqual(
    extractSafeDiagnostic("", "AI_BLOG_TEST_DB_ERROR stage=postgres_authentication code=POSTGRES_AUTHENTICATION_FAILED"),
    { stage: "postgres_authentication", code: "POSTGRES_AUTHENTICATION_FAILED" },
  );
  assert.equal(
    extractSafeDiagnostic("", "AI_BLOG_TEST_DB_ERROR stage=unknown code=PRIVATE_SECRET"),
    undefined,
  );
});

test("runner preserves safe identity failure and adds child exit code", () => {
  assert.deepEqual(
    formatRunnerResult({
      status: 1,
      stdout: "",
      stderr: "AI_BLOG_TEST_DB_ERROR stage=identity_check code=DATABASE_IDENTITY_MISMATCH",
    }),
    {
      ok: false,
      exitCode: 1,
      line: "AI_BLOG_TEST_DB_ERROR stage=identity_check code=DATABASE_IDENTITY_MISMATCH exit_code=1",
    },
  );
});

test("runner preserves the classifier's generic TCP connection failure", () => {
  assert.deepEqual(
    formatRunnerResult({
      status: 1,
      stdout: "",
      stderr: "AI_BLOG_TEST_DB_ERROR stage=tcp_connect code=DATABASE_OPERATION_FAILED",
    }),
    {
      ok: false,
      exitCode: 1,
      line: "AI_BLOG_TEST_DB_ERROR stage=tcp_connect code=DATABASE_OPERATION_FAILED exit_code=1",
    },
  );
});

test("tsx or import startup failure becomes a safe startup diagnostic", () => {
  const raw = "Error [ERR_MODULE_NOT_FOUND]: postgresql://private-user:private-pass@host/db\nat loadSecret()";
  const result = formatRunnerResult({ status: 1, stdout: "", stderr: raw });
  assert.equal(
    result.line,
    "AI_BLOG_TEST_DB_ERROR stage=script_startup code=SCRIPT_STARTUP_FAILED exit_code=1",
  );
  for (const sensitive of ["private-user", "private-pass", "host", "loadSecret"]) {
    assert.equal(result.line.includes(sensitive), false);
  }
});

test("runner startup failures do not expose underlying error details", () => {
  const result = formatRunnerResult({
    status: null,
    error: new Error("private DSN and password"),
  });
  assert.equal(
    result.line,
    "AI_BLOG_TEST_DB_ERROR stage=runner_startup code=RUNNER_START_FAILED exit_code=127",
  );
  assert.equal(result.line.includes("password"), false);
});

test("verify success is reported only for the exact safe success line", () => {
  assert.deepEqual(
    formatRunnerResult({ status: 0, stdout: "Verified isolated PostgreSQL target: ai_blog_drafts_test on loopback.\n" }),
    {
      ok: true,
      exitCode: 0,
      line: "AI_BLOG_TEST_DB_RESULT stage=complete code=VERIFY_OK exit_code=0",
    },
  );
  assert.equal(formatRunnerResult({ status: 0, stdout: "unexpected output" }).ok, false);
});
