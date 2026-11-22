import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import express from "express";
import pg from "pg";
const { Pool } = pg;
import { getRuntimeDatabaseUrl } from "../runtimeSafety";
import { hasForbiddenDatabaseVariables, STAGING_AUTH_HOST, STAGING_AUTH_PORT } from "./isolation";
import {
  decryptArchiveValue,
  getEmployeeArchiveRuntimeDecision,
} from "../whatsappEmployeeArchiveSafety";
import { whatsappEmployeeArchivePostgresStore } from "../whatsappEmployeeArchivePostgresStore";
import {
  createStagingArchiveFixture,
  createStagingArchiveRequestHandler,
  type StagingArchiveMessage,
  type StagingArchiveRequestStore,
} from "./archiveFixture";
import { getStagingArchiveReadiness } from "../stagingArchive/isolation";
import { getStagingIdentity, registerStagingIdentityAuth } from "../stagingIdentityAuth";
import { createStagingPasswordRecoveryStore } from "./passwordRecoveryStore";
import { registerStagingIdentityProvisioningRoutes } from "../stagingIdentityProvisioning";
import { createStagingIdentityProvisioningPostgresStore } from "../stagingIdentityProvisioningPostgresStore";
import { createStagingResendIdentityProvider } from "../stagingIdentityResendAdapter";
import {
  createStagingOwnerBootstrapPostgresStore,
  registerStagingOwnerBootstrapRoutes,
} from "./ownerBootstrap";
import { registerStagingWhatsappNumberPreapprovalRoutes, normalizeE164 } from "./whatsappPreapproval";
import { createStagingWhatsappPreapprovalPostgresStore } from "./whatsappPreapprovalPostgresStore";
import { matchesCurrentVerifiedMetaPreapproval } from "./whatsappMetaBindingEligibility";
import { parseOnboardingKey } from "./whatsappPreapproval";
import { parseMetaTokenEncryptionKey } from "../stagingArchive/metaTokenVault";
import { canAccessStagingArchive } from "./archiveAuthorization";
import { createWhatsappCoexistenceMetaGraphClient, type MetaGraphClient } from "../whatsappCoexistenceMetaGraph";
import { createVerifiedPreapprovalSignupCompleter } from "../whatsappCoexistencePreapprovalFlow";
import { createWhatsappCoexistenceSignupPostgresWriter } from "../whatsappCoexistenceSignupPostgresWriter";
import { registerWhatsappCoexistenceOAuthRoutes } from "../whatsappCoexistenceOAuthRoutes";
import { getWhatsappCoexistenceReadiness } from "../whatsappCoexistenceReadiness";
import { registerEmployeeWhatsappVerificationRoutes } from "../whatsappEmployeeSelfVerificationRoutes";
import { registerWhatsappArchiveOwnerApprovalRoutes } from "../whatsappArchiveOwnerApprovalRoutes";
import { createWhatsappArchiveOwnerApprovalPostgresStore } from "../whatsappArchiveOwnerApprovalPostgresStore";
import { registerWhatsappOnboardingQuarantineWebhookRoutes } from "../whatsappOnboardingQuarantineWebhookRoutes";
import { registerWhatsappArchiveWebhookRoutes, WHATSAPP_ARCHIVE_WEBHOOK_PATH } from "../whatsappArchiveWebhookRoutes";
import { createWhatsappArchiveWebhookProcessor } from "../whatsappArchiveWebhookProcessor";
import {
  createCustomerNoticeWebhookStatusWriter,
  createStagingCustomerNoticeStatusDatabaseAdapter,
} from "../stagingArchive/customerNoticeWebhookStatusWriter";
import {
  fingerprintCustomerNoticeRecipient,
  parseCustomerNoticeRecipientHmacKey,
} from "../stagingArchive/customerNoticeRecipientFingerprint";

type SafeUser = {
  id: number;
  username: string;
  email: null;
  phoneNumber: null;
  authMethod: "email";
  isAdmin: true;
  role: "admin" | "owner_approver";
};

const sessions = new Map<string, number>();
const cookieName = "kinglike_staging_session";

function send(res: ServerResponse, status: number, body: unknown, cookie?: string) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Staging-Auth", "isolated");
  if (cookie) res.setHeader("Set-Cookie", cookie);
  res.end(JSON.stringify(body));
}

function readCookie(req: IncomingMessage): string | null {
  const raw = req.headers.cookie || "";
  const value = raw.split(";").map((item) => item.trim())
    .find((item) => item.startsWith(`${cookieName}=`));
  return value ? decodeURIComponent(value.slice(cookieName.length + 1)) : null;
}

function safeUser(row: { id: number; username: string; role: "admin" | "owner_approver" }): SafeUser {
  return {
    id: row.id,
    username: row.username,
    email: null,
    phoneNumber: null,
    authMethod: "email",
    isAdmin: true,
    role: row.role,
  };
}

async function main() {
  if (process.env.STAGING_AUTH_CHILD !== "1" || process.env.STAGING_AUTH_COMMAND !== "server") {
    throw new Error("Staging auth must run through the isolated launcher.");
  }
  if (hasForbiddenDatabaseVariables(process.env)) {
    throw new Error("Legacy database variables are forbidden in the auth process.");
  }

  const url = getRuntimeDatabaseUrl(process.env);
  if (new URL(url).hostname !== STAGING_AUTH_HOST) {
    throw new Error("Staging auth target rejected.");
  }
  const pool = new Pool({ connectionString: url, max: 2, connectionTimeoutMillis: 5000 });
  const identity = await pool.query("SELECT current_database() AS name");
  if (identity.rows[0]?.name !== "neondb") {
    await pool.end();
    throw new Error("Staging database identity rejected.");
  }
  await pool.query("SELECT 1 FROM staging_auth_users LIMIT 0");
  const archiveFixture = createStagingArchiveFixture();
  const archiveSource = process.env.WHATSAPP_EMPLOYEE_ARCHIVE_STORAGE_SOURCE || "fixture";
  let archiveStore: StagingArchiveRequestStore = archiveFixture;
  let archiveEnvironment: "staging-fixture" | "staging-archive-database" = "staging-fixture";
  if (archiveSource === "postgres") {
    if (getStagingArchiveReadiness(process.env).storageSource !== "isolated_archive_database_configured") {
      throw new Error("Requested archive database is not independently configured; fixture fallback is disabled.");
    }
    archiveEnvironment = "staging-archive-database";
    archiveStore = {
      listEmployees: () => whatsappEmployeeArchivePostgresStore.listEmployees(),
      listConversations: (filters) => whatsappEmployeeArchivePostgresStore.listConversations(filters),
      getConversation: (id) => whatsappEmployeeArchivePostgresStore.getConversation(id),
      listMessages: async (id) => {
        const decision = getEmployeeArchiveRuntimeDecision(process.env);
        if (!decision.enabled) throw new Error("Archive policy is not enabled.");
        const rows = await whatsappEmployeeArchivePostgresStore.listMessages(id);
        return rows.map(({ encryptedPayload, ...row }) => {
          if (row.tombstonedAt) return { ...row, payload: null };
          if (!encryptedPayload) throw new Error("Archive payload is missing.");
          return {
            ...row,
            payload: JSON.parse(decryptArchiveValue(encryptedPayload, decision.encryptionKey)),
          };
        }) as StagingArchiveMessage[];
      },
      getPrivateMedia: (id) => whatsappEmployeeArchivePostgresStore.getPrivateMedia(id),
      recordAudit: (event) => whatsappEmployeeArchivePostgresStore.recordAudit(event),
    };
  } else if (archiveSource !== "fixture") {
    throw new Error("Unknown WhatsApp archive source; choose fixture or postgres explicitly.");
  }
  const handleStagingArchiveRequest = createStagingArchiveRequestHandler(async (req) => {
    const token = readCookie(req);
    const userId = token ? sessions.get(token) : undefined;
    if (!token || !userId) return { status: 401 };
    const result = await pool.query(
      `SELECT id::int, is_admin AS "isAdmin", role
         FROM staging_auth_users WHERE id = $1 AND is_active = TRUE`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) {
      sessions.delete(token);
      return { status: 401 };
    }
    if (!canAccessStagingArchive(row)) return { status: 403 };
    return { actor: { id: row.id } };
  }, archiveStore, archiveEnvironment);

  const app = express();
  app.set("trust proxy", 1);
  const webhookJsonParser = express.json({
    limit: "1mb",
    verify(req, _res, buffer) {
      (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  });
  app.use((req, res, next) => {
      if (req.path.startsWith("/api/staging/identity/") ||
        req.path.startsWith("/api/employee/whatsapp-number-preapproval") ||
          req.path.startsWith("/api/admin/whatsapp-number-preapproval") ||
          req.path.startsWith("/api/admin/whatsapp-archive/owner-approval") ||
          req.path.startsWith("/api/employee/whatsapp-coexistence") ||
          req.path.startsWith("/api/employee/whatsapp-meta-verification")) {
      res.setHeader("X-Staging-Auth", "isolated");
    }
    next();
  });
  const jsonParser = express.json({ limit: "16kb" });
  app.use((req, res, next) => {
    if (req.path === WHATSAPP_ARCHIVE_WEBHOOK_PATH ||
        req.path === "/api/webhooks/whatsapp-onboarding-quarantine") {
      const limitParser = req.path === "/api/webhooks/whatsapp-onboarding-quarantine"
        ? express.json({
            limit: "256kb",
            verify(innerReq, _innerRes, buffer) {
              (innerReq as typeof innerReq & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
            },
          })
        : webhookJsonParser;
      return limitParser(req, res, next);
    }
    if (req.path.startsWith("/api/staging/identity/") || req.path === "/api/auth/login" ||
        req.path.startsWith("/api/employee/whatsapp-number-preapproval") ||
        req.path.startsWith("/api/admin/whatsapp-number-preapproval") ||
        req.path.startsWith("/api/admin/whatsapp-archive/owner-approval") ||
        req.path.startsWith("/api/employee/whatsapp-coexistence") ||
        req.path.startsWith("/api/employee/whatsapp-meta-verification")) {
      return jsonParser(req, res, next);
    }
    return next();
  });

  const identityVerifier = createStagingResendIdentityProvider(process.env);
  const recoveryStore = createStagingPasswordRecoveryStore(process.env);
  const storeReadiness = await recoveryStore.readiness();
  const ownerStoreReadiness = await recoveryStore.ownerReadiness();
  const emailReadiness = identityVerifier.passwordResetReadiness?.();
  const ownerEmailReadiness = identityVerifier.ownerPasswordResetReadiness?.();
  const storeState = storeReadiness.ready === true ? "ready" : storeReadiness.reasonCode;
  const storeDiagnostic = storeReadiness.ready === true ? "none" : storeReadiness.diagnosticCode;
  const emailState = emailReadiness?.ready ? "ready" : "email_provider_not_configured";
  const ownerStoreState = ownerStoreReadiness.ready === true ? "ready" : ownerStoreReadiness.reasonCode;
  const ownerStoreDiagnostic = ownerStoreReadiness.ready === true ? "none" : ownerStoreReadiness.diagnosticCode;
  const ownerEmailState = ownerEmailReadiness?.ready ? "ready" : "email_provider_not_configured";
  console.info(
    `[staging-auth-recovery] readiness=${storeReadiness.ready && emailReadiness?.ready ? "ready" : "blocked"} ` +
    `store=${storeState} store_detail=${storeDiagnostic} email=${emailState} ` +
    `owner_store=${ownerStoreState} owner_store_detail=${ownerStoreDiagnostic} owner_email=${ownerEmailState}`,
  );
  const identityAuth = registerStagingIdentityAuth(app, process.env, undefined, {
    store: recoveryStore,
    sendReset: (email, token) => identityVerifier.deliverPasswordReset?.(email, token) ?? Promise.resolve(false),
    emailReady: () => identityVerifier.passwordResetReadiness?.().ready === true,
    sendOwnerReset: (email, token) =>
      identityVerifier.deliverOwnerPasswordReset?.(email, token) ?? Promise.resolve(false),
    ownerEmailReady: () => identityVerifier.ownerPasswordResetReadiness?.().ready === true,
  });
  app.use("/api/staging/identity/provisioning", (req, res, next) => {
    if (req.path === "/redeem") return next();
    return identityAuth.middleware(req, res, next);
  });
  app.use(
    [
      "/api/employee/whatsapp-number-preapproval",
      "/api/admin/whatsapp-number-preapproval",
      "/api/employee/whatsapp-coexistence",
      "/api/employee/whatsapp-meta-verification",
    ],
    identityAuth.middleware,
  );
  const preapprovalStore = createStagingWhatsappPreapprovalPostgresStore(process.env);
  const preapprovalConfigReady = process.env.NODE_ENV === "development" &&
    process.env.APP_DEPLOYMENT_MODE === "staging" &&
    process.env.DEV_RESOURCE_ISOLATION_CONFIRMED === "true" &&
    process.env.DEV_DATABASE_ISOLATION_CONFIRMED === "true" &&
    (archiveSource === "fixture" ||
      (archiveSource === "postgres" &&
        getStagingArchiveReadiness(process.env).storageSource ===
          "isolated_archive_database_configured"));
  const preapprovalEncryptionReady = !!parseOnboardingKey(
    process.env.WHATSAPP_STAGING_ONBOARDING_ENCRYPTION_KEY,
  );
  const preapprovalStoreReady = await preapprovalStore.schemaReady().catch(() => false);
  console.info(
    `[staging-whatsapp-preapproval] readiness=${
      preapprovalConfigReady && preapprovalEncryptionReady && preapprovalStoreReady ? "ready" : "blocked"
    } config=${preapprovalConfigReady ? "ready" : "blocked"} ` +
    `encryption=${preapprovalEncryptionReady ? "ready" : "blocked"} ` +
    `store=${preapprovalStoreReady ? "ready" : "blocked"}`,
  );
  registerStagingWhatsappNumberPreapprovalRoutes(app, {
    env: process.env,
    store: preapprovalStore,
  });
  const createMetaGraph = () => createWhatsappCoexistenceMetaGraphClient({
    appId: process.env.WHATSAPP_MONITOR_META_APP_ID ?? "",
    appSecret: process.env.META_APP_SECRET ?? "",
  });
  const metaGraph: MetaGraphClient = {
    exchangeCode: (code) => createMetaGraph().exchangeCode(code),
    inspectToken: (token) => createMetaGraph().inspectToken(token),
    listBusinessOwnedWabas: (businessId, token) =>
      createMetaGraph().listBusinessOwnedWabas(businessId, token),
    listWabaPhoneNumbers: (wabaId, token) =>
      createMetaGraph().listWabaPhoneNumbers(wabaId, token),
    listWabaPhoneNumberDetails: (wabaId, token) =>
      createMetaGraph().listWabaPhoneNumberDetails(wabaId, token),
    subscribeAppToWaba: (wabaId, token) =>
      createMetaGraph().subscribeAppToWaba!(wabaId, token),
  };
  const archiveSignupWriter = createWhatsappCoexistenceSignupPostgresWriter({
    env: process.env,
  });
  const tokenVaultKeyReady = parseMetaTokenEncryptionKey(
    process.env.WHATSAPP_STAGING_META_TOKEN_ENCRYPTION_KEY,
  ) !== null;
  const ownerApprovalStore = createWhatsappArchiveOwnerApprovalPostgresStore({
    env: process.env,
  });
  const readArchiveServiceReadiness = async () => {
    const [archiveSignupWriterAuthenticated, customerNoticeIntentReady] = await Promise.all([
      archiveSignupWriter.metaTokenVaultReady().catch(() => false),
      ownerApprovalStore.customerNoticeIntentReady().catch(() => false),
    ]);
    return {
      archiveSignupWriterAuthenticated,
      encryptedTokenStoreVerified:
        tokenVaultKeyReady && archiveSignupWriterAuthenticated,
      ownerApprovalStoreAuthenticated: customerNoticeIntentReady,
    };
  };
  const archiveServiceReadiness = await readArchiveServiceReadiness();
  const tokenVaultStoreReady = archiveServiceReadiness.encryptedTokenStoreVerified;
  const customerNoticeIntentReady = archiveServiceReadiness.ownerApprovalStoreAuthenticated;
  const noticeDatabase = createStagingCustomerNoticeStatusDatabaseAdapter(process.env);
  const noticeContract = noticeDatabase
    ? await noticeDatabase.verify().catch(() => null)
    : null;
  const trustedNoticeSourceReady =
    process.env.WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_APPROVED === "true" &&
    process.env.WHATSAPP_ARCHIVE_STAGING_NOTICE_SOURCE_APPROVED === "true" &&
    process.env.WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_ROLE_READONLY_VERIFIED === "true" &&
    process.env.WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_SCHEMA_READONLY_VERIFIED === "true" &&
    process.env.WHATSAPP_ARCHIVE_STAGING_PUBLIC_HTTPS_READONLY_VERIFIED === "true" &&
    process.env.WHATSAPP_ARCHIVE_STAGING_FUNCTION_GRANTS_READONLY_VERIFIED === "true" &&
    !!process.env.WHATSAPP_ARCHIVE_STAGING_NOTICE_WEBHOOK_DATABASE_URL?.trim() &&
    parseCustomerNoticeRecipientHmacKey(
      process.env.WHATSAPP_ARCHIVE_STAGING_NOTICE_RECIPIENT_HMAC_KEY,
    ) !== null &&
    customerNoticeIntentReady &&
    !!noticeContract &&
    noticeContract.database === "kinglike_whatsapp_archive_staging" &&
    noticeContract.username === "kinglike_wa_archive_notice_webhook" &&
    noticeContract.approvedHost === true &&
    noticeContract.functionSignature ===
      "staging_whatsapp_archive.apply_customer_notice_webhook_event(text,text,bytea,text,text,bigint,bigint,text,text,bytea,bytea,bytea,timestamp with time zone)" &&
    noticeContract.sourceFunctionSignature ===
      "staging_whatsapp_archive.find_verified_customer_notice_sender_receipt(text,text,text,bytea)" &&
    noticeContract.echoFunctionSignature ===
      "staging_whatsapp_archive.record_customer_notice_sender_receipt_from_signed_echo(text,text,text,bytea,bytea,bytea,timestamp with time zone,text)" &&
    noticeContract.gateFunctionSignature ===
      "staging_whatsapp_archive.has_current_customer_notice_receipt(text,text,bytea)" &&
    noticeContract.writerCanExecute === true &&
    noticeContract.sourceCanExecute === true &&
    noticeContract.echoCanExecute === true &&
    noticeContract.gateCanExecute === true &&
    noticeContract.forbiddenRolesCanExecute === false &&
    noticeContract.migration005Applied === true &&
    noticeContract.roleLimited === true;
  const noticeStatusWriter = createCustomerNoticeWebhookStatusWriter({
    env: process.env,
    source: noticeDatabase
      ? { findVerifiedNotice: (input) => noticeDatabase.findVerifiedNotice(input) }
      : undefined,
    databaseContract: noticeDatabase ?? undefined,
    applyStatus: noticeDatabase?.applyStatus,
    recordNoticeEcho: noticeDatabase?.recordNoticeEcho,
  });
  const pilotEmployeeId = /^[1-9]\d*$/.test(
    process.env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID ?? "",
  ) ? Number(process.env.WHATSAPP_EMPLOYEE_ARCHIVE_PILOT_EMPLOYEE_ID) : 0;
  let ownerApprovedBindingVerified = false;
  if (pilotEmployeeId > 0 && archiveSource === "postgres") {
    ownerApprovedBindingVerified = await whatsappEmployeeArchivePostgresStore
      .getEmployeeBindingStatus(pilotEmployeeId)
      .then((value) => value.status === "approved_not_connected" || value.status === "connected")
      .catch(() => false);
  }
  const coexistenceReadiness = getWhatsappCoexistenceReadiness(process.env, {
    preapprovalMigrationApplied: preapprovalStoreReady,
    onboardingStoreAuthenticated: preapprovalStoreReady,
    minimalMetadataStoreVerified: preapprovalStoreReady,
    ...archiveServiceReadiness,
    ownerApprovedArchiveBindingVerified: ownerApprovedBindingVerified,
    trustedNoticeWriterVerified: trustedNoticeSourceReady,
  });
  console.info(
    `[staging-whatsapp-coexistence] readiness=${
      coexistenceReadiness.oauthEnabled ? "ready" : "blocked"
    } token_custody=${coexistenceReadiness.encryptedTokenCustody.toLowerCase()} ` +
    `archive_binding=${coexistenceReadiness.ownerApprovedArchiveBinding.toLowerCase()} ` +
    `trusted_notice=${coexistenceReadiness.trustedNoticeStatusWriter.toLowerCase()} ` +
    `webhook=${coexistenceReadiness.webhookEnabled ? "ready" : "blocked"}`,
  );
  registerEmployeeWhatsappVerificationRoutes(app, {
    env: process.env,
    requireStagingIdentity: true,
    currentActor: async (req) => {
      const actor = getStagingIdentity(req)?.actor;
      return actor ? {
        id: actor.id,
        isActive: actor.active,
        isAdmin: actor.isAdmin,
        role: actor.role,
      } : null;
    },
    getBindingStatus: (employeeId) =>
      whatsappEmployeeArchivePostgresStore.getEmployeeBindingStatus(employeeId),
    getNoticeEligibility: async (employeeId) => {
      const value = await whatsappEmployeeArchivePostgresStore.getSignupEligibility(employeeId);
      if (!value) return null;
      return {
        currentNoticeReceived: value.currentNoticeReceived,
        noticeVersion: value.noticeVersion,
        customerNoticeVersion: value.customerNoticeVersion,
        retentionDays: value.retentionDays,
        policyApproved: value.policyApproved,
        lawfulBasis: value.lawfulBasis,
        legalAssessmentReference: value.legalAssessmentReference,
        noticeText: value.noticeText,
        customerTransparencyText: value.customerTransparencyText,
        companyWorkNumberOnly: value.companyWorkNumberOnly,
      };
    },
    recordNoticeRead: async (employeeId, noticeVersion) => {
      const value = await whatsappEmployeeArchivePostgresStore.getSignupEligibility(employeeId);
      if (!value || !value.active || !value.authorizedRole ||
          value.companyWorkNumberOnly !== true) return false;
      return archiveSignupWriter.recordEmployeeNoticeReceipt(
        value.employeeRef, noticeVersion,
      );
    },
  });
  registerWhatsappArchiveOwnerApprovalRoutes(app, {
    enabled: coexistenceReadiness.archivingReady &&
      process.env.WHATSAPP_ARCHIVE_STAGING_OWNER_APPROVAL_APPROVED === "true",
    requireStagingIdentity: true,
    requireOwnerApprover: true,
    currentAdmin: async (req) => {
      const actor = getStagingIdentity(req)?.actor;
      return actor?.role === "owner_approver"
        ? {
            id: actor.id, active: actor.active, isAdmin: actor.isAdmin,
            role: actor.role,
          }
        : null;
    },
    listPending: async (sessionUserId) => {
      const rows = await ownerApprovalStore.listPending(sessionUserId);
      const verified = await Promise.all(rows.map(async (row) => {
        const requestId = Number(row.requestId);
        const employeeId = Number(row.employeeRef);
        if (!Number.isSafeInteger(requestId) || requestId < 1 ||
            !Number.isSafeInteger(employeeId) || employeeId < 1 ||
            !(await archiveSignupWriter.hasPendingMetaAccessToken(requestId))) return false;
        const preapprovals = await preapprovalStore.listForEmployee(employeeId);
        return matchesCurrentVerifiedMetaPreapproval(row, preapprovals);
      }));
      return rows.filter((_row, index) => verified[index]);
    },
    approveRequest: async (requestId, ownerSessionUserId) => {
      if (!(await archiveSignupWriter.hasPendingMetaAccessToken(requestId))) return false;
      const rows = await ownerApprovalStore.listPending(ownerSessionUserId);
      const request = rows.find((row) => Number(row.requestId) === requestId);
      if (!request) return false;
      const employeeId = Number(request.employeeRef);
      if (!Number.isSafeInteger(employeeId) || employeeId < 1) return false;
      const preapprovals = await preapprovalStore.listForEmployee(employeeId);
      const verified = matchesCurrentVerifiedMetaPreapproval(request, preapprovals);
      if (!verified) return false;
      return ownerApprovalStore.approveRequest(requestId, ownerSessionUserId);
    },
    createCustomerNoticeIntent: async (phoneNumberId, recipientNumber, ownerSessionUserId) => {
      const key = parseCustomerNoticeRecipientHmacKey(
        process.env.WHATSAPP_ARCHIVE_STAGING_NOTICE_RECIPIENT_HMAC_KEY,
      );
      const normalizedRecipient = normalizeE164(recipientNumber);
      const fingerprint = key && normalizedRecipient
        ? fingerprintCustomerNoticeRecipient(normalizedRecipient, key)
        : null;
      if (!fingerprint) return false;
      return ownerApprovalStore.createCustomerNoticeEchoIntent(
        phoneNumberId, fingerprint, ownerSessionUserId,
      );
    },
  });
  registerWhatsappOnboardingQuarantineWebhookRoutes(app, {
    env: process.env,
    enabled: coexistenceReadiness.quarantineWebhookEnabled,
    ...(trustedNoticeSourceReady
      ? { processCustomerNoticeEcho: (rawBody: Buffer, signature: unknown) =>
          noticeStatusWriter.processSignedNoticeEcho(rawBody, signature) }
      : {}),
  });
  registerWhatsappArchiveWebhookRoutes(app, {
    env: process.env,
    enabled: coexistenceReadiness.webhookEnabled,
    processCustomerNoticeStatus: (rawBody, signature) =>
      noticeStatusWriter.process(rawBody, signature),
    processVerifiedPayloadOnce: createWhatsappArchiveWebhookProcessor({
      env: process.env,
      store: whatsappEmployeeArchivePostgresStore,
      requireCustomerNoticeProof: true,
      customerNoticeGate: noticeDatabase
        ? (input) => noticeDatabase.hasCurrentNoticeReceipt(input)
        : undefined,
    }),
  });
  registerWhatsappCoexistenceOAuthRoutes(app, {
    enabled: false,
    quarantineEnabled: coexistenceReadiness.oauthEnabled,
    requireStagingIdentity: true,
    env: process.env,
    currentEmployee: async (req) => getStagingIdentity(req)?.actor ?? null,
    completePreapprovedSignup: createVerifiedPreapprovalSignupCompleter({
      env: process.env,
      graph: metaGraph,
      store: preapprovalStore,
      expectedAppId: process.env.WHATSAPP_MONITOR_META_APP_ID ?? "",
      archiveSignupWriter,
      getArchiveEligibility: (employeeId) =>
        whatsappEmployeeArchivePostgresStore.getSignupEligibility(employeeId),
    }),
    preapprovalStoreReady: async () => preapprovalStoreReady,
    readinessContext: readArchiveServiceReadiness,
    getSignupConfig: () => coexistenceReadiness.oauthEnabled
      ? {
          appId: process.env.WHATSAPP_MONITOR_META_APP_ID ?? "",
          configId: process.env.WHATSAPP_MONITOR_META_CONFIG_ID ?? "",
        }
      : null,
    getPreapprovalForAttempt: async ({ approvalId, version, employeeId }) => {
      const row = await preapprovalStore.getApprovedForAttempt({
        id: approvalId, version, employeeId,
      });
      return !!row && row.status === "approved" && row.version === version;
    },
  });
  registerStagingOwnerBootstrapRoutes(app, {
    enabled: process.env.WHATSAPP_STAGING_IDENTITY_PROVISIONING_ENABLED === "true",
    env: process.env,
    store: createStagingOwnerBootstrapPostgresStore(process.env),
    verifier: identityVerifier,
    expectedIdentities: {
      ownerEmail: "info@kinglikeluxury.app",
      employeeEmail: "kinglikeluxury.sales.ge@gmail.com",
    },
  });
  registerStagingIdentityProvisioningRoutes(app, {
    enabled: process.env.WHATSAPP_STAGING_IDENTITY_PROVISIONING_ENABLED === "true",
    store: createStagingIdentityProvisioningPostgresStore(process.env),
    verifier: identityVerifier,
  });

  app.use(async (req, res) => {
    try {
      if (await handleStagingArchiveRequest(req, res)) return;
      if (req.method === "GET" && req.url === "/api/auth/me") {
        const token = readCookie(req);
        const userId = token ? sessions.get(token) : undefined;
        if (!userId) return send(res, 401, { message: "Not authenticated." });
        const result = await pool.query(
          `SELECT id::int, username, role FROM staging_auth_users
            WHERE id = $1 AND is_active = TRUE AND is_admin = TRUE
              AND role IN ('admin', 'owner_approver') AND identity_verified_at IS NOT NULL`,
          [userId],
        );
        if (!result.rowCount) {
          sessions.delete(token!);
          return send(res, 401, { message: "Not authenticated." });
        }
        return send(res, 200, safeUser(result.rows[0]));
      }
      if (req.method === "POST" && req.url === "/api/auth/login") {
        const body = req.body ?? {};
        const username = typeof body.username === "string" ? body.username.trim() : "";
        const password = typeof body.password === "string" ? body.password : "";
        if (!username || !password) return send(res, 400, { message: "Username and password are required." });
        const result = await pool.query(
          `SELECT id::int, username, password_hash, role FROM staging_auth_users
            WHERE username = $1 AND is_active = TRUE AND is_admin = TRUE
              AND role IN ('admin', 'owner_approver') AND identity_verified_at IS NOT NULL`,
          [username],
        );
        const row = result.rows[0];
        if (!row || !(await bcrypt.compare(password, row.password_hash))) {
          return send(res, 401, { message: "Invalid login credentials." });
        }
        const token = randomBytes(32).toString("base64url");
        sessions.set(token, row.id);
        return send(
          res,
          200,
          safeUser(row),
          `${cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Secure`,
        );
      }
      if (req.method === "POST" && req.url === "/api/auth/logout") {
        const token = readCookie(req);
        if (token) sessions.delete(token);
        return send(
          res,
          200,
          { ok: true },
          `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,
        );
      }
      return send(res, 404, { message: "Not found." });
    } catch {
      if (req.url?.startsWith("/api/admin/whatsapp-employee-archive/")) {
        return send(res, 503, { message: "Staging archive is unavailable." });
      }
      return send(res, 500, { message: "Staging authentication unavailable." });
    }
  });

  const server = createServer(app);
  server.listen(STAGING_AUTH_PORT, "127.0.0.1", () => {
    console.log("Isolated staging auth server ready on loopback.");
  });
  const shutdown = () => server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch(() => {
  console.error("Isolated staging auth server refused to start.");
  process.exitCode = 1;
});
