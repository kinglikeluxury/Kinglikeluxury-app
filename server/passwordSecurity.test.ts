import assert from "node:assert/strict";
import test from "node:test";
import { hashAccountPassword, verifyAccountPassword, needsLegacyPasswordUpgrade } from "./passwordSecurity";

const synthetic = "Synthetic-2026-Only-Password-That-Is-Not-Used";

test("new passwords use strong bcrypt and are not persisted in plaintext", async () => {
  const hashed = await hashAccountPassword(synthetic);
  assert.match(hashed, /^\$2[aby]\$12\$/);
  assert.notEqual(hashed, synthetic);
  assert.equal(await verifyAccountPassword(synthetic, hashed), true);
  assert.equal(await verifyAccountPassword(synthetic + "incorrect", hashed), false);
  assert.equal(needsLegacyPasswordUpgrade(hashed), false);
});

test("preexisting plaintext passwords still authenticate without being saved as plaintext again", async () => {
  assert.equal(await verifyAccountPassword(synthetic, synthetic), true);
  assert.equal(await verifyAccountPassword("wrong", synthetic), false);
  assert.equal(needsLegacyPasswordUpgrade(synthetic), true);
});

test("invalid input and short new credentials are refused", async () => {
  for (const value of [undefined, null, "", 123, "short", "a".repeat(1025)]) {
    await assert.rejects(hashAccountPassword(value));
  }
  assert.equal(await verifyAccountPassword("x", null), false);
  assert.equal(await verifyAccountPassword(undefined, synthetic), false);
  assert.equal(await verifyAccountPassword("", synthetic), false);
  assert.equal(await verifyAccountPassword("a".repeat(1025), synthetic), false);
});

test("no secret is emitted by the verifier", async () => {
  const hashed = await hashAccountPassword(synthetic);
  const result = await verifyAccountPassword(synthetic, hashed);
  assert.equal(typeof result, "boolean");
});
