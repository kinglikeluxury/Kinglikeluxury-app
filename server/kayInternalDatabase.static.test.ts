import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  getKayDataOwnership,
  KAY_INTERNAL_APPROVED_WRITABLE_TABLES,
  KAY_INTERNAL_OPTIONAL_WRITABLE_TABLES,
  KAY_INTERNAL_WRITABLE_TABLES,
} from "./kayDataOwnership";

const source = readFileSync(new URL("./kayInternalDatabase.ts", import.meta.url), "utf8");

test("internal persistence has no generic fallback", () => {
  assert.match(source, /KAY_INTERNAL_DATABASE_URL/);
  assert.doesNotMatch(source, /process\.env\.(?:DATABASE_URL|NEON_DATABASE_URL)/);
  assert.doesNotMatch(source, /from ["']\.\/db["']/);
});

test("internal persistence verifies its boundary", () => {
  assert.match(source, /kay_internal_writer/);
  assert.match(source, /current_database\(\)\s*=\s*'neondb'/);
  assert.match(source, /crm_(?:select|insert|update|delete|truncate)_denied/);
  assert.match(source, /create_denied/);
  assert.match(source, /mission_scope_fence/);
});

test("unknown and execution-linked objects fail closed", () => {
  assert.equal(getKayDataOwnership("future_kay_table").owner, "UNKNOWN");
  assert.equal(getKayDataOwnership("kay_auto_rescue_queue").runtimeWrite, false);
  assert.equal(getKayDataOwnership("kay_rescue_executions").runtimeWrite, false);
  assert.equal(KAY_INTERNAL_WRITABLE_TABLES.length, 9);
  assert.deepEqual(KAY_INTERNAL_OPTIONAL_WRITABLE_TABLES, ["kay_internal_call_sessions", "kay_voice_one_turn_sessions", "kay_recording_sessions"]);
  assert.equal(KAY_INTERNAL_APPROVED_WRITABLE_TABLES.length, 12);
});