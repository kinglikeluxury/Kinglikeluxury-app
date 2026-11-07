export type SyntheticOnboardingFixture = {
  code: string;
  businessPortfolioId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhoneNumber: string;
};

export async function runSyntheticWhatsappOnboardingFlow(
  fetcher: typeof fetch = fetch,
  baseUrl = "",
  fixture: SyntheticOnboardingFixture = {
    code: "synthetic-code-valid",
    businessPortfolioId: "123456",
    wabaId: "234567",
    phoneNumberId: "345678",
    displayPhoneNumber: "+995555000001",
  },
): Promise<void> {
  const send = (path: string, init?: RequestInit) => fetcher(`${baseUrl}${path}`, {
    credentials: "same-origin",
    cache: "no-store",
    ...init,
    headers: {
      Accept: "application/json",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  const csrfResponse = await send("/api/admin/whatsapp-meta/onboarding/csrf");
  if (!csrfResponse.ok) throw new Error("Isolated onboarding test is unavailable.");
  const { csrfToken } = await csrfResponse.json() as { csrfToken?: string };
  if (typeof csrfToken !== "string") throw new Error("Isolated onboarding test is unavailable.");

  const startResponse = await send("/api/admin/whatsapp-meta/onboarding/start", {
    method: "POST",
    headers: { "X-CSRF-Token": csrfToken },
    body: "{}",
  });
  if (!startResponse.ok) throw new Error("Isolated onboarding test is unavailable.");
  const flow = await startResponse.json() as {
    flowId?: string; state?: string; csrfToken?: string;
  };
  if (!flow.flowId || !flow.state || !flow.csrfToken) {
    throw new Error("Isolated onboarding test is unavailable.");
  }

  const finishResponse = await send("/api/admin/whatsapp-meta/onboarding/finish", {
    method: "POST",
    headers: { "X-CSRF-Token": flow.csrfToken },
    body: JSON.stringify({
      flowId: flow.flowId,
      state: flow.state,
      ...fixture,
    }),
  });
  if (!finishResponse.ok) throw new Error("Isolated onboarding test was rejected.");
  const result = await finishResponse.json() as { status?: string };
  if (result.status !== "verified_pending_activation") {
    throw new Error("Isolated onboarding test was rejected.");
  }
}
