import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  EmployeeMediaUnavailable,
  MAX_EMPLOYEE_MEDIA_BYTES,
  openEmployeeMedia,
  sealEmployeeMedia,
  type EmployeeMediaScope,
  type PrivateMediaGate,
} from "./whatsappPrivateMediaVault";

const key = Buffer.alloc(32, 3);
const scope: EmployeeMediaScope = {
  employeeId: 101, conversationId: "c-9", eventId: "event-voice-1", phoneNumberId: "phone-101",
};
const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function gate(canRead: boolean) {
  const calls: string[] = [];
  const deps: PrivateMediaGate = {
    authorize: async (_scope, action) => { calls.push("authorize:" + action); return canRead; },
    audit: async (_scope, action, outcome) => { calls.push("audit:" + action + ":" + outcome); },
  };
  return { deps, calls };
}

test("authorized media is encrypted with AES-GCM, scope-bound and audited before retrieval", async () => {
  const voice = Buffer.from("sensitive synthetic voice recording bytes");
  const { deps, calls } = gate(true);
  let providerCalls = 0;
  const envelope = await sealEmployeeMedia({
    scope, encryptionKey: key, expectedSha256: digest(voice), declaredMimeType: "audio/ogg",
    gate: deps, retrieveTrustedMedia: async () => { providerCalls++; calls.push("retrieve"); return voice; },
  });
  assert.deepEqual(calls, ["authorize:ingest", "audit:ingest:allowed", "retrieve"]);
  assert.equal(providerCalls, 1);
  assert.equal(envelope.sizeBytes, voice.length);
  assert.equal(envelope.mimeType, "audio/ogg");
  assert.equal(envelope.sha256, digest(voice));
  assert.equal(Buffer.from(envelope.ciphertext, "base64").equals(voice), false);
  assert.equal(JSON.stringify(envelope).includes(voice.toString()), false);
  const opened = await openEmployeeMedia({ scope, encryptionKey: key, envelope, gate: deps });
  assert.deepEqual(opened.bytes, voice);
  assert.equal(opened.mimeType, "audio/ogg");
  assert.deepEqual(calls.slice(-2), ["authorize:read", "audit:read:allowed"]);

  await assert.rejects(
    openEmployeeMedia({ scope: { ...scope, employeeId: 102 }, encryptionKey: key, envelope, gate: deps }),
    EmployeeMediaUnavailable,
  );
  const tampered = { ...envelope, tag: "0".repeat(32) };
  await assert.rejects(openEmployeeMedia({ scope, encryptionKey: key, envelope: tampered, gate: deps }),
    EmployeeMediaUnavailable);
});

test("a revoked or ungranted employee never triggers media retrieval", async () => {
  const { deps, calls } = gate(false);
  let requests = 0;
  const voice = Buffer.from("synthetic secret");
  await assert.rejects(sealEmployeeMedia({
    scope, encryptionKey: key, expectedSha256: digest(voice), declaredMimeType: "audio/ogg",
    gate: deps, retrieveTrustedMedia: async () => { requests++; return voice; },
  }), EmployeeMediaUnavailable);
  assert.equal(requests, 0);
  assert.deepEqual(calls, ["authorize:ingest", "audit:ingest:denied"]);
});

test("an audit outage blocks the media before provider access", async () => {
  const voice = Buffer.from("synthetic");
  let requests = 0;
  await assert.rejects(sealEmployeeMedia({
    scope, encryptionKey: key, expectedSha256: digest(voice), declaredMimeType: "audio/ogg",
    gate: {
      authorize: async () => true,
      audit: async () => { throw new Error("synthetic audit DB unavailable"); },
    },
    retrieveTrustedMedia: async () => { requests++; return voice; },
  }), /synthetic audit DB unavailable/);
  assert.equal(requests, 0);
});

test("digest mismatch, malformed MIME and oversized files fail closed", async () => {
  const media = Buffer.from("test-media");
  const { deps } = gate(true);
  await assert.rejects(sealEmployeeMedia({
    scope, encryptionKey: key, declaredMimeType: "audio/ogg",
    expectedSha256: "f".repeat(64), gate: deps,
    retrieveTrustedMedia: async () => media,
  }), EmployeeMediaUnavailable);
  let requested = false;
  await assert.rejects(sealEmployeeMedia({
    scope, encryptionKey: key, declaredMimeType: "text/html",
    expectedSha256: digest(media), gate: deps,
    retrieveTrustedMedia: async () => { requested = true; return media; },
  }), EmployeeMediaUnavailable);
  assert.equal(requested, false);
  await assert.rejects(sealEmployeeMedia({
    scope, encryptionKey: key, declaredMimeType: "video/mp4",
    expectedSha256: digest(media), gate: deps,
    retrieveTrustedMedia: async () => Buffer.alloc(MAX_EMPLOYEE_MEDIA_BYTES + 1, 0),
  }), EmployeeMediaUnavailable);
});

test("invalid keys/scopes and ciphertext metadata fail before media reads", async () => {
  const { deps } = gate(true);
  const bytes = Buffer.from("safe");
  await assert.rejects(sealEmployeeMedia({
    scope: { ...scope, phoneNumberId: "" }, encryptionKey: key,
    declaredMimeType: "audio/ogg", expectedSha256: digest(bytes), gate: deps,
    retrieveTrustedMedia: async () => bytes,
  }), EmployeeMediaUnavailable);
  await assert.rejects(sealEmployeeMedia({
    scope, encryptionKey: Buffer.alloc(8),
    declaredMimeType: "audio/ogg", expectedSha256: digest(bytes), gate: deps,
    retrieveTrustedMedia: async () => bytes,
  }), EmployeeMediaUnavailable);
  const envelope = await sealEmployeeMedia({
    scope, encryptionKey: key, declaredMimeType: "audio/ogg",
    expectedSha256: digest(bytes), gate: deps, retrieveTrustedMedia: async () => bytes,
  });
  await assert.rejects(openEmployeeMedia({
    scope, encryptionKey: key,
    envelope: { ...envelope, sizeBytes: MAX_EMPLOYEE_MEDIA_BYTES + 1 }, gate: deps,
  }), EmployeeMediaUnavailable);
  await assert.rejects(openEmployeeMedia({
    scope, encryptionKey: key,
    envelope: { ...envelope, ciphertext: "" }, gate: deps,
  }), EmployeeMediaUnavailable);
});
