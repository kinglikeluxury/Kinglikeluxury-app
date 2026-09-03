import test from "node:test";
import assert from "node:assert/strict";
import { resolveKayMode, validateKayModeUpdate } from "./kayService";

test("Kay mode resolves invalid or absent stored settings to safe shadow", () => {
  assert.equal(resolveKayMode(undefined), "shadow");
  assert.equal(resolveKayMode({ mode: "invalid" }), "shadow");
  assert.equal(resolveKayMode({ mode: "advisory" }), "advisory");
});

test("Kay mode update validation rejects unknown fields and execution modes", () => {
  assert.deepEqual(validateKayModeUpdate({ mode: "shadow" }), { ok: true, mode: "shadow" });
  assert.equal(validateKayModeUpdate({ mode: "active" }).ok, false);
  assert.equal(validateKayModeUpdate({ mode: "shadow", extra: true }).ok, false);
});