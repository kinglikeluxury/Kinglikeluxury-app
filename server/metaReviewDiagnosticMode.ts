export const META_REVIEW_DIAGNOSTIC_MODE_FLAG =
  "ENABLE_META_REVIEW_DIAGNOSTIC_MODE";

export const META_REVIEW_DIAGNOSTIC_MODE_STARTUP_LOG =
  "[Startup] Meta Review diagnostic mode active; background jobs are disabled.";

export function isMetaReviewDiagnosticMode(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return (
    environment.NODE_ENV === "development" &&
    environment[META_REVIEW_DIAGNOSTIC_MODE_FLAG] === "true"
  );
}

export function shouldRunNormalStartupWork(
  environment: Record<string, string | undefined> = process.env,
): boolean {
  return !isMetaReviewDiagnosticMode(environment);
}
