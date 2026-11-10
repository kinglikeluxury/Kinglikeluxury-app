export type AuditQueryResult = { rows: Array<Record<string, unknown>>; rowCount?: number | null };
export interface AuditQueryable {
  query(sql: string, values?: unknown[]): Promise<AuditQueryResult>;
}

export type ArchiveAccessAction = "archive.read" | "archive.search" | "archive.export";
export type ArchiveAccessOutcome = "allowed" | "denied";
export type ArchiveAccessReason =
  | "employee_own_scope" | "supervisor_grant" | "admin_explicit_grant"
  | "missing_assignment" | "consent_inactive" | "scope_denied" | "policy_blocked";

export interface ArchiveAccessAuditInput {
  actorId: number;
  employeeId: number;
  action: ArchiveAccessAction;
  outcome: ArchiveAccessOutcome;
  reason: ArchiveAccessReason;
  resultCount?: number;
}

const ACTIONS = new Set<ArchiveAccessAction>(["archive.read", "archive.search", "archive.export"]);
const OUTCOMES = new Set<ArchiveAccessOutcome>(["allowed", "denied"]);
const REASONS = new Set<ArchiveAccessReason>([
  "employee_own_scope", "supervisor_grant", "admin_explicit_grant",
  "missing_assignment", "consent_inactive", "scope_denied", "policy_blocked",
]);

function countBucket(value: number | undefined): string | null {
  if (value === undefined || !Number.isSafeInteger(value) || value < 0) return null;
  if (value === 0) return "0";
  if (value <= 10) return "1-10";
  if (value <= 50) return "11-50";
  return "51+";
}

/**
 * Call only after the route has made its authorization decision, including
 * denials. It deliberately accepts no request body, message, query, or response.
 * Audit persistence failure must abort the protected read/export.
 */
export async function recordWhatsappEmployeeArchiveAccess(
  db: AuditQueryable,
  input: ArchiveAccessAuditInput,
): Promise<void> {
  if (!Number.isSafeInteger(input.actorId) || input.actorId <= 0 ||
      !Number.isSafeInteger(input.employeeId) || input.employeeId <= 0 ||
      !ACTIONS.has(input.action) || !OUTCOMES.has(input.outcome) || !REASONS.has(input.reason)) {
    throw new Error("Invalid archive audit event");
  }
  const count = countBucket(input.resultCount);
  await assertWhatsappEmployeeAuditWriter(db);
  await db.query(
    `INSERT INTO whatsapp_employee_access_audit
      (actor_id, employee_id, action, outcome, reason_code, result_count_bucket)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [input.actorId, input.employeeId, input.action, input.outcome, input.reason, count],
  );
}

/** Verify a dedicated non-owner writer before allowing a protected response. */
export async function assertWhatsappEmployeeAuditWriter(db: AuditQueryable): Promise<void> {
  const result = await db.query(`SELECT
    has_table_privilege(current_user,'whatsapp_employee_access_audit','INSERT') AS can_insert,
    has_table_privilege(current_user,'whatsapp_employee_access_audit','SELECT') AS can_select,
    has_table_privilege(current_user,'whatsapp_employee_access_audit','UPDATE') AS can_update,
    has_table_privilege(current_user,'whatsapp_employee_access_audit','DELETE') AS can_delete,
    has_table_privilege(current_user,'whatsapp_employee_access_audit','TRUNCATE') AS can_truncate,
    EXISTS (SELECT 1 FROM pg_class WHERE oid='whatsapp_employee_access_audit'::regclass
      AND relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns_table,
    pg_has_role((SELECT oid FROM pg_roles WHERE rolname=current_user),
      (SELECT relowner FROM pg_class WHERE oid='whatsapp_employee_access_audit'::regclass),
      'MEMBER') AS member_of_owner,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='whatsapp_employee_access_audit'::regclass
      AND tgname='whatsapp_employee_access_audit_immutable' AND tgenabled='O') AS trigger_enabled`);
  const row = result.rows[0];
  if (row?.can_insert !== true || row?.can_select !== false || row?.can_update !== false ||
      row?.can_delete !== false || row?.can_truncate !== false || row?.owns_table !== false ||
      row?.member_of_owner !== false || row?.trigger_enabled !== true) {
    throw new Error("WhatsApp archive audit writer privilege boundary is unsafe");
  }
}
