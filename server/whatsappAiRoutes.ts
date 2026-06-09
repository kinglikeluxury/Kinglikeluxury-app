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
   * POST /api/admin/whatsapp-ai/lead/:leadId/init
   * Creates a draft conversation for a lead that doesn't have one yet.
   * Access: admin only
   */
  app.post(
    "/api/admin/whatsapp-ai/lead/:leadId/init",
    async (req: Request, res: Response) => {
      if (!req.session.isAdmin) {
        return res.status(403).json({ message: "Admin only" });
      }
      const leadId = Number(req.params.leadId);
      if (!leadId) return res.status(400).json({ message: "Invalid lead id" });

      const [lead] = await db
        .select()
        .from(crmLeads)
        .where(eq(crmLeads.id, leadId))
        .limit(1);

      if (!lead) return res.status(404).json({ message: "Lead not found" });

      const { initConversationForLead } = await import("./whatsappAiService");
      await initConversationForLead(lead.id, {
        fullName:        lead.fullName,
        firstName:       lead.firstName,
        phone:           lead.phone,
        country:         lead.country,
        city:            lead.city,
        budget:          lead.budget,
        projectInterest: lead.projectInterest,
        assignedTo:      lead.assignedTo,
      });

      const data = await getConversationData(leadId);
      return res.json(data);
    }
  );

  /**
   * POST /api/admin/whatsapp-ai/backfill
   * Creates draft conversations for ALL CRM leads that don't have one.
   * Access: admin only
   */
  app.post(
    "/api/admin/whatsapp-ai/backfill",
    async (req: Request, res: Response) => {
      if (!req.session.isAdmin) {
        return res.status(403).json({ message: "Admin only" });
      }
      const { pool } = await import("./db");
      const { initConversationForLead } = await import("./whatsappAiService");

      const client = await pool.connect();
      let processed = 0;
      let skipped = 0;
      let errors = 0;
      try {
        const { rows } = await client.query(`
          SELECT cl.id, cl.full_name, cl.first_name, cl.phone, cl.country,
                 cl.city, cl.budget, cl.project_interest, cl.assigned_to
          FROM crm_leads cl
          WHERE NOT EXISTS (
            SELECT 1 FROM whatsapp_ai_conversations wc WHERE wc.lead_id = cl.id
          )
          ORDER BY cl.id
        `);
        console.log(`[WhatsAppAI][Backfill] ${rows.length} leads need conversations`);
        for (const l of rows) {
          try {
            await initConversationForLead(l.id, {
              fullName:        l.full_name,
              firstName:       l.first_name,
              phone:           l.phone,
              country:         l.country,
              city:            l.city,
              budget:          l.budget,
              projectInterest: l.project_interest,
              assignedTo:      l.assigned_to,
            });
            processed++;
          } catch (err: any) {
            console.error(`[WhatsAppAI][Backfill] lead=${l.id} error: ${err.message}`);
            errors++;
          }
        }
        skipped = 0;
      } finally {
        client.release();
      }
      console.log(`[WhatsAppAI][Backfill] done — processed=${processed} errors=${errors}`);
      return res.json({ processed, skipped, errors });
    }
  );

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

  // ── Preview / Prompt Inspection endpoints (admin only) ────────────────────

  const SYSTEM_PROMPT = `أنت خالد — عضو في فريق Kinglike Luxury للعقارات الفاخرة.
أسلوبك: إنساني، دافئ، محترف، صبور، طبيعي — كأنك صديق خبير يتحدث عبر واتساب.

ترتيب الأسئلة (سؤال واحد فقط في كل رسالة):
1. الهدف: استثمار / سكن / عطلات
2. الدولة المفضلة
3. المدينة أو المنطقة
4. نوع العقار
5. الميزانية
6. طريقة الدفع
7. الإطار الزمني للشراء
8. أفضل وقت للتواصل

القواعد الصارمة:
- العربية الفصحى المعاصرة، رسائل قصيرة مناسبة لواتساب.
- السؤال الأول دائماً: الاستثمار أم السكن أم قضاء العطلات.
- لا تسأل عن الدولة أو الميزانية أو المدينة في الرسالة الأولى.
- لا تقل "أنا مستشارك" أو "خبير استثماري" أو "مستشار قانوني".
- لا تذكر أسعاراً أو ضمانات أو عوائد استثمارية أو نسب ربح.
- لا تفضّل دولة على أخرى، ولا مشروعاً على آخر، ولا مدينة على أخرى.
- لا تعطِ نصائح قانونية أو ضريبية أو هجرة أو إقامة أو جنسية.
- لا ترسل روابط خارجية أو روابط مشاريع أو روابط مطورين إطلاقاً.`;

  async function aiCall(messages: { role: "system" | "user" | "assistant"; content: string }[], maxTokens = 800): Promise<string> {
    const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY not set");
    const OpenAI = (await import("openai")).default;
    const client = new OpenAI({ apiKey });
    const r = await client.chat.completions.create({
      model: "gpt-4o",
      messages,
      max_tokens: maxTokens,
      temperature: 0.75,
      response_format: { type: "json_object" },
    });
    return r.choices[0]?.message?.content ?? "{}";
  }

  /**
   * POST /api/admin/whatsapp-ai/preview/opening
   * Generate 5 opening message examples. Admin only.
   */
  app.post("/api/admin/whatsapp-ai/preview/opening", async (req: Request, res: Response) => {
    if (!(req as any).session?.isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const raw = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `أنشئ 5 رسائل واتساب ترحيبية مختلفة لعملاء جدد. كل رسالة يجب أن:\n` +
            `- تبدأ بالتحية المناسبة (باستخدام الاسم الأول إذا متوفر، أو "أستاذي" إذا غير متوفر) مع إيموجي 🌷\n` +
            `- تشكر العميل على اهتمامه بالعقارات مع Kinglike Luxury\n` +
            `- تعرّف بنفسك: خالد من فريق Kinglike Luxury (لا تقل مستشار أو خبير)\n` +
            `- تنهي بالسؤال الأول الإلزامي: هل تبحث عن عقار بهدف الاستثمار أم السكن أم قضاء العطلات؟\n` +
            `- لا تسأل عن الدولة أو المدينة أو الميزانية\n\n` +
            `استخدم أسماء متنوعة: أحمد، سارة، محمد، فاطمة، (بلا اسم).\n\n` +
            `أعد JSON بهذا الشكل بالضبط:\n` +
            `{"examples":[{"name":"أحمد","message":"..."},{"name":"سارة","message":"..."},{"name":"محمد","message":"..."},{"name":"فاطمة","message":"..."},{"name":"(بلا اسم)","message":"..."}]}`,
        },
      ], 1200);
      return res.json(JSON.parse(raw));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  /**
   * POST /api/admin/whatsapp-ai/preview/recovery
   * Generate 5 No Answer 3 recovery examples. Admin only.
   */
  app.post("/api/admin/whatsapp-ai/preview/recovery", async (req: Request, res: Response) => {
    if (!(req as any).session?.isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const raw = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `أنشئ 5 رسائل استرداد لعملاء لم يردوا (No Answer 3). كل رسالة تبدأ بـ 🌷\n` +
            `القواعد: لا تقل "اتصلنا بك 3 مرات"، لا لوم، لا ضغط، إنساني ودافئ.\n\n` +
            `السيناريوهات:\n` +
            `1. عميل عام (لا توجد معلومات)\n` +
            `2. عميل مهتم بالعقارات في جورجيا\n` +
            `3. عميل مهتم بباتومي تحديداً\n` +
            `4. عميل مهتم بتبليسي تحديداً\n` +
            `5. عميل معروفة ميزانيته (100,000 - 200,000 دولار)\n\n` +
            `أعد JSON:\n` +
            `{"examples":[{"scenario":"عميل عام","name":"أستاذي","message":"..."},{"scenario":"مهتم بجورجيا","name":"أحمد","message":"..."},{"scenario":"مهتم بباتومي","name":"سارة","message":"..."},{"scenario":"مهتم بتبليسي","name":"محمد","message":"..."},{"scenario":"ميزانية معروفة","name":"فاطمة","message":"..."}]}`,
        },
      ], 1400);
      return res.json(JSON.parse(raw));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  /**
   * POST /api/admin/whatsapp-ai/preview/flow
   * Generate sample AI question for each qualification step. Admin only.
   */
  app.post("/api/admin/whatsapp-ai/preview/flow", async (req: Request, res: Response) => {
    if (!(req as any).session?.isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const raw = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `أنشئ سؤالاً واتساب نموذجياً لكل خطوة من خطوات التأهيل الـ8 أدناه.\n` +
            `كل سؤال يجب أن يكون قصيراً وطبيعياً كأنك تتحدث مع صديق.\n\n` +
            `أعد JSON:\n` +
            `{"steps":[\n` +
            `{"step":1,"topic":"الهدف","question":"..."},\n` +
            `{"step":2,"topic":"الدولة","question":"..."},\n` +
            `{"step":3,"topic":"المدينة","question":"..."},\n` +
            `{"step":4,"topic":"نوع العقار","question":"..."},\n` +
            `{"step":5,"topic":"الميزانية","question":"..."},\n` +
            `{"step":6,"topic":"طريقة الدفع","question":"..."},\n` +
            `{"step":7,"topic":"الإطار الزمني","question":"..."},\n` +
            `{"step":8,"topic":"أفضل وقت للتواصل","question":"..."}\n` +
            `]}`,
        },
      ], 900);
      return res.json(JSON.parse(raw));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });

  /**
   * POST /api/admin/whatsapp-ai/preview/simulate
   * Generate a full simulated qualification conversation. Admin only.
   */
  app.post("/api/admin/whatsapp-ai/preview/simulate", async (req: Request, res: Response) => {
    if (!(req as any).session?.isAdmin) return res.status(403).json({ message: "Admin only" });
    try {
      const raw = await aiCall([
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content:
            `أنشئ محادثة تأهيل كاملة بين خالد (AI) وعميل وهمي اسمه "عمر".\n` +
            `المحادثة يجب أن تغطي جميع خطوات التأهيل الـ8 بطريقة طبيعية وإنسانية.\n` +
            `عمر مهتم بشراء شقة للاستثمار في جورجيا، ميزانيته 150,000 دولار، يريد دفع نقدي.\n\n` +
            `أعد JSON:\n` +
            `{"turns":[{"sender":"ai","text":"..."},{"sender":"lead","text":"..."},...]}\n\n` +
            `استمر حتى اكتمال التأهيل (8-12 رسالة تقريباً).`,
        },
      ], 2000);
      return res.json(JSON.parse(raw));
    } catch (err: any) {
      return res.status(500).json({ message: err.message });
    }
  });
}
