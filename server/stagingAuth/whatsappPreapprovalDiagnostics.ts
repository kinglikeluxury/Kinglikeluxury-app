type Operation = "create" | "list_employee" | "list_pending" | "decide" | "cancel";

function postgresCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

function reasonCode(error: unknown, code?: string): string {
  if (code === "42501") return "database_permission_denied";
  if (code === "28P01" || code?.startsWith("08")) return "database_connection_failure";
  if (code === "42P01" || code === "42703" || code === "3F000") return "database_schema_mismatch";
  if (code === "23505") return "duplicate_active_request";
  if (error instanceof Error && error.message === "employee_identity_unavailable") {
    return "employee_identity_unavailable";
  }
  if (error instanceof Error && error.message === "staging_preapproval_database_mismatch") {
    return "database_target_mismatch";
  }
  return "database_operation_failed";
}

export function logStagingWhatsappPreapprovalFailure(
  operation: Operation,
  error: unknown,
): void {
  const code = postgresCode(error);
  const details = {
    event: "staging_whatsapp_preapproval_failure",
    operation,
    reasonCode: reasonCode(error, code),
    ...(code ? { postgresCode: code } : {}),
  };
  console.error(JSON.stringify(details));
}
