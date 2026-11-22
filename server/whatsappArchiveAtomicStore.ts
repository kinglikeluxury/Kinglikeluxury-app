import crypto from "node:crypto";
import {
  getEmployeeArchiveRuntimeDecision,
  type EncryptedArchiveValue,
} from "./whatsappEmployeeArchiveSafety";
import { safePgFailureMessage } from "./stagingArchive/pgFailureDiagnosis";
import type {
  PreparedArchiveEvent,
  VerifiedArchiveBinding,
  WhatsAppArchiveWebhookStore,
} from "./whatsappArchiveWebhookProcessor";

type BindingRow = {
  id: string | number;
  employeeId: string | number;
  policyId: string | number;
  wabaId: string;
  phoneNumberId: string;
  verifiedAt: Date | string;
  retentionDays: number;
  employeeNoticeCurrent: boolean;
};

type QueryExecutor = {
  query(text: string, values?: any[]): Promise<any>;
};

type Queryable = QueryExecutor & {
  connect(): Promise<QueryExecutor & { release(): void }>;
};

function eventKeyIsValid(value: string): boolean {
  return /^[a-f0-9]{64}$/.test(value);
}

function contactFingerprint(value: string, key: Buffer): Buffer {
  const lookupKey = crypto.createHmac("sha256", key)
    .update("kinglike-whatsapp-contact-lookup-v1")
    .digest();
  return crypto.createHmac("sha256", lookupKey).update(value).digest();
}

function currentBindingQuery(lock: boolean): string {
  return `
    SELECT b.id, b.employee_id AS "employeeId", p.id AS "policyId", b.waba_id AS "wabaId",
           b.phone_number_id AS "phoneNumberId", b.verified_at AS "verifiedAt",
           p.retention_days AS "retentionDays",
           EXISTS (
             SELECT 1
              FROM staging_whatsapp_archive.employee_notice_receipts current_receipt
              WHERE current_receipt.employee_id = e.id
                AND current_receipt.policy_id = p.id
                AND current_receipt.viewed_at IS NOT NULL
                AND current_receipt.notice_version = p.version
           ) AS "employeeNoticeCurrent"
    FROM staging_whatsapp_archive.phone_number_bindings b
    JOIN staging_whatsapp_archive.employees e
      ON e.id = b.employee_id AND e.active = TRUE
      AND e.role IN ('crm_employee', 'sub_agent', 'agent')
    JOIN staging_whatsapp_archive.policies p
      ON p.approved_at IS NOT NULL AND p.legal_reviewed_at IS NOT NULL
      AND p.processing_scope = 'company_work_only'
      AND p.id = (
        SELECT current_policy.id
        FROM staging_whatsapp_archive.policies current_policy
         WHERE current_policy.approved_at IS NOT NULL
           AND current_policy.legal_reviewed_at IS NOT NULL
           AND current_policy.processing_scope = 'company_work_only'
        ORDER BY current_policy.approved_at DESC, current_policy.id DESC
        LIMIT 1
      )
    JOIN staging_whatsapp_archive.binding_owners bo
      ON bo.session_user_id = b.owner_approved_by_session_user_id
      AND bo.active = TRUE AND bo.revoked_at IS NULL
    JOIN staging_whatsapp_archive.company_work_phone_assignments work_number
      ON work_number.employee_id = b.employee_id
      AND work_number.phone_number_id = b.phone_number_id
      AND work_number.active AND work_number.revoked_at IS NULL
    WHERE b.waba_id = $1 AND b.phone_number_id = $2
      AND b.active = TRUE AND b.verified_at IS NOT NULL
      AND b.owner_approved_at IS NOT NULL
      AND b.owner_approved_by_session_user_id IS NOT NULL
      AND b.revoked_at IS NULL
    LIMIT 1
    ${lock ? "FOR SHARE OF b, e, p, bo" : ""}
  `;
}

function toVerifiedBinding(row: BindingRow): VerifiedArchiveBinding {
  return {
    wabaId: String(row.wabaId),
    phoneNumberId: String(row.phoneNumberId),
    employeeId: Number(row.employeeId),
    verifiedAt: new Date(row.verifiedAt).toISOString(),
    active: true,
    revokedAt: null,
    immutableAssignment: true,
    companyWorkNumberOnly: true,
    employeeNoticeCurrent: row.employeeNoticeCurrent === true,
    policyApproved: true,
    retentionDays: Number(row.retentionDays),
  };
}

async function findBinding(
  db: QueryExecutor,
  wabaId: string,
  phoneNumberId: string,
  lock: boolean,
): Promise<BindingRow | null> {
  const result = await db.query(currentBindingQuery(lock), [wabaId, phoneNumberId]);
  return (result.rows[0] as BindingRow | undefined) ?? null;
}

function serializeEncrypted(value: EncryptedArchiveValue): Buffer {
  if (
    value.version !== 1 ||
    typeof value.nonce !== "string" ||
    typeof value.ciphertext !== "string" ||
    typeof value.tag !== "string" ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.nonce) ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value.ciphertext) ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(value.tag) ||
    Buffer.from(value.nonce, "base64").length !== 12 ||
    Buffer.from(value.tag, "base64").length !== 16
  ) throw new Error("Encrypted archive message is invalid.");
  return Buffer.from(JSON.stringify(value), "utf8");
}

function assertMessageEvent(event: PreparedArchiveEvent): asserts event is Extract<PreparedArchiveEvent, { kind: "message" }> {
  if (
    event.kind !== "message" ||
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(event.wamid) ||
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(event.contactWaId) ||
    (event.direction !== "inbound" && event.direction !== "outbound") ||
    (event.direction === "inbound" && event.status !== "received") ||
    (event.direction === "outbound" && event.status !== "sent") ||
    !(event.occurredAt instanceof Date) ||
    !Number.isFinite(event.occurredAt.getTime())
  ) throw new Error("Archive message event is invalid.");
}

function assertEditEvent(event: PreparedArchiveEvent): asserts event is Extract<PreparedArchiveEvent, { kind: "edit" }> {
  if (
    event.kind !== "edit" ||
    !/^[a-f0-9]{64}$/.test(event.eventId) ||
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(event.originalWamid) ||
    !/^[A-Za-z0-9_.:-]{1,160}$/.test(event.contactWaId) ||
    !(event.occurredAt instanceof Date) ||
    !Number.isFinite(event.occurredAt.getTime())
  ) throw new Error("Archive edit event is invalid.");
}

export function createWhatsappArchiveAtomicStore(dependencies: {
  getPool(env: NodeJS.ProcessEnv): Promise<Queryable>;
  env: NodeJS.ProcessEnv;
  now?: () => Date;
}): WhatsAppArchiveWebhookStore {
  return {
    async resolveVerifiedImmutableBinding(wabaId, phoneNumberId) {
      const decision = getEmployeeArchiveRuntimeDecision(dependencies.env);
      if (!decision.enabled) return null;
      const db = await dependencies.getPool(dependencies.env);
      try {
        const row = await findBinding(db, wabaId, phoneNumberId, false);
        if (!row || Number(row.retentionDays) !== decision.retentionDays) return null;
        return toVerifiedBinding(row);
      } catch (error) {
        if (typeof (error as { code?: unknown })?.code === "string") {
          throw new Error(safePgFailureMessage(error, "preflight_query"));
        }
        throw error;
      }
    },

    async commitBatchOnce({ eventKey, binding, events }) {
      if (!eventKeyIsValid(eventKey) || events.length === 0 || events.length > 500) {
        throw new Error("Archive webhook batch is invalid.");
      }
      const decision = getEmployeeArchiveRuntimeDecision(dependencies.env);
      if (!decision.enabled) throw new Error("Archive policy is unavailable.");
      if (binding.retentionDays !== decision.retentionDays) {
        throw new Error("Archive retention policy changed.");
      }

      const db = await dependencies.getPool(dependencies.env);
      let client: QueryExecutor & { release(): void };
      try {
        client = await db.connect();
      } catch (error) {
        throw new Error(safePgFailureMessage(error, "connect"));
      }
      const now = dependencies.now?.() ?? new Date();
      const keyId = dependencies.env.WHATSAPP_EMPLOYEE_ARCHIVE_ENCRYPTION_KEY_ID || "archive-key-v1";
      let transactionOpen = false;
      try {
        await client.query("BEGIN");
        transactionOpen = true;
        await client.query("LOCK TABLE staging_whatsapp_archive.policies IN SHARE MODE");
        const current = await findBinding(client, binding.wabaId, binding.phoneNumberId, true);
        if (
          !current ||
          Number(current.employeeId) !== binding.employeeId ||
          Number(current.retentionDays) !== decision.retentionDays
        ) throw new Error("Verified company-work binding or current notice changed.");
        if (events.some((event) => event.kind !== "tombstone")) {
          const receipt = await client.query(
            `SELECT 1
             FROM staging_whatsapp_archive.employee_notice_receipts r
             JOIN staging_whatsapp_archive.policies p ON p.id = r.policy_id
             JOIN staging_whatsapp_archive.company_work_phone_assignments n
               ON n.employee_id = r.employee_id AND n.phone_number_id = $3
              AND n.active AND n.revoked_at IS NULL
             WHERE r.employee_id = $1 AND r.policy_id = $2
               AND r.viewed_at IS NOT NULL AND r.notice_version = p.version
               AND p.approved_at IS NOT NULL AND p.legal_reviewed_at IS NOT NULL
               AND p.processing_scope = 'company_work_only'
              FOR SHARE OF r, p, n`,
            [binding.employeeId, current.policyId, binding.phoneNumberId],
          );
          if (!receipt.rowCount) throw new Error("Current company policy or employee notice receipt is unavailable.");
        }

        const insertedEvent = await client.query(
          `INSERT INTO staging_whatsapp_archive.webhook_events
             (event_key, binding_id, employee_id, waba_id, phone_number_id, item_count)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (event_key) DO NOTHING
           RETURNING event_key`,
          [
            eventKey, current.id, binding.employeeId, binding.wabaId,
            binding.phoneNumberId, events.length,
          ],
        );
        if (insertedEvent.rowCount !== 1) {
          const prior = await client.query(
            `SELECT binding_id, employee_id
             FROM staging_whatsapp_archive.webhook_events
             WHERE event_key = $1`,
            [eventKey],
          );
          if (
            prior.rows[0]?.binding_id?.toString() !== current.id.toString() ||
            Number(prior.rows[0]?.employee_id) !== binding.employeeId
          ) throw new Error("Webhook event key is already assigned to another binding.");
          await client.query("COMMIT");
          transactionOpen = false;
          return "duplicate";
        }

        for (const event of events) {
          if (event.kind === "message") {
            assertMessageEvent(event);
            const retentionStart = now.getTime() - decision.retentionDays * 86_400_000;
            if (event.occurredAt.getTime() < retentionStart || event.occurredAt > now) {
              throw new Error("Archive message is outside the approved retention window.");
            }
            const fingerprint = contactFingerprint(event.contactWaId, decision.encryptionKey);
            const customerNotice = await client.query(
              `SELECT 1
                 FROM staging_whatsapp_archive.customer_notice_evidence e
                 JOIN staging_whatsapp_archive.company_work_phone_assignments n
                   ON n.assignment_id = e.assignment_id
                WHERE n.employee_id = $1 AND n.phone_number_id = $2
                  AND n.active AND n.revoked_at IS NULL
                  AND e.recipient_fingerprint = $3
                  AND e.policy_version = (SELECT version FROM staging_whatsapp_archive.policies WHERE id = $4)
                  AND e.status IN ('delivery_confirmed', 'viewed')
                  AND e.evidence_source = 'provider_webhook'
                FOR SHARE OF e, n`,
              [binding.employeeId, binding.phoneNumberId, fingerprint, current.policyId],
            );
            if (!customerNotice.rowCount) {
              throw new Error("Verified customer notice delivery is required before message archiving.");
            }
            const conversation = await client.query(
              `INSERT INTO staging_whatsapp_archive.conversations
                 (employee_id, phone_number_id, contact_fingerprint, last_message_at)
               VALUES ($1, $2, $3, $4)
               ON CONFLICT (employee_id, phone_number_id, contact_fingerprint)
               DO UPDATE SET last_message_at = GREATEST(
                 staging_whatsapp_archive.conversations.last_message_at, EXCLUDED.last_message_at
               )
               RETURNING id`,
              [binding.employeeId, binding.phoneNumberId, fingerprint, event.occurredAt],
            );
            if (!conversation.rows[0]?.id) throw new Error("Archive conversation was not created.");
            const insertedMessage = await client.query(
              `INSERT INTO staging_whatsapp_archive.messages
                 (conversation_id, provider_event_id, direction, message_type, status,
                  occurred_at, encrypted_payload, encryption_key_id, status_updated_at,
                  media_mime_type)
                SELECT $1, $2, $7, $3, $8, $4, $5, $6, $4, $9
                WHERE $4 >= NOW() - ($10::int * INTERVAL '1 day')
                 AND EXISTS (
                   SELECT 1 FROM staging_whatsapp_archive.policies p
                     WHERE p.id = $11 AND p.approved_at IS NOT NULL
                      AND p.retention_days = $10 AND p.encryption_key_id = $6
                     AND $4 >= NOW() - (p.retention_days * INTERVAL '1 day')
                 )
               ON CONFLICT (provider_event_id) DO NOTHING
               RETURNING id`,
              [
                conversation.rows[0].id, event.wamid, event.messageType, event.occurredAt,
                serializeEncrypted(event.encryptedPayload), keyId,
                 event.direction, event.status, event.mediaMimeType ?? null,
                 decision.retentionDays, current.policyId,
              ],
            );
            if (insertedMessage.rowCount !== 1) {
              const existing = await client.query(
                `SELECT 1
                 FROM staging_whatsapp_archive.messages m
                 JOIN staging_whatsapp_archive.conversations c ON c.id = m.conversation_id
                 WHERE m.provider_event_id = $1
                   AND c.employee_id = $2 AND c.phone_number_id = $3`,
                [event.wamid, binding.employeeId, binding.phoneNumberId],
              );
              if (!existing.rowCount) throw new Error("Archive message insert was rejected.");
            }
          } else if (event.kind === "edit") {
            assertEditEvent(event);
            const retentionStart = now.getTime() - decision.retentionDays * 86_400_000;
            if (event.occurredAt.getTime() < retentionStart || event.occurredAt > now) {
              throw new Error("Archive edit is outside the approved retention window.");
            }
            const fingerprint = contactFingerprint(event.contactWaId, decision.encryptionKey);
            const customerNotice = await client.query(
              `SELECT 1
                 FROM staging_whatsapp_archive.customer_notice_evidence e
                 JOIN staging_whatsapp_archive.company_work_phone_assignments n
                   ON n.assignment_id = e.assignment_id
                WHERE n.employee_id = $1 AND n.phone_number_id = $2
                  AND n.active AND n.revoked_at IS NULL
                  AND e.recipient_fingerprint = $3
                  AND e.policy_version = (SELECT version FROM staging_whatsapp_archive.policies WHERE id = $4)
                  AND e.status IN ('delivery_confirmed', 'viewed')
                  AND e.evidence_source = 'provider_webhook'
                FOR SHARE OF e, n`,
              [binding.employeeId, binding.phoneNumberId, fingerprint, current.policyId],
            );
            if (!customerNotice.rowCount) {
              throw new Error("Verified customer notice delivery is required before message edits.");
            }
            const edited = await client.query(
              `UPDATE staging_whatsapp_archive.messages m
                  SET encrypted_payload = $1
                 FROM staging_whatsapp_archive.conversations c
                WHERE m.conversation_id = c.id
                  AND m.provider_event_id = $2
                  AND c.employee_id = $3 AND c.phone_number_id = $4
                  AND c.contact_fingerprint = $5
                  AND m.tombstoned_at IS NULL
                RETURNING m.id`,
              [
                serializeEncrypted(event.encryptedPayload), event.originalWamid,
                binding.employeeId, binding.phoneNumberId, fingerprint,
              ],
            );
            if (!edited.rowCount) throw new Error("Archive edit has no owned original message.");
          } else if (event.kind === "status") {
            if (
              !/^[a-f0-9]{64}$/.test(event.eventId) ||
              !/^[A-Za-z0-9_.:-]{1,160}$/.test(event.wamid) ||
              !["sent", "delivered", "read", "failed"].includes(event.status)
            ) throw new Error("Archive status event is invalid.");
            const retentionStart = now.getTime() - decision.retentionDays * 86_400_000;
            if (
              !(event.occurredAt instanceof Date) ||
              !Number.isFinite(event.occurredAt.getTime()) ||
              event.occurredAt.getTime() < retentionStart ||
              event.occurredAt > now
            ) throw new Error("Archive status is outside the approved retention window.");
            const recorded = await client.query(
              `INSERT INTO staging_whatsapp_archive.message_status_events
                 (status_event_id, event_key, provider_event_id, status, occurred_at)
               SELECT $1, $2, m.provider_event_id, $4, $5
               FROM staging_whatsapp_archive.messages m
               JOIN staging_whatsapp_archive.conversations c ON c.id = m.conversation_id
               WHERE m.provider_event_id = $3
                 AND c.employee_id = $6 AND c.phone_number_id = $7
               ON CONFLICT (status_event_id) DO NOTHING
               RETURNING status_event_id`,
              [event.eventId, eventKey, event.wamid, event.status, event.occurredAt,
                binding.employeeId, binding.phoneNumberId],
            );
            if (!recorded.rowCount) {
              const duplicate = await client.query(
                `SELECT 1 FROM staging_whatsapp_archive.message_status_events
                 WHERE status_event_id = $1 AND provider_event_id = $2`,
                [event.eventId, event.wamid],
              );
              if (!duplicate.rowCount) {
                if (event.recipientWaId) {
                  // The SECURITY DEFINER transition is intentionally not
                  // executable by the general runtime role. Do not fall back
                  // to that role for customer-notice evidence; fail closed
                  // until a dedicated webhook-only DB identity is provisioned.
                  throw new Error(
                    "Customer notice status persistence is disabled until a dedicated webhook executor is configured.",
                  );
                }
                throw new Error("Archive status has no owned message or registered customer notice.");
              }
            }
            await client.query(
              `UPDATE staging_whatsapp_archive.messages
               SET status = $2, status_updated_at = $3
               WHERE provider_event_id = $1 AND tombstoned_at IS NULL
                 AND COALESCE(status_updated_at, occurred_at) <= $3
                 AND CASE status
                   WHEN 'read' THEN $2 = 'read'
                   WHEN 'delivered' THEN $2 IN ('delivered', 'read')
                   WHEN 'failed' THEN $2 = 'failed'
                   WHEN 'sent' THEN $2 IN ('sent', 'delivered', 'read', 'failed')
                   ELSE $2 IN ('sent', 'delivered', 'read', 'failed')
                 END`,
              [event.wamid, event.status, event.occurredAt],
            );
          } else {
            if (
              !/^[A-Za-z0-9_.:-]{1,160}$/.test(event.eventId) ||
              !/^[A-Za-z0-9_.:-]{1,160}$/.test(event.wamid) ||
              !(event.deletedAt instanceof Date) ||
              !Number.isFinite(event.deletedAt.getTime()) ||
              event.deletedAt > now
            ) {
              throw new Error("Archive deletion event is invalid.");
            }
            const tombstoned = await client.query(
              `UPDATE staging_whatsapp_archive.messages m
               SET tombstoned_at = $3, encrypted_payload = NULL, deletion_event_id = $2
               FROM staging_whatsapp_archive.conversations c
               WHERE m.conversation_id = c.id AND m.provider_event_id = $1
                 AND c.employee_id = $4 AND c.phone_number_id = $5
                 AND m.tombstoned_at IS NULL
               RETURNING m.id`,
              [event.wamid, event.eventId, event.deletedAt, binding.employeeId, binding.phoneNumberId],
            );
            let messageId = tombstoned.rows[0]?.id;
            if (!messageId) {
              const alreadyDeleted = await client.query(
                `SELECT m.id
                 FROM staging_whatsapp_archive.messages m
                 JOIN staging_whatsapp_archive.conversations c ON c.id = m.conversation_id
                 WHERE m.provider_event_id = $1 AND m.deletion_event_id = $2
                   AND c.employee_id = $3 AND c.phone_number_id = $4`,
                [event.wamid, event.eventId, binding.employeeId, binding.phoneNumberId],
              );
              messageId = alreadyDeleted.rows[0]?.id;
              if (!messageId) throw new Error("Archive deletion has no owned message.");
            }
            await client.query(
              `UPDATE staging_whatsapp_archive.media
               SET encrypted_blob = NULL
               WHERE message_id = $1`,
              [messageId],
            );
          }
        }

        await client.query(
          `INSERT INTO staging_whatsapp_archive.audit_events
             (actor_session_user_id, action, employee_id, source_event_key)
           VALUES ('whatsapp-webhook', 'webhook.batch_archived', $1, $2)
           ON CONFLICT (source_event_key) DO NOTHING`,
          [binding.employeeId, eventKey],
        );
        await client.query("COMMIT");
        transactionOpen = false;
        return "processed";
      } catch (error) {
        if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
        if (typeof (error as { code?: unknown })?.code === "string") {
          throw new Error(safePgFailureMessage(error, "transaction"));
        }
        throw error;
      } finally {
        client.release();
      }
    },
  };
}
