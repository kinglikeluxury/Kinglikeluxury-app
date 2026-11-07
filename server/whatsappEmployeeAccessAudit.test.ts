import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  assertWhatsappEmployeeAuditWriter, recordWhatsappEmployeeArchiveAccess,
  type AuditQueryable,
} from "./whatsappEmployeeAccessAudit";

test("archive audit records only bounded access metadata, never payload or search terms", async () => {
  let captured: unknown[] = [];
  const db: AuditQueryable = { async query(sql, values = []) {
    if (sql.includes("SELECT")) return { rows: [{
      can_insert: true, can_select: false, can_update: false, can_delete: false,
      can_truncate: false, owns_table: false, member_of_owner: false, trigger_enabled: true,
    }] };
    captured = values; return { rows: [] };
  } };
  await recordWhatsappEmployeeArchiveAccess(db, {
    actorId: 1, employeeId: 2, action: "archive.search", outcome: "allowed",
    reason: "supervisor_grant", resultCount: 15,
  });
  assert.deepEqual(captured, [1, 2, "archive.search", "allowed", "supervisor_grant", "11-50"]);
});

test("invalid identities and unbounded action vocabularies are rejected", async () => {
  const db: AuditQueryable = { async query() { throw new Error("must not write"); } };
  await assert.rejects(recordWhatsappEmployeeArchiveAccess(db, {
    actorId: 0, employeeId: 2, action: "archive.read", outcome: "denied", reason: "scope_denied",
  }));
  await assert.rejects(recordWhatsappEmployeeArchiveAccess(db, {
    actorId: 1, employeeId: 2, action: "archive.read" as never,
    outcome: "allowed", reason: "scope_denied",
  }));
});

test("audit writer privilege mismatch fails closed", async () => {
  const unsafe: AuditQueryable = { async query() {
    return { rows: [{ can_insert: true, can_select: false, can_update: false, can_delete: false,
      can_truncate: true, owns_table: false, member_of_owner: false, trigger_enabled: true }] };
  } };
  await assert.rejects(assertWhatsappEmployeeAuditWriter(unsafe), /privilege boundary is unsafe/);
});
