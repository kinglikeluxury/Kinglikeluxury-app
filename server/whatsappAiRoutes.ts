import { type Express, type Request, type Response } from "express";
import { db } from "./db";
import { eq } from "drizzle-orm";
import {
  crmLeads,
  whatsappAiConversations,
  whatsappAiAgentReports,
} from "@shared/schema";
import {
  getConversationData,
  generateAiReport,
} from "./whatsappAiService";

// ── Permission helpers (same pattern as CRM routes) ───────────────────────────
function isCrmUser(req: any): boolean {
  return !!(req.session.isAdmin || req.session.role === "sub_agent");
}

async function canAccessLeadWhatsApp(req: any, leadId: number): Promise<boolean> {
  if (req.session.isAdmin) return true;
  if (req.session.role !== "sub_agent") return false;
  const [lead] = await db
    .select({ assignedTo: crmLeads.assignedTo })
    .from(crmLeads)
    .where(eq(crmLeads.id, leadId))
    .limit(1);
  return lead?.assignedTo === req.session.userId;
}

// ── Register routes ───────────────────────────────────────────────────────────
export function registerWhatsappAiRoutes(app: Express): void {

  /**
   * GET /api/admin/whatsapp-ai/lead/:leadId
   * Returns full conversation + messages + agent report.
   * Access: admin (any lead) | sub_agent (only assigned leads)
   */
  app.get(
    "/api/admin/whatsapp-ai/lead/:leadId",
    async (req: Request, res: Response) => {
      if (!isCrmUser(req)) {
        return res.status(403).json({ message: "Forbidden" });
      }

      const leadId = Number(req.params.leadId);
      if (!leadId) return res.status(400).json({ message: "Invalid lead id" });

      const allowed = await canAccessLeadWhatsApp(req, leadId);
      if (!allowed) {
        console.log(
          `[WhatsAppAI] Access denied leadId=${leadId} userId=${req.session.userId}`
        );
        return res
          .status(403)
          .json({ message: "Access denied — lead not assigned to you" });
      }

      if (req.session.isAdmin) {
        console.log(`[WhatsAppAI] Admin transcript access granted leadId=${leadId}`);
      } else {
        console.log(
          `[WhatsAppAI] Agent transcript access granted leadId=${leadId} agentId=${req.session.userId}`
        );
      }

      const data = await getConversationData(leadId);
      return res.json(data);
    }
  );

  /**
   * POST /api/admin/whatsapp-ai/lead/:leadId/report/generate
   * Regenerates the AI agent report using OpenAI.
   * Access: admin only
   */
  app.post(
    "/api/admin/whatsapp-ai/lead/:leadId/report/generate",
    async (req: Request, res: Response) => {
      if (!req.session.isAdmin) {
        return res.status(403).json({ message: "Admin only" });
      }

      const leadId = Number(req.params.leadId);
      if (!leadId) return res.status(400).json({ message: "Invalid lead id" });

      const result = await generateAiReport(leadId);
      if (!result.success) {
        return res.status(400).json({ message: result.message });
      }

      const data = await getConversationData(leadId);
      return res.json({ message: result.message, ...data });
    }
  );

  /**
   * PATCH /api/admin/whatsapp-ai/lead/:leadId/status
   * Update conversation status: needs_human | stopped | active | draft
   * Access: admin only
   */
  app.patch(
    "/api/admin/whatsapp-ai/lead/:leadId/status",
    async (req: Request, res: Response) => {
      if (!req.session.isAdmin) {
        return res.status(403).json({ message: "Admin only" });
      }

      const leadId = Number(req.params.leadId);
      if (!leadId) return res.status(400).json({ message: "Invalid lead id" });

      const { status, handoff_reason } = req.body as {
        status: string;
        handoff_reason?: string;
      };

      const valid = ["draft", "active", "completed", "needs_human", "stopped"];
      if (!valid.includes(status)) {
        return res
          .status(400)
          .json({ message: `Invalid status. Must be one of: ${valid.join(", ")}` });
      }

      const [conv] = await db
        .select({ id: whatsappAiConversations.id })
        .from(whatsappAiConversations)
        .where(eq(whatsappAiConversations.leadId, leadId))
        .limit(1);

      if (!conv) {
        return res.status(404).json({ message: "No conversation found for this lead" });
      }

      await db
        .update(whatsappAiConversations)
        .set({
          status,
          handoffReason: handoff_reason ?? null,
          updatedAt: new Date(),
        })
        .where(eq(whatsappAiConversations.id, conv.id));

      console.log(
        `[WhatsAppAI] Conversation status updated leadId=${leadId} status=${status}`
      );

      const data = await getConversationData(leadId);
      return res.json(data);
    }
  );

  /**
   * PATCH /api/admin/whatsapp-ai/lead/:leadId/report
   * Admin can manually edit individual report fields.
   * Access: admin only
   */
  app.patch(
    "/api/admin/whatsapp-ai/lead/:leadId/report",
    async (req: Request, res: Response) => {
      if (!req.session.isAdmin) {
        return res.status(403).json({ message: "Admin only" });
      }

      const leadId = Number(req.params.leadId);
      if (!leadId) return res.status(400).json({ message: "Invalid lead id" });

      const allowed = [
        "summaryText", "clientInterest", "country", "city", "budget",
        "propertyType", "paymentMethod", "investmentGoal", "buyingTimeframe",
        "bestCallTime", "priorityScore", "recommendedNextAction",
      ];

      const patch: Record<string, any> = { updatedAt: new Date() };
      for (const key of allowed) {
        if (key in req.body) patch[key] = req.body[key];
      }

      const [existing] = await db
        .select({ id: whatsappAiAgentReports.id })
        .from(whatsappAiAgentReports)
        .where(eq(whatsappAiAgentReports.leadId, leadId))
        .limit(1);

      if (!existing) {
        return res.status(404).json({ message: "No report found for this lead" });
      }

      await db
        .update(whatsappAiAgentReports)
        .set(patch)
        .where(eq(whatsappAiAgentReports.id, existing.id));

      const data = await getConversationData(leadId);
      return res.json(data);
    }
  );
}
