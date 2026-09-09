import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../artifacts/kay-postgres-readonly-role.sql", import.meta.url), "utf8");
const verifier = readFileSync(new URL("../scripts/verify-kay-readonly-role.ts", import.meta.url), "utf8");

test("Kay readonly role artifact grants SELECT and revokes writes", () => {
  assert.match(sql, /GRANT SELECT ON ALL TABLES/i);
  assert.match(sql, /REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER/i);
  assert.match(sql, /ALTER DEFAULT PRIVILEGES/i);
  assert.doesNotMatch(sql, /postgres(?:ql)?:\/\/|password\s*=/i);
});

test("Kay readonly verification is read-only and parameterized", () => {
  assert.match(verifier, /BEGIN READ ONLY/);
  assert.match(verifier, /has_table_privilege/);
  assert.match(verifier, /pg_auth_members/);
  assert.match(verifier, /relowner/);
  assert.doesNotMatch(verifier, /\b(INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|CREATE\s+ROLE|DROP\s+ROLE|ALTER\s+ROLE)\b/i);
});