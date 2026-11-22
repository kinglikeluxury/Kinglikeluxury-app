import type pg from "pg";
import {
  getStagingArchiveTarget,
  isExactArchiveBranchApproval,
  type StagingArchiveTarget,
} from "./isolation";

type PgConfigOptions = {
  connectionTimeoutMillis?: number;
  applicationName: string;
};

function buildPgConfig(
  target: StagingArchiveTarget,
  options: PgConfigOptions,
  runtimePassword?: string,
): pg.PoolConfig {
  const url = new URL(target.connectionString);
  if (
    !["postgres:", "postgresql:"].includes(url.protocol) ||
    url.hostname.toLowerCase() !== target.host.toLowerCase() ||
    decodeURIComponent(url.pathname.replace(/^\/+/, "")) !== target.database ||
    url.hash
  ) {
    throw new Error("Archive PostgreSQL target identity mismatch.");
  }

  let user: string;
  let password: string;
  try {
    user = decodeURIComponent(url.username);
    // A runtime target deliberately ignores the URL password. Its approved
    // credential is supplied separately and never written back into a URL.
    password = runtimePassword ?? decodeURIComponent(url.password);
  } catch {
    throw new Error("Archive PostgreSQL credentials are malformed.");
  }
  if (!user || !password) throw new Error("Archive PostgreSQL credentials are missing.");

  return {
    host: target.host,
    port: url.port ? Number(url.port) : 5432,
    database: target.database,
    user,
    password,
    max: 3,
    connectionTimeoutMillis: options.connectionTimeoutMillis ?? 15_000,
    application_name: options.applicationName,
    ssl: { rejectUnauthorized: true },
  };
}

/**
 * Build pg options from the already-allowlisted URL without passing
 * connectionString through node-postgres' URL parser. In pg, SSL query
 * parameters can replace the explicit ssl object, so they are intentionally
 * ignored and certificate verification remains enabled.
 */
export function buildStagingArchivePgConfig(
  target: StagingArchiveTarget,
  options: PgConfigOptions,
): pg.PoolConfig {
  return buildPgConfig(target, options);
}

/**
 * Runtime-only credential path. The URL supplies identity; the password comes
 * only from the dedicated Development secret after the exact Staging target
 * and branch have been revalidated. Other archive roles must use the ordinary
 * URL credential path above.
 */
export function buildStagingArchiveRuntimePgConfig(
  target: StagingArchiveTarget,
  env: NodeJS.ProcessEnv,
  options: PgConfigOptions,
): pg.PoolConfig {
  const approvedTarget = getStagingArchiveTarget(env);
  if (
    env.NODE_ENV !== "development" ||
    env.APP_DEPLOYMENT_MODE !== "staging" ||
    env.WHATSAPP_ARCHIVE_STAGING_APPROVED !== "true" ||
    !isExactArchiveBranchApproval(env) ||
    !approvedTarget ||
    approvedTarget.connectionString !== target.connectionString ||
    approvedTarget.host !== target.host ||
    approvedTarget.database !== target.database
  ) {
    throw new Error("Archive runtime connection is not approved for this Development Staging target.");
  }

  const runtimePassword = env.WHATSAPP_ARCHIVE_STAGING_RUNTIME_PASSWORD;
  if (!runtimePassword) {
    throw new Error("Dedicated archive runtime credential is not configured.");
  }
  return buildPgConfig(target, options, runtimePassword);
}
