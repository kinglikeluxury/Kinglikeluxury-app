import crypto from "node:crypto";
import pg from "pg";
import { STAGING_AUTH_DIRECT_HOST, STAGING_AUTH_HOST, STAGING_AUTH_TARGET } from "./isolation";
import {
  acceptsRecoveryRuntimePassword,
  hasOnlyExpectedNeonOwnerMembership,
  type RecoveryRoleMembership,
} from "./passwordRecoveryPreflightGuards";

const RUNTIME_ROLE = "kinglike_staging_auth_recovery_runtime";
const DEFINER_ROLE = "kinglike_staging_auth_recovery_definer";
const ISSUE_FUNCTION = "staging_auth_recovery.staging_auth_issue_password_reset";
const COMPLETE_FUNCTION = "staging_auth_recovery.staging_auth_complete_password_reset";
const OWNER_ISSUE_FUNCTION = "staging_auth_recovery.staging_auth_issue_owner_password_reset";
const OWNER_COMPLETE_FUNCTION = "staging_auth_recovery.staging_auth_complete_owner_password_reset";
const ISSUE_SIGNATURE = `${ISSUE_FUNCTION}(bytea,bytea,bytea)`;
const COMPLETE_SIGNATURE = `${COMPLETE_FUNCTION}(bytea,text,bytea,bytea)`;
const OWNER_ISSUE_SIGNATURE = `${OWNER_ISSUE_FUNCTION}(bytea,bytea,bytea)`;
const OWNER_COMPLETE_SIGNATURE = `${OWNER_COMPLETE_FUNCTION}(bytea,text,bytea,bytea)`;

export type RecoveryStoreReasonCode =
  | "recovery_store_connection_failure"
  | "role_guard_failure";

export type RecoveryStoreDiagnosticCode =
  | "runtime_configuration_blocked"
  | "runtime_credential_unavailable"
  | "runtime_identity_mismatch"
  | "unexpected_role_membership"
  | "recovery_privilege_mismatch"
  | "recovery_role_attribute_mismatch"
  | "recovery_function_definition_mismatch"
  | "recovery_function_count_mismatch"
  | "recovery_function_owner_mismatch"
  | "recovery_function_security_mismatch"
  | "recovery_function_search_path_mismatch"
  | "recovery_function_runtime_execute_missing"
  | "recovery_function_public_execute_granted"
  | "database_authentication_rejected"
  | "database_permission_denied"
  | "database_connection_failed"
  | "database_check_failed";

export type RecoveryStoreReadiness =
  | { ready: true }
  | {
      ready: false;
      reasonCode: RecoveryStoreReasonCode;
      diagnosticCode: RecoveryStoreDiagnosticCode;
    };

export type PasswordRecoveryStore = Readonly<{
  issue(tokenHash: Buffer, ipHash: Buffer, emailHash: Buffer): Promise<number | null>;
  complete(tokenHash: Buffer, passwordHash: string, ipHash: Buffer, emailHash: Buffer): Promise<number | null>;
  issueOwner(tokenHash: Buffer, ipHash: Buffer, emailHash: Buffer): Promise<number | null>;
  completeOwner(tokenHash: Buffer, passwordHash: string, ipHash: Buffer, emailHash: Buffer): Promise<number | null>;
  readiness(): Promise<RecoveryStoreReadiness>;
  ownerReadiness(): Promise<RecoveryStoreReadiness>;
}>;

export class RecoveryStoreGuardError extends Error {
  readonly reasonCode = "role_guard_failure" as const;
  constructor(readonly diagnosticCode: RecoveryStoreDiagnosticCode = "database_check_failed") {
    super("staging_recovery_role_guard_failed");
  }
}

export function recoveryStoreFailureReason(error: unknown): RecoveryStoreReasonCode {
  return error instanceof RecoveryStoreGuardError
    ? error.reasonCode
    : "recovery_store_connection_failure";
}

function recoveryStoreDiagnostic(error: unknown): RecoveryStoreDiagnosticCode {
  if (error instanceof RecoveryStoreGuardError) return error.diagnosticCode;
  const message = error instanceof Error ? error.message : "";
  if (message === "staging_recovery_blocked" ||
      message === "staging_recovery_target_blocked") return "runtime_configuration_blocked";
  if (message === "staging_recovery_not_configured") return "runtime_credential_unavailable";
  const code = error && typeof error === "object" && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  if (code === "28P01") return "database_authentication_rejected";
  if (code === "42501") return "database_permission_denied";
  if (["ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "ETIMEDOUT", "EHOSTUNREACH"].includes(code)) {
    return "database_connection_failed";
  }
  return "database_check_failed";
}

function urlFor(env: NodeJS.ProcessEnv): string {
  if (env.NODE_ENV !== "development" || env.APP_DEPLOYMENT_MODE !== "staging" ||
      env.STAGING_AUTH_CHILD !== "1" || env.STAGING_AUTH_COMMAND !== "server" ||
      env.DEV_RESOURCE_ISOLATION_CONFIRMED !== "true" || env.DEV_DATABASE_ISOLATION_CONFIRMED !== "true") {
    throw new Error("staging_recovery_blocked");
  }
  const secret = env.WHATSAPP_STAGING_AUTH_RECOVERY_RUNTIME_PASSWORD;
  if (typeof secret !== "string" || !acceptsRecoveryRuntimePassword(secret)) {
    throw new Error("staging_recovery_not_configured");
  }
  const url = new URL("postgresql://placeholder@placeholder/neondb");
  url.hostname = STAGING_AUTH_DIRECT_HOST;
  url.username = "kinglike_staging_auth_recovery_runtime";
  url.password = secret;
  url.searchParams.set("sslmode", "require");
  if (STAGING_AUTH_TARGET.host !== STAGING_AUTH_HOST) throw new Error("staging_recovery_target_blocked");
  return url.toString();
}

export function createStagingPasswordRecoveryStore(env: NodeJS.ProcessEnv): PasswordRecoveryStore {
  let pool: InstanceType<typeof pg.Pool> | null = null;
  const getPool = () => pool ??= new pg.Pool({
    connectionString: urlFor(env), max: 1, connectionTimeoutMillis: 3000,
    application_name: "kinglike_staging_auth_password_recovery",
  });
  const getMemberships = async (db: InstanceType<typeof pg.Pool>) => {
    const result = await db.query<RecoveryRoleMembership>(
      `SELECT member_role.rolname AS member_role,
              granted_role.rolname AS granted_role,
              grantor_role.rolname AS grantor_role,
              m.admin_option, m.inherit_option, m.set_option
         FROM pg_auth_members m
         JOIN pg_roles granted_role ON granted_role.oid = m.roleid
         JOIN pg_roles member_role ON member_role.oid = m.member
         JOIN pg_roles grantor_role ON grantor_role.oid = m.grantor
        WHERE granted_role.rolname = ANY($1::text[])
           OR member_role.rolname = ANY($1::text[])`,
      [[RUNTIME_ROLE, DEFINER_ROLE]],
    );
    return result.rows;
  };
  const assertRuntimeIdentity = async (db: InstanceType<typeof pg.Pool>) => {
    const result = await db.query(
      `SELECT current_database() AS db, current_user AS role,
              r.rolcanlogin, r.rolconnlimit, r.rolsuper, r.rolcreatedb,
              r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolinherit
         FROM pg_roles r WHERE r.rolname = current_user`,
    );
    const identity = result.rows[0];
    const memberships = await getMemberships(db);
    if (identity?.db !== "neondb" ||
        identity?.role !== RUNTIME_ROLE ||
        identity?.rolcanlogin !== true ||
        identity?.rolconnlimit !== 2 ||
        identity?.rolsuper ||
        identity?.rolcreatedb ||
        identity?.rolcreaterole ||
        identity?.rolreplication ||
        identity?.rolbypassrls ||
        identity?.rolinherit) {
      throw new RecoveryStoreGuardError("runtime_identity_mismatch");
    }
    if (!hasOnlyExpectedNeonOwnerMembership(RUNTIME_ROLE, memberships)) {
      throw new RecoveryStoreGuardError("unexpected_role_membership");
    }
  };

  const inspectReadiness = async (issueSignature: string, completeSignature: string) => {
    const db = getPool();
    await assertRuntimeIdentity(db);

    const result = await db.query(
      `SELECT
         has_schema_privilege($1, 'staging_auth_recovery', 'USAGE') AS runtime_schema_usage,
         has_schema_privilege($2, 'public', 'USAGE') AS definer_public_schema_usage,
         has_function_privilege($1, to_regprocedure($3), 'EXECUTE') AS runtime_issue_execute,
         has_function_privilege($1, to_regprocedure($4), 'EXECUTE') AS runtime_complete_execute,
         has_column_privilege($2, 'public.staging_auth_users', 'id', 'SELECT') AS definer_user_id_select,
         has_column_privilege($2, 'public.staging_auth_users', 'username', 'SELECT') AS definer_username_select,
         has_column_privilege($2, 'public.staging_auth_users', 'is_active', 'SELECT') AS definer_active_select,
         has_column_privilege($2, 'public.staging_auth_users', 'is_admin', 'SELECT') AS definer_admin_select,
         has_column_privilege($2, 'public.staging_auth_users', 'role', 'SELECT') AS definer_role_select,
         has_column_privilege($2, 'public.staging_auth_users', 'identity_verified_at', 'SELECT') AS definer_verified_select,
         has_column_privilege($2, 'public.staging_auth_users', 'password_hash', 'UPDATE') AS definer_password_update,
         has_column_privilege($2, 'public.staging_auth_users', 'id', 'REFERENCES') AS definer_user_id_reference,
         has_table_privilege($2, 'public.staging_auth_password_resets', 'SELECT') AS definer_resets_select,
         has_table_privilege($2, 'public.staging_auth_password_resets', 'INSERT') AS definer_resets_insert,
         has_table_privilege($2, 'public.staging_auth_password_resets', 'UPDATE') AS definer_resets_update,
         has_table_privilege($2, 'public.staging_auth_password_recovery_audit', 'INSERT') AS definer_audit_insert,
         has_sequence_privilege($2, 'public.staging_auth_password_resets_reset_id_seq', 'USAGE') AS definer_reset_sequence_usage,
         has_sequence_privilege($2, 'public.staging_auth_password_recovery_audit_audit_id_seq', 'USAGE') AS definer_audit_sequence_usage,
         NOT has_column_privilege($1, 'public.staging_auth_users', 'password_hash', 'UPDATE') AS runtime_no_password_update,
         NOT has_table_privilege($1, 'public.staging_auth_password_resets', 'SELECT,INSERT,UPDATE,DELETE') AS runtime_no_reset_table_access,
         NOT has_table_privilege($1, 'public.staging_auth_password_recovery_audit', 'SELECT,INSERT,UPDATE,DELETE') AS runtime_no_audit_table_access
      `,
        [RUNTIME_ROLE, DEFINER_ROLE, issueSignature, completeSignature],
    );
    const grants = result.rows[0];
    if (Object.values(grants ?? {}).some((value) => value !== true)) {
      throw new RecoveryStoreGuardError("recovery_privilege_mismatch");
    }

    const roleResult = await db.query(
      `SELECT r.rolname, r.rolcanlogin, r.rolsuper, r.rolcreatedb,
              r.rolcreaterole, r.rolreplication, r.rolbypassrls, r.rolinherit
         FROM pg_roles r
        WHERE r.rolname = ANY($1::text[])`,
      [[RUNTIME_ROLE, DEFINER_ROLE]],
    );
    const roles = new Map(roleResult.rows.map((row) => [String(row.rolname), row]));
    const runtime = roles.get(RUNTIME_ROLE);
    const definer = roles.get(DEFINER_ROLE);
    const memberships = await getMemberships(db);
    if (!runtime || !definer ||
        runtime.rolcanlogin !== true ||
        definer.rolcanlogin !== false ||
        [definer.rolsuper, definer.rolcreatedb, definer.rolcreaterole,
          definer.rolreplication, definer.rolbypassrls, definer.rolinherit].some(Boolean)) {
      throw new RecoveryStoreGuardError("recovery_role_attribute_mismatch");
    }
    if (!hasOnlyExpectedNeonOwnerMembership(RUNTIME_ROLE, memberships) ||
        !hasOnlyExpectedNeonOwnerMembership(DEFINER_ROLE, memberships)) {
      throw new RecoveryStoreGuardError("unexpected_role_membership");
    }

    const functions = await db.query(
      `SELECT p.proname, owner.rolname AS owner, p.prosecdef, p.proconfig,
              has_function_privilege($1, p.oid, 'EXECUTE') AS runtime_execute,
              NOT EXISTS (
                SELECT 1
                  FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) acl
                 WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
              ) AS public_execute_absent
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         JOIN pg_roles owner ON owner.oid = p.proowner
        WHERE p.oid IN (to_regprocedure($2), to_regprocedure($3))`,
        [RUNTIME_ROLE, issueSignature, completeSignature],
    );
    if (functions.rowCount !== 2) {
      throw new RecoveryStoreGuardError("recovery_function_count_mismatch");
    }
    for (const fn of functions.rows) {
      if (fn.owner !== DEFINER_ROLE) {
        throw new RecoveryStoreGuardError("recovery_function_owner_mismatch");
      }
      if (fn.prosecdef !== true) {
        throw new RecoveryStoreGuardError("recovery_function_security_mismatch");
      }
      if (!Array.isArray(fn.proconfig) || !fn.proconfig.includes("search_path=pg_catalog")) {
        throw new RecoveryStoreGuardError("recovery_function_search_path_mismatch");
      }
      if (fn.runtime_execute !== true) {
        throw new RecoveryStoreGuardError("recovery_function_runtime_execute_missing");
      }
      if (fn.public_execute_absent !== true) {
        throw new RecoveryStoreGuardError("recovery_function_public_execute_granted");
      }
    }
  };

  return {
    async issue(tokenHash, ipHash, emailHash) {
      const db = getPool();
      await assertRuntimeIdentity(db);
      const result = await db.query(
        `SELECT * FROM ${ISSUE_FUNCTION}($1,$2,$3)`,
        [tokenHash, ipHash, emailHash],
      );
      const id = Number(result.rows[0]?.staging_auth_issue_password_reset);
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    },
    async complete(tokenHash, passwordHash, ipHash, emailHash) {
      const db = getPool();
      await assertRuntimeIdentity(db);
      const result = await db.query(
        `SELECT * FROM ${COMPLETE_FUNCTION}($1,$2,$3,$4)`,
        [tokenHash, passwordHash, ipHash, emailHash],
      );
      const id = Number(result.rows[0]?.staging_auth_complete_password_reset);
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    },
    async issueOwner(tokenHash, ipHash, emailHash) {
      const db = getPool();
      await assertRuntimeIdentity(db);
      const result = await db.query(
        `SELECT * FROM ${OWNER_ISSUE_FUNCTION}($1,$2,$3)`,
        [tokenHash, ipHash, emailHash],
      );
      const id = Number(result.rows[0]?.staging_auth_issue_owner_password_reset);
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    },
    async completeOwner(tokenHash, passwordHash, ipHash, emailHash) {
      const db = getPool();
      await assertRuntimeIdentity(db);
      const result = await db.query(
        `SELECT * FROM ${OWNER_COMPLETE_FUNCTION}($1,$2,$3,$4)`,
        [tokenHash, passwordHash, ipHash, emailHash],
      );
      const id = Number(result.rows[0]?.staging_auth_complete_owner_password_reset);
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    },
    async readiness() {
      try {
        await inspectReadiness(ISSUE_SIGNATURE, COMPLETE_SIGNATURE);
        return { ready: true };
      } catch (error) {
        return {
          ready: false,
          reasonCode: recoveryStoreFailureReason(error),
          diagnosticCode: recoveryStoreDiagnostic(error),
        };
      }
    },
    async ownerReadiness() {
      try {
        await inspectReadiness(OWNER_ISSUE_SIGNATURE, OWNER_COMPLETE_SIGNATURE);
        return { ready: true };
      } catch (error) {
        return {
          ready: false,
          reasonCode: recoveryStoreFailureReason(error),
          diagnosticCode: recoveryStoreDiagnostic(error),
        };
      }
    },
  };
}

export function hashRecoveryValue(value: string): Buffer {
  return crypto.createHash("sha256").update(value).digest();
}
