import test from "node:test";
import assert from "node:assert/strict";
import {
  assessOneTimeHistorySync,
  InvalidHistoryPayload,
  summarizeVerifiedHistoryWebhook,
} from "./whatsappHistorySyncPreflight";

const expected = {
  wabaId: "123456789001",
  phoneNumberId: "123456789002",
  displayPhoneNumber: "+1 555 000 0001",
};

const validGate = {
  verifiedCoexistence: true, employeeConsented: true, customerNoticeApproved: true,
  companyNumberAuthorized: true, subscribedToHistoryWebhook: true,
  archiveAndAuditReady: true, hasAlreadyRequestedHistory: false,
  onboardedAtMs: 1800000000000, nowMs: 1800000000000 + 23 * 60 * 60 * 1000,
};

const makePayload = (history: unknown[]) => ({
  object: "whatsapp_business_account",
  entry: [{ id: expected.wabaId, changes: [{
    field: "history",
    value: { messaging_product: "whatsapp", metadata: {
      phone_number_id: expected.phoneNumberId, display_phone_number: "15550000001",
    }, history },
  }] }],
});

const chunk = (phase: number, order: number, progress: number, msg = "sensitive synthetic content") => ({
  metadata: { phase, chunk_order: order, progress },
  threads: [{
    id: "secret-customer-number",
    messages: [{ id: "secret-wamid", from: "secret-customer-number", type: "text",
      text: { body: msg }, timestamp: "1799999999" }],
  }],
});

test("never triggers history sync unless every preflight gate and one-time 24h window is valid", () => {
  assert.deepEqual(assessOneTimeHistorySync(validGate), { mayRequest: true, reason: "ready" });
  assert.deepEqual(assessOneTimeHistorySync({ ...validGate, verifiedCoexistence: false }),
    { mayRequest: false, reason: "not_verified" });
  assert.deepEqual(assessOneTimeHistorySync({ ...validGate, employeeConsented: false }),
    { mayRequest: false, reason: "notice_or_consent_missing" });
  assert.deepEqual(assessOneTimeHistorySync({ ...validGate, customerNoticeApproved: false }),
    { mayRequest: false, reason: "notice_or_consent_missing" });
  assert.deepEqual(assessOneTimeHistorySync({ ...validGate, subscribedToHistoryWebhook: false }),
    { mayRequest: false, reason: "webhook_not_subscribed" });
  assert.deepEqual(assessOneTimeHistorySync({ ...validGate, archiveAndAuditReady: false }),
    { mayRequest: false, reason: "archive_not_ready" });
  assert.deepEqual(assessOneTimeHistorySync({ ...validGate, hasAlreadyRequestedHistory: true }),
    { mayRequest: false, reason: "already_requested" });
  assert.deepEqual(assessOneTimeHistorySync({ ...validGate, nowMs: validGate.onboardedAtMs + 86400000 }),
    { mayRequest: false, reason: "outside_24h_window" });
  assert.deepEqual(assessOneTimeHistorySync({ ...validGate, nowMs: validGate.onboardedAtMs - 1 }),
    { mayRequest: false, reason: "outside_24h_window" });
});

test("accepts out-of-order phase/chunks without leaking message or contact contents", () => {
  const a = summarizeVerifiedHistoryWebhook(
    makePayload([chunk(2, 4, 100), chunk(0, 1, 25), chunk(1, 2, 60)]), expected);
  assert.equal(a.length, 3);
  assert.deepEqual(a.map((x) => [x.phase, x.chunkOrder, x.progress]), [
    [2, 4, 100], [0, 1, 25], [1, 2, 60],
  ]);
  assert.equal(a[0].reportedComplete, true);
  assert.equal(a[0].threadCount, 1);
  assert.equal(a[0].messageCount, 1);
  assert.equal(a.every((x) => /^[a-f0-9]{64}$/.test(x.chunkKey) &&
    /^[a-f0-9]{64}$/.test(x.contentDigest)), true);
  assert.doesNotMatch(JSON.stringify(a), /secret-customer|secret-wamid|sensitive synthetic/);
});

test("exact duplicate batches are deduplicated; conflicting phase/order is rejected", () => {
  const c = chunk(1, 3, 60);
  const a = summarizeVerifiedHistoryWebhook(makePayload([c, c]), expected);
  assert.equal(a.length, 1);
  assert.throws(() => summarizeVerifiedHistoryWebhook(
    makePayload([c, chunk(1, 3, 60, "different private message")]), expected,
  ), InvalidHistoryPayload);
});

test("history sharing declined is recognized without materializing private messages", () => {
  const result = summarizeVerifiedHistoryWebhook(
    makePayload([{ errors: [{ code: 2593109, title: "User declined" }] }]), expected);
  assert.equal(result.length, 1);
  assert.equal(result[0].kind, "declined");
  assert.equal(result[0].messageCount, 0);
  assert.equal(result[0].reportedComplete, false);
});

test("wrong WABA/phone, suspicious progress and overly large message batches are rejected", () => {
  const payload = makePayload([chunk(0, 1, 20)]);
  assert.throws(() => summarizeVerifiedHistoryWebhook({
    ...payload, entry: [{ ...payload.entry[0], id: "999999999999" }],
  }, expected), InvalidHistoryPayload);
  assert.throws(() => summarizeVerifiedHistoryWebhook({
    ...payload, entry: [{ ...payload.entry[0], changes: [{
      ...payload.entry[0].changes[0], value: {
        ...payload.entry[0].changes[0].value,
        metadata: { ...payload.entry[0].changes[0].value.metadata,
          phone_number_id: "888888888888" },
      },
    }] }],
  }, expected), InvalidHistoryPayload);
  assert.throws(() => summarizeVerifiedHistoryWebhook(makePayload([chunk(0, 1, 101)]), expected),
    InvalidHistoryPayload);
  assert.throws(() => summarizeVerifiedHistoryWebhook(makePayload([chunk(3, 1, 20)]), expected),
    InvalidHistoryPayload);
  assert.throws(() => summarizeVerifiedHistoryWebhook(makePayload([{
    metadata: { phase: 0, chunk_order: 1, progress: 25 },
    threads: [{ id: "fake", messages: new Array(50001).fill(null) }],
  }]), expected), InvalidHistoryPayload);
  assert.throws(() => summarizeVerifiedHistoryWebhook({ object: "page", entry: payload.entry }, expected),
    InvalidHistoryPayload);
});

test("unknown webhook fields cannot impersonate history", () => {
  const p = makePayload([chunk(0, 1, 25)]);
  p.entry[0].changes[0].field = "messages";
  assert.deepEqual(summarizeVerifiedHistoryWebhook(p, expected), []);
});
