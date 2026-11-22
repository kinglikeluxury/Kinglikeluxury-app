import crypto from "node:crypto";
import type { Express, Request, Response } from "express";

export const WHATSAPP_ARCHIVE_WEBHOOK_PATH = "/api/webhooks/whatsapp-archive";
export const WHATSAPP_ARCHIVE_WEBHOOK_BODY_LIMIT = 1024 * 1024;

export type CloudWebhookPayload = {
  object: "whatsapp_business_account";
  entry: Array<Record<string, unknown>>;
};

export type WhatsAppArchiveWebhookDependencies = Readonly<{
  env?: NodeJS.ProcessEnv;
  /** Main application must pass an explicit readiness decision. */
  enabled?: boolean;
  /**
   * Must atomically deduplicate and persist only after verifying the employee
   * binding, current employee/customer notice proof, approved retention
   * policy, and archive database identity. No default is provided.
   */
  processVerifiedPayloadOnce?: (
    eventKey: string,
    payload: CloudWebhookPayload,
  ) => Promise<"processed" | "duplicate" | "discarded_unnotified">;
  processCustomerNoticeStatus?: (
    rawBody: Buffer,
    signature: unknown,
  ) => Promise<"not_applicable" | "applied" | "duplicate" | "blocked">;
}>;

function constantTimeEqual(actual: string, expected: string): boolean {
  const actualBytes = Buffer.from(actual, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  return actualBytes.length === expectedBytes.length &&
    crypto.timingSafeEqual(actualBytes, expectedBytes);
}

function isCloudWebhookPayload(value: unknown): value is CloudWebhookPayload {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate.object === "whatsapp_business_account" &&
    Array.isArray(candidate.entry) &&
    candidate.entry.length > 0 &&
    candidate.entry.length <= 100 &&
    candidate.entry.every((entry) =>
      Boolean(entry) && typeof entry === "object" &&
      Array.isArray((entry as Record<string, unknown>).changes),
    );
}

function signatureIsValid(rawBody: Buffer, signature: unknown, appSecret: string): boolean {
  if (typeof signature !== "string" || !/^sha256=[a-f0-9]{64}$/.test(signature)) {
    return false;
  }
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return constantTimeEqual(signature, expected);
}

function stagingEnabled(env: NodeJS.ProcessEnv, enabled: boolean | undefined): boolean {
  return env.APP_DEPLOYMENT_MODE === "staging" && enabled === true;
}

export function registerWhatsappArchiveWebhookRoutes(
  app: Express,
  dependencies: WhatsAppArchiveWebhookDependencies = {},
): void {
  const env = dependencies.env ?? process.env;

  app.get(WHATSAPP_ARCHIVE_WEBHOOK_PATH, (req: Request, res: Response) => {
    if (!stagingEnabled(env, dependencies.enabled)) return res.sendStatus(404);
    const verifyToken = env.WHATSAPP_ARCHIVE_WEBHOOK_VERIFY_TOKEN;
    if (!verifyToken) return res.status(503).json({ error: "webhook_not_configured" });

    const mode = req.query["hub.mode"];
    const suppliedToken = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (
      mode !== "subscribe" ||
      typeof suppliedToken !== "string" ||
      typeof challenge !== "string" ||
      challenge.length > 1024 ||
      !constantTimeEqual(suppliedToken, verifyToken)
    ) {
      return res.sendStatus(403);
    }
    return res.status(200).type("text/plain").send(challenge);
  });

  app.post(WHATSAPP_ARCHIVE_WEBHOOK_PATH, async (req: Request, res: Response) => {
    if (!stagingEnabled(env, dependencies.enabled)) return res.sendStatus(404);
    const appSecret = env.META_APP_SECRET;
    if (!appSecret) return res.status(503).json({ error: "webhook_not_configured" });

    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) {
      return res.status(415).json({ error: "raw_json_body_required" });
    }
    if (!signatureIsValid(rawBody, req.header("x-hub-signature-256"), appSecret)) {
      return res.sendStatus(401);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(rawBody.toString("utf8"));
    } catch {
      return res.status(400).json({ error: "invalid_json" });
    }
    if (!isCloudWebhookPayload(payload)) {
      return res.status(400).json({ error: "invalid_whatsapp_webhook_payload" });
    }

    if (dependencies.processCustomerNoticeStatus) {
      let noticeResult: "not_applicable" | "applied" | "duplicate" | "blocked";
      try {
        noticeResult = await dependencies.processCustomerNoticeStatus(
          rawBody,
          req.header("x-hub-signature-256"),
        );
      } catch {
        return res.status(503).json({ error: "customer_notice_status_unavailable" });
      }
      if (noticeResult === "blocked") {
        return res.status(503).json({ error: "customer_notice_evidence_unavailable" });
      }
      if (noticeResult === "applied" || noticeResult === "duplicate") {
        return res.status(200).json({ status: noticeResult });
      }
    }

    // A valid signature alone is not permission to archive messages. Without
    // the database-backed processor, fail closed without acknowledging delivery.
    if (!dependencies.processVerifiedPayloadOnce) {
      return res.status(503).json({ error: "archive_ingest_not_ready" });
    }

    const eventKey = crypto.createHash("sha256").update(rawBody).digest("hex");
    try {
      const result = await dependencies.processVerifiedPayloadOnce(eventKey, payload);
      if (result === "discarded_unnotified") {
        return res.status(200).json({ status: "discarded_without_customer_notice_proof", messageStored: false });
      }
      if (result !== "processed" && result !== "duplicate") {
        return res.status(503).json({ error: "archive_ingest_unavailable" });
      }
      return res.status(200).json({
        status: result === "duplicate" ? "duplicate" : "accepted",
      });
    } catch {
      return res.status(503).json({ error: "archive_ingest_unavailable" });
    }
  });
}
