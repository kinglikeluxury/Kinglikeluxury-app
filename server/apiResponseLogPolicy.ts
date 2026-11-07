const SENSITIVE_RESPONSE_PREFIXES = [
  "/api/whatsapp-employee",
  "/api/employee/whatsapp-consents",
  "/api/admin/whatsapp-employees",
  "/api/admin/whatsapp-meta/onboarding",
  "/api/admin/whatsapp-employee/local-review",
  "/api/webhooks/whatsapp-employee",
];

export function shouldLogApiResponseBody(path: string): boolean {
  if (!path.startsWith("/api/")) return false;
  return !SENSITIVE_RESPONSE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
