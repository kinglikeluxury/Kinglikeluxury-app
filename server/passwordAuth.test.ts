import assert from "node:assert/strict";
import bcrypt from "bcrypt";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { verifyStoredPassword } from "./passwordAuth";

test("hashed credentials authenticate while legacy credentials remain compatible", async () => {
  const candidate = `fixture-${randomUUID()}`;
  const hash = await bcrypt.hash(candidate, 4);

  assert.match(hash, /^\$2[ab]\$/);
  assert.equal(await verifyStoredPassword(candidate, hash), true);
  assert.equal(await verifyStoredPassword("different-value", hash), false);
  const legacyValue = `legacy-${randomUUID()}`;
  assert.equal(await verifyStoredPassword(legacyValue, legacyValue), true);
  assert.equal(await verifyStoredPassword(legacyValue, null), false);
});
