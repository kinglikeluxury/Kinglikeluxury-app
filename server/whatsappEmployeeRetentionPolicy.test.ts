import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("manual employee archive schema has no automatic expiry or purge", () => {
  const schema = readFileSync(
    new URL("../docs/sql/2026-11-07-whatsapp-employee-unified.sql.txt", import.meta.url),
    "utf8",
  );
  const expiryColumn = schema.match(/^\s*expires_at\s+TIMESTAMPTZ([^,\n]*)/m)?.[1] ?? "";

  assert.match(expiryColumn, /\bNULL\b/i);
  assert.doesNotMatch(expiryColumn, /\bNOT NULL\b|\bDEFAULT\b/i);
  assert.doesNotMatch(schema, /\bDELETE\s+FROM\s+whatsapp_employee_events\b/i);
});
