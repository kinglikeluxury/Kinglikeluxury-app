import assert from "node:assert/strict";
import test from "node:test";
import { parseAiBlogUsageResponse } from "./aiBlogUsageResponse";

test("missing AI Blog usage schema becomes an unconfigured state", async () => {
  const response = new Response(JSON.stringify({
    code: "AI_BLOG_USAGE_SCHEMA_MISSING",
    message: "Apply the separate usage migration before viewing usage.",
  }), { status: 503 });

  assert.deepEqual(await parseAiBlogUsageResponse(response), {
    configured: false,
    message: "Apply the separate usage migration before viewing usage.",
  });
});

test("unexpected usage API failures remain visible errors", async () => {
  const response = new Response(JSON.stringify({
    message: "Request failed.",
  }), { status: 500 });

  await assert.rejects(
    parseAiBlogUsageResponse(response),
    /Request failed\./,
  );
});
