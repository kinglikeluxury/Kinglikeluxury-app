import crypto from "node:crypto";
import type { MetaGraphClient } from "./whatsappCoexistenceMetaGraph";
import {
  normalizeMetaDisplayNumber,
  parseOnboardingKey,
  protectApprovedNumber,
  revealApprovedNumber,
  type NumberPreapprovalStore,
} from "./stagingAuth/whatsappPreapproval";
import {
  encryptMetaAccessToken,
  parseMetaTokenEncryptionKey,
} from "./stagingArchive/metaTokenVault";
import type { createWhatsappCoexistenceSignupPostgresWriter } from "./whatsappCoexistenceSignupPostgresWriter";

// Embedded Signup v4 requires the two WhatsApp scopes. Some app configurations
// do not grant business_management; actual business ownership and exact WABA
// membership must still be proven by Meta Graph, or signup fails closed.
const REQUIRED_SCOPES = [
  "whatsapp_business_management",
  "whatsapp_business_messaging",
];

type MetaClaims = { businessId: string; wabaId: string; phoneNumberId: string };
const validId = (value: unknown): value is string =>
  typeof value === "string" && /^\d{1,40}$/.test(value);
const digestMatches = (left: Buffer, right: Buffer) =>
  left.length === right.length && crypto.timingSafeEqual(left, right);

export function createVerifiedPreapprovalSignupCompleter(deps: {
  env: NodeJS.ProcessEnv;
  graph: MetaGraphClient;
  store: NumberPreapprovalStore;
  expectedAppId: string;
  archiveSignupWriter?: ReturnType<typeof createWhatsappCoexistenceSignupPostgresWriter>;
  getArchiveEligibility?(employeeId: number): Promise<{
    archiveEmployeeId: number; employeeRef: string; active: boolean;
    authorizedRole: boolean; currentNoticeReceived: boolean;
    companyWorkNumberOnly: boolean; noticeVersion: string;
    retentionDays: number; policyApproved: boolean;
  } | null>;
  now?: () => number;
}) {
  return async (input: {
    approvalId: string;
    version: number;
    employeeId: number;
    code: string;
    claims: MetaClaims;
  }): Promise<"verified" | "stale"> => {
    const key = parseOnboardingKey(deps.env.WHATSAPP_STAGING_ONBOARDING_ENCRYPTION_KEY);
    if (!key || !/^[0-9a-f-]{36}$/i.test(input.approvalId) ||
      !Number.isSafeInteger(input.version) || input.version < 1 ||
      !Number.isSafeInteger(input.employeeId) || input.employeeId < 1 ||
      input.code.length < 8 || input.code.length > 4096 ||
      !validId(input.claims.businessId) || !validId(input.claims.wabaId) ||
      !validId(input.claims.phoneNumberId)) throw new Error("preapproval_signup_invalid");

    const approval = await deps.store.getApprovedForAttempt({
      id: input.approvalId, version: input.version, employeeId: input.employeeId,
    });
    if (!approval || approval.status !== "approved" || approval.version !== input.version) return "stale";
    const approvedNumber = revealApprovedNumber(approval.numberCiphertext, key);
    const expected = protectApprovedNumber(approvedNumber, key).fingerprint;
    if (!digestMatches(expected, approval.numberFingerprint)) throw new Error("preapproval_number_integrity_failed");

    const token = await deps.graph.exchangeCode(input.code);
    const inspection = await deps.graph.inspectToken(token);
    const nowSeconds = Math.floor((deps.now?.() ?? Date.now()) / 1000);
    if (!inspection.valid || inspection.appId !== deps.expectedAppId ||
      !Number.isSafeInteger(inspection.expiresAt) ||
      !(inspection.expiresAt === 0 || inspection.expiresAt > nowSeconds) ||
      REQUIRED_SCOPES.some((scope) => !inspection.scopes.includes(scope))) {
      throw new Error("meta_token_verification_failed");
    }

    // If Meta cannot positively confirm coexistence, refuse to treat a
    // potentially migrated Cloud API-only phone as the approved Business App number.
    if (!deps.graph.getCoexistencePhoneStatus) {
      throw new Error("meta_coexistence_status_verification_unavailable");
    }
    const [wabas, phoneNumbers, coexistence] = await Promise.all([
      deps.graph.listBusinessOwnedWabas(input.claims.businessId, token),
      deps.graph.listWabaPhoneNumberDetails(input.claims.wabaId, token),
      deps.graph.getCoexistencePhoneStatus(input.claims.phoneNumberId, token),
    ]);
    if (coexistence.isOnBizApp !== true || coexistence.platformType !== "CLOUD_API") {
      throw new Error("meta_phone_not_verified_as_coexistence");
    }
    const phone = phoneNumbers.find((candidate) => candidate.id === input.claims.phoneNumberId);
    const returnedNumber = normalizeMetaDisplayNumber(phone?.displayPhoneNumber);
    if (!wabas.includes(input.claims.wabaId) || !phone || returnedNumber !== approvedNumber) {
      throw new Error("meta_asset_or_approved_number_mismatch");
    }
    const displayFingerprint = protectApprovedNumber(returnedNumber, key).fingerprint;
    if (deps.archiveSignupWriter || deps.getArchiveEligibility) {
      if (!deps.archiveSignupWriter || !deps.getArchiveEligibility) {
        throw new Error("staging_archive_binding_store_unavailable");
      }
      const eligibility = await deps.getArchiveEligibility(input.employeeId);
      if (!eligibility || !eligibility.active || !eligibility.authorizedRole ||
          !eligibility.currentNoticeReceived || !eligibility.policyApproved ||
          !eligibility.companyWorkNumberOnly) {
        throw new Error("staging_archive_binding_prerequisites_unavailable");
      }
      const tokenKey = parseMetaTokenEncryptionKey(
        deps.env.WHATSAPP_STAGING_META_TOKEN_ENCRYPTION_KEY,
      );
      if (!tokenKey) throw new Error("staging_meta_token_key_unavailable");
      const requestId = await deps.archiveSignupWriter
        .createPendingOwnerApprovalRequestWithId({
          employeeId: input.employeeId,
          archiveEmployeeId: eligibility.archiveEmployeeId,
          employeeRef: eligibility.employeeRef,
          businessId: input.claims.businessId,
          wabaId: input.claims.wabaId,
          phoneNumberId: input.claims.phoneNumberId,
          noticeVersion: eligibility.noticeVersion,
          retentionDays: eligibility.retentionDays,
          noticeReceiptRecorded: true,
          verifiedAt: new Date(deps.now?.() ?? Date.now()),
        });
      const encrypted = encryptMetaAccessToken(token, tokenKey, {
        requestId,
        employeeId: eligibility.archiveEmployeeId,
        businessId: input.claims.businessId,
        wabaId: input.claims.wabaId,
        phoneNumberId: input.claims.phoneNumberId,
      });
      const tokenStored = await deps.archiveSignupWriter.storeMetaAccessToken({
        requestId,
        employeeId: eligibility.archiveEmployeeId,
        businessId: input.claims.businessId,
        wabaId: input.claims.wabaId,
        phoneNumberId: input.claims.phoneNumberId,
        encrypted,
        expiresAt: inspection.expiresAt > 0
          ? new Date(inspection.expiresAt * 1000)
          : null,
      });
      if (!tokenStored) throw new Error("staging_meta_token_store_failed");
    }
    const persisted = await deps.store.recordMetaVerified({
      id: input.approvalId,
      version: input.version,
      employeeId: input.employeeId,
      numberFingerprint: approval.numberFingerprint,
      businessId: input.claims.businessId,
      wabaId: input.claims.wabaId,
      phoneNumberId: input.claims.phoneNumberId,
      displayFingerprint,
    });
    return persisted ? "verified" : "stale";
  };
}
