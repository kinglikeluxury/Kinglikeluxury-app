import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assertKayOneTurnCall } from "./kayOneTurnConversationService";

const service = readFileSync(new URL("./kayOneTurnConversationService.ts", import.meta.url), "utf8");
const callService = readFileSync(new URL("./kayInternalCallService.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../artifacts/kay-internal-call-v1-migration.sql", import.meta.url), "utf8");

test("one-turn scope is fail-closed to Tarek ADMIN_TEST calls", () => {
  const prior = process.env.KAY_AUTOMATIC_INTERNAL_CALLS_ENABLED;
  process.env.KAY_AUTOMATIC_INTERNAL_CALLS_ENABLED = "false";
  try {
    assert.doesNotThrow(() => assertKayOneTurnCall({
      id: 41,
      caller: "KAY",
      status: "ACTIVE",
      target_user_id: 1,
      initiated_by_user_id: 1,
      reason_code: "ADMIN_TEST",
      idempotency_key: "DIRECT_ADMIN_TEST_fixture",
    }));
    assert.throws(() => assertKayOneTurnCall({
      id: 41,
      caller: "KAY",
      status: "ACTIVE",
      target_user_id: 24,
      initiated_by_user_id: 1,
      reason_code: "ADMIN_TEST",
      idempotency_key: "DIRECT_ADMIN_TEST_fixture",
    }), /KAY_ONE_TURN_SCOPE_DENIED/);
  } finally {
    if (prior === undefined) delete process.env.KAY_AUTOMATIC_INTERNAL_CALLS_ENABLED;
    else process.env.KAY_AUTOMATIC_INTERNAL_CALLS_ENABLED = prior;
  }
});

test("gateway is bound to the authenticated answering socket and notice state", () => {
  assert.match(callService, /\/api\/admin\/kay\/internal-calls\/:callId\/one-turn/);
  assert.match(callService, /X-Kay-Connection-Id|x-kay-connection-id/);
  assert.match(callService, /answeringConnectionByCall\.get\(callId\) === connectionId/);
  assert.match(callService, /processKayOneTurn/);
  assert.match(service, /r\.notice_status='PLAYED'/);
  assert.match(service, /ON CONFLICT \(call_session_id\) DO NOTHING/);
  assert.match(migration, /kay_voice_one_turn_sessions/);
});

test("reasoning adapter has no CRM/customer mutation path", () => {
  assert.match(service, /customerDataIncluded: false/);
  assert.match(service, /read-only|read only|الرد فقط/);
  assert.doesNotMatch(service, /INSERT INTO\s+crm_|UPDATE\s+crm_|DELETE FROM\s+crm_/i);
  assert.doesNotMatch(service, /lead_id|phone_number|crm_leads|crm_tasks|crm_notes/);
  assert.match(service, /KAY_ONE_TURN_REASONING_TIMEOUT/);
  assert.match(service, /KAY_ONE_TURN_\$\{stage\}_TIMEOUT/);
});