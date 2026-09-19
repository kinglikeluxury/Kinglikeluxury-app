import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isAllowedKayCallOrigin } from "./kayInternalCallService";

const service = readFileSync(new URL("./kayInternalCallService.ts", import.meta.url), "utf8");
const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
const schema = readFileSync(new URL("../shared/schema.ts", import.meta.url), "utf8");
const db = readFileSync(new URL("./db.ts", import.meta.url), "utf8");
const ownership = readFileSync(new URL("./kayDataOwnership.ts", import.meta.url), "utf8");
const internalDatabase = readFileSync(new URL("./kayInternalDatabase.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../artifacts/kay-internal-call-v1-migration.sql", import.meta.url), "utf8");

test("Kay internal calls are disabled by default and never use telephony", () => {
  assert.match(service, /KAY_INTERNAL_CALLS_ENABLED !== "true"/);
  assert.doesNotMatch(service, /calls\.create|Twilio|PSTN|phone_number|crm_leads/);
});

test("Kay internal calls use the existing session middleware for native WebSocket upgrades", () => {
  assert.match(routes, /const sessionMiddleware: RequestHandler = session/);
  assert.match(routes, /registerKayInternalCallRoutes\(app, httpServer, sessionMiddleware\)/);
  assert.match(service, /sessionMiddleware\(request as any, response as any/);
  assert.match(service, /\/ws\/kay-calls/);
  assert.doesNotMatch(service.slice(service.indexOf("async function getCall"), service.indexOf("async function getLatestRingingCall")), /withKayReadonlyAnalysis/);
  assert.match(service, /getLatestRingingCall\(userId\)/);
});

test("only the four authorized Kay users can participate and each signal reloads identity", () => {
  assert.match(service, /new Set\(\[1, 24, 29, 31\]\)/);
  assert.match(service, /SELECT id,username,is_admin,role,is_active FROM users/);
  assert.match(service, /const sender = await loadAuthorizedUser\(senderUserId\)/);
  assert.match(service, /if \(!initiator\.isAdmin\)/);
});

test("required signaling events and safe generic push fallback exist", () => {
  for (const event of [
    "call_offer", "call_answer", "ice_candidate", "call_reject", "call_end", "call_busy",
    "recording_notice_result", "recording_objection", "recording_upload_begin",
    "recording_upload_chunk", "recording_upload_complete",
  ]) {
    assert.match(service, new RegExp(`"${event}"`));
  }
  assert.match(service, /some\(socket => socket\.readyState === WebSocket\.OPEN\)/);
  assert.match(service, /title: "Kay is calling", body: "Kay is calling"/);
  assert.match(service, /data: \{ kayCall: true, path: "\/admin\/kay\/call" \}/);
  assert.match(service, /type: "incoming_call"/);
});

test("recording messages stay on the answering socket and finalize before READY", () => {
  assert.match(service, /KAY_RECORDING_ANSWERING_CONNECTION_REQUIRED/);
  assert.match(service, /pendingRecordingUploadsByCall/);
  assert.match(service, /await onKayCallEnded\(callId\)/);
  assert.match(service, /await finalizePendingKayRecording\(callId\)/);
  assert.match(service, /KAY_DIRECT_CALL_AUDIO_NOT_CAPTURED/);
  assert.match(service, /MAX_RECORDING_CHUNK_BYTES = 40 \* 1024/);
  assert.match(service, /client\.send\(JSON\.stringify\(\{\s*type: "recording_upload_result"/);
});

test("WebSocket origin is restricted to the request host", () => {
  assert.equal(isAllowedKayCallOrigin({ headers: { host: "app.example", origin: "https://app.example" } } as any), true);
  assert.equal(isAllowedKayCallOrigin({ headers: { host: "app.example", origin: "https://evil.example" } } as any), false);
  assert.equal(isAllowedKayCallOrigin({ headers: { host: "app.example" } } as any), false);
});

test("session and both participants are revalidated for signaling", () => {
  assert.match(service, /reloadSocketSession\(request\)/);
  assert.match(service, /currentUserId !== client\.kayUserId/);
  assert.match(service, /loadAuthorizedUser\(Number\(call\.initiated_by_user_id\)\)/);
  assert.match(service, /loadAuthorizedUser\(Number\(call\.target_user_id\)\)/);
  assert.match(service, /call\.caller !== "KAY"/);
  assert.match(service, /initiator\.id !== 1/);
  assert.match(service, /initiatorConnectionId/);
  assert.match(service, /requiredConnectionId/);
  assert.match(service, /excludedConnectionId/);
  assert.match(service, /KAY_INTERNAL_CALL_SELF_TARGET_REQUIRES_SECOND_SESSION/);
  assert.match(service, /await sendToSocketIfAuthorized\(client, \{/);
});

test("offline signals are bounded and lifecycle transitions are atomic", () => {
  assert.match(service, /MAX_QUEUED_SIGNALS_PER_USER = 96/);
  assert.match(service, /SIGNAL_TTL_MS = 2 \* 60 \* 1000/);
  assert.match(service, /deliverOrQueueSignal/);
  assert.match(service, /flushQueuedSignals/);
  assert.match(service, /status=ANY\(\$3::text\[\]\)/);
  assert.match(service, /endCallsForDisconnectedUser/);
  assert.match(service, /answeringConnectionByCall/);
  assert.match(service, /endCallsForDisconnectedSocket/);
  assert.match(service, /id=ANY\(\$1::int\[\]\).*status IN \('RINGING','ACTIVE'\)/s);
});

test("signaling shape, size, state, and direction are enforced server-side", () => {
  assert.match(service, /maxPayload: MAX_RAW_MESSAGE_BYTES/);
  assert.match(service, /MAX_RAW_MESSAGE_BYTES = 64 \* 1024/);
  assert.match(service, /assertExactKeys\(message, \["type", "callId", "sdp"\]\)/);
  assert.match(service, /assertExactKeys\(message, \["type", "callId", "candidate"\]\)/);
  assert.match(service, /call\.status !== "RINGING"/);
  assert.match(service, /\["RINGING", "ACTIVE"\]\.includes\(call\.status\)/);
  assert.match(service, /sdp: message\.sdp/);
  assert.match(service, /candidate: message\.candidate/);
  assert.doesNotMatch(service, /payload: message\.payload/);
  assert.match(service, /type: "incoming_call"/);
});

test("idempotency conflicts are rejected and title is sanitized without persistence", () => {
  assert.match(service, /KAY_INTERNAL_CALL_IDEMPOTENCY_CONFLICT/);
  assert.match(service, /slice\(0, 120\)/);
  assert.match(service, /targetName: target\.username/);
  assert.match(service, /callId: call\.id/);
  assert.doesNotMatch(schema.slice(schema.indexOf("kayInternalCallSessions"), schema.indexOf("export type KayInternalCallSession")), /title/);
});

test("call sessions are Kay-owned and DDL is additive but not startup-wired", () => {
  assert.match(schema, /kayInternalCallSessions = pgTable\("kay_internal_call_sessions"/);
  assert.match(db, /CREATE TABLE IF NOT EXISTS kay_internal_call_sessions/);
  assert.match(ownership, /kay_internal_call_sessions.*KAY_OWNED/);
  assert.match(ownership, /KAY_INTERNAL_OPTIONAL_WRITABLE_TABLES/);
  assert.match(internalDatabase, /KAY_INTERNAL_CALLS_ENABLED === "true"/);
  assert.match(migration, /GRANT SELECT, INSERT, UPDATE ON TABLE kay_internal_call_sessions TO kay_internal_writer/);
  assert.doesNotMatch(migration, /\b(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\s+crm_/i);
  assert.doesNotMatch(readFileSync(new URL("./index.ts", import.meta.url), "utf8"), /ensureKayTables\(\)/);
});

test("call persistence has no CRM/customer fields or audio recording", () => {
  const callSchema = schema.slice(schema.indexOf("kayInternalCallSessions"), schema.indexOf("export type KayInternalCallSession"));
  assert.match(callSchema, /targetUserId: integer\("target_user_id"\)/);
  assert.match(callSchema, /reasonCode: text\("reason_code"\)/);
  assert.doesNotMatch(callSchema, /leadId|phone|audio|record/);
});

test("after-hours Tarek test override is narrow, expiring, and single-use", () => {
  assert.match(service, /initiationType === "ADMIN_TEST"/);
  assert.match(service, /reasonCode === "ADMIN_TEST"/);
  assert.match(service, /initiator\.id === 1/);
  assert.match(service, /target\.id === 1/);
  assert.match(service, /KAY_AUTOMATIC_INTERNAL_CALLS_ENABLED === "false"/);
  assert.match(service, /KAY_AFTER_HOURS_TAREK_TEST_STARTED_AT/);
  assert.match(service, /Number\.isNaN\(startedAt\.getTime\(\)\)/);
  assert.match(service, /15 \* 60 \* 1000/);
  assert.match(service, /KAY_TAREK_ADMIN_TEST_RETRY_ENABLED/);
  assert.match(service, /KAY_TAREK_ADMIN_TEST_RETRY_WINDOW_SCOPED/);
  assert.match(service, /created_at >= \$1/);
  assert.match(service, /created_at < \$2/);
  assert.match(service, /adminTestAllowedCount/);
  assert.match(service, /status IN \('RINGING','ACTIVE'\)/);
  assert.match(service, /reason_code='ADMIN_TEST'/);
  assert.match(service, /KAY_AFTER_HOURS_TAREK_TEST_ALREADY_CONSUMED/);
  assert.match(service, /KAY_AFTER_HOURS_TAREK_TEST_OVERRIDE_INACTIVE/);
  assert.match(service, /disableAfterHoursTarekTestRuntime/);
});

test("direct Kay caller has no caller socket and exposes target lifecycle", () => {
  assert.match(service, /\/api\/admin\/kay\/internal-calls\/test-readiness/);
  assert.match(service, /ready: consumedCount < adminTestAllowedCount\(now\)/);
  assert.match(service, /\/api\/admin\/kay\/internal-calls\/start/);
  assert.match(service, /target_user_id/);
  assert.match(service, /reason_code/);
  assert.match(service, /test_mode/);
  assert.match(service, /KAY_DIRECT_CALL_TARGET_MUST_BE_TAREK/);
  assert.match(service, /const meaningfulActionItems = testMode\s*\?\s*true/);
  assert.match(service, /if \(!testMode\) \{/);
  assert.match(service, /type: "KAY_CALL_INCOMING"/);
  assert.match(service, /call_session_id/);
  assert.match(service, /display_title/);
  assert.match(service, /for \(const \[action, nextStatus, allowed\]/);
  assert.match(service, /action !== "answer"/);
  assert.match(service, /nextStatus, \[\.\.\.allowed\]/);
  assert.match(service, /KAY_AFTER_HOURS_TAREK_TEST_ALREADY_CONSUMED/);
  assert.match(service, /KAY_TAREK_ADMIN_TEST_ONLY/);
  assert.match(service, /KAY_INTERNAL_CALL_RESERVED_IDEMPOTENCY_KEY/);
  assert.match(service, /\/\^DIRECT_\/i/);
  assert.match(service, /KAY_DIRECT_CALL_TEST_MODE_REASON_MISMATCH/);
  assert.match(service, /status IN \('RINGING','ACTIVE'\)/);
  assert.match(service, /KAY_DIRECT_CALL_EXPIRED/);
  assert.match(service, /getLatestRingingCall\(userId\)/);
  assert.match(service, /if \(isDirectCall\(call\)\)/);
  assert.match(service, /type: "incoming_call"/);
});

test("only Tarek ADMIN_TEST direct recordings may use the plumbing fixture", () => {
  assert.match(service, /function isAllowedDirectKayRecordingTest/);
  assert.match(service, /call\.reason_code === "ADMIN_TEST"/);
  assert.match(service, /Number\(call\.target_user_id\) === 1/);
  assert.match(service, /Number\(call\.initiated_by_user_id\) === 1/);
  assert.match(service, /isDirectCall\(call\) && !isAllowedDirectKayRecordingTest\(call\)/);
  assert.match(service, /KAY_DIRECT_CALL_AUDIO_NOT_CAPTURED/);
  assert.match(service, /finalizeKayRecordingAndUpload/);
  assert.doesNotMatch(service.slice(service.indexOf("function isAllowedDirectKayRecordingTest"), service.indexOf("function directExpiry")), /crm_/i);
});