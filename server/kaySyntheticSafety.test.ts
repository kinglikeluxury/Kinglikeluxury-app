import test from "node:test";
import assert from "node:assert/strict";
import { assertKayProductionEntry, isKaySyntheticRecord, isKayTestEnvironmentIdentity } from "./kaySyntheticSafety";

test("Kay synthetic boundary detects test_run_id and explicit markers", () => {
  assert.equal(isKaySyntheticRecord({ test_run_id: "incident-regression-001" }), true);
  assert.equal(isKaySyntheticRecord({ metadata: { synthetic_marker: "fixture:run:x" } }), true);
  assert.equal(isKaySyntheticRecord({ metadata: { isSynthetic: true } }), true);
  assert.equal(isKaySyntheticRecord({ full_name: "Real customer" }), false);
});

test("Kay production boundary rejects test identity and synthetic records", () => {
  assert.equal(isKayTestEnvironmentIdentity({ NODE_ENV: "test" }), true);
  assert.equal(isKayTestEnvironmentIdentity({ KAY_TEST_RUN_ID: "run-1" }), true);
  assert.throws(() => assertKayProductionEntry(undefined, { NODE_ENV: "test" }), /test environment identity/);
  assert.throws(() => assertKayProductionEntry({ test_run_id: "run-1" }, { NODE_ENV: "production" }), /synthetic records/);
  assert.doesNotThrow(() => assertKayProductionEntry({ id: 1 }, { NODE_ENV: "production" }));
});