import { strict as assert } from "node:assert";
import { test } from "node:test";
import { evaluateKayAction } from "./kayActionGateway";

const base = {
  action: "crm.read", actorCapabilities: ["kay.crm.read"], dryRun: true,
  environment: "test", mode: "shadow", killSwitch: true,
};

test("allows read and analyze only with explicit capability", () => {
  assert.equal(evaluateKayAction(base, { runId: "r", actionId: "a" }).ok, true);
  assert.equal(evaluateKayAction({ ...base, action: "crm.analyze", targetId: "lead-1", actorCapabilities: ["kay.crm.analyze"] }).ok, true);
  assert.equal(evaluateKayAction({ ...base, actorCapabilities: [] }).audit.policy.reason, "CAPABILITY_REQUIRED");
});

test("writes are deny-by-default regardless of caller capability", () => {
  const result = evaluateKayAction({ ...base, action: "crm.update", actionKind: "write", killSwitch: false, actorCapabilities: ["kay.crm.write"] });
  assert.equal(result.ok, false);
  assert.equal(result.audit.policy.reason, "WRITE_CAPABILITY_DISABLED");
});

test("caller cannot disguise a known write action as read", () => {
  const result = evaluateKayAction({
    ...base,
    action: "crm.update",
    actionKind: "read",
    killSwitch: false,
    actorCapabilities: ["kay.crm.read"],
  });
  assert.equal(result.ok, false);
  assert.equal(result.audit.policy.reason, "WRITE_CAPABILITY_DISABLED");
});

test("camelCase aliases of immutable identity fields are blocked", () => {
  for (const field of ["fullName", "metaLeadId", "originalInboundPayload", "whatsappIdentity", "createdAt"]) {
    assert.equal(evaluateKayAction({ ...base, fields: [field] }).audit.policy.reason, "IMMUTABLE_FIELD", field);
  }
});

test("kill switch, immutable identity, dry-run, and canary gates block", () => {
  assert.equal(evaluateKayAction({ ...base, action: "rescue.execute", actionKind: "write" }).audit.policy.reason, "KILL_SWITCH_ACTIVE");
  assert.equal(evaluateKayAction({ ...base, fields: ["email"] }).audit.policy.reason, "IMMUTABLE_FIELD");
  assert.equal(evaluateKayAction({ ...base, dryRun: false }).audit.policy.reason, "DRY_RUN_REQUIRED");
  assert.equal(evaluateKayAction({ ...base, canary: true, canaryEnabled: true, canaryTarget: false }).audit.policy.reason, "CANARY_DENIED");
});

test("allow and block always include stable audit identifiers", () => {
  for (const result of [
    evaluateKayAction(base, { runId: "r", actionId: "a" }),
    evaluateKayAction({ ...base, actorCapabilities: [] }, { runId: "r", actionId: "a" }),
  ]) {
    assert.equal(result.audit.runId, "r");
    assert.equal(result.audit.actionId, "a");
    assert.ok(result.audit.policy.decision);
  }
});