import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import test from "node:test";
import {
  clearMetaReviewWhatsappEventsForTests,
  getMetaReviewWhatsappEvents,
  getMetaReviewWhatsappStatus,
  processMetaReviewWhatsappWebhook,
  sendMetaReviewWhatsappTestTemplate,
  validateMetaReviewWhatsappChallenge,
  type MetaReviewWhatsappEnvironment,
} from "./metaReviewWhatsappService";

const TEST_ENV: MetaReviewWhatsappEnvironment = {
  META_REVIEW_WA_TEST_ENABLED: "true",
  META_REVIEW_WA_TEST_WABA_ID: "123456789",
  META_REVIEW_WA_TEST_PHONE_NUMBER_ID: "987654321",
  META_REVIEW_WA_TEST_RECIPIENT: "+12025550101",
  META_REVIEW_WA_TEST_ACCESS_TOKEN: randomBytes(32).toString("hex"),
  META_REVIEW_WA_TEST_VERIFY_TOKEN: randomBytes(32).toString("hex"),
  META_REVIEW_WA_TEST_APP_SECRET: randomBytes(32).toString("hex"),
};

function signedBody(payload: unknown): { rawBody: Buffer; signature: string } {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature =
    "sha256=" +
    createHmac("sha256", TEST_ENV.META_REVIEW_WA_TEST_APP_SECRET!)
      .update(rawBody)
      .digest("hex");
  return { rawBody, signature };
}

function makePayload(overrides: {
  wabaId?: string;
  phoneNumberId?: string;
  sender?: string;
} = {}) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: overrides.wabaId ?? TEST_ENV.META_REVIEW_WA_TEST_WABA_ID,
      changes: [{
        field: "messages",
        value: {
          metadata: {
            phone_number_id:
              overrides.phoneNumberId ?? TEST_ENV.META_REVIEW_WA_TEST_PHONE_NUMBER_ID,
          },
          messages: [{
            id: "synthetic-wamid-1",
            from: overrides.sender ?? "12025550101",
            timestamp: "1791389928",
            type: "text",
            text: { body: "Hello from the test recipient" },
          }],
        },
      }],
    }],
  };
}

test("review webhook accepts only signed events from the configured test assets", () => {
  clearMetaReviewWhatsappEventsForTests();
  const signed = signedBody(makePayload());
  const result = processMetaReviewWhatsappWebhook(
    signed.rawBody,
    signed.signature,
    TEST_ENV,
  );
  assert.deepEqual(result, { accepted: true, added: 1 });
  assert.equal(getMetaReviewWhatsappEvents()[0]?.text, "Hello from the test recipient");

  const mismatchedPayload = makePayload({ wabaId: "444" });
  const mismatched = signedBody(mismatchedPayload);
  assert.deepEqual(
    processMetaReviewWhatsappWebhook(mismatched.rawBody, mismatched.signature, TEST_ENV),
    { accepted: true, added: 0 },
  );
  assert.equal(getMetaReviewWhatsappEvents().length, 1);
  clearMetaReviewWhatsappEventsForTests();
});

test("review webhook rejects bad signatures and does not retain payload data", () => {
  clearMetaReviewWhatsappEventsForTests();
  const signed = signedBody(makePayload());
  assert.deepEqual(
    processMetaReviewWhatsappWebhook(signed.rawBody, "sha256=" + "0".repeat(64), TEST_ENV),
    { accepted: false, reason: "invalid_signature" },
  );
  assert.equal(getMetaReviewWhatsappEvents().length, 0);
});

test("review webhook redacts token-like values before buffering message text", () => {
  clearMetaReviewWhatsappEventsForTests();
  const payload = makePayload();
  payload.entry[0].changes[0].value.messages[0].text.body =
    "Please ignore token=abc123 and long value abcdef0123456789abcdef0123456789";
  const signed = signedBody(payload);
  assert.deepEqual(
    processMetaReviewWhatsappWebhook(signed.rawBody, signed.signature, TEST_ENV),
    { accepted: true, added: 1 },
  );
  const text = getMetaReviewWhatsappEvents()[0]?.text ?? "";
  assert.match(text, /token=\[redacted\]/i);
  assert.doesNotMatch(text, /abc123|abcdef0123456789abcdef0123456789/);
  clearMetaReviewWhatsappEventsForTests();
});

test("challenge requires enabled test configuration and exact token", () => {
  assert.equal(
    validateMetaReviewWhatsappChallenge(
      "subscribe",
      TEST_ENV.META_REVIEW_WA_TEST_VERIFY_TOKEN,
      "challenge-123",
      TEST_ENV,
    ),
    "challenge-123",
  );
  assert.equal(
    validateMetaReviewWhatsappChallenge("subscribe", "wrong", "challenge-123", TEST_ENV),
    null,
  );
  assert.equal(
    validateMetaReviewWhatsappChallenge(
      "subscribe",
      TEST_ENV.META_REVIEW_WA_TEST_VERIFY_TOKEN,
      "challenge-123",
      { ...TEST_ENV, META_REVIEW_WA_TEST_ENABLED: "false" },
    ),
    null,
  );
});

test("fixed sender always targets configured test recipient and fixed hello_world template", async () => {
  clearMetaReviewWhatsappEventsForTests();
  let observedUrl = "";
  let observedInit: RequestInit | undefined;
  await sendMetaReviewWhatsappTestTemplate(TEST_ENV, async (input, init) => {
    observedUrl = String(input);
    observedInit = init;
    return { ok: true, status: 200 } as Response;
  });

  assert.equal(
    observedUrl,
    "https://graph.facebook.com/v23.0/987654321/messages",
  );
  assert.equal(observedInit?.method, "POST");
  assert.deepEqual(JSON.parse(String(observedInit?.body)), {
    messaging_product: "whatsapp",
    to: "12025550101",
    type: "template",
    template: { name: "hello_world", language: { code: "en_US" } },
  });
  assert.equal(getMetaReviewWhatsappEvents()[0]?.direction, "outbound");
  clearMetaReviewWhatsappEventsForTests();
});

test("failed test send logs only sanitized Meta error diagnostics", async () => {
  const warnings: unknown[][] = [];
  const originalWarn = console.warn;
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    await assert.rejects(
      sendMetaReviewWhatsappTestTemplate(TEST_ENV, async () =>
        new Response(
          JSON.stringify({
            error: {
              message:
                 `Recipient +12025550102 with phone ID 987654321 token=${TEST_ENV.META_REVIEW_WA_TEST_ACCESS_TOKEN} WAMID wamid.HBgM123456789012345`,
              type: "OAuthException",
              code: 131030,
              error_subcode: 2494010,
            },
          }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
      ),
      /HTTP 400/,
    );
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(warnings.length, 1);
  assert.equal(warnings[0]?.[0], "[meta-review-test] Meta Graph API send failed");
  const diagnostic = warnings[0]?.[1] as Record<string, unknown>;
  assert.deepEqual(diagnostic, {
    metaHttpStatus: 400,
    errorCode: 131030,
    errorSubcode: 2494010,
    errorMessage:
      "Recipient [redacted-number] with phone ID [redacted] token=[redacted] WAMID [redacted-wamid]",
  });
  assert.doesNotMatch(
    JSON.stringify(diagnostic),
    new RegExp(`1202555010[12]|987654321|${TEST_ENV.META_REVIEW_WA_TEST_ACCESS_TOKEN}|wamid\\.`, "i"),
  );
});

test("sender fails closed before network access when test mode is disabled", async () => {
  let fetchCalled = false;
  await assert.rejects(
    sendMetaReviewWhatsappTestTemplate(
      { ...TEST_ENV, META_REVIEW_WA_TEST_ENABLED: "false" },
      async () => {
        fetchCalled = true;
        throw new Error("must not be called");
      },
    ),
    /not configured/,
  );
  assert.equal(fetchCalled, false);
  assert.deepEqual(getMetaReviewWhatsappStatus({}).sendConfigured, false);
});
