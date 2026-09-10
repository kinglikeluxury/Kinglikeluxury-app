import {
  createKayAuditEnvelope,
  evaluateKayPolicy,
  KAY_CRM_MUTATION_ACTIONS,
  KAY_IMMUTABLE_IDENTITY_FIELDS,
  KAY_CRM_MUTATION_DENIED,
  type KayAuditEnvelope,
  type KayPolicyRequest,
} from "./kayActionPolicy";
import { randomUUID } from "node:crypto";
import { Pool } from "@neondatabase/serverless";

export interface KayGatewayResult {
  ok: boolean;
  audit: KayAuditEnvelope;
}

let auditPool: Pool | null = null;
let auditVerified: Promise<void> | null = null;

const AUDIT_ACTIONS = new Set([
  "crm.read", "crm.get", "crm.list", "crm.search", "crm.analyze", "crm.score", "crm.inspect",
  "crm.write", "crm.update", "crm.insert", "crm.delete", "crm.truncate", "crm.alter",
  "tasks.create", "tasks.update", "tasks.complete", "tasks.delete",
  "leads.reassign", "leads.update", "rescue.execute", "protection.update",
  "missions.generate", "settings.update", "whatsapp.send", "workflow.transition",
  "audit.write", "http.write",
  ...Array.from(KAY_CRM_MUTATION_ACTIONS),
]);

const AUDIT_TARGET_TYPES = new Set([
  "crm_lead", "crm_leads", "crm_task", "crm_tasks", "lead_assignment",
  "lead_assignment_history", "http_route", "auto_rescue_queue", "rescue_execution",
  "kay_availability", "kay_briefing", "kay_commitment", "kay_decision", "kay_evaluator",
  "kay_evaluator_queue", "kay_mission", "kay_notification", "kay_phase", "kay_promise",
  "kay_setting", "legacy_baseline", "manager_review", "mission_generator", "mission_lease",
  "phase", "phase_d_lease", "promise_handoff", "worker",
]);

const AUDIT_SAFE_IDS = new Set([
  "E.2.4", "new", "acquire", "renew", "release", "claim", "enqueue", "shadow", "start",
  "pending", "automatic", "manual", "repair", "activate",
]);

function boundedAction(action: unknown): string {
  const value = String(action || "").trim().toLowerCase();
  if (value === "crm_mutation_blocked") return "CRM_MUTATION_BLOCKED";
  return AUDIT_ACTIONS.has(value) ? value : "unknown_action";
}

function boundedTargetType(targetType: unknown): string | null {
  const value = String(targetType || "").trim().toLowerCase();
  return AUDIT_TARGET_TYPES.has(value) ? value : null;
}

function boundedTargetId(targetType: unknown, targetId: unknown): string | null {
  const type = boundedTargetType(targetType);
  if (!type || targetId == null) return null;
  if (typeof targetId === "number" && Number.isSafeInteger(targetId) && targetId >= 0) return String(targetId);
  const value = String(targetId);
  if (type === "http_route") return "kay_http_route";
  return AUDIT_SAFE_IDS.has(value) ? value : null;
}

function boundedActorId(actorId: unknown): string | null {
  return typeof actorId === "number" && Number.isSafeInteger(actorId) && actorId >= 0
    ? String(actorId)
    : null;
}

function normalizeAuditField(field: unknown): string {
  const value = String(field || "").split(".").pop()?.replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase() || "";
  return KAY_IMMUTABLE_IDENTITY_FIELDS.includes(value) ? value : "unknown_field";
}

function boundedFields(fields: readonly unknown[] | undefined): string[] {
  return Array.from(new Set((fields || []).slice(0, 20).map(normalizeAuditField))).slice(0, 20);
}

export function sanitizeKayAuditRecord(result: KayGatewayResult, request: KayPolicyRequest) {
  return {
    action: boundedAction(result.audit.action),
    actorId: boundedActorId(result.audit.actorId),
    targetType: boundedTargetType(result.audit.target.type),
    targetId: boundedTargetId(result.audit.target.type, result.audit.target.id),
    requestSnapshot: {
      attemptedAction: boundedAction(request.action),
      capability: request.capability && [
        "kay.crm.read", "kay.crm.analyze", "kay.tasks.create", "kay.leads.reassign",
        "kay.crm.write", "kay.whatsapp.send", "kay.rescue.execute",
      ].includes(request.capability) ? request.capability : null,
      actionKind: request.actionKind === "read" || request.actionKind === "analyze" || request.actionKind === "write" ? request.actionKind : null,
      environment: request.environment === "development" || request.environment === "test" || request.environment === "production" ? request.environment : null,
      mode: request.mode === "shadow" || request.mode === "assisted" || request.mode === "controlled_automation" ? request.mode : null,
      killSwitch: request.killSwitch !== false,
      fields: boundedFields(request.fields),
      canary: request.canary === true,
    },
  };
}

function getAuditPool(): Pool {
  const connectionString = process.env.KAY_AUDIT_DATABASE_URL;
  if (!connectionString) {
    throw Object.assign(new Error("Kay audit writer connection is not configured"), {
      code: "KAY_AUDIT_UNAVAILABLE",
      status: 503,
    });
  }
  auditPool ||= new Pool({ connectionString, max: 2, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 10_000 });
  return auditPool;
}

async function verifyAuditWriter(): Promise<void> {
  auditVerified ||= (async () => {
    const check = await getAuditPool().query(`SELECT
      has_table_privilege(current_user,'kay_action_audit','INSERT') AS can_insert,
      has_table_privilege(current_user,'kay_action_audit','UPDATE') AS can_update,
      has_table_privilege(current_user,'kay_action_audit','DELETE') AS can_delete,
      has_table_privilege(current_user,'kay_action_audit','TRUNCATE') AS can_truncate,
      EXISTS(SELECT 1 FROM pg_class WHERE oid='kay_action_audit'::regclass
        AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns_ledger,
      EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='kay_action_audit'::regclass
        AND tgname='kay_action_audit_append_only' AND tgenabled='O') AS trigger_enabled`);
    const row = check.rows[0];
    if (row?.can_insert !== true || row?.can_update === true || row?.can_delete === true ||
        row?.can_truncate === true || row?.owns_ledger === true || row?.trigger_enabled !== true) {
      throw Object.assign(new Error("Kay audit writer privilege boundary is unsafe"), {
        code: "KAY_AUDIT_ROLE_UNSAFE",
        status: 503,
      });
    }
  })().catch(error => {
    auditVerified = null;
    throw error;
  });
  return auditVerified;
}

async function persistAuditDecision(
  result: KayGatewayResult,
  request: KayPolicyRequest,
): Promise<void> {
  await verifyAuditWriter();
  const safe = sanitizeKayAuditRecord(result, request);
  await getAuditPool().query(`INSERT INTO kay_action_audit
    (run_id,action_id,action,actor_id,target_type,target_id,policy_decision,policy_reason,policy_version,dry_run,request_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`, [
    result.audit.runId, result.audit.actionId, safe.action,
    safe.actorId, safe.targetType, safe.targetId,
    result.audit.policy.decision, result.audit.policy.reason, result.audit.policy.policyVersion,
    result.audit.dryRun, JSON.stringify(safe.requestSnapshot),
  ]);
}

/**
 * The only supported entry point for Kay actions. It authorizes and returns
 * an audit envelope; it deliberately accepts no executor and performs no
 * database or CRM operation. Callers must still implement an independently
 * reviewed, write-disabled action.
 */
export function evaluateKayAction(request: KayPolicyRequest, ids?: Partial<Pick<KayAuditEnvelope, "runId" | "actionId">>): KayGatewayResult {
  const policy = evaluateKayPolicy(request);
  const audit = createKayAuditEnvelope(request, policy, {
    runId: ids?.runId || `kay-run-${randomUUID()}`,
    actionId: ids?.actionId || `kay-action-${randomUUID()}`,
  });
  return { ok: policy.allowed, audit };
}

/** Every policy decision is persisted before the caller may continue. */
export async function authorizeKayAction(
  request: KayPolicyRequest,
  ids?: Partial<Pick<KayAuditEnvelope, "runId" | "actionId">>,
): Promise<KayGatewayResult> {
  const result = evaluateKayAction(request, ids);
  await persistAuditDecision(result, request);
  return result;
}

/**
 * Synchronous, permanent mutation boundary.  Keeping the throw synchronous
 * protects direct service calls that forget to await a guard: no transaction
 * can be opened after this function returns.  Audit persistence is best effort
 * and never receives secrets or customer payloads.
 */
export function denyKayWrite(
  action: KayPolicyRequest["action"],
  actorId?: string | number,
  targetType?: string,
  targetId?: string | number,
): never {
  const request: KayPolicyRequest = {
    action,
    actionKind: "write",
    actorId,
    targetType,
    targetId,
    environment: process.env.NODE_ENV || "development",
    mode: "shadow",
    killSwitch: true,
    dryRun: false,
    actorCapabilities: [],
  };
  const result = evaluateKayAction(request);
  // Every blocked guard is audited. Persistence is deliberately not awaited:
  // this function must throw synchronously so a forgotten await cannot reach a
  // transaction. Audit failure never changes the deny result.
  void persistAuditDecision(result, request).catch(error => {
    // Missing/revoked dedicated audit credentials are a deployment
    // availability issue, never a reason to let the mutation continue.
    console.warn(`[Kay] blocked Kay action audit unavailable: ${error instanceof Error ? error.message : "unknown"}`);
  });
  throw Object.assign(new Error(KAY_CRM_MUTATION_DENIED), {
    code: KAY_CRM_MUTATION_DENIED,
    reason: result.audit.policy.reason,
    status: 423,
    actionId: result.audit.actionId,
    legacyCode: "KAY_WRITES_DISABLED",
  });
}