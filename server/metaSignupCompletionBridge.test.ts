import assert from "node:assert/strict";
import test from "node:test";
import {
  MetaSignupCompletionBridge,
  readMetaSignupAuthorizationCode,
} from "../client/src/lib/metaSignupCompletionBridge";

const code = "AQABC-meta-onetime-synthetic-code";
const auth = { authResponse: { code, accessToken: "should-not-be-used" } };
const finish = {
  kind: "completed" as const,
  businessPortfolioId: "123456789",
  wabaId: "234567891",
  phoneNumberId: "345678912",
};

test("only FB.login authResponse.code is accepted, not bearer token", () => {
  assert.equal(readMetaSignupAuthorizationCode(auth), code);
  assert.equal(readMetaSignupAuthorizationCode({ authResponse: { accessToken: code } }), null);
  assert.equal(readMetaSignupAuthorizationCode({ code }), null);
  assert.equal(readMetaSignupAuthorizationCode({ authResponse: { code: "bad\ncode1234" } }), null);
});

test("either ordering of SDK code and Meta FINISH yields one complete handoff", () => {
  for (const order of ["code-first", "session-first"]) {
    const bridge = new MetaSignupCompletionBridge();
    bridge.begin();
    if (order === "code-first") {
      assert.equal(bridge.acceptLoginResponse(auth), true);
      assert.equal(bridge.takeReady(), null);
      assert.equal(bridge.acceptSessionEvent(finish), true);
    } else {
      assert.equal(bridge.acceptSessionEvent(finish), true);
      assert.equal(bridge.takeReady(), null);
      assert.equal(bridge.acceptLoginResponse(auth), true);
    }
    const ready = bridge.takeReady();
    assert.deepEqual(ready, {
      code,
      businessPortfolioId: finish.businessPortfolioId,
      wabaId: finish.wabaId,
      phoneNumberId: finish.phoneNumberId,
    });
    assert.equal(JSON.stringify(ready).includes("accessToken"), false);
    assert.equal(bridge.takeReady(), null);
    assert.equal(bridge.acceptLoginResponse(auth), false);
  }
});

test("rejects unstarted, missing identifiers and callbacks after cancellation", () => {
  const bridge = new MetaSignupCompletionBridge();
  assert.equal(bridge.acceptLoginResponse(auth), false);
  bridge.begin();
  assert.equal(bridge.acceptLoginResponse(auth), true);
  assert.equal(bridge.acceptSessionEvent({ kind: "completed", wabaId: finish.wabaId }), false);
  assert.equal(bridge.takeReady(), null);
  bridge.acceptSessionEvent({ kind: "cancelled" });
  assert.equal(bridge.acceptSessionEvent(finish), false);
  assert.equal(bridge.takeReady(), null);
});

test("rejects conflicting Meta identifiers and conflicting authorization codes", () => {
  const bridge = new MetaSignupCompletionBridge();
  bridge.begin();
  bridge.acceptSessionEvent(finish);
  assert.equal(bridge.acceptSessionEvent({ ...finish, phoneNumberId: "999998887" }), false);
  assert.equal(bridge.takeReady(), null);
  bridge.begin();
  bridge.acceptLoginResponse(auth);
  assert.equal(bridge.acceptLoginResponse({ authResponse: { code: "DIFFERENT-valid-code-123" } }), false);
  assert.equal(bridge.acceptSessionEvent(finish), false);
  assert.equal(bridge.takeReady(), null);
});

test("expires the pending code and clears it even when other callback arrives later", () => {
  let clock = 10000;
  const bridge = new MetaSignupCompletionBridge(() => clock, 1000);
  bridge.begin();
  bridge.acceptLoginResponse(auth);
  clock += 1001;
  assert.equal(bridge.acceptSessionEvent(finish), false);
  assert.equal(bridge.takeReady(), null);
  bridge.begin();
  bridge.acceptSessionEvent(finish);
  assert.equal(bridge.acceptLoginResponse(auth), true);
  assert.deepEqual(bridge.takeReady(), { code, ...{
    businessPortfolioId: finish.businessPortfolioId,
    wabaId: finish.wabaId,
    phoneNumberId: finish.phoneNumberId,
  } });
});

test("explicit clear wipes pending session and cannot accidentally complete", () => {
  const bridge = new MetaSignupCompletionBridge();
  bridge.begin();
  bridge.acceptLoginResponse(auth);
  bridge.clear();
  assert.equal(bridge.acceptSessionEvent(finish), false);
  assert.equal(bridge.takeReady(), null);
});
