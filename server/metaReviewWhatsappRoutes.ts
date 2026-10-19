import type { Express, NextFunction, Request, Response } from "express";
import { storage } from "./storage";
import { requireWhatsappAdmin } from "./whatsappInternalAuth";
import {
  createMetaReviewerAccount,
  deleteMetaReviewerAccount,
  disableMetaReviewerAccount,
  getMetaReviewerAccount,
  listMetaReviewerAccounts,
} from "./metaReviewerAccessStore";
import { isMetaReviewDiagnosticMode } from "./metaReviewDiagnosticMode";
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
  userStorage?: Pick<typeof storage, "getUserByEmail" | "getUserByUsername">;
}

function createRequireActiveMetaReviewAdmin() {
  return function requireActiveMetaReviewAdmin(
    req: Request,
    res: Response,
    next: NextFunction,
  ): void {
    requireWhatsappAdmin(req, res, () => {
      if (req.session.role !== "meta_reviewer") {
        next();
        return;
      }

      const account = getMetaReviewerAccount(req.session.userId!);
      if (
        !account ||
        account.role !== "meta_reviewer" ||
        account.isAdmin !== true ||
        account.isActive !== true
      ) {
        res.status(403).json({ message: "Not authorized" });
        return;
      }
      next();
    });
  };
}

export function registerMetaReviewWhatsappRoutes(
  app: Express,
  dependencies: MetaReviewWhatsappRouteDependencies = {},
): void {
  const environment = dependencies.environment ?? (() => process.env);
  const userStorage = dependencies.userStorage ?? storage;
  const requireActiveMetaReviewAdmin = createRequireActiveMetaReviewAdmin();

  if (isMetaReviewDiagnosticMode(environment())) {
  app.get(
    "/api/admin/meta-reviewer-access",
    requireActiveMetaReviewAdmin,
    async (_req, res) => {
      try {
        const reviewers = listMetaReviewerAccounts();
        res.setHeader("Cache-Control", "no-store");
        res.json({ reviewers });
      } catch {
        res.status(500).json({ message: "Unable to load reviewer accounts." });
      }
    },
  );

  app.post(
    "/api/admin/meta-reviewer-access",
    requireActiveMetaReviewAdmin,
    async (req, res) => {
      const email = typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";
      const password = typeof req.body?.password === "string"
        ? req.body.password
        : "";

      if (
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 254 ||
        password.length < 12 ||
        Buffer.byteLength(password, "utf8") > 72
      ) {
        res.status(400).json({
          message: "Enter a valid email and a password with 12–72 UTF-8 bytes.",
        });
        return;
      }

      try {
        if (
          await userStorage.getUserByEmail(email) ||
          await userStorage.getUserByUsername(email)
        ) {
          res.status(409).json({ message: "An account already uses that email." });
          return;
        }

        const created = await createMetaReviewerAccount(email, password);

        res.status(201).json({
          reviewer: {
            id: created.id,
            email: created.email,
            username: created.username,
            isAdmin: created.isAdmin,
            isActive: created.isActive,
          },
        });
      } catch {
        res.status(500).json({ message: "Unable to create the reviewer account." });
      }
    },
  );

  app.patch(
    "/api/admin/meta-reviewer-access/:id/disable",
    requireActiveMetaReviewAdmin,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id === 0) {
        res.status(400).json({ message: "Invalid reviewer account." });
        return;
      }
      try {
        const reviewer = getMetaReviewerAccount(id);
        if (!reviewer) {
          res.status(404).json({ message: "Reviewer account not found." });
          return;
        }
        const updated = disableMetaReviewerAccount(id);
        if (!updated) {
          res.status(404).json({ message: "Reviewer account not found." });
          return;
        }
        res.json({ ok: true, id: updated.id, isActive: false, isAdmin: false });
      } catch {
        res.status(500).json({ message: "Unable to disable the reviewer account." });
      }
    },
  );

  app.delete(
    "/api/admin/meta-reviewer-access/:id",
    requireActiveMetaReviewAdmin,
    async (req, res) => {
      const id = Number(req.params.id);
      if (!Number.isSafeInteger(id) || id === 0) {
        res.status(400).json({ message: "Invalid reviewer account." });
        return;
      }
      try {
        const reviewer = getMetaReviewerAccount(id);
        if (!reviewer) {
          res.status(404).json({ message: "Reviewer account not found." });
          return;
        }
        deleteMetaReviewerAccount(id);
        res.json({ ok: true });
      } catch {
        res.status(500).json({ message: "Unable to delete the reviewer account." });
      }
    },
  );
  }

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
    requireActiveMetaReviewAdmin,
    (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json(getMetaReviewWhatsappStatus(environment()));
    },
  );

  app.get(
    "/api/admin/meta-review/whatsapp/events",
    requireActiveMetaReviewAdmin,
    (_req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.json({ events: getMetaReviewWhatsappEvents() });
    },
  );

  app.get(
    "/api/admin/meta-review/whatsapp/management",
    requireActiveMetaReviewAdmin,
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
    requireActiveMetaReviewAdmin,
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
