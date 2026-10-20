import { isIP } from "node:net";

export const AI_BLOG_TEST_DATABASE_ENV = "AI_BLOG_TEST_DATABASE_URL";
export const AI_BLOG_TEST_DATABASE_NAME = "ai_blog_drafts_test";
export const AI_BLOG_TEST_APPLICATION_NAME = "kinglike-ai-blog-test";

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
    throw new Error("Connected PostgreSQL database identity does not match the isolated AI Blog test database.");
  }
  if (typeof identity.serverAddress !== "string" || !isLoopbackAddress(identity.serverAddress)) {
    throw new Error("Connected PostgreSQL server is not confirmed as loopback; refusing test database use.");
  }
}
