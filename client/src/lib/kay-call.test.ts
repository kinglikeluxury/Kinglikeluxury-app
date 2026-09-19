import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isKayCallPushUrl, KAY_AUDIO_CONSTRAINTS } from "./kay-call-shared";
const source = readFileSync(new URL("./kay-call.tsx", import.meta.url), "utf8");

test("Kay calls request audio without video", () => {
  assert.deepEqual(KAY_AUDIO_CONSTRAINTS, { audio: true, video: false });
});

test("Kay push URLs never carry call or customer query data", () => {
  assert.equal(isKayCallPushUrl("https://example.test/admin/kay/call"), true);
  assert.equal(isKayCallPushUrl("https://example.test/admin/kay/call?leadId=123"), true);
  assert.equal(isKayCallPushUrl("https://example.test/notifications?leadId=123"), false);
});

test("Kay call controller exposes signaling, controls, and cleanup", () => {
  for (const token of [
    "new WebSocket",
    "RTCPeerConnection",
    "getUserMedia(KAY_AUDIO_CONSTRAINTS)",
    "call_offer",
    "call_answer",
    "ice_candidate",
    "call_reject",
    "call_end",
    "recording_notice_result",
    "recording_objection",
    "recording_upload_begin",
    "recording_upload_chunk",
    "recording_upload_complete",
    "MediaRecorder",
    "createMediaStreamDestination",
    "AudioBufferSourceNode",
    "decodeAudioData",
    "kayRecordingPlumbingFixtureUrl",
    "source.connect(destination)",
    "source.connect(context.destination)",
    "source.onended",
    "call.direct && call.reasonCode === \"ADMIN_TEST\"",
    "PLUMBING_FIXTURE",
    "buildKayRecordingNotice",
    "toggleMute",
    "track.stop()",
    "onconnectionstatechange",
    "peer.connectionState === \"failed\"",
    "socket.onclose",
    "cleanup()",
    "call_socket_ready",
    "initiatorConnectionId",
     "canAnswer={offerReady || incomingCall.direct === true}",
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

test("direct Kay caller uses local voice and microphone without a peer", () => {
  assert.match(source, /هذه أول مكالمة تجريبية مباشرة بيني وبينك داخل تطبيق كينغ لايك/);
  assert.match(source, /\/api\/admin\/kay\/internal-calls\/test-readiness/);
  assert.match(source, /اتصل بي من KAY الآن/);
  assert.match(source, /KAY_CALL_INCOMING/);
  assert.match(source, /answerDirect/);
  assert.match(source, /speechSynthesis\.speak/);
  assert.match(source, /AudioContext/);
  assert.match(source, /\/answer/);
  assert.match(source, /\/reject/);
  assert.match(source, /\/end/);
  assert.match(source, /micLevel/);
  assert.match(source, /Kay call was not ended on the server/);
  assert.match(source, /KAY_CALL_ENDED/);
});

test("direct ADMIN_TEST uses a capturable fixture and waits for source completion", () => {
  const directNotice = source.slice(source.indexOf("const playDirectAdminTestFixture"), source.indexOf("const reportRecordingNotice"));
  assert.match(directNotice, /fetch\(kayRecordingPlumbingFixtureUrl\)/);
  assert.match(directNotice, /context\.decodeAudioData/);
  assert.match(directNotice, /source\.connect\(destination\)/);
  assert.match(directNotice, /source\.connect\(context\.destination\)/);
  assert.match(directNotice, /source\.onended/);
  assert.match(source, /if \(call\.direct && call\.reasonCode === "ADMIN_TEST"\)/);
  assert.match(source, /PLUMBING_FIXTURE/);
  assert.match(source.slice(source.indexOf("const reportRecordingNotice"), source.indexOf("const answerDirect")), /await playDirectAdminTestFixture\(\)/);
});

test("microphone and direct fixture share the MediaRecorder destination", () => {
  const recordingSection = source.slice(source.indexOf("const startRecording"), source.indexOf("const reportRecordingNotice"));
  assert.match(recordingSection, /source\.connect\(destination\)/);
  assert.match(recordingSection, /source\.connect\(destination\)[\s\S]*source\.connect\(context\.destination\)/);
  assert.match(source, /recordingDestinationRef\.current = destination/);
});