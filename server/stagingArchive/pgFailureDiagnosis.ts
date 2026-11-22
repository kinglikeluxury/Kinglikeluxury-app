export type PgFailureStage = "connect" | "preflight_query" | "transaction";
export type PgFailureCategory = "dns" | "tcp" | "tls" | "authentication" | "postgres" | "unknown";

export type SafePgFailureDiagnosis = Readonly<{
  stage: PgFailureStage;
  category: PgFailureCategory;
  code: string | null;
}>;

const SAFE_CODE = /^[A-Z0-9_]{1,32}$/;

export function diagnosePgFailure(
  error: unknown,
  stage: PgFailureStage,
): SafePgFailureDiagnosis {
  const candidate = error && typeof error === "object"
    ? (error as { code?: unknown }).code
    : null;
  const code = typeof candidate === "string" && SAFE_CODE.test(candidate) ? candidate : null;

  let category: PgFailureCategory = "unknown";
  if (code && ["ENOTFOUND", "EAI_AGAIN", "EAI_FAIL", "ENODATA"].includes(code)) {
    category = "dns";
  } else if (code && ["ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EHOSTUNREACH"].includes(code)) {
    category = "tcp";
  } else if (code && (
    code.startsWith("ERR_TLS") ||
    code.startsWith("CERT_") ||
    code.startsWith("ERR_SSL") ||
    code.startsWith("ERR_OSSL") ||
    ["DEPTH_ZERO_SELF_SIGNED_CERT", "SELF_SIGNED_CERT_IN_CHAIN", "UNABLE_TO_VERIFY_LEAF_SIGNATURE"].includes(code)
  )) {
    category = "tls";
  } else if (code && ["28P01", "28000", "28P02"].includes(code)) {
    category = "authentication";
  } else if (code && /^[0-9A-Z]{5}$/.test(code)) {
    category = "postgres";
  } else if (stage === "connect") {
    category = "tcp";
  }

  return { stage, category, code };
}

export function safePgFailureMessage(error: unknown, stage: PgFailureStage): string {
  const diagnosis = diagnosePgFailure(error, stage);
  return `Archive PostgreSQL ${diagnosis.stage} failed (${diagnosis.category}; code=${diagnosis.code ?? "unavailable"}).`;
}
