/**
 * WhatsApp Notification Service
 *
 * Sends automated WhatsApp messages (welcome, weekly_update, inactive_reminder)
 * via Meta Cloud API — NOT Twilio.
 *
 * Twilio is kept only for SMS/OTP delivery (see server/routes.ts).
 */

import { db } from "./db";
import { notificationTemplates, notificationLogs, users } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getOrCreateTemplate } from "./emailService";
import { sendMetaWhatsApp, isMetaWhatsAppConfigured } from "./services/metaWhatsAppService";

// ── Re-export so callers that check this flag still work ──────────────────────

export function isWhatsAppConfigured(): boolean {
  return isMetaWhatsAppConfigured();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

async function logNotification(params: {
  userId?:   number;
  type:      string;
  trigger:   string;
  recipient?: string;
  status:    string;
  error?:    string;
}) {
  try {
    await db.insert(notificationLogs).values(params);
  } catch { /* non-critical */ }
}

// ── Default message templates ─────────────────────────────────────────────────

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

// ── Public API ────────────────────────────────────────────────────────────────

export async function sendWelcomeWhatsApp(user: {
  id:             number;
  username:       string;
  phoneNumber?:   string | null;
  whatsappNumber?: string | null;
}) {
  const phone = user.whatsappNumber || user.phoneNumber;
  if (!phone) return;

  if (!isMetaWhatsAppConfigured()) {
    console.log("[WhatsApp] Meta not configured — skipping welcome for", phone);
    return;
  }

  const template = await getOrCreateTemplate("whatsapp", "welcome");
  if (!template || !template.isActive) return;

  const body = fillTemplate(
    template.bodyText ?? DEFAULT_WHATSAPP_TEXTS.welcome,
    { username: user.username }
  );

  const result = await sendMetaWhatsApp(phone, body, "welcome");

  await logNotification({
    userId:    user.id,
    type:      "whatsapp",
    trigger:   "welcome",
    recipient: phone,
    status:    result.success ? "sent" : "failed",
    error:     result.error,
  });
}

export async function sendBulkWhatsApp(trigger: "weekly_update" | "inactive_reminder") {
  if (!isMetaWhatsAppConfigured()) {
    console.log("[WhatsApp] Meta not configured — skipping bulk", trigger);
    return { sent: 0, failed: 0, skipped: "not configured" };
  }

  const template = await getOrCreateTemplate("whatsapp", trigger);
  if (!template || !template.isActive) {
    return { sent: 0, failed: 0, skipped: "template inactive" };
  }

  const allUsers = await db.select().from(users);
  let targetUsers = allUsers.filter(u => u.phoneNumber || u.whatsappNumber);

  if (trigger === "inactive_reminder") {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    targetUsers = targetUsers.filter(u => new Date(u.createdAt) < cutoff);
  }

  let sent = 0, failed = 0;

  for (const user of targetUsers) {
    const phone = user.whatsappNumber || user.phoneNumber!;
    const body  = fillTemplate(
      template.bodyText ?? DEFAULT_WHATSAPP_TEXTS[trigger],
      { username: user.username }
    );

    const result = await sendMetaWhatsApp(phone, body, trigger);

    await logNotification({
      userId:    user.id,
      type:      "whatsapp",
      trigger,
      recipient: phone,
      status:    result.success ? "sent" : "failed",
      error:     result.error,
    });

    if (result.success) { sent++; } else { failed++; }

    // Respect Meta rate limits — short pause between sends
    await new Promise(r => setTimeout(r, 200));
  }

  console.log(`[WhatsApp] Bulk ${trigger}: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}
