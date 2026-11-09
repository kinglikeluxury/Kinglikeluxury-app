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

test("normalizes standard messages, statuses, and official Coexistence echo payloads", () => {
  const base = { object: "whatsapp_business_account", entry: [{ id: "synthetic-waba", changes: [
    { field: "messages", value: { metadata: { phone_number_id: "synthetic-phone" },
      contacts: [{ wa_id: "15550000002", user_id: "synthetic-user-2" }],
      messages: [{ id: "wamid-in", from: "15550000002", type: "text", text: { body: "hello" }, timestamp: "100" }],
      statuses: [{ id: "wamid-out", recipient_id: "15550000002", status: "delivered", timestamp: "101" }] } },
    { field: "smb_message_echoes", value: {
      metadata: { phone_number_id: "synthetic-phone", display_phone_number: "+15550000001" },
      contacts: [{ wa_id: "15550000002", user_id: "synthetic-user-2" }],
      message_echoes: [
        { id: "wamid-echo", from: "15550000001", to: "15550000002", to_user_id: "synthetic-user-2",
          type: "text", text: { body: "sent" }, timestamp: "102" },
        { id: "wamid-photo", from: "15550000001", to: "15550000002", to_user_id: "synthetic-user-2",
          type: "image", image: { caption: "photo caption", id: "synthetic-media-id", url: "https://invalid.example/media" } },
        { id: "wamid-doc", from: "15550000001", to: "15550000002", to_user_id: "synthetic-user-2",
          type: "document", document: { caption: "document caption", id: "synthetic-doc-id" } },
      ] } },
  ] }] };
  const events = normalizeWhatsappWebhook(base);
  assert.equal(events.length, 5);
  assert.deepEqual(events.map((event) => event.direction), ["inbound", "status", "outbound", "outbound", "outbound"]);
  assert.equal(events[0].eventKey, "message:wamid-in");
  assert.equal(events[2].contactWaId, "15550000002");
  assert.equal(events[2].contactUserId, "synthetic-user-2");
  assert.equal(events[2].eventKey, "echo:message:wamid-echo");
  assert.equal(events[3].text, "photo caption");
  assert.equal(events[4].text, "document caption");
  assert.equal(JSON.stringify(events).includes("invalid.example"), false);
  assert.equal(normalizeWhatsappWebhook(base)[2].eventKey, events[2].eventKey);
  assert.equal(normalizeWhatsappWebhook({ object: "page", entry: base.entry }).length, 0);
});

test("normalizes documented edit/revoke references as separate immutable events", () => {
  const payload = { object: "whatsapp_business_account", entry: [{ id: "synthetic-waba", changes: [{
    field: "smb_message_echoes",
    value: {
      metadata: { phone_number_id: "synthetic-phone", display_phone_number: "15550000001" },
      message_echoes: [
        { id: "synthetic-edit-event", from: "15550000001", to: "15550000002", to_user_id: "synthetic-user-2",
          type: "edit", edit: { original_message_id: "synthetic-original", message: { type: "image", image: { caption: "edited caption" } } } },
        { id: "synthetic-revoke-event", from: "15550000001", to: "15550000002", to_user_id: "synthetic-user-2",
          type: "revoke", revoke: { original_message_id: "synthetic-original" } },
      ],
    },
  }] }] };
  const events = normalizeWhatsappWebhook(payload);
  assert.deepEqual(events.map((event) => event.kind), ["edit", "revoke"]);
  assert.deepEqual(events.map((event) => event.relatedMessageId), ["synthetic-original", "synthetic-original"]);
  assert.equal(events[0].text, "edited caption");
  assert.equal(events[1].text, null);
});

test("rejects unknown/mismatched echo sender and recipient identity", () => {
  const make = (overrides: any = {}) => ({
    object: "whatsapp_business_account",
    entry: [{ id: "synthetic-waba", changes: [{ field: "smb_message_echoes", value: {
      metadata: { phone_number_id: "synthetic-phone", display_phone_number: "15550000001" },
      contacts: [{ wa_id: "15550000002", user_id: "synthetic-user-2" }],
      message_echoes: [{ id: "synthetic-echo", from: "15550000001", to: "15550000002",
        to_user_id: "synthetic-user-2", type: "text", text: { body: "safe" }, ...overrides }],
    } }] }],
  });
  assert.equal(normalizeWhatsappWebhook(make({ from: "15559999999" })).length, 0);
  assert.equal(normalizeWhatsappWebhook(make({ to: "15559999999" })).length, 0);
  assert.equal(normalizeWhatsappWebhook(make({ type: "unsupported" })).length, 0);
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
    coexistence_verified_at: "synthetic-verified-at",
    coexistence_verification_ref: "synthetic-onboarding-session",
    registration_kind: "company",
    display_phone_number: "15550000001",
  };
  assert.equal(isEligibleRegistration(registration, "messages"), true);
  assert.equal(isEligibleRegistration({ ...registration, revoked_at: "synthetic-revocation" }, "messages"), false);
  assert.equal(isEligibleRegistration({ ...registration, consent_status: "revoked" }, "messages"), false);
  assert.equal(isEligibleRegistration({ ...registration, business_authorized_at: null }, "messages"), false);
  assert.equal(isEligibleRegistration({ ...registration, coexistence_enabled: false }, "smb_message_echoes", "15550000001"), false);
  assert.equal(isEligibleRegistration({ ...registration, coexistence_verified_at: null }, "smb_message_echoes", "15550000001"), false);
  assert.equal(isEligibleRegistration({ ...registration, registration_kind: "test" }, "messages"), false);
  assert.equal(isEligibleRegistration(registration, "smb_message_echoes", "15559999999"), false);
  assert.equal(isEligibleRegistration(registration, "smb_message_echoes", "+1 555 000 0001"), true);
});

test("captures voice/sticker media metadata without exposing Meta media handles", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [{ id: "synthetic-waba", changes: [{
      field: "messages", value: {
        metadata: { phone_number_id: "synthetic-business-phone" },
        messages: [
          { id: "wamid-audio", from: "15550000002", type: "audio",
            audio: { mime_type: "audio/ogg", sha256: Buffer.alloc(32, 1).toString("base64"),
              id: "private-media-handle", url: "https://untrusted.example/media" } },
          { id: "wamid-sticker", from: "15550000002", type: "sticker",
            sticker: { mime_type: "image/webp", file_size: 42 } },
        ],
      },
    }] }],
  };
  const events = normalizeWhatsappWebhook(payload);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map((e) => e.messageType), ["audio", "sticker"]);
  assert.equal(events[0].mediaMimeType, "audio/ogg");
  assert.equal(events[0].mediaSha256, Buffer.alloc(32, 1).toString("hex"));
  assert.equal(events[1].mediaSizeBytes, 42);
  assert.equal(events[0].text, null);
  assert.equal(JSON.stringify(events).includes("private-media-handle"), false);
  assert.equal(JSON.stringify(events).includes("untrusted.example"), false);
});
