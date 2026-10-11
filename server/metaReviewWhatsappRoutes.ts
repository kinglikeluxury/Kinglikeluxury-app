import type { Express, Request, Response } from "express";
import { requireWhatsappAdmin } from "./whatsappInternalAuth";
import {
  getMetaReviewWhatsappEvents,
  loadMetaReviewWhatsappManagementData,
  getMetaReviewWhatsappStatus,
  MetaReviewWhatsappManagementError,
  META_REVIEW_WHATSAPP_WEBHOOK_PATH,
  processMetaReviewWhatsappWebhook,
  sendMetaReviewWhatsappTestTemplate,
  validateMetaReviewWhatsappChallenge,
  type MetaReviewWhatsappEnvironment,
} from "./metaReviewWhatsappService";

type RequestWithRawBody = Request & { rawBody?: Buffer };

export interface MetaReviewWhatsappRouteDependencies {
  environment?: () => MetaReviewWhatsappEnvironment;
  fetchImpl?: typeof fetch;
}

export function registerMetaReviewWhatsappRoutes(
  app: Express,
  dependencies: MetaReviewWhatsappRouteDependencies = {},
): void {
  const environment = dependencies.environment ?? (() => process.env);

  app.get(META_REVIEW_WHATSAPP_WEBHOOK_PATH, (req, res) => {
    const challenge = validateMetaReviewWhatsappChallenge(
      req.query["hub.mode"],
      req.query["hub.verify_token"],
      req.query["hub.challenge"],
      environment(),
    );
    if (challenge === null) {
      res.status(403).type("text/plain").send("Webhook verification failed");
      return;
    }
    res.status(200).type("text/plain").send(challenge);
  });

  app.post(
    META_REVIEW_WHATSAPP_WEBHOOK_PATH,
    (req: RequestWithRawBody, res: Response) => {
      if (!req.rawBody) {
        res.status(400).json({ message: "Webhook body is unavailable." });
        return;
      }
      const signature = req.get("x-hub-signature-256") ?? "";
      const result = processMetaReviewWhatsappWebhook(
        req.rawBody,
        signature,
        environment(),
      );
      if (!result.accepted) {
        const status = result.reason === "not_configured"
          ? 503
          : result.reason === "invalid_signature"
            ? 401
            : 400;
        res.status(status).json({ message: "Test webhook was not accepted." });
        return;
      }
      res.status(200).json({ ok: true });
    },
  );

  app.get(
    "/api/admin/meta-review/whatsapp/status",
    requireWhatsappAdmin,
    (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(getMetaReviewWhatsappStatus(environment()));
    },
  );

  app.get(
    "/api/admin/meta-review/whatsapp/events",
    requireWhatsappAdmin,
    (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json({ events: getMetaReviewWhatsappEvents() });
    },
  );

  app.get(
    "/api/admin/meta-review/whatsapp/management",
    requireWhatsappAdmin,
    async (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      try {
        const data = await loadMetaReviewWhatsappManagementData(
          environment(),
          dependencies.fetchImpl,
        );
        res.json(data);
      } catch (error) {
        const statusCode = error instanceof MetaReviewWhatsappManagementError
          ? error.statusCode
          : 502;
        res.status(statusCode).json({
          message: "Test WhatsApp Business details are unavailable.",
        });
      }
    },
  );

  app.post(
    "/api/admin/meta-review/whatsapp/send-test-template",
    requireWhatsappAdmin,
    async (req, res) => {
      if (
        !req.body ||
        typeof req.body !== "object" ||
        Array.isArray(req.body) ||
        Object.keys(req.body).length !== 0
      ) {
        res.status(400).json({ message: "This endpoint accepts no message or recipient fields." });
        return;
      }

      try {
        await sendMetaReviewWhatsappTestTemplate(environment(), dependencies.fetchImpl);
        res.json({ ok: true, message: "The fixed test template was submitted." });
      } catch (error) {
        const statusCode =
          typeof error === "object" &&
          error !== null &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
            ? error.statusCode
            : 502;
        const message =
          error instanceof Error
            ? error.message
            : "The test template could not be submitted.";
        res.status(statusCode).json({ message });
      }
    },
  );
}
