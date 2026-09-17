import test from "node:test";
import assert from "node:assert/strict";
import { KAY_DATA_OWNERSHIP } from "./kayDataOwnership";
import { assertKayInternalWriteAllowed, KAY_INTERNAL_WRITE_TARGETS, KayInternalWriteDeniedError } from "./kayInternalWriteGate";

test("internal write allowlist is exact and excludes CRM and configuration", () => {
  assert.equal(KAY_INTERNAL_WRITE_TARGETS.length, 9);
  const crm = new Set(KAY_DATA_OWNERSHIP.filter(x => x.owner === "CRM_OWNED").map(x => x.name));
  assert.equal(KAY_INTERNAL_WRITE_TARGETS.filter(name => crm.has(name)).length, 0);
  assert.ok(!KAY_INTERNAL_WRITE_TARGETS.includes("kay_settings" as any));
  assert.ok(!KAY_INTERNAL_WRITE_TARGETS.includes("user_notifications" as any));
});

test("internal gate rejects unapproved, CRM, external, and frozen writes before connection use", async () => {
  const denied = (promise: Promise<void>) => assert.rejects(promise, KayInternalWriteDeniedError);
  await denied(assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "unknown_table" }));
  await denied(assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "crm_leads" }));
  await denied(assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_settings" }));
  await denied(assertKayInternalWriteAllowed({ operation: "CRM_WRITE", table: "kay_events" } as any));
  await denied(assertKayInternalWriteAllowed({ operation: "CUSTOMER_EXTERNAL_ACTION", table: "kay_events" } as any));
  await denied(assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_events", externalSideEffect: true }));
  await denied(assertKayInternalWriteAllowed({ operation: "KAY_INTERNAL_WRITE", table: "kay_events", frozenExecution: true }));
});