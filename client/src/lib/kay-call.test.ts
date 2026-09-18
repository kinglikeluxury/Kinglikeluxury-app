import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isKayCallPushUrl, KAY_AUDIO_CONSTRAINTS } from "./kay-call";

test("Kay calls request audio without video", () => {
  assert.deepEqual(KAY_AUDIO_CONSTRAINTS, { audio: true, video: false });
});

test("Kay push URLs never carry call or customer query data", () => {
  assert.equal(isKayCallPushUrl("https://example.test/admin/kay/call"), true);
  assert.equal(isKayCallPushUrl("https://example.test/admin/kay/call?leadId=123"), true);
  assert.equal(isKayCallPushUrl("https://example.test/notifications?leadId=123"), false);
});

test("Kay call controller exposes signaling, controls, and cleanup", () => {
  const source = readFileSync(new URL("./kay-call.tsx", import.meta.url), "utf8");
  for (const token of [
    "new WebSocket",
    "RTCPeerConnection",
    "getUserMedia(KAY_AUDIO_CONSTRAINTS)",
    "call_offer",
    "call_answer",
    "ice_candidate",
    "call_reject",
    "call_end",
    "toggleMute",
    "track.stop()",
    "onconnectionstatechange",
    "peer.connectionState === \"failed\"",
    "socket.onclose",
    "cleanup()",
    "call_socket_ready",
    "initiatorConnectionId",
    "canAnswer={offerReady}",
    "/api/admin/kay/internal-calls",
    "startCall",
    "targetUserId",
  ]) {
    assert.match(source, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  const answerSource = source.slice(source.indexOf("const answer ="), source.indexOf("const startCall ="));
  assert.match(answerSource, /if \(!pendingOfferRef\.current\) throw/);
  assert.doesNotMatch(answerSource, /createOffer\(/);
  assert.match(source, /call_offer[\s\S]*sdp: offer/);
  assert.match(source, /if \(incomingCall\) send\(\{ type: "call_reject"/);
  assert.match(source, /send\(\{ type: "call_end"[\s\S]*cleanup\(\)/);
  assert.doesNotMatch(source, /senderUserId|fromUserId/);
});