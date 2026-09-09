import {
  createKayAuditEnvelope,
  evaluateKayPolicy,
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
  await verifyAuditWriter();
  await getAuditPool().query(`INSERT INTO kay_action_audit
    (run_id,action_id,action,actor_id,target_type,target_id,policy_decision,policy_reason,policy_version,dry_run,request_snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`, [
      result.audit.runId, result.audit.actionId, result.audit.action,
      result.audit.actorId == null ? null : String(result.audit.actorId),
      result.audit.target.type, result.audit.target.id == null ? null : String(result.audit.target.id),
      result.audit.policy.decision, result.audit.policy.reason, result.audit.policy.policyVersion,
      result.audit.dryRun, JSON.stringify({
        capability: request.capability ?? null,
        actionKind: request.actionKind ?? null,
        environment: request.environment ?? null,
        mode: request.mode ?? null,
        killSwitch: request.killSwitch !== false,
        fields: request.fields ?? [],
        canary: request.canary === true,
      }),
    ]);
  return result;
}

/** Current production writes are deliberately impossible, but attempts remain auditable. */
export async function denyKayWrite(
  action: KayPolicyRequest["action"],
  actorId?: string | number,
  targetType?: string,
  targetId?: string | number,
): Promise<never> {
  const result = await authorizeKayAction({
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
  });
  throw Object.assign(new Error("KAY_WRITES_DISABLED"), {
    code: "KAY_WRITES_DISABLED",
    status: 423,
    actionId: result.audit.actionId,
  });
}