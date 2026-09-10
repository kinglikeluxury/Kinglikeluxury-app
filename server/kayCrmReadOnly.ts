/**
 * CRM access used by Kay analysis.  This module intentionally has no import
 * from server/db: the application's normal pool is write-capable for human
 * CRM workflows and is never a valid Kay CRM-read fallback.
 */
export { withKayReadonlyAnalysis } from "./kayAnalysisDatabase";

export const KAY_ANALYSIS_CONNECTION_ENV = "KAY_ANALYSIS_DATABASE_URL" as const;
export const KAY_FORBIDDEN_CRM_READ_FALLBACKS = [
  "DATABASE_URL",
  "NEON_DATABASE_URL",
] as const;

/** Tables whose rows are CRM business data and therefore read-only to Kay. */
export const KAY_CRM_TABLES = Object.freeze([
  "crm_leads",
  "crm_tasks",
  "lead_assignment_history",
]) as readonly string[];

/**
 * A small source-level contract for static audits and future services.  It is
 * intentionally an allowlist: unknown CRM tables and future fields remain
 * protected until an explicitly read-only query is reviewed.
 */
export function isKayApprovedCrmReadTable(table: string): boolean {
  return KAY_CRM_TABLES.includes(String(table).trim().toLowerCase());
}
