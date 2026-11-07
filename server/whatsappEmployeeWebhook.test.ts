import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { isEligibleRegistration, normalizeWhatsappWebhook, verifyWhatsappSignature } from "./whatsappEmployeeWebhook";

test("validates raw-body HMAC and rejects altered or malformed signatures", () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const secret = "synthetic-test-secret";
  const signature = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  assert.equal(verifyWhatsappSignature(body, signature, secret), true);
  assert.equal(verifyWhatsappSignature(Buffer.from(body.toString() + " "), signature, secret), false);
  assert.equal(verifyWhatsappSignature(body, "Bearer synthetic", secret), false);
});

test("normalizes message, status, and eligible coexistence echo fields with stable dedupe keys", () => {
  const base = { object: "whatsapp_business_account", entry: [{ id: "synthetic-waba", changes: [
    { field: "messages", value: { metadata: { phone_number_id: "synthetic-phone" },
      messages: [{ id: "wamid-in", from: "synthetic-contact", type: "text", text: { body: "hello" }, timestamp: "100" }],
      statuses: [{ id: "wamid-out", recipient_id: "synthetic-contact", status: "delivered", timestamp: "101" }] } },
    { field: "smb_message_echoes", value: { metadata: { phone_number_id: "synthetic-phone" },
      messages: [{ id: "wamid-echo", from: "synthetic-contact", type: "text", text: { body: "sent" } }] } },
  ] }] };
  const events = normalizeWhatsappWebhook(base);
  assert.equal(events.length, 3);
  assert.deepEqual(events.map((event) => event.direction), ["inbound", "status", "outbound"]);
  assert.equal(events[0].eventKey, "message:wamid-in");
  assert.equal(events[2].sourceField, "smb_message_echoes");
  assert.equal(normalizeWhatsappWebhook(base)[0].eventKey, events[0].eventKey);
  assert.equal(normalizeWhatsappWebhook({ object: "page", entry: base.entry }).length, 0);
});

test("ignores unknown and untrusted changes rather than treating them as employee messages", () => {
  assert.equal(normalizeWhatsappWebhook({ object: "whatsapp_business_account", entry: [{
    id: "waba", changes: [{ field: "account_update", value: { messages: [{}] } }],
  }] }).length, 0);
});

test("requires company authorization and active employee consent; Coexistence echoes are gated", () => {
  const registration = {
    is_active: true, consent_status: "consented", revoked_at: null,
    business_authorized_at: "synthetic-time", coexistence_enabled: true,
  };
  assert.equal(isEligibleRegistration(registration, "messages"), true);
  assert.equal(isEligibleRegistration({ ...registration, revoked_at: "synthetic-revocation" }, "messages"), false);
  assert.equal(isEligibleRegistration({ ...registration, consent_status: "revoked" }, "messages"), false);
  assert.equal(isEligibleRegistration({ ...registration, business_authorized_at: null }, "messages"), false);
  assert.equal(isEligibleRegistration({ ...registration, coexistence_enabled: false }, "smb_message_echoes"), false);
});
