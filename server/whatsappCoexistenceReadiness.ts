import { parseArchiveEncryptionKey } from "./whatsappEmployeeArchiveSafety";
import {
  getStagingArchiveOwnerApproverTarget,
  getStagingArchiveSignupWriterTarget,
} from "./stagingArchive/isolation";

export type ReadinessState = "READY" | "BLOCKED";

export type WhatsappCoexistenceReadiness = Readonly<{
  nodeDevelopmentOnly: ReadinessState;
  stagingOnly: ReadinessState;
  identityStoreIsolation: ReadinessState;
  serviceConnections: ReadinessState;
  serviceStoresAuthenticated: ReadinessState;
  signupWriterStore: ReadinessState;
  ownerApprovalStore: ReadinessState;
  functionGrants: ReadinessState;
  publicHttpsCallback: ReadinessState;
  metaCredentialsAndWebhook: ReadinessState;
  archivePolicyAndKey: ReadinessState;
  trustedNoticeStatusWriter: ReadinessState;
  employeeSession: ReadinessState;
  employeeConfirmation: ReadinessState;
  ownerNumberApproval: ReadinessState;
  minimalMetadataStore: ReadinessState;
  metaConfigVerified: ReadinessState;
  preapprovalMigration: ReadinessState;
  onboardingEncryptionKey: ReadinessState;
  metadataStoreAuthenticated: ReadinessState;
  encryptedTokenCustody: ReadinessState;
  ownerApprovedArchiveBinding: ReadinessState;
  numberPreapprovalReady: boolean;
  employeeNumberRequestReady: boolean;
  ownerNumberReviewReady: boolean;
  quarantineSignatureReview: ReadinessState;
  activationApproval: ReadinessState;
  onboardingQuarantineReady: boolean;
  onboardingPrerequisitesReady: boolean;
  connectionReady: boolean;
  archivingReady: boolean;
  oauthEnabled: boolean;
  webhookEnabled: boolean;
  quarantineWebhookEnabled: boolean;
}>;

export type WhatsappCoexistenceReadinessContext = Readonly<{
  validEmployeeSession?: boolean;
  validOwnerSession?: boolean;
  employeeConfirmed?: boolean;
  ownerApprovedExactNumber?: boolean;
  minimalMetadataStoreVerified?: boolean;
  preapprovalMigrationApplied?: boolean;
  onboardingStoreAuthenticated?: boolean;
  encryptedTokenStoreVerified?: boolean;
  archiveSignupWriterAuthenticated?: boolean;
  ownerApprovalStoreAuthenticated?: boolean;
  ownerApprovedArchiveBindingVerified?: boolean;
  trustedNoticeWriterVerified?: boolean;
}>;

function present(env: NodeJS.ProcessEnv, key: string): boolean {
  return typeof env[key] === "string" && env[key]!.trim().length > 0;
}

function approved(env: NodeJS.ProcessEnv, key: string): boolean {
  return env[key] === "true";
}

function publicHttpsConfigured(env: NodeJS.ProcessEnv): boolean {
  const raw = env.WHATSAPP_ARCHIVE_STAGING_PUBLIC_BASE_URL;
  if (!raw) return false;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && !url.username && !url.password &&
      url.hostname.length > 0 && url.origin === raw.replace(/\/+$/, "");
  } catch {
    return false;
  }
}

export function getWhatsappCoexistenceReadiness(
  env: NodeJS.ProcessEnv,
  context: WhatsappCoexistenceReadinessContext = {},
): WhatsappCoexistenceReadiness {
  const staging = env.APP_DEPLOYMENT_MODE === "staging";
  const nodeDevelopment = env.NODE_ENV === "development";
  const identityStoreIsolation =
    approved(env, "WHATSAPP_COEXISTENCE_STAGING_IDENTITY_STORE_READONLY_VERIFIED");
  const serviceConnections = staging &&
    getStagingArchiveSignupWriterTarget(env) !== null &&
    getStagingArchiveOwnerApproverTarget(env) !== null;
  const serviceStoresAuthenticated =
    context.archiveSignupWriterAuthenticated === true &&
    context.ownerApprovalStoreAuthenticated === true;
  const grants = approved(env, "WHATSAPP_ARCHIVE_STAGING_FUNCTION_GRANTS_READONLY_VERIFIED");
  const publicHttps = publicHttpsConfigured(env) &&
    approved(env, "WHATSAPP_ARCHIVE_STAGING_PUBLIC_HTTPS_READONLY_VERIFIED");
  const meta = present(env, "WHATSAPP_MONITOR_META_APP_ID") &&
    present(env, "WHATSAPP_MONITOR_META_CONFIG_ID") &&
    present(env, "META_APP_SECRET") &&
    present(env, "WHATSAPP_ARCHIVE_WEBHOOK_VERIFY_TOKEN") &&
    approved(env, "WHATSAPP_ARCHIVE_STAGING_WEBHOOK_APPROVED");
  const retentionDays = Number(env.WHATSAPP_EMPLOYEE_ARCHIVE_RETENTION_DAYS);
  const archivePolicy = approved(env, "WHATSAPP_EMPLOYEE_ARCHIVE_ENABLED") &&
    approved(env, "WHATSAPP_EMPLOYEE_ARCHIVE_META_VERIFICATION_APPROVED") &&
    approved(env, "WHATSAPP_EMPLOYEE_ARCHIVE_EMPLOYEE_NOTICE_APPROVED") &&
    parseArchiveEncryptionKey(env.WHATSAPP_EMPLOYEE_ARCHIVE_ENCRYPTION_KEY) !== null &&
    Number.isSafeInteger(retentionDays) && retentionDays >= 1 && retentionDays <= 3650;
  // This may only be supplied by a server-side verifier that checks the real
  // notice source, idempotent receipt writer, and dedicated DB role. No env
  // toggle can assert this on its own.
  const trustedNoticeWriter = context.trustedNoticeWriterVerified === true;
  const activation = approved(env, "WHATSAPP_COEXISTENCE_STAGING_ENABLED") &&
    approved(env, "WHATSAPP_COEXISTENCE_STAGING_APPROVED");
  const metaConfigVerified =
    approved(env, "WHATSAPP_MONITOR_META_CONFIG_READONLY_VERIFIED");
  const rawOnboardingKey = env.WHATSAPP_STAGING_ONBOARDING_ENCRYPTION_KEY;
  const decodedOnboardingKey = rawOnboardingKey ? Buffer.from(rawOnboardingKey, "base64") : null;
  const onboardingKey = typeof rawOnboardingKey === "string" &&
    /^[A-Za-z0-9+/]{43}=$/.test(rawOnboardingKey) &&
    decodedOnboardingKey?.length === 32 &&
    decodedOnboardingKey.toString("base64") === rawOnboardingKey;
  const preapprovalMigration = context.preapprovalMigrationApplied === true;
  const metadataStoreAuthenticated = context.onboardingStoreAuthenticated === true &&
    context.minimalMetadataStoreVerified === true;
  const quarantineSignatureReview =
    approved(env, "WHATSAPP_ARCHIVE_STAGING_QUARANTINE_SIGNATURE_READONLY_VERIFIED");
  // These checks must come from the authenticated server-side session and
  // database-backed owner assignment. Environment toggles cannot substitute.
  const employeeConfirmed = context.employeeConfirmed === true;
  const ownerNumberApproval = context.ownerApprovedExactNumber === true;
  const minimalMetadataStore = context.minimalMetadataStoreVerified === true;
  const archiveStorageReady = env.WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE === "fixture" ||
    (env.WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE === "postgres" &&
      getStagingArchiveSignupWriterTarget(env) !== null &&
      getStagingArchiveOwnerApproverTarget(env) !== null);
  const numberPreapprovalReady = nodeDevelopment && staging &&
    env.DEV_RESOURCE_ISOLATION_CONFIRMED === "true" &&
    env.DEV_DATABASE_ISOLATION_CONFIRMED === "true" &&
    archiveStorageReady &&
    preapprovalMigration && onboardingKey && metadataStoreAuthenticated &&
    minimalMetadataStore;
  const employeeNumberRequestReady = numberPreapprovalReady &&
    context.validEmployeeSession === true;
  const ownerNumberReviewReady = numberPreapprovalReady &&
    context.validOwnerSession === true;
  const quarantineInfrastructureReady = nodeDevelopment && staging &&
    identityStoreIsolation && serviceConnections && serviceStoresAuthenticated &&
    publicHttps && meta && metaConfigVerified &&
    minimalMetadataStore;
  const encryptedTokenStoreVerified = context.encryptedTokenStoreVerified === true;
  const ownerApprovedArchiveBindingVerified = context.ownerApprovedArchiveBindingVerified === true;
  const onboardingPrerequisitesReady = quarantineInfrastructureReady &&
    activation && context.validEmployeeSession === true &&
    employeeConfirmed && ownerNumberApproval && preapprovalMigration &&
    onboardingKey && metadataStoreAuthenticated && quarantineSignatureReview &&
    encryptedTokenStoreVerified;
  // The employee's exact-number preapproval is checked per request. Final
  // archive binding is a separate owner decision made only after Meta returns
  // the WABA/phone assets, so it must not be a prerequisite for signup itself.
  const onboardingQuarantineReady = quarantineInfrastructureReady &&
    activation && preapprovalMigration && onboardingKey && metadataStoreAuthenticated &&
    quarantineSignatureReview && encryptedTokenStoreVerified;
  const serverReady = staging && identityStoreIsolation && serviceConnections &&
    serviceStoresAuthenticated && grants && publicHttps && meta && archivePolicy &&
    trustedNoticeWriter;
  const oauthEnabled = onboardingQuarantineReady;
  const webhookEnabled = serverReady && activation &&
    encryptedTokenStoreVerified && ownerApprovedArchiveBindingVerified;
  // In quarantine mode, accept only signed callbacks and discard their bodies.
  // This is independent from the archive webhook and is required before OAuth.
  const quarantineWebhookEnabled = quarantineInfrastructureReady && activation &&
    preapprovalMigration && onboardingKey && metadataStoreAuthenticated &&
    quarantineSignatureReview;

  const state = (value: boolean): ReadinessState => value ? "READY" : "BLOCKED";
  return {
    nodeDevelopmentOnly: state(nodeDevelopment),
    stagingOnly: state(staging),
    identityStoreIsolation: state(identityStoreIsolation),
    serviceConnections: state(serviceConnections),
    serviceStoresAuthenticated: state(serviceStoresAuthenticated),
    signupWriterStore: state(context.archiveSignupWriterAuthenticated === true),
    ownerApprovalStore: state(context.ownerApprovalStoreAuthenticated === true),
    functionGrants: state(grants),
    publicHttpsCallback: state(publicHttps),
    metaCredentialsAndWebhook: state(meta),
    archivePolicyAndKey: state(archivePolicy),
    trustedNoticeStatusWriter: state(trustedNoticeWriter),
    employeeSession: state(context.validEmployeeSession === true),
    employeeConfirmation: state(employeeConfirmed),
    ownerNumberApproval: state(ownerNumberApproval),
    minimalMetadataStore: state(minimalMetadataStore),
    metaConfigVerified: state(metaConfigVerified),
    preapprovalMigration: state(preapprovalMigration),
    onboardingEncryptionKey: state(onboardingKey),
    metadataStoreAuthenticated: state(metadataStoreAuthenticated),
    encryptedTokenCustody: state(encryptedTokenStoreVerified),
    ownerApprovedArchiveBinding: state(ownerApprovedArchiveBindingVerified),
    numberPreapprovalReady,
    employeeNumberRequestReady,
    ownerNumberReviewReady,
    quarantineSignatureReview: state(quarantineSignatureReview),
    activationApproval: state(activation),
    onboardingQuarantineReady,
    onboardingPrerequisitesReady,
    connectionReady: oauthEnabled && onboardingPrerequisitesReady &&
      ownerApprovedArchiveBindingVerified,
    archivingReady: serverReady && activation,
    oauthEnabled,
    webhookEnabled,
    quarantineWebhookEnabled,
  };
}
