import crypto from "node:crypto";
import pg from "pg";
import type { ArchiveReadStore } from "./whatsappEmployeeArchiveRoutes";
import type { ArchiveIngestStore } from "./whatsappEmployeeArchiveIngest";
import {
  decryptArchiveValue,
  encryptArchiveValue,
  getEmployeeArchiveRuntimeDecision,
  type EncryptedArchiveValue,
} from "./whatsappEmployeeArchiveSafety";
import { getStagingArchiveTarget } from "./stagingArchive/isolation";
import { buildStagingArchiveRuntimePgConfig } from "./stagingArchive/postgresConfig";
import { safePgFailureMessage } from "./stagingArchive/pgFailureDiagnosis";
import { createWhatsappArchiveAtomicStore } from "./whatsappArchiveAtomicStore";
import type { WhatsAppArchiveWebhookStore } from "./whatsappArchiveWebhookProcessor";

const { Pool } = pg;
let pool: pg.Pool | undefined;
let verifiedPool: pg.Pool | undefined;
let poolTargetFingerprint: string | undefined;

type BindingStatusQueryPool = {
  query(text: string, values?: any[]): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export type EmployeeBindingStatus = {
  status: "not_connected" | "pending" | "approved_not_connected" | "verified" | "connected" | "revoked";
  metaVerified: boolean;
  phoneConnected: boolean;
  phoneNumberId: string | null;
};

export function assertArchiveRuntimeIdentity(
  row: Record<string, unknown> | undefined,
  target: { connectionString: string; database: string },
): void {
  const expectedUser = decodeURIComponent(new URL(target.connectionString).username);
  if (row?.database !== target.database || row?.username !== expectedUser) {
    throw new Error("WhatsApp archive database identity mismatch.");
  }
}

/**
 * Read only the employee's binding state. Archive policy, customer notice,
 * retention and encryption gates control ingestion, not this status query.
 */
export async function readEmployeeBindingStatus(
  employeeId: number,
  env: NodeJS.ProcessEnv,
  db: BindingStatusQueryPool,
): Promise<EmployeeBindingStatus> {
  if (!Number.isSafeInteger(employeeId) || employeeId < 1) {
    throw new Error("Employee identity is invalid.");
  }
  if (!getStagingArchiveTarget(env)) {
    throw new Error("Isolated WhatsApp archive database is unavailable.");
  }
  const result = await db.query(
    `SELECT status, meta_verified AS "metaVerified",
            phone_connected AS "phoneConnected",
            current_phone_number_id AS "phoneNumberId"
       FROM staging_whatsapp_archive.employee_binding_status($1)`,
    [String(employeeId)],
  );
  const row = result.rows[0];
  const allowed = new Set([
    "not_connected", "pending", "approved_not_connected", "verified", "connected", "revoked",
  ]);
  if (!row || !allowed.has(String(row.status)) ||
    typeof row.metaVerified !== "boolean" || typeof row.phoneConnected !== "boolean" ||
    row.phoneConnected !== (row.status === "connected")) {
    throw new Error("Archive status response is invalid.");
  }
  return {
    status: row.status as EmployeeBindingStatus["status"],
    metaVerified: row.metaVerified,
    phoneConnected: row.phoneConnected,
    phoneNumberId: typeof row.phoneNumberId === "string" ? row.phoneNumberId : null,
  };
}

async function archivePool(env: NodeJS.ProcessEnv = process.env): Promise<pg.Pool> {
  const target = getStagingArchiveTarget(env);
  if (!target) throw new Error("Isolated WhatsApp archive database is unavailable.");
  const targetFingerprint = crypto.createHash("sha256")
    .update(target.connectionString)
    .digest("hex");
  if (pool && poolTargetFingerprint !== targetFingerprint) {
    throw new Error("Archive PostgreSQL target changed after pool initialization.");
  }
  if (!pool) {
    pool = new Pool(buildStagingArchiveRuntimePgConfig(target, env, {
      applicationName: "kinglike_staging_whatsapp_archive",
    }));
    poolTargetFingerprint = targetFingerprint;
  }
  if (verifiedPool !== pool) {
    let identity;
    try {
      identity = await pool.query(
        "SELECT current_database() AS database, current_user AS username",
      );
    } catch (error) {
      throw new Error(safePgFailureMessage(error, "preflight_query"));
    }
    assertArchiveRuntimeIdentity(identity.rows[0], target);
    verifiedPool = pool;
  }
  return pool;
}

const whatsappArchiveWebhookStore: WhatsAppArchiveWebhookStore =
  createWhatsappArchiveAtomicStore({
    getPool: (env) => archivePool(env),
    env: process.env,
  });

function contactFingerprint(contactWaId: string, key: Buffer): Buffer {
  const lookupKey = crypto.createHmac("sha256", key)
    .update("kinglike-whatsapp-contact-lookup-v1")
    .digest();
  return crypto.createHmac("sha256", lookupKey).update(contactWaId).digest();
}

function serializedEncryptedValue(value: unknown): EncryptedArchiveValue {
  if (!value || typeof value !== "object") throw new Error("Encrypted archive payload is invalid.");
  return JSON.parse(Buffer.from(value as Uint8Array).toString("utf8")) as EncryptedArchiveValue;
}

export const whatsappEmployeeArchivePostgresStore: ArchiveReadStore & ArchiveIngestStore & {
  getEmployeeBindingStatus(employeeId: number): Promise<{
    status: "not_connected" | "pending" | "approved_not_connected" | "verified" | "connected" | "revoked";
    metaVerified: boolean;
    phoneConnected: boolean;
    phoneNumberId: string | null;
  }>;
  savePrivateMedia(messageId: number, mimeType: string, data: Buffer): Promise<number>;
  tombstoneMessage(providerEventId: string, deletionEventId: string, deletedAt: Date): Promise<boolean>;
  getSignupEligibility(employeeId: number): Promise<{
    archiveEmployeeId: number;
    employeeRef: string;
    active: boolean;
    authorizedRole: boolean;
    currentNoticeReceived: boolean;
    companyWorkNumberOnly: boolean;
    noticeVersion: string;
    retentionDays: number;
    policyApproved: boolean;
    lawfulBasis: string;
    legalAssessmentReference: string;
    noticeText: string;
    customerNoticeVersion: string;
    customerTransparencyText: string;
  } | null>;
} & WhatsAppArchiveWebhookStore = {
  ...whatsappArchiveWebhookStore,
  async getEmployeeBindingStatus(employeeId) {
    const db = await archivePool();
    return readEmployeeBindingStatus(employeeId, process.env, db);
  },
  async getSignupEligibility(employeeId) {
    if (!Number.isSafeInteger(employeeId) || employeeId < 1) return null;
    const decision = getEmployeeArchiveRuntimeDecision(process.env);
    if (!decision.enabled) return null;
    const db = await archivePool();
    const result = await db.query(`
      SELECT e.id AS "archiveEmployeeId", e.employee_ref AS "employeeRef",
             e.active, e.role IN ('crm_employee', 'sub_agent', 'agent') AS "authorizedRole",
              p.version AS "noticeVersion", p.retention_days AS "retentionDays",
              p.lawful_basis AS "lawfulBasis",
              p.legal_assessment_reference AS "legalAssessmentReference",
              p.employee_notice_text AS "noticeText",
              p.customer_notice_version AS "customerNoticeVersion",
              p.customer_notice_text AS "customerTransparencyText",
              (p.approved_at IS NOT NULL AND p.legal_reviewed_at IS NOT NULL
                AND p.processing_scope = 'company_work_only') AS "policyApproved",
             EXISTS (
                SELECT 1 FROM staging_whatsapp_archive.employee_notice_receipts r
                 WHERE r.employee_id = e.id AND r.policy_id = p.id
                   AND r.viewed_at IS NOT NULL AND r.notice_version = p.version
              ) AS "currentNoticeReceived",
              EXISTS (
                SELECT 1 FROM staging_whatsapp_archive.company_work_phone_assignments n
                 WHERE n.employee_id = e.id AND n.active AND n.revoked_at IS NULL
              ) AS "companyWorkNumberOnly"
        FROM staging_whatsapp_archive.employees e
        JOIN LATERAL (
           SELECT id, version, retention_days, approved_at
            FROM staging_whatsapp_archive.policies
            WHERE approved_at IS NOT NULL AND legal_reviewed_at IS NOT NULL
              AND NULLIF(BTRIM(legal_assessment_reference), '') IS NOT NULL
              AND processing_scope = 'company_work_only'
              AND NULLIF(BTRIM(employee_notice_text), '') IS NOT NULL
              AND NULLIF(BTRIM(customer_notice_text), '') IS NOT NULL
           ORDER BY approved_at DESC, id DESC
           LIMIT 1
        ) p ON TRUE
       WHERE e.employee_ref = $1
       LIMIT 1
    `, [String(employeeId)]);
    const row = result.rows[0];
    if (!row) return null;
    return {
      archiveEmployeeId: Number(row.archiveEmployeeId),
      employeeRef: String(row.employeeRef),
      active: row.active === true,
      authorizedRole: row.authorizedRole === true,
      currentNoticeReceived: row.currentNoticeReceived === true,
      companyWorkNumberOnly: row.companyWorkNumberOnly === true,
      noticeVersion: String(row.noticeVersion),
      customerNoticeVersion: String(row.customerNoticeVersion),
      lawfulBasis: String(row.lawfulBasis),
      legalAssessmentReference: String(row.legalAssessmentReference),
      noticeText: String(row.noticeText),
      customerTransparencyText: String(row.customerTransparencyText),
      retentionDays: Number(row.retentionDays),
      policyApproved: row.policyApproved === true &&
        Number(row.retentionDays) === decision.retentionDays,
    };
  },
  async listEmployees() {
    const db = await archivePool();
    const result = await db.query(`
      SELECT e.id::int, e.display_name AS username, e.role
      FROM staging_whatsapp_archive.employees e
      JOIN staging_whatsapp_archive.employee_notice_receipts a
        ON a.employee_id = e.id AND a.viewed_at IS NOT NULL
      JOIN staging_whatsapp_archive.policies p
        ON p.id = a.policy_id AND p.approved_at IS NOT NULL
      WHERE e.active = TRUE
        AND p.id = (SELECT id FROM staging_whatsapp_archive.policies
                    WHERE approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1)
      ORDER BY e.display_name
    `);
    return result.rows;
  },
  async listConversations(filters) {
    const db = await archivePool();
    const decision = getEmployeeArchiveRuntimeDecision(process.env);
    if (!decision.enabled) throw new Error("Archive policy is unavailable.");
    const params: unknown[] = [filters.employeeId, decision.retentionDays];
    const where = [
      "c.employee_id = $1",
      "c.last_message_at >= NOW() - ($2::int * INTERVAL '1 day')",
    ];
    if (filters.search) {
      params.push(contactFingerprint(filters.search, decision.encryptionKey));
      where.push(`c.contact_fingerprint = $${params.length}`);
    }
    if (filters.from) {
      params.push(filters.from);
      where.push(`c.last_message_at >= $${params.length}::timestamptz`);
    }
    if (filters.to) {
      params.push(filters.to);
      where.push(`c.last_message_at < ($${params.length}::timestamptz + INTERVAL '1 day')`);
    }
    const result = await db.query(`
      SELECT c.id, c.employee_id AS "employeeId", c.phone_number_id AS "phoneNumberId",
             'archive-' || substr(encode(c.contact_fingerprint, 'hex'), 1, 12) AS "contactWaId",
             c.last_message_at AS "lastMessageAt",
             COUNT(m.id)::int AS "messageCount",
             COUNT(m.id) FILTER (WHERE m.tombstoned_at IS NOT NULL)::int AS "deletedCount",
             COUNT(media.id)::int AS "mediaCount"
      FROM staging_whatsapp_archive.conversations c
      LEFT JOIN staging_whatsapp_archive.messages m ON m.conversation_id = c.id
      LEFT JOIN staging_whatsapp_archive.media media ON media.message_id = m.id
      WHERE ${where.join(" AND ")}
        AND EXISTS (
          SELECT 1
          FROM staging_whatsapp_archive.employee_notice_receipts a
          JOIN staging_whatsapp_archive.policies p ON p.id = a.policy_id
          WHERE a.employee_id = c.employee_id AND a.viewed_at IS NOT NULL
            AND p.approved_at IS NOT NULL
            AND p.id = (SELECT id FROM staging_whatsapp_archive.policies
                        WHERE approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1)
        )
      GROUP BY c.id
      ORDER BY c.last_message_at DESC NULLS LAST
      LIMIT 200
    `, params);
    return result.rows;
  },
  async getConversation(id) {
    const db = await archivePool();
    const result = await db.query(
      `SELECT c.id, c.employee_id AS "employeeId"
       FROM staging_whatsapp_archive.conversations c
       JOIN staging_whatsapp_archive.employees e ON e.id = c.employee_id AND e.active = TRUE
       WHERE c.id = $1 AND EXISTS (
         SELECT 1
         FROM staging_whatsapp_archive.employee_notice_receipts a
         JOIN staging_whatsapp_archive.policies p ON p.id = a.policy_id
         WHERE a.employee_id = e.id AND a.viewed_at IS NOT NULL AND p.approved_at IS NOT NULL
           AND p.id = (SELECT id FROM staging_whatsapp_archive.policies
                       WHERE approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1)
       )
       LIMIT 1`,
      [id],
    );
    return result.rows[0] ?? null;
  },
  async listMessages(conversationId) {
    const db = await archivePool();
    const result = await db.query(`
      SELECT m.id, m.direction, m.message_type AS "messageType", m.status,
             m.occurred_at AS "occurredAt", m.tombstoned_at AS "tombstonedAt",
             m.encrypted_payload AS "encryptedPayload",
             media.id AS "mediaId", media.mime_type AS "mediaType"
      FROM staging_whatsapp_archive.messages m
      LEFT JOIN staging_whatsapp_archive.media media
        ON media.message_id = m.id AND m.tombstoned_at IS NULL
      WHERE m.conversation_id = $1
        AND m.occurred_at >= NOW() - (
          (SELECT retention_days FROM staging_whatsapp_archive.policies
           WHERE approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1)::int * INTERVAL '1 day'
        )
      ORDER BY m.occurred_at ASC
      LIMIT 1000
    `, [conversationId]);
    return result.rows.map((row) => ({
      ...row,
      encryptedPayload: row.encryptedPayload
        ? serializedEncryptedValue(row.encryptedPayload)
        : null,
    }));
  },
  async getPrivateMedia(id) {
    const db = await archivePool();
    const decision = getEmployeeArchiveRuntimeDecision(process.env);
    if (!decision.enabled) return null;
    const result = await db.query(`
      SELECT media.encrypted_blob AS "encryptedBlob", media.mime_type AS "mimeType",
             conversation.employee_id AS "employeeId", conversation.id AS "conversationId",
             message.tombstoned_at AS "tombstonedAt"
      FROM staging_whatsapp_archive.media media
      JOIN staging_whatsapp_archive.messages message ON message.id = media.message_id
      JOIN staging_whatsapp_archive.conversations conversation ON conversation.id = message.conversation_id
      WHERE media.id = $1 AND message.tombstoned_at IS NULL
        AND message.occurred_at >= NOW() - ($2::int * INTERVAL '1 day')
        AND EXISTS (
          SELECT 1
          FROM staging_whatsapp_archive.employee_notice_receipts a
          JOIN staging_whatsapp_archive.policies p ON p.id = a.policy_id
          WHERE a.employee_id = conversation.employee_id AND a.viewed_at IS NOT NULL
            AND p.approved_at IS NOT NULL
            AND p.id = (SELECT id FROM staging_whatsapp_archive.policies
                        WHERE approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1)
        )
      LIMIT 1
    `, [id, decision.retentionDays]);
    const row = result.rows[0];
    if (!row || !Buffer.isBuffer(row.encryptedBlob)) return null;
    const encrypted = serializedEncryptedValue(row.encryptedBlob);
    const encoded = decryptArchiveValue(encrypted, decision.encryptionKey);
    const data = Buffer.from(encoded, "base64");
    if (data.length === 0 || data.length > 15 * 1024 * 1024) return null;
    return {
      employeeId: Number(row.employeeId),
      conversationId: Number(row.conversationId),
      mimeType: String(row.mimeType),
      data,
    };
  },
  async recordAudit(event) {
    const db = await archivePool();
    await db.query(`
      INSERT INTO staging_whatsapp_archive.audit_events
        (actor_session_user_id, action, employee_id, conversation_id)
      VALUES ($1, $2, $3, $4)
    `, [String(event.actorUserId), event.action, event.employeeId ?? null, event.conversationId ?? null]);
  },
  async findVerifiedBinding(phoneNumberId) {
    const db = await archivePool();
    const result = await db.query(`
      SELECT b.employee_id::int AS "employeeId", b.active
      FROM staging_whatsapp_archive.phone_number_bindings b
      JOIN staging_whatsapp_archive.employees e ON e.id = b.employee_id
      WHERE b.phone_number_id = $1 AND e.active = TRUE AND b.verified_at IS NOT NULL
      LIMIT 1
    `, [phoneNumberId]);
    return result.rows[0] ?? null;
  },
  async hasCurrentEmployeeAcknowledgement(employeeId) {
    const db = await archivePool();
    const result = await db.query(`
      SELECT EXISTS (
        SELECT 1
        FROM staging_whatsapp_archive.employee_notice_receipts a
        JOIN staging_whatsapp_archive.policies p ON p.id = a.policy_id
        JOIN staging_whatsapp_archive.employees e ON e.id = a.employee_id
        WHERE a.employee_id = $1 AND e.active = TRUE
          AND a.viewed_at IS NOT NULL AND p.approved_at IS NOT NULL
          AND p.id = (SELECT id FROM staging_whatsapp_archive.policies
                      WHERE approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1)
      ) AS acknowledged
    `, [employeeId]);
    return result.rows[0]?.acknowledged === true;
  },
  async saveMessage(input) {
    const db = await archivePool();
    const client = await db.connect();
    const decision = getEmployeeArchiveRuntimeDecision(process.env);
    if (!decision.enabled) {
      client.release();
      throw new Error("Archive storage policy is unavailable.");
    }
    const fingerprint = contactFingerprint(input.contactWaId, decision.encryptionKey);
    const keyId = process.env.WHATSAPP_EMPLOYEE_ARCHIVE_ENCRYPTION_KEY_ID || "archive-key-v1";
    try {
      await client.query("BEGIN");
      const permitted = await client.query(`
        SELECT 1
        FROM staging_whatsapp_archive.phone_number_bindings b
        JOIN staging_whatsapp_archive.employees e ON e.id = b.employee_id
        JOIN staging_whatsapp_archive.company_work_phone_assignments n
          ON n.employee_id = e.id AND n.phone_number_id = b.phone_number_id
          AND n.active AND n.revoked_at IS NULL
        JOIN staging_whatsapp_archive.employee_notice_receipts a
          ON a.employee_id = e.id AND a.viewed_at IS NOT NULL
        JOIN staging_whatsapp_archive.policies p
          ON p.id = a.policy_id AND p.approved_at IS NOT NULL
        WHERE b.phone_number_id = $1 AND b.employee_id = $2
          AND b.active = TRUE AND b.verified_at IS NOT NULL AND e.active = TRUE
          AND p.id = (SELECT id FROM staging_whatsapp_archive.policies
                      WHERE approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1)
        LIMIT 1
        FOR SHARE OF b, e, a, p
      `, [input.phoneNumberId, input.employeeId]);
      if (!permitted.rowCount) {
        throw new Error("Verified binding or current employee acknowledgement is missing.");
      }
      const conversation = await client.query(`
        INSERT INTO staging_whatsapp_archive.conversations
          (employee_id, phone_number_id, contact_fingerprint, last_message_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (employee_id, phone_number_id, contact_fingerprint)
        DO UPDATE SET last_message_at = GREATEST(
          staging_whatsapp_archive.conversations.last_message_at, EXCLUDED.last_message_at
        )
        RETURNING id
      `, [input.employeeId, input.phoneNumberId, fingerprint, input.occurredAt]);
      const inserted = await client.query(`
        INSERT INTO staging_whatsapp_archive.messages
          (conversation_id, provider_event_id, direction, message_type, status,
           occurred_at, encrypted_payload, encryption_key_id)
        SELECT $1, $2, $3, $4, $5, $6, $7, $8
        WHERE $6 >= NOW() - ($9::int * INTERVAL '1 day')
          AND EXISTS (
            SELECT 1 FROM staging_whatsapp_archive.policies p
            WHERE p.approved_at IS NOT NULL
              AND p.id = (SELECT id FROM staging_whatsapp_archive.policies
                          WHERE approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1)
              AND p.encryption_key_id = $8
              AND $6 >= NOW() - (p.retention_days * INTERVAL '1 day')
          )
        ON CONFLICT (provider_event_id) DO NOTHING
        RETURNING id
      `, [
        conversation.rows[0].id, input.wamid, input.direction, input.messageType,
        input.status, input.occurredAt, Buffer.from(JSON.stringify(input.encryptedPayload)),
        keyId, decision.retentionDays,
      ]);
      if (!inserted.rowCount) {
        const exists = await client.query(
          "SELECT 1 FROM staging_whatsapp_archive.messages WHERE provider_event_id = $1",
          [input.wamid],
        );
        if (!exists.rowCount) throw new Error("Archive event is outside the approved retention window.");
        await client.query("ROLLBACK");
        return "duplicate";
      }
      await client.query("COMMIT");
      return "inserted";
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
  async savePrivateMedia(messageId, mimeType, data) {
    const allowed = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "audio/ogg", "audio/mpeg", "application/pdf"]);
    if (!allowed.has(mimeType) || data.length === 0 || data.length > 15 * 1024 * 1024) {
      throw new Error("Archive media is unsupported or exceeds the size limit.");
    }
    const decision = getEmployeeArchiveRuntimeDecision(process.env);
    if (!decision.enabled) throw new Error("Archive media storage is unavailable.");
    // The media payload is encoded before AES-GCM; only ciphertext reaches BYTEA.
    const encryptedValue = encryptArchiveValue(data.toString("base64"), decision.encryptionKey);
    const db = await archivePool();
    const result = await db.query(`
      INSERT INTO staging_whatsapp_archive.media
        (message_id, mime_type, byte_size, encrypted_blob, encryption_key_id)
      SELECT $1, $2, $3, $4, $5
      WHERE EXISTS (
        SELECT 1
        FROM staging_whatsapp_archive.messages m
        JOIN staging_whatsapp_archive.conversations c ON c.id = m.conversation_id
        JOIN staging_whatsapp_archive.company_work_phone_assignments n
          ON n.employee_id = c.employee_id AND n.phone_number_id = c.phone_number_id
          AND n.active AND n.revoked_at IS NULL
        JOIN staging_whatsapp_archive.employee_notice_receipts a
          ON a.employee_id = c.employee_id AND a.viewed_at IS NOT NULL
        JOIN staging_whatsapp_archive.policies p ON p.id = a.policy_id AND p.approved_at IS NOT NULL
        WHERE m.id = $1 AND m.tombstoned_at IS NULL
          AND m.occurred_at >= NOW() - ($6::int * INTERVAL '1 day')
          AND p.id = (SELECT id FROM staging_whatsapp_archive.policies
                      WHERE approved_at IS NOT NULL ORDER BY approved_at DESC LIMIT 1)
      )
      RETURNING id
    `, [
      messageId, mimeType, data.length, Buffer.from(JSON.stringify(encryptedValue)),
      process.env.WHATSAPP_EMPLOYEE_ARCHIVE_ENCRYPTION_KEY_ID || "archive-key-v1",
      decision.retentionDays,
    ]);
    if (!result.rowCount) throw new Error("Media message is unavailable or deleted.");
    return Number(result.rows[0].id);
  },
  async tombstoneMessage(providerEventId, deletionEventId, deletedAt) {
    const db = await archivePool();
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(`
        UPDATE staging_whatsapp_archive.messages
        SET tombstoned_at = $3, encrypted_payload = NULL, deletion_event_id = $2
        WHERE provider_event_id = $1 AND tombstoned_at IS NULL
        RETURNING id
      `, [providerEventId, deletionEventId, deletedAt]);
      if (result.rowCount) {
        await client.query(
          "UPDATE staging_whatsapp_archive.media SET encrypted_blob = NULL WHERE message_id = $1",
          [result.rows[0].id],
        );
      }
      await client.query("COMMIT");
      return Boolean(result.rowCount);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  },
};
