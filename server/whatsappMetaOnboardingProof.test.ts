import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  acceptMetaOnboardingFinish, MetaOnboardingRejected, type MetaOnboardingProof,
  type OnboardingRepository, type MetaOnboardingVerifier,
} from "./whatsappMetaOnboardingProof";

const proof: MetaOnboardingProof = {
  businessPortfolioId: "123456", wabaId: "234567", phoneNumberId: "345678",
  displayPhoneNumber: "+995555000001", coexistence: "verified",
  grantedPermissions: ["whatsapp_business_management", "whatsapp_business_messaging"],
  ownershipVerified: true,
};
function fixture() {
  let consumed = false;
  let saved = 0;
  const repository: OnboardingRepository = {
    async consumeFlow(input) {
      if (input.flowId !== "flow-id-12345" || input.actorId !== 7 ||
          input.sessionHash !== "a".repeat(64) || input.requestOrigin !== "https://app.example" ||
          input.state !== "state-token-long-enough-for-test-123456" ||
          input.csrfToken !== "csrf-token-long-12345678901234567890" || consumed) return null;
      consumed = true;
      return { flowId: input.flowId, actorId: input.actorId, expectedOrigin: "https://app.example/", consumedAt: new Date() };
    },
    async saveVerifiedNumber() { saved++; return "saved"; },
    async revokeNumber() { return true; },
  };
  let exchanged: string | undefined;
  const verifier: MetaOnboardingVerifier = {
    async exchangeAndVerify({ code }) { exchanged = code; return proof; },
  };
  const input = {
    enabled: true,
    finish: { flowId: "flow-id-12345", state: "state-token-long-enough-for-test-123456",
      code: "one-time-code-value", businessPortfolioId: proof.businessPortfolioId,
      wabaId: proof.wabaId, phoneNumberId: proof.phoneNumberId, displayPhoneNumber: proof.displayPhoneNumber },
    actorId: 7, sessionHash: "a".repeat(64), requestOrigin: "https://app.example",
    csrfToken: "csrf-token-long-12345678901234567890", repository, verifier,
  };
  return { input, get saved() { return saved; }, get exchanged() { return exchanged; } };
}

test("disabled gate never exchanges code or persists a number", async () => {
  const f = fixture();
  await assert.rejects(acceptMetaOnboardingFinish({ ...f.input, enabled: false }),
    (error: unknown) => error instanceof MetaOnboardingRejected && error.code === "DISABLED");
  assert.equal(f.exchanged, undefined);
  assert.equal(f.saved, 0);
});

test("server-side proof is required before a number can be accepted", async () => {
  const f = fixture();
  assert.deepEqual(await acceptMetaOnboardingFinish(f.input),
    { status: "verified_pending_activation", phoneNumberId: proof.phoneNumberId });
  assert.equal(f.exchanged, "one-time-code-value");
  assert.equal(f.saved, 1);
});

test("origin/CSRF mismatch and replay fail closed", async () => {
  for (const override of [
    { requestOrigin: "https://evil.example" },
    { csrfToken: "wrong-csrf-token-12345678901234567890" },
    { finish: { ...fixture().input.finish, state: "wrong-state-token-long-123456789012345" } },
  ]) {
    const f = fixture();
    await assert.rejects(acceptMetaOnboardingFinish({ ...f.input, ...override }),
      (error: unknown) => error instanceof MetaOnboardingRejected && error.code === "FLOW_INVALID");
    assert.equal(f.saved, 0);
  }
  const f = fixture();
  await acceptMetaOnboardingFinish(f.input);
  await assert.rejects(acceptMetaOnboardingFinish(f.input),
    (error: unknown) => error instanceof MetaOnboardingRejected && error.code === "FLOW_INVALID");
});

test("browser-supplied IDs cannot override mismatched or unverified Meta facts", async () => {
  const f = fixture();
  f.input.verifier.exchangeAndVerify = async () => ({ ...proof, phoneNumberId: "999999" });
  await assert.rejects(acceptMetaOnboardingFinish(f.input),
    (error: unknown) => error instanceof MetaOnboardingRejected && error.code === "META_PROOF_FAILED");
  assert.equal(f.saved, 0);
});

test("missing required permission, ownership proof, Coexistence proof, and duplicate ownership fail closed", async () => {
  const badProofs = [
    { ...proof, grantedPermissions: ["whatsapp_business_management"] },
    { ...proof, ownershipVerified: false },
    { ...proof, coexistence: "not_verified" as const },
  ];
  for (const bad of badProofs) {
    const f = fixture();
    f.input.verifier.exchangeAndVerify = async () => bad;
    await assert.rejects(acceptMetaOnboardingFinish(f.input),
      (error: unknown) => error instanceof MetaOnboardingRejected && error.code === "META_PROOF_FAILED");
    assert.equal(f.saved, 0);
  }
  const f = fixture();
  f.input.repository.saveVerifiedNumber = async () => "duplicate";
  await assert.rejects(acceptMetaOnboardingFinish(f.input),
    (error: unknown) => error instanceof MetaOnboardingRejected && error.code === "DUPLICATE_OWNERSHIP");
});
