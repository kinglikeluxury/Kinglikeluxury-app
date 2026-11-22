import crypto from "node:crypto";
import type { Express, Request, Response } from "express";

export const WHATSAPP_ONBOARDING_QUARANTINE_WEBHOOK_PATH =
  "/api/webhooks/whatsapp-onboarding-quarantine";
export const WHATSAPP_ONBOARDING_QUARANTINE_BODY_LIMIT = 256 * 1024;

function constantTimeEqual(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function validSignature(rawBody: Buffer, supplied: unknown, appSecret: string): boolean {
  if (typeof supplied !== "string" || !/^sha256=[a-f0-9]{64}$/.test(supplied)) {
    return false;
  }
  const expected = `sha256=${crypto.createHmac("sha256", appSecret)
    .update(rawBody).digest("hex")}`;
  return constantTimeEqual(supplied, expected);
}

/**
 * A strict drop-only endpoint for the period before archiving is authorized.
 * It deliberately does not parse, hash, persist, forward, or log the webhook
 * body. Consequently no Meta event is treated as onboarding evidence here.
 */
export function registerWhatsappOnboardingQuarantineWebhookRoutes(
  app: Express,
  dependencies: {
    env?: NodeJS.ProcessEnv;
    enabled?: boolean;
    processCustomerNoticeEcho?: (
      rawBody: Buffer,
      signature: unknown,
    ) => Promise<"recorded" | "duplicate" | "not_applicable" | "blocked">;
  } = {},
): void {
  const env = dependencies.env ?? process.env;
  const enabled = () => env.NODE_ENV === "development" &&
    env.APP_DEPLOYMENT_MODE === "staging" &&
    dependencies.enabled === true;

  app.get(WHATSAPP_ONBOARDING_QUARANTINE_WEBHOOK_PATH, (req, res) => {
    if (!enabled()) return res.sendStatus(404);
    const verifyToken = env.WHATSAPP_ARCHIVE_WEBHOOK_VERIFY_TOKEN;
    const mode = req.query["hub.mode"];
    const suppliedToken = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (!verifyToken || mode !== "subscribe" ||
      typeof suppliedToken !== "string" ||
      typeof challenge !== "string" || challenge.length > 1024 ||
      !constantTimeEqual(suppliedToken, verifyToken)) {
      return res.sendStatus(403);
    }
    return res.status(200).type("text/plain").send(challenge);
  });

  app.post(WHATSAPP_ONBOARDING_QUARANTINE_WEBHOOK_PATH, async (req: Request, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    if (!enabled()) return res.sendStatus(404);
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    const appSecret = env.META_APP_SECRET;
    if (!Buffer.isBuffer(rawBody) || rawBody.length === 0 ||
      rawBody.length > WHATSAPP_ONBOARDING_QUARANTINE_BODY_LIMIT) {
      return res.sendStatus(400);
    }
    if (!appSecret ||
      !validSignature(rawBody, req.header("x-hub-signature-256"), appSecret)) {
      return res.sendStatus(401);
    }

    if (dependencies.processCustomerNoticeEcho) {
      let result: "recorded" | "duplicate" | "not_applicable" | "blocked";
      try {
        result = await dependencies.processCustomerNoticeEcho(
          rawBody, req.header("x-hub-signature-256"),
        );
      } catch {
        return res.status(503).json({ status: "notice_proof_unavailable" });
      }
      if (result === "blocked") {
        return res.status(503).json({ status: "notice_proof_unavailable" });
      }
      if (result === "recorded" || result === "duplicate") {
        return res.status(200).json({
          status: `notice_receipt_${result}_quarantine_only`,
          messageStored: false,
        });
      }
    }

    // Other signed events are intentionally discarded. The optional proof
    // handler above parses only smb_message_echoes and never stores message text.
    return res.status(200).json({ status: "discarded_quarantine_no_storage" });
  });
}
