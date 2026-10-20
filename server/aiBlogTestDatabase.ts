import { isIP } from "node:net";

export const AI_BLOG_TEST_DATABASE_ENV = "AI_BLOG_TEST_DATABASE_URL";
export const AI_BLOG_TEST_DATABASE_NAME = "ai_blog_drafts_test";
export const AI_BLOG_TEST_APPLICATION_NAME = "kinglike-ai-blog-test";

export type AiBlogTestDatabaseFailureStage =
  | "configuration"
  | "tcp_connect"
  | "postgres_authentication"
  | "identity_check"
  | "migration"
  | "pool_close";

export type AiBlogTestDatabaseFailureCode =
  | "TEST_DATABASE_CONFIG_INVALID"
  | "TCP_CONNECTION_REFUSED"
  | "TCP_CONNECTION_TIMEOUT"
  | "POSTGRES_AUTHENTICATION_FAILED"
  | "POSTGRES_HBA_REJECTED"
  | "POSTGRES_ROLE_NOT_FOUND"
  | "POSTGRES_DATABASE_NOT_FOUND"
  | "POSTGRES_CONNECTION_REJECTED"
  | "DATABASE_IDENTITY_MISMATCH"
  | "DATABASE_OPERATION_FAILED"
  | "DATABASE_CLOSE_FAILED";

export class AiBlogTestDatabaseIdentityError extends Error {
  constructor(readonly failureCode: "DATABASE_IDENTITY_MISMATCH") {
    super(failureCode);
    this.name = "AiBlogTestDatabaseIdentityError";
  }
}

type SafeFailure = {
  stage: AiBlogTestDatabaseFailureStage;
  code: AiBlogTestDatabaseFailureCode;
};

function getErrorProperty(error: unknown, key: "code" | "message"): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Convert driver/configuration errors to fixed, non-sensitive diagnostics.
 * Raw messages, connection strings, SQL, and stack traces must never be returned.
 */
export function classifyAiBlogTestDatabaseFailure(
  stage: AiBlogTestDatabaseFailureStage,
  error: unknown,
): SafeFailure {
  if (error instanceof AiBlogTestDatabaseIdentityError) {
    return { stage: "identity_check", code: error.failureCode };
  }

  const pgCode = getErrorProperty(error, "code");
  const message = getErrorProperty(error, "message")?.toLowerCase() ?? "";

  if (stage === "configuration") {
    return { stage, code: "TEST_DATABASE_CONFIG_INVALID" };
  }
  if (stage === "pool_close") {
    return { stage, code: "DATABASE_CLOSE_FAILED" };
  }
  if (stage === "migration") {
    return { stage, code: "DATABASE_OPERATION_FAILED" };
  }
  if (stage === "identity_check") {
    return { stage, code: "DATABASE_OPERATION_FAILED" };
  }
  if (stage === "tcp_connect") {
    if (pgCode === "28P01") {
      return { stage: "postgres_authentication", code: "POSTGRES_AUTHENTICATION_FAILED" };
    }
    if (message.includes("no pg_hba.conf entry")) {
      return { stage: "postgres_authentication", code: "POSTGRES_HBA_REJECTED" };
    }
    if (message.includes("role ") && message.includes(" does not exist")) {
      return { stage: "postgres_authentication", code: "POSTGRES_ROLE_NOT_FOUND" };
    }
    if (pgCode === "3D000") {
      return { stage, code: "POSTGRES_DATABASE_NOT_FOUND" };
    }
    if (pgCode === "28000") {
      return { stage: "postgres_authentication", code: "POSTGRES_CONNECTION_REJECTED" };
    }
    if (pgCode === "ECONNREFUSED") {
      return { stage, code: "TCP_CONNECTION_REFUSED" };
    }
    if (pgCode === "ETIMEDOUT" || pgCode === "CONNECT_TIMEOUT") {
      return { stage, code: "TCP_CONNECTION_TIMEOUT" };
    }
  }
  return { stage, code: "DATABASE_OPERATION_FAILED" };
}

export function formatAiBlogTestDatabaseFailure(failure: SafeFailure): string {
  return `AI_BLOG_TEST_DB_ERROR stage=${failure.stage} code=${failure.code}`;
}

export type IsolatedAiBlogTestDatabaseConfig = {
  connectionString: string;
  expectedDatabaseName: typeof AI_BLOG_TEST_DATABASE_NAME;
  applicationName: typeof AI_BLOG_TEST_APPLICATION_NAME;
};

function isLoopbackAddress(input: string): boolean {
  const address = input.toLowerCase().split("%")[0];
  if (address === "::1") return true;
  const mappedIpv4 = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  const ipv4 = mappedIpv4 || address;
  if (isIP(ipv4) === 4) return Number(ipv4.split(".")[0]) === 127;
  return false;
}

export function getIsolatedAiBlogTestDatabaseConfig(
  env: NodeJS.ProcessEnv,
): IsolatedAiBlogTestDatabaseConfig {
  const connectionString = env[AI_BLOG_TEST_DATABASE_ENV]?.trim();
  if (!connectionString) {
    throw new Error(`${AI_BLOG_TEST_DATABASE_ENV} is required; no database fallback is permitted.`);
  }

  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error(`${AI_BLOG_TEST_DATABASE_ENV} must be a valid PostgreSQL URL.`);
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error(`${AI_BLOG_TEST_DATABASE_ENV} must use the PostgreSQL protocol.`);
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname !== "localhost" && !isLoopbackAddress(hostname)) {
    throw new Error("AI Blog test database host must be a loopback address.");
  }
  let databaseName = "";
  try { databaseName = decodeURIComponent(url.pathname.replace(/^\/+/, "")); } catch { /* fail below */ }
  if (databaseName !== AI_BLOG_TEST_DATABASE_NAME) {
    throw new Error(`AI Blog test database name must be ${AI_BLOG_TEST_DATABASE_NAME}.`);
  }

  return {
    connectionString,
    expectedDatabaseName: AI_BLOG_TEST_DATABASE_NAME,
    applicationName: AI_BLOG_TEST_APPLICATION_NAME,
  };
}

export function assertIsolatedAiBlogTestDatabaseIdentity(identity: {
  databaseName?: unknown;
  serverAddress?: unknown;
}): asserts identity is { databaseName: string; serverAddress: string } {
  if (identity.databaseName !== AI_BLOG_TEST_DATABASE_NAME) {
    throw new AiBlogTestDatabaseIdentityError("DATABASE_IDENTITY_MISMATCH");
  }
  if (typeof identity.serverAddress !== "string" || !isLoopbackAddress(identity.serverAddress)) {
    throw new AiBlogTestDatabaseIdentityError("DATABASE_IDENTITY_MISMATCH");
  }
}
