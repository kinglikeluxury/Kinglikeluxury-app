/**
 * Kay's policy is intentionally pure and deny-by-default.  This module does
 * not import the database (or any service which can mutate it), so policy
 * decisions are safe to use from HTTP handlers, jobs, and unit tests.
 */

export type KayCapability =
  | "kay.crm.read"
  | "kay.crm.analyze"
  | "kay.tasks.create"
  | "kay.leads.reassign"
  | "kay.crm.write"
  | "kay.whatsapp.send"
  | "kay.rescue.execute";

export type KayActionKind = "read" | "analyze" | "write";
export type KayMode = "shadow" | "assisted" | "controlled_automation";

export const KAY_CAPABILITIES: Readonly<Record<KayCapability, boolean>> = {
  "kay.crm.read": true,
  "kay.crm.analyze": true,
  "kay.tasks.create": false,
  "kay.leads.reassign": false,
  "kay.crm.write": false,
  "kay.whatsapp.send": false,
  "kay.rescue.execute": false,
};

/** Identity and ownership fields are never writable by Kay, even if a caller
 * accidentally supplies a future write capability. */
export const KAY_IMMUTABLE_IDENTITY_FIELDS = Object.freeze([
  "full_name", "first_name", "last_name", "name", "email", "phone", "phone_number",
  "meta_lead_id", "external_lead_id", "original_lead_source", "lead_source",
  "original_inbound_payload", "inbound_payload", "whatsapp_identity",
  "wa_identity", "created_at", "creation_timestamp",
]);

export interface KayPolicyRequest {
  capability?: string;
  action: string;
  actionKind?: KayActionKind;
  actorId?: string | number;
  actorCapabilities?: readonly string[];
  targetType?: string;
  targetId?: string | number;
  fields?: readonly string[];
  environment?: string;
  mode?: KayMode | string;
  killSwitch?: boolean;
  dryRun?: boolean;
  canary?: boolean;
  canaryEnabled?: boolean;
  canaryTarget?: boolean;
}

export type KayPolicyReason =
  | "ALLOWED"
  | "CAPABILITY_REQUIRED"
  | "ACTION_REQUIRED"
  | "UNKNOWN_ACTION"
  | "WRITE_CAPABILITY_DISABLED"
  | "ENVIRONMENT_DENIED"
  | "MODE_DENIED"
  | "KILL_SWITCH_ACTIVE"
  | "TARGET_REQUIRED"
  | "IMMUTABLE_FIELD"
  | "DRY_RUN_REQUIRED"
  | "CANARY_DENIED";

export interface KayPolicyDecision {
  allowed: boolean;
  decision: "allow" | "block";
  reason: KayPolicyReason;
  policyVersion: string;
}

export interface KayAuditEnvelope {
  runId: string;
  actionId: string;
  timestamp: string;
  action: string;
  actorId: string | number | null;
  target: { type: string | null; id: string | number | null };
  policy: KayPolicyDecision;
  dryRun: boolean;
  canary: boolean;
}

const READ_ACTIONS = new Set(["crm.read", "crm.get", "crm.list", "crm.search"]);
const ANALYZE_ACTIONS = new Set(["crm.analyze", "crm.score", "crm.inspect"]);
const WRITE_ACTIONS = new Set([
  "crm.write", "crm.update", "tasks.create", "leads.reassign",
  "whatsapp.send", "rescue.execute", "missions.generate", "settings.update",
  "protection.update", "workflow.transition", "audit.write", "http.write",
]);

function actionKind(action: string): KayActionKind | undefined {
  if (READ_ACTIONS.has(action) || action.startsWith("kay.crm.read")) return "read";
  if (ANALYZE_ACTIONS.has(action) || action.startsWith("kay.crm.analyze")) return "analyze";
  if (WRITE_ACTIONS.has(action) || action.startsWith("kay.crm.write")) return "write";
  return undefined;
}

function capabilityFor(request: KayPolicyRequest, kind: KayActionKind): KayCapability {
  if (kind === "read") return "kay.crm.read";
  if (kind === "analyze") return "kay.crm.analyze";
  if (request.action === "tasks.create" || request.action === "missions.generate") return "kay.tasks.create";
  if (request.action === "leads.reassign") return "kay.leads.reassign";
  if (request.action === "whatsapp.send") return "kay.whatsapp.send";
  if (request.action === "rescue.execute") return "kay.rescue.execute";
  return "kay.crm.write";
}

export function evaluateKayPolicy(request: KayPolicyRequest): KayPolicyDecision {
  const action = String(request.action || "").trim();
  const kind = actionKind(action);
  const policyVersion = "kay-policy-v1";
  const block = (reason: KayPolicyReason): KayPolicyDecision =>
    { return { allowed: false, decision: "block", reason, policyVersion }; };
  if (!action) return block("ACTION_REQUIRED");
  if (!kind) return block("UNKNOWN_ACTION");
  if (!request.environment || !["development", "test", "production"].includes(request.environment)) {
    return block("ENVIRONMENT_DENIED");
  }
  if (!request.mode || !["shadow", "assisted", "controlled_automation"].includes(request.mode)) {
    return block("MODE_DENIED");
  }
  const required = capabilityFor(request, kind);
  if (kind === "write" && request.killSwitch !== false) return block("KILL_SWITCH_ACTIVE");
  if (kind === "write" && KAY_CAPABILITIES[required] !== true) return block("WRITE_CAPABILITY_DISABLED");
  // A caller cannot downgrade or substitute the capability required by the
  // action (for example, claim that an analyze operation is merely a read).
  if (request.capability && request.capability !== required) return block("CAPABILITY_REQUIRED");
  if (KAY_CAPABILITIES[required] !== true ||
      !request.actorCapabilities?.includes(required)) return block("CAPABILITY_REQUIRED");
  if (kind === "analyze" && request.targetId == null) return block("TARGET_REQUIRED");
  if (request.fields?.some(field => {
    const normalized = (field.split(".").pop() || "")
      .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
      .replace(/[^a-zA-Z0-9]+/g, "_")
      .toLowerCase();
    return KAY_IMMUTABLE_IDENTITY_FIELDS.includes(normalized);
  })) {
    return block("IMMUTABLE_FIELD");
  }
  if (!request.dryRun) return block("DRY_RUN_REQUIRED");
  if (request.canary === true && (request.canaryEnabled !== true || request.canaryTarget !== true)) {
    return block("CANARY_DENIED");
  }
  return { allowed: true, decision: "allow", reason: "ALLOWED", policyVersion };
}

export function createKayAuditEnvelope(request: KayPolicyRequest, policy: KayPolicyDecision,
  ids: { runId: string; actionId: string }, now = new Date()): KayAuditEnvelope {
  return {
    runId: ids.runId,
    actionId: ids.actionId,
    timestamp: now.toISOString(),
    action: request.action,
    actorId: request.actorId ?? null,
    target: { type: request.targetType ?? null, id: request.targetId ?? null },
    policy,
    dryRun: request.dryRun === true,
    canary: request.canary === true,
  };
}