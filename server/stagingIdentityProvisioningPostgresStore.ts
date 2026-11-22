import pg from "pg";
import bcrypt from "bcrypt";
import type { ProvisionedRole, ProvisioningStore } from "./stagingIdentityProvisioning";
import { STAGING_AUTH_HOST } from "./stagingAuth/isolation";

const { Pool } = pg;

function approvedDevelopmentTarget(env: NodeJS.ProcessEnv): boolean {
  if (env.NODE_ENV !== "development" || env.APP_DEPLOYMENT_MODE !== "staging" ||
      env.DEV_RESOURCE_ISOLATION_CONFIRMED !== "true" ||
      env.DEV_DATABASE_ISOLATION_CONFIRMED !== "true") return false;
  try {
    const target = new URL(env.DEV_DATABASE_URL ?? "");
    if (!["postgres:", "postgresql:"].includes(target.protocol) ||
        target.hostname !== STAGING_AUTH_HOST ||
        decodeURIComponent(target.pathname.replace(/^\/+/, "")) !== "neondb") return false;
    for (const key of ["DATABASE_URL", "NEON_DATABASE_URL"] as const) {
      if (!env[key]) continue;
      const primary = new URL(env[key]!);
      if (primary.hostname === target.hostname &&
          (decodeURIComponent(primary.pathname.replace(/^\/+/, "")) === "neondb" ||
           primary.username === target.username)) return false;
    }
    return env.PGHOST?.trim().toLowerCase() !== target.hostname.toLowerCase();
  } catch {
    return false;
  }
}

export function createStagingIdentityProvisioningPostgresStore(
  env: NodeJS.ProcessEnv,
): ProvisioningStore {
  let pool: InstanceType<typeof Pool> | null = null;
  const getPool = () => {
    if (!approvedDevelopmentTarget(env)) throw new Error("staging_identity_write_target_blocked");
    if (!pool) pool = new Pool({
      connectionString: env.DEV_DATABASE_URL,
      max: 1,
      connectionTimeoutMillis: 3000,
      application_name: "kinglike_staging_identity_provisioner",
    });
    return pool;
  };
  const audit = async (
    client: any, actorId: number, action: string, inviteId: string | null,
    targetUserId: number | null, emailHash: string | null, detail: string,
  ) => {
    await client.query(
      `INSERT INTO staging_identity_audit
        (actor_user_id, target_user_id, invite_id, action, target_email_hash, detail_code)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [actorId, targetUserId, inviteId, action, emailHash, detail],
    );
  };

  return {
    async hasActiveInvite(emailHash, role) {
      const result = await getPool().query(
        `SELECT EXISTS (
           SELECT 1 FROM staging_identity_invites
            WHERE target_email_hash = $1 AND fixed_role = $2
              AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > NOW()
         ) AS active`,
        [emailHash, role],
      );
      return result.rows[0]?.active === true;
    },
    async revokeActiveInvite(emailHash, role, actorId, reason) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const identity = await client.query("SELECT current_database() AS name");
        if (identity.rows[0]?.name !== "neondb") throw new Error("identity_database_mismatch");
        const selected = await client.query(
          `SELECT invite_id::text FROM staging_identity_invites
            WHERE target_email_hash = $1 AND fixed_role = $2
              AND consumed_at IS NULL AND revoked_at IS NULL
            ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
          [emailHash, role],
        );
        const inviteId = selected.rows[0]?.invite_id;
        if (typeof inviteId !== "string") {
          await client.query("ROLLBACK");
          return false;
        }
        const revoked = await client.query(
          `UPDATE staging_identity_invites SET revoked_at = NOW()
            WHERE invite_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL`,
          [inviteId],
        );
        if (!revoked.rowCount) {
          await client.query("ROLLBACK");
          return false;
        }
        await audit(client, actorId, "invite_revoked", inviteId, null, emailHash, reason.slice(0, 80));
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async issueInvite(input) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const identity = await client.query("SELECT current_database() AS name");
        if (identity.rows[0]?.name !== "neondb") throw new Error("identity_database_mismatch");
        await client.query(
          `UPDATE staging_identity_invites SET revoked_at = NOW()
            WHERE target_email_hash = $1 AND fixed_role = $2
              AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at <= NOW()`,
          [input.emailHash, input.role],
        );
        if (input.role === "owner_approver") {
          await client.query(
            `UPDATE staging_identity_bootstrap SET invite_id = NULL
              WHERE singleton = TRUE AND completed_at IS NULL AND invite_id IN (
                SELECT invite_id FROM staging_identity_invites WHERE revoked_at IS NOT NULL
              )`,
          );
          const bootstrap = await client.query(
            "SELECT completed_at, invite_id FROM staging_identity_bootstrap WHERE singleton = TRUE FOR UPDATE",
          );
          const current = bootstrap.rows[0];
          if (!current || current.completed_at || current.invite_id) {
            await client.query("ROLLBACK");
            return "duplicate";
          }
        }
        const created = await client.query(
          `INSERT INTO staging_identity_invites
            (target_email, target_email_hash, fixed_role, token_hash, created_by, expires_at)
           VALUES ($1,$2,$3,decode($4,'hex'),$5,$6)
           RETURNING invite_id::text`,
          [input.email, input.emailHash, input.role, input.tokenHash, input.creatorId, input.expiresAt],
        );
        const id = String(created.rows[0]?.invite_id ?? "");
        if (!id) throw new Error("invite_insert_failed");
        if (input.role === "owner_approver") {
          const updated = await client.query(
            `UPDATE staging_identity_bootstrap
                SET invite_id = $1
              WHERE singleton = TRUE AND completed_at IS NULL AND invite_id IS NULL`,
            [id],
          );
          if (!updated.rowCount) throw new Error("owner_bootstrap_already_used");
        }
        await audit(client, input.creatorId, "invite_issued", id, null, input.emailHash, "fixed_role_invite");
        await client.query("COMMIT");
        return { id };
      } catch (error: any) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (error?.code === "23505") return "duplicate";
        throw error;
      } finally {
        client.release();
      }
    },
    async revokeInvite(id, actorId, reason) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const result = await client.query(
          `UPDATE staging_identity_invites SET revoked_at = NOW()
            WHERE invite_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
            RETURNING target_email_hash`,
          [id],
        );
        if (!result.rowCount) throw new Error("invite_not_revocable");
        await client.query(
          `UPDATE staging_identity_bootstrap SET invite_id = NULL
            WHERE singleton = TRUE AND invite_id = $1 AND completed_at IS NULL`,
          [id],
        );
        await audit(client, actorId, "invite_revoked", id, null,
          String(result.rows[0].target_email_hash), reason.slice(0, 80));
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    },
    async setVerificationCode(id, codeHash, expiresAt) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const identity = await client.query("SELECT current_database() AS name");
        if (identity.rows[0]?.name !== "neondb") throw new Error("identity_database_mismatch");
        const result = await client.query(
          `UPDATE staging_identity_invites
              SET verification_code_hash = $2, verification_code_expires_at = $3,
                  verification_attempts = 0
            WHERE invite_id = $1 AND consumed_at IS NULL AND revoked_at IS NULL
              AND expires_at > NOW()`,
          [id, codeHash, expiresAt],
        );
        await client.query("COMMIT");
        return result.rowCount === 1;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    },
    async redeemInvite(input) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const identity = await client.query("SELECT current_database() AS name");
        if (identity.rows[0]?.name !== "neondb") throw new Error("identity_database_mismatch");
        const result = await client.query(
          `SELECT invite_id::text, target_email, target_email_hash, fixed_role, created_by,
                  verification_code_hash, verification_code_expires_at, verification_attempts
             FROM staging_identity_invites
            WHERE token_hash = decode($1,'hex') AND consumed_at IS NULL
              AND revoked_at IS NULL AND expires_at > NOW()
            FOR UPDATE`,
          [input.tokenHash],
        );
        const invite = result.rows[0];
        if (!invite || invite.target_email !== input.email) {
          await client.query("ROLLBACK");
          return "invalid";
        }
        if (!invite.verification_code_hash ||
            !invite.verification_code_expires_at ||
            new Date(invite.verification_code_expires_at).getTime() <= Date.now() ||
            Number(invite.verification_attempts) >= 5) {
          await audit(client, Number(invite.created_by), "verification_failed", invite.invite_id,
            null, String(invite.target_email_hash), "challenge_expired_or_locked");
          await client.query("COMMIT");
          return "invalid";
        }
        const proofMatches = await bcrypt.compare(input.proofCode, String(invite.verification_code_hash));
        if (!proofMatches) {
          await client.query(
            `UPDATE staging_identity_invites
                SET verification_attempts = verification_attempts + 1
              WHERE invite_id = $1`,
            [invite.invite_id],
          );
          await audit(client, Number(invite.created_by), "verification_failed", invite.invite_id,
            null, String(invite.target_email_hash), "invalid_email_code");
          await client.query("COMMIT");
          return "invalid";
        }
        const role = String(invite.fixed_role) as ProvisionedRole;
        const isAdmin = role === "owner_approver" || role === "legal_reviewer";
        const user = await client.query(
          `INSERT INTO staging_auth_users
            (username, password_hash, is_admin, role, is_active, identity_verified_at,
             identity_verification_method, identity_subject_hash, provisioned_by)
           VALUES ($1,$2,$3,$4,TRUE,NOW(),'email_otp',$5,$6)
           RETURNING id::int`,
          [input.email, input.passwordHash, isAdmin, role, input.subjectHash, invite.created_by],
        );
        const userId = Number(user.rows[0]?.id);
        if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("identity_insert_failed");
        await client.query(
          `UPDATE staging_identity_invites
              SET verified_at = NOW(), consumed_at = NOW(), verified_subject_hash = $2,
                  verification_code_hash = NULL
            WHERE invite_id = $1`,
          [invite.invite_id, input.subjectHash],
        );
        if (role === "owner_approver") {
          const bootstrap = await client.query(
            `UPDATE staging_identity_bootstrap
                SET completed_at = NOW(), completed_by = $1
              WHERE singleton = TRUE AND invite_id = $2 AND completed_at IS NULL`,
            [userId, invite.invite_id],
          );
          if (!bootstrap.rowCount) throw new Error("owner_bootstrap_reservation_missing");
        }
        await audit(client, Number(invite.created_by), "identity_verified", invite.invite_id,
          userId, String(invite.target_email_hash), input.verificationMethod);
        await audit(client, Number(invite.created_by), "account_activated", invite.invite_id,
          userId, String(invite.target_email_hash), role);
        await client.query("COMMIT");
        return "activated";
      } catch (error: any) {
        await client.query("ROLLBACK").catch(() => undefined);
        if (error?.code === "23505") return "duplicate";
        throw error;
      } finally { client.release(); }
    },
    async disableUser(id, actorId) {
      const client = await getPool().connect();
      try {
        await client.query("BEGIN");
        const target = await client.query(
          `SELECT is_admin, role FROM staging_auth_users
            WHERE id = $1 AND is_active = TRUE AND identity_verified_at IS NOT NULL
            FOR UPDATE`,
          [id],
        );
        if (!target.rowCount) { await client.query("ROLLBACK"); return false; }
        if (target.rows[0].role === "owner_approver") {
          const owners = await client.query(
            `SELECT COUNT(*)::int AS count FROM staging_auth_users
              WHERE is_active = TRUE AND is_admin = TRUE AND role = 'owner_approver'
                AND identity_verified_at IS NOT NULL`,
          );
          if (Number(owners.rows[0]?.count ?? 0) <= 1) {
            await client.query("ROLLBACK");
            return false;
          }
        }
        await client.query("UPDATE staging_auth_users SET is_active = FALSE WHERE id = $1", [id]);
        await audit(client, actorId, "account_disabled", null, id, null, "admin_disabled");
        await client.query("COMMIT");
        return true;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally { client.release(); }
    },
  };
}
