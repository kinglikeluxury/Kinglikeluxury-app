import Twilio from "twilio";
import { db } from "./db";
import { notificationTemplates, notificationLogs, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { getOrCreateTemplate } from "./emailService";

const ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const AUTH_TOKEN  = process.env.TWILIO_AUTH_TOKEN;
const FROM_NUMBER = process.env.TWILIO_PHONE_NUMBER;

function getClient() {
  if (!ACCOUNT_SID || !AUTH_TOKEN) return null;
  return Twilio(ACCOUNT_SID, AUTH_TOKEN);
}

export function isWhatsAppConfigured(): boolean {
  return !!(ACCOUNT_SID && AUTH_TOKEN && FROM_NUMBER);
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

async function logNotification(params: {
  userId?: number;
  type: string;
  trigger: string;
  recipient?: string;
  status: string;
  error?: string;
}) {
  await db.insert(notificationLogs).values(params);
}

function toWhatsAppNumber(phone: string): string {
  const clean = phone.replace(/\s/g, "");
  const e164 = clean.startsWith("+") ? clean : `+${clean}`;
  return `whatsapp:${e164}`;
}

const DEFAULT_WHATSAPP_TEXTS: Record<string, string> = {
  welcome: `مرحباً *{{username}}*! 👋

أهلاً بك في *Kinglike Luxury* 🏡
منصتك الأولى للعقارات الفاخرة في:
🇬🇪 جورجيا | 🇦🇿 أذربيجان | 🇹🇷 تركيا

ابدأ استكشافك الآن:
🔗 https://kinglikeluxury.app

فريق Kinglike Luxury 💎`,

  weekly_update: `مرحباً *{{username}}*! 🏙️

*أحدث العقارات الفاخرة هذا الأسبوع*

اكتشف شققاً وفيلات وأراضي استثمارية جديدة بانتظارك على Kinglike Luxury.

👉 https://kinglikeluxury.app/properties

فريق Kinglike Luxury 💎`,

  inactive_reminder: `مرحباً *{{username}}* 💎

نشتاق إليك! لديك عروض عقارية حصرية لم تراها بعد.

🏠 عقارات VIP جديدة
✨ أسعار تنافسية
📍 أفضل المواقع

عد الآن:
🔗 https://kinglikeluxury.app

فريق Kinglike Luxury`,
};

export async function sendWelcomeWhatsApp(user: {
  id: number;
  username: string;
  phoneNumber?: string | null;
  whatsappNumber?: string | null;
}) {
  const phone = user.whatsappNumber || user.phoneNumber;
  if (!phone) return;

  const client = getClient();
  if (!client) {
    console.log("[WhatsApp] Twilio not configured — skipping welcome for", phone);
    return;
  }

  const template = await getOrCreateTemplate("whatsapp", "welcome");
  if (!template || !template.isActive) return;

  const body = fillTemplate(
    template.bodyText ?? DEFAULT_WHATSAPP_TEXTS.welcome,
    { username: user.username }
  );

  try {
    await client.messages.create({
      from: `whatsapp:${FROM_NUMBER}`,
      to: toWhatsAppNumber(phone),
      body,
    });
    await logNotification({ userId: user.id, type: "whatsapp", trigger: "welcome", recipient: phone, status: "sent" });
    console.log("[WhatsApp] Welcome sent to", phone);
  } catch (err: any) {
    await logNotification({ userId: user.id, type: "whatsapp", trigger: "welcome", recipient: phone, status: "failed", error: err.message });
    console.error("[WhatsApp] Failed welcome:", err.message);
  }
}

export async function sendBulkWhatsApp(trigger: "weekly_update" | "inactive_reminder") {
  const client = getClient();
  if (!client) {
    console.log("[WhatsApp] Twilio not configured — skipping bulk", trigger);
    return { sent: 0, failed: 0, skipped: "not configured" };
  }

  const template = await getOrCreateTemplate("whatsapp", trigger);
  if (!template || !template.isActive) return { sent: 0, failed: 0, skipped: "template inactive" };

  const allUsers = await db.select().from(users);
  let targetUsers = allUsers.filter(u => u.phoneNumber || u.whatsappNumber);

  if (trigger === "inactive_reminder") {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    targetUsers = targetUsers.filter(u => new Date(u.createdAt) < cutoff);
  }

  let sent = 0, failed = 0;
  for (const user of targetUsers) {
    const phone = user.whatsappNumber || user.phoneNumber!;
    const body = fillTemplate(
      template.bodyText ?? DEFAULT_WHATSAPP_TEXTS[trigger],
      { username: user.username }
    );
    try {
      await client.messages.create({
        from: `whatsapp:${FROM_NUMBER}`,
        to: toWhatsAppNumber(phone),
        body,
      });
      await logNotification({ userId: user.id, type: "whatsapp", trigger, recipient: phone, status: "sent" });
      sent++;
      await new Promise(r => setTimeout(r, 300));
    } catch (err: any) {
      await logNotification({ userId: user.id, type: "whatsapp", trigger, recipient: phone, status: "failed", error: err.message });
      failed++;
    }
  }

  console.log(`[WhatsApp] Bulk ${trigger}: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}
