import type {
  MetaGraphClient,
  MetaSignupTokenInspection,
} from "./whatsappCoexistenceMetaGraph";

const REQUIRED_SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
  "business_management",
] as const;

export type SignupAssetClaims = Readonly<{
  businessId: string;
  wabaId: string;
  phoneNumberId: string;
}>;

export type SignupActor = Readonly<{
  employeeId: number;
  sessionId: string;
}>;

export type SignupEligibility = Readonly<{
  archiveEmployeeId: number;
  employeeRef: string;
  active: boolean;
  authorizedRole: boolean;
  companyWorkNumberOnly: boolean;
  noticeVersion: string;
  customerNoticeVersion: string;
  lawfulBasis: string;
  legalAssessmentReference: string;
  retentionDays: number;
  policyApproved: boolean;
}>;

export type SignupRepository = {
  getEmployeeEligibility(employeeId: number): Promise<SignupEligibility | null>;
  createPendingOwnerApprovalRequest(input: {
    employeeId: number;
    archiveEmployeeId: number;
    employeeRef: string;
    businessId: string;
    wabaId: string;
    phoneNumberId: string;
    noticeVersion: string;
    retentionDays: number;
    noticeReceiptRecorded: true;
    verifiedAt: Date;
  }): Promise<"created" | "duplicate">;
};

export type CompleteSignupInput = {
  actor: SignupActor;
  code: string;
  claims: SignupAssetClaims;
  noticeReceiptRecorded: boolean;
};

function isMetaId(value: unknown): value is string {
  return typeof value === "string" && /^\d{1,40}$/.test(value);
}

function assertClaims(claims: SignupAssetClaims): void {
  if (
    !isMetaId(claims.businessId) ||
    !isMetaId(claims.wabaId) ||
    !isMetaId(claims.phoneNumberId)
  ) throw new Error("Signup asset claims are invalid.");
}

export function createWhatsappCoexistenceSignupCompleter(dependencies: {
  graph: MetaGraphClient;
  repository: SignupRepository;
  expectedAppId: string;
  now?: () => number;
}) {
  return async function completeSignup(input: CompleteSignupInput): Promise<"created" | "duplicate"> {
    assertClaims(input.claims);
    if (
      !Number.isSafeInteger(input.actor.employeeId) ||
      input.actor.employeeId < 1 ||
      !input.actor.sessionId ||
      input.code.length < 8 ||
      input.code.length > 4096 ||
      input.noticeReceiptRecorded !== true
    ) throw new Error("Signup request is invalid.");

    // The short-lived code is exchanged immediately and kept in memory only.
    const token = await dependencies.graph.exchangeCode(input.code);
    const inspection = await dependencies.graph.inspectToken(token);
    const nowSeconds = Math.floor((dependencies.now?.() ?? Date.now()) / 1000);
    if (
      !inspection.valid ||
      inspection.appId !== dependencies.expectedAppId ||
      !Number.isSafeInteger(inspection.expiresAt) ||
      !(inspection.expiresAt === 0 || inspection.expiresAt > nowSeconds) ||
      REQUIRED_SCOPES.some((scope) => !inspection.scopes.includes(scope))
    ) throw new Error("Meta token identity or permissions were not verified.");

    const [ownedWabas, phoneNumbers] = await Promise.all([
      dependencies.graph.listBusinessOwnedWabas(input.claims.businessId, token),
      dependencies.graph.listWabaPhoneNumbers(input.claims.wabaId, token),
    ]);
    if (
      !ownedWabas.includes(input.claims.wabaId) ||
      !phoneNumbers.includes(input.claims.phoneNumberId)
    ) throw new Error("Meta business asset ownership was not verified.");

    const eligibility = await dependencies.repository.getEmployeeEligibility(input.actor.employeeId);
    if (
      !eligibility ||
      !Number.isSafeInteger(eligibility.archiveEmployeeId) ||
      eligibility.archiveEmployeeId < 1 ||
      eligibility.employeeRef !== String(input.actor.employeeId) ||
      !eligibility.active ||
      !eligibility.authorizedRole ||
      !eligibility.policyApproved ||
      !eligibility.noticeVersion ||
      !eligibility.customerNoticeVersion ||
      !eligibility.lawfulBasis ||
      !eligibility.legalAssessmentReference ||
      !Number.isSafeInteger(eligibility.retentionDays) ||
      eligibility.retentionDays < 1 ||
      eligibility.retentionDays > 3650
    ) throw new Error("Employee archive approval is unavailable.");

    // This only creates a short-lived request after current company policy,
    // notice receipt, and company-number eligibility are rechecked. Meta's
    // number authorization and a separate authenticated admin approval remain
    // required before a binding can become active.
    return dependencies.repository.createPendingOwnerApprovalRequest({
      employeeId: input.actor.employeeId,
      archiveEmployeeId: eligibility.archiveEmployeeId,
      employeeRef: eligibility.employeeRef,
      ...input.claims,
      noticeVersion: eligibility.noticeVersion,
      retentionDays: eligibility.retentionDays,
      noticeReceiptRecorded: true,
      verifiedAt: new Date((dependencies.now?.() ?? Date.now())),
    });
  };
}
