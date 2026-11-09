import test from "node:test";
import assert from "node:assert/strict";
import { isEmployeeWhatsappMediaKind, normalizeEmployeeWhatsappMedia } from "./whatsappEmployeeMedia";

test("supports WhatsApp voice messages and stickers without downloading media", () => {
  assert.equal(isEmployeeWhatsappMediaKind("audio"), true);
  assert.equal(isEmployeeWhatsappMediaKind("sticker"), true);
  assert.equal(isEmployeeWhatsappMediaKind("location"), false);
  const digest = Buffer.alloc(32, 0xab);
  const input = {
    audio: {
      id: "sensitive-meta-media-id",
      url: "https://lookaside.fbsbx.com/private-media",
      mime_type: "audio/ogg",
      sha256: digest.toString("base64"),
      file_size: 1280,
      filename: "private-name.ogg",
    },
  };
  const result = normalizeEmployeeWhatsappMedia("audio", input);
  assert.deepEqual(result, {
    mimeType: "audio/ogg",
    sizeBytes: 1280,
    sha256Hex: digest.toString("hex"),
  });
  assert.equal(JSON.stringify(result).includes("sensitive-meta"), false);
  assert.equal(JSON.stringify(result).includes("lookaside"), false);
  assert.equal(JSON.stringify(result).includes("private-name"), false);
});

test("rejects invalid, untrusted, or oversized metadata fields without trusting media URLs", () => {
  assert.deepEqual(normalizeEmployeeWhatsappMedia("video", {
    video: { mime_type: "video/mp4\r\nSet-Cookie:1", file_size: -1,
      sha256: "not-a-sha", id: "sensitive", url: "https://evil.example" },
  }), { mimeType: null, sizeBytes: null, sha256Hex: null });
  assert.deepEqual(normalizeEmployeeWhatsappMedia("document", {
    document: { mime_type: "APPLICATION/PDF", size: 0, sha256: "Aa".repeat(32) },
  }), { mimeType: "application/pdf", sizeBytes: 0, sha256Hex: "aa".repeat(32) });
  assert.deepEqual(normalizeEmployeeWhatsappMedia("image", { image: {
    mime_type: "image/jpeg", file_size: Number.MAX_SAFE_INTEGER + 1,
  } }), { mimeType: "image/jpeg", sizeBytes: null, sha256Hex: null });
  assert.equal(normalizeEmployeeWhatsappMedia("text", { text: { body: "hello" } }), null);
  assert.equal(normalizeEmployeeWhatsappMedia("audio", null), null);
});

test("does not fabricate metadata when a supported media body is absent", () => {
  assert.deepEqual(normalizeEmployeeWhatsappMedia("sticker", {}), {
    mimeType: null, sizeBytes: null, sha256Hex: null,
  });
});
