import { Resend } from "resend";
import { db } from "./db";
import { notificationTemplates, notificationLogs, users, crmLeads } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import pg from "pg";
const { Pool } = pg;

const FROM = "Kinglike Luxury <info@kinglikeluxury.app>";

async function getResendKey(): Promise<string | null> {
  const key = process.env.RESEND_API_KEY;
  if (key) return key;
  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const r = await pool.query("SELECT value FROM app_settings WHERE key='RESEND_API_KEY'");
    await pool.end();
    if (r.rows.length > 0) return r.rows[0].value;
  } catch {}
  return null;
}

let _resend: Resend | null = null;
async function getResend(): Promise<Resend | null> {
  if (_resend) return _resend;
  const key = await getResendKey();
  if (!key) return null;
  _resend = new Resend(key);
  return _resend;
}

export async function isEmailConfigured(): Promise<boolean> {
  const key = await getResendKey();
  return !!key;
}

const DEFAULT_TEMPLATES: Record<string, { subject: string; bodyHtml: string; bodyText: string }> = {
  welcome: {
    subject: "مرحباً بك في Kinglike Luxury 🏡",
    bodyText: "مرحباً {{username}}! أهلاً بك في Kinglike Luxury — منصة العقارات الفاخرة.",
    bodyHtml: `
<div style="background:#f0f9f9;padding:40px 20px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,84,118,0.10)">
    <div style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);padding:48px 40px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:30px;font-weight:800;letter-spacing:-0.5px">Kinglike Luxury</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:15px">منصة العقارات الفاخرة</p>
    </div>
    <div style="padding:40px">
      <h2 style="color:#005476;margin-top:0">أهلاً {{username}}! 👋</h2>
      <p style="color:#555;line-height:1.9;font-size:15px">
        يسعدنا انضمامك إلى <strong>Kinglike Luxury</strong> — وجهتك الأولى للعقارات الفاخرة في المنطقة.
      </p>
      <p style="color:#555;line-height:1.9;font-size:15px">
        اكتشف الآن أجمل الشقق والفلل والأراضي الفاخرة في <strong>جورجيا، أذربيجان، وتركيا</strong>.
      </p>
      <div style="text-align:center;margin:32px 0">
        <a href="https://kinglikeluxury.app" style="display:inline-block;background:linear-gradient(135deg,#3bcac4,#005476);color:#fff;padding:15px 40px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px">
          استكشف العقارات →
        </a>
      </div>
      <p style="color:#888;font-size:13px;text-align:center">إذا لم تقم بالتسجيل يمكنك تجاهل هذا الإيميل.</p>
    </div>
    <div style="background:#f0f9f9;padding:24px;text-align:center;color:#999;font-size:12px">
      <p style="margin:0">© Kinglike Luxury Real Estate Platform</p>
    </div>
  </div>
</div>`,
  },
  weekly_update: {
    subject: "أحدث العقارات الفاخرة هذا الأسبوع 🏙️",
    bodyText: "مرحباً {{username}}! اكتشف أحدث العقارات المتاحة هذا الأسبوع على Kinglike Luxury.",
    bodyHtml: `
<div style="background:#f0f9f9;padding:40px 20px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,84,118,0.10)">
    <div style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);padding:40px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800">أحدث العروض الأسبوعية</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0">Kinglike Luxury</p>
    </div>
    <div style="padding:40px">
      <h2 style="color:#005476;margin-top:0">مرحباً {{username}}!</h2>
      <p style="color:#555;line-height:1.9;font-size:15px">إليك أحدث العقارات الفاخرة المتاحة هذا الأسبوع على منصتنا.</p>
      <div style="background:#f0f9f9;border-radius:12px;padding:24px;margin:24px 0">
        <p style="color:#3bcac4;font-weight:bold;margin:0 0 12px;font-size:16px">🏠 عقارات جديدة بانتظارك</p>
        <p style="color:#555;line-height:1.8;margin:0">شقق فاخرة، فيلات راقية، وأراضٍ استثمارية في أفضل المواقع.</p>
      </div>
      <div style="text-align:center;margin:32px 0">
        <a href="https://kinglikeluxury.app/properties" style="display:inline-block;background:linear-gradient(135deg,#3bcac4,#005476);color:#fff;padding:15px 40px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px">
          عرض جميع العقارات →
        </a>
      </div>
    </div>
    <div style="background:#f0f9f9;padding:24px;text-align:center;color:#999;font-size:12px">
      <p style="margin:0">© Kinglike Luxury | <a href="https://kinglikeluxury.app" style="color:#3bcac4;text-decoration:none">إلغاء الاشتراك</a></p>
    </div>
  </div>
</div>`,
  },
  inactive_reminder: {
    subject: "نشتاق إليك! 💎 عروض حصرية بانتظارك",
    bodyText: "مرحباً {{username}}! لاحظنا غيابك. لا تفوّت أحدث العروض العقارية الفاخرة على Kinglike Luxury.",
    bodyHtml: `
<div style="background:#f0f9f9;padding:40px 20px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,84,118,0.10)">
    <div style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);padding:40px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:26px;font-weight:800">نشتاق إليك! 💎</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0">Kinglike Luxury</p>
    </div>
    <div style="padding:40px">
      <h2 style="color:#005476;margin-top:0">مرحباً {{username}}!</h2>
      <p style="color:#555;line-height:1.9;font-size:15px">لاحظنا أنك لم تزرنا منذ فترة — ونحن نشتاق إليك!</p>
      <p style="color:#555;line-height:1.9;font-size:15px">لديك الكثير من العقارات الجديدة والعروض الحصرية التي لم تراها بعد.</p>
      <div style="background:#fff5f5;border:2px solid #3bcac4;border-radius:12px;padding:24px;margin:24px 0;text-align:center">
        <p style="color:#005476;font-weight:bold;margin:0 0 8px;font-size:18px">عروض حصرية لا تفوتها!</p>
        <p style="color:#555;margin:0;font-size:14px">عقارات VIP جديدة بأسعار تنافسية</p>
      </div>
      <div style="text-align:center;margin:32px 0">
        <a href="https://kinglikeluxury.app" style="display:inline-block;background:linear-gradient(135deg,#3bcac4,#005476);color:#fff;padding:15px 40px;border-radius:10px;text-decoration:none;font-weight:bold;font-size:16px">
          عد الآن واستكشف →
        </a>
      </div>
    </div>
    <div style="background:#f0f9f9;padding:24px;text-align:center;color:#999;font-size:12px">
      <p style="margin:0">© Kinglike Luxury Real Estate Platform</p>
    </div>
  </div>
</div>`,
  },
};

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export async function getOrCreateTemplate(type: string, trigger: string) {
  const [existing] = await db
    .select()
    .from(notificationTemplates)
    .where(and(eq(notificationTemplates.type, type), eq(notificationTemplates.trigger, trigger)));

  if (existing) return existing;

  const def = DEFAULT_TEMPLATES[trigger];
  if (!def) return null;

  const [created] = await db
    .insert(notificationTemplates)
    .values({ type, trigger, subject: def.subject, bodyHtml: def.bodyHtml, bodyText: def.bodyText, isActive: true })
    .returning();
  return created;
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

export async function sendWelcomeEmail(user: { id: number; username: string; email?: string | null }) {
  if (!user.email) return;
  const resend = await getResend();
  if (!resend) {
    console.log("[Email] Resend not configured — skipping welcome email for", user.email);
    return;
  }

  const template = await getOrCreateTemplate("email", "welcome");
  if (!template || !template.isActive) return;

  const vars = { username: user.username };
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: user.email,
      subject: fillTemplate(template.subject ?? "", vars),
      html: fillTemplate(template.bodyHtml ?? "", vars),
      text: fillTemplate(template.bodyText ?? "", vars),
    });
    if (result.error) throw new Error(result.error.message);
    await logNotification({ userId: user.id, type: "email", trigger: "welcome", recipient: user.email, status: "sent" });
    console.log("[Email] ✅ Welcome email sent to", user.email);
  } catch (err: any) {
    await logNotification({ userId: user.id, type: "email", trigger: "welcome", recipient: user.email, status: "failed", error: err.message });
    console.error("[Email] ❌ Welcome email failed:", err.message);
  }
}

export async function sendEmailOtp(email: string, code: string): Promise<void> {
  const resend = await getResend();
  if (!resend) {
    throw new Error("Email service not configured");
  }
  const html = `
<div style="background:#f0f9f9;padding:40px 20px;font-family:Arial,Helvetica,sans-serif">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,84,118,0.10)">
    <div style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);padding:40px;text-align:center">
      <h1 style="color:#fff;margin:0;font-size:28px;font-weight:800">Kinglike Luxury</h1>
      <p style="color:rgba(255,255,255,0.85);margin:8px 0 0;font-size:14px">Email Verification</p>
    </div>
    <div style="padding:40px;text-align:center">
      <h2 style="color:#005476;margin-top:0">Your Verification Code</h2>
      <div style="background:#f0f9f9;border-radius:12px;padding:24px;margin:24px 0">
        <p style="font-size:40px;font-weight:900;color:#005476;letter-spacing:10px;margin:0">${code}</p>
      </div>
      <p style="color:#555;font-size:14px">This code is valid for <strong>10 minutes</strong>.</p>
      <p style="color:#888;font-size:12px;margin-top:20px">If you did not request this code, please ignore this email.</p>
    </div>
    <div style="background:#f0f9f9;padding:20px;text-align:center;color:#999;font-size:12px">
      <p style="margin:0">&copy; Kinglike Luxury Real Estate Platform</p>
    </div>
  </div>
</div>`;

  const result = await resend.emails.send({
    from: FROM,
    to: email,
    subject: `Kinglike Luxury — Verification Code: ${code}`,
    html,
    text: `Your Kinglike Luxury verification code is: ${code}\n\nValid for 10 minutes.`,
  });
  if (result.error) throw new Error(result.error.message);
  console.log(`[Email] ✅ Email OTP sent to ${email}`);
}

export async function sendNewPropertyNotification(property: {
  id: number;
  title: string;
  propertyType: string;
  price: number;
  location: string;
  ownerName?: string;
  ownerEmail?: string | null;
  ownerPhone?: string | null;
}) {
  const ADMIN_EMAIL = "info@kinglikeluxury.app";

  const typeLabels: Record<string, string> = {
    apartment: "شقة / Apartment",
    villa: "فيلا / Villa",
    land: "أرض / Land",
    commercial: "تجاري / Commercial",
    project: "مشروع / Project",
  };

  const priceFormatted = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
  }).format(property.price);

  const html = `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;direction:rtl">
  <div style="background:linear-gradient(135deg,#3bcac4,#005476);padding:30px;border-radius:12px 12px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px">🏠 عقار جديد يحتاج موافقة</h1>
    <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:14px">New Property Pending Approval</p>
  </div>
  <div style="background:#f9fafb;padding:28px;border:1px solid #e5e7eb">
    <table style="width:100%;border-collapse:collapse">
      <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%">رقم العقار / ID</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-weight:bold;color:#111827">#${property.id}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">العنوان / Title</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-weight:bold;color:#111827">${property.title}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">النوع / Type</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827">${typeLabels[property.propertyType] || property.propertyType}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">السعر / Price</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#005476;font-weight:bold">${priceFormatted}</td></tr>
      <tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">الموقع / Location</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827">${property.location}</td></tr>
      ${property.ownerName ? `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">صاحب العقار</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827">${property.ownerName}</td></tr>` : ""}
      ${property.ownerPhone ? `<tr><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">الهاتف / Phone</td><td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827">${property.ownerPhone}</td></tr>` : ""}
      ${property.ownerEmail ? `<tr><td style="padding:10px 0;color:#6b7280">البريد / Email</td><td style="padding:10px 0;color:#111827">${property.ownerEmail}</td></tr>` : ""}
    </table>
    <div style="text-align:center;margin-top:28px">
      <a href="https://kinglikeluxury.app/admin/dashboard" style="background:linear-gradient(135deg,#3bcac4,#005476);color:#fff;padding:14px 30px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block">مراجعة العقار والموافقة عليه ←</a>
    </div>
  </div>
  <div style="background:#005476;padding:14px;border-radius:0 0 12px 12px;text-align:center">
    <p style="color:rgba(255,255,255,0.7);margin:0;font-size:12px">Kinglike Luxury · info@kinglikeluxury.app</p>
  </div>
</div>`;

  const resend = await getResend();
  if (!resend) {
    console.log("[Email] Resend not configured — skipping property notification #" + property.id);
    return;
  }
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: ADMIN_EMAIL,
      subject: `🏠 عقار جديد بحاجة للمراجعة — ${property.title}`,
      html,
    });
    if (result.error) throw new Error(result.error.message);
    console.log(`[Email] ✅ Property notification sent for #${property.id}`);
  } catch (err: any) {
    console.error(`[Email] ❌ Property notification failed for #${property.id}:`, err.message);
  }
}

/**
 * Send a welcome email to a newly created CRM lead.
 * Reuses the existing "welcome" email template — no new mailing engine created.
 */
export async function sendCrmWelcomeEmail(lead: { fullName?: string | null; firstName?: string | null; email: string }) {
  const resend = await getResend();
  if (!resend) {
    console.log("[Email] Resend not configured — skipping CRM welcome for", lead.email);
    return;
  }
  const template = await getOrCreateTemplate("email", "welcome");
  if (!template || !template.isActive) return;
  const name = lead.fullName || lead.firstName || "Valued Client";
  const vars = { username: name };
  try {
    const result = await resend.emails.send({
      from: FROM,
      to: lead.email,
      subject: fillTemplate(template.subject ?? "", vars),
      html: fillTemplate(template.bodyHtml ?? "", vars),
      text: fillTemplate(template.bodyText ?? "", vars),
    });
    if (result.error) throw new Error(result.error.message);
    await logNotification({ type: "email", trigger: "welcome", recipient: lead.email, status: "sent" });
    console.log("[Email] ✅ CRM welcome email sent to", lead.email);
  } catch (err: any) {
    await logNotification({ type: "email", trigger: "welcome", recipient: lead.email, status: "failed", error: err.message });
    console.error("[Email] ❌ CRM welcome email failed:", err.message);
  }
}

export async function sendBulkEmail(trigger: "weekly_update" | "inactive_reminder") {
  const resend = await getResend();
  if (!resend) {
    console.log("[Email] Resend not configured — skipping bulk send for", trigger);
    return { sent: 0, failed: 0, skipped: "not configured" };
  }

  const template = await getOrCreateTemplate("email", trigger);
  if (!template || !template.isActive) return { sent: 0, failed: 0, skipped: "template inactive" };

  const allUsers = await db.select().from(users);
  let targetUsers: { id: number; username: string; email: string | null }[] = allUsers.filter(u => u.email);

  if (trigger === "inactive_reminder") {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    targetUsers = targetUsers.filter(u => new Date(u.createdAt) < cutoff);
  }

  // For weekly_update: also include CRM leads who have an email, deduplicated
  if (trigger === "weekly_update") {
    const allLeads = await db.select().from(crmLeads);
    const userEmails = new Set(targetUsers.map(u => u.email?.toLowerCase()));
    const crmContacts = allLeads
      .filter(l => l.email?.trim() && !userEmails.has(l.email.toLowerCase()))
      .map(l => ({ id: 0, username: l.fullName || l.firstName || "Valued Client", email: l.email! }));
    targetUsers = [...targetUsers, ...crmContacts];
  }

  let sent = 0, failed = 0;
  for (const user of targetUsers) {
    if (!user.email) continue;
    const vars = { username: user.username };
    try {
      const result = await resend.emails.send({
        from: FROM,
        to: user.email,
        subject: fillTemplate(template.subject ?? "", vars),
        html: fillTemplate(template.bodyHtml ?? "", vars),
        text: fillTemplate(template.bodyText ?? "", vars),
      });
      if (result.error) throw new Error(result.error.message);
      if (user.id > 0) {
        await logNotification({ userId: user.id, type: "email", trigger, recipient: user.email, status: "sent" });
      }
      sent++;
      await new Promise(r => setTimeout(r, 200));
    } catch (err: any) {
      if (user.id > 0) {
        await logNotification({ userId: user.id, type: "email", trigger, recipient: user.email!, status: "failed", error: err.message });
      }
      failed++;
    }
  }

  console.log(`[Email] Bulk ${trigger}: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}

// ── CRM Admin Notifications ────────────────────────────────────────────────

const CRM_ADMIN_EMAIL = "info@kinglikeluxury.app";

/**
 * Notify the main admin when a sub-admin / employee modifies a CRM lead field.
 * Only fires when the changer is NOT the primary admin (isAdmin = false).
 * Handles both regular field changes and status changes (with optional reason note).
 */
export async function sendLeadChangeNotification(opts: {
  leadId: number;
  leadName: string;
  leadPhone: string;
  changedBy: string;
  changedAt: Date;
  changes: { field: string; label: string; oldValue: string; newValue: string }[];
  statusChangeNote?: string;
}): Promise<void> {
  const resend = await getResend();
  if (!resend) return;

  const { leadId, leadName, leadPhone, changedBy, changedAt, changes, statusChangeNote } = opts;

  const changedAtStr = changedAt.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const changeRows = changes.map(c => `
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;color:#6b7280;font-size:13px;width:30%">${c.label}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#dc2626;text-decoration:line-through">${c.oldValue || "—"}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #e5e7eb;font-size:13px;color:#005476;font-weight:600">${c.newValue || "—"}</td>
    </tr>`).join("");

  const noteBlock = statusChangeNote
    ? `<div style="margin-top:16px;background:#f0f9f9;border-left:4px solid #3bcac4;border-radius:0 8px 8px 0;padding:14px 18px">
         <p style="color:#005476;font-weight:700;margin:0 0 6px;font-size:13px">Status Change Reason</p>
         <p style="color:#374151;margin:0;font-size:14px;line-height:1.6">${statusChangeNote}</p>
       </div>` : "";

  const subject = `🔔 CRM Lead Modified — ${leadName}`;

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;background:#f0f9f9;padding:32px 16px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,84,118,0.10)">
    <div style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);padding:28px 32px">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:800">🔔 CRM Lead Modified</h1>
      <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px">Kinglike Luxury CRM — Admin Notification</p>
    </div>
    <div style="padding:28px 32px">
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
        <tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px;width:36%">Lead</td><td style="padding:7px 0;font-weight:700;color:#005476;font-size:15px">${leadName}</td></tr>
        <tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Phone</td><td style="padding:7px 0;color:#111827;font-size:14px">${leadPhone}</td></tr>
        <tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Changed by</td><td style="padding:7px 0;color:#111827;font-size:14px;font-weight:600">${changedBy}</td></tr>
        <tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Changed at</td><td style="padding:7px 0;color:#111827;font-size:14px">${changedAtStr}</td></tr>
      </table>
      <div style="background:#f9fafb;border-radius:10px;overflow:hidden;border:1px solid #e5e7eb">
        <div style="background:#005476;padding:10px 14px">
          <p style="color:#fff;font-weight:700;margin:0;font-size:13px">Changes</p>
        </div>
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#f3f4f6">
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">Field</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">Old Value</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px">New Value</th>
            </tr>
          </thead>
          <tbody>${changeRows}</tbody>
        </table>
      </div>
      ${noteBlock}
      <div style="text-align:center;margin-top:24px">
        <a href="https://kinglikeluxury.app/admin/crm/${leadId}" style="display:inline-block;background:linear-gradient(135deg,#3bcac4,#005476);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px">View Lead →</a>
      </div>
    </div>
    <div style="background:#005476;padding:14px 32px;text-align:center">
      <p style="color:rgba(255,255,255,0.65);margin:0;font-size:12px">Kinglike Luxury CRM · info@kinglikeluxury.app</p>
    </div>
  </div>
</div>`;

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: CRM_ADMIN_EMAIL,
      subject,
      html,
    });
    if (result.error) throw new Error(result.error.message);
    console.log(`[Email] ✅ Lead change notification sent for lead #${leadId} by ${changedBy}`);
  } catch (err: any) {
    console.error(`[Email] ❌ Lead change notification failed for lead #${leadId}:`, err.message);
  }
}

/**
 * Notify the main admin when a sub-admin / employee adds, updates, or deletes a CRM task.
 * Only fires when the changer is NOT the primary admin.
 */
export async function sendLeadTaskChangeNotification(opts: {
  leadId: number;
  leadName: string;
  leadPhone: string;
  changedBy: string;
  changedAt: Date;
  action: "added" | "updated" | "deleted";
  taskTitle: string;
  taskDetails?: string;
}): Promise<void> {
  const resend = await getResend();
  if (!resend) return;

  const { leadId, leadName, leadPhone, changedBy, changedAt, action, taskTitle, taskDetails } = opts;

  const changedAtStr = changedAt.toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  const actionLabel = action === "added" ? "Task Added" : action === "updated" ? "Task Updated" : "Task Deleted";
  const actionColor = action === "deleted" ? "#dc2626" : action === "updated" ? "#d97706" : "#16a34a";

  const subject = `🔔 CRM Task ${actionLabel} — ${leadName}`;

  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;background:#f0f9f9;padding:32px 16px">
  <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 2px 16px rgba(0,84,118,0.10)">
    <div style="background:linear-gradient(135deg,#3bcac4 0%,#005476 100%);padding:28px 32px">
      <h1 style="color:#fff;margin:0;font-size:20px;font-weight:800">🔔 CRM Task ${actionLabel}</h1>
      <p style="color:rgba(255,255,255,0.85);margin:6px 0 0;font-size:13px">Kinglike Luxury CRM — Admin Notification</p>
    </div>
    <div style="padding:28px 32px">
      <table style="width:100%;border-collapse:collapse;margin-bottom:22px">
        <tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px;width:36%">Lead</td><td style="padding:7px 0;font-weight:700;color:#005476;font-size:15px">${leadName}</td></tr>
        <tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Phone</td><td style="padding:7px 0;color:#111827;font-size:14px">${leadPhone}</td></tr>
        <tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Changed by</td><td style="padding:7px 0;color:#111827;font-size:14px;font-weight:600">${changedBy}</td></tr>
        <tr><td style="padding:7px 0;color:#9ca3af;font-size:12px;text-transform:uppercase;letter-spacing:.5px">Changed at</td><td style="padding:7px 0;color:#111827;font-size:14px">${changedAtStr}</td></tr>
      </table>
      <div style="background:#f9fafb;border-radius:10px;border:1px solid #e5e7eb;padding:18px 20px">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <span style="display:inline-block;background:${actionColor};color:#fff;font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;text-transform:uppercase;letter-spacing:.5px">${action}</span>
          <span style="color:#005476;font-weight:700;font-size:15px">${taskTitle}</span>
        </div>
        ${taskDetails ? `<p style="color:#6b7280;font-size:13px;margin:0;line-height:1.6">${taskDetails}</p>` : ""}
      </div>
      <div style="text-align:center;margin-top:24px">
        <a href="https://kinglikeluxury.app/admin/crm/${leadId}" style="display:inline-block;background:linear-gradient(135deg,#3bcac4,#005476);color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px">View Lead →</a>
      </div>
    </div>
    <div style="background:#005476;padding:14px 32px;text-align:center">
      <p style="color:rgba(255,255,255,0.65);margin:0;font-size:12px">Kinglike Luxury CRM · info@kinglikeluxury.app</p>
    </div>
  </div>
</div>`;

  try {
    const result = await resend.emails.send({
      from: FROM,
      to: CRM_ADMIN_EMAIL,
      subject,
      html,
    });
    if (result.error) throw new Error(result.error.message);
    console.log(`[Email] ✅ Task ${action} notification sent for lead #${leadId} by ${changedBy}`);
  } catch (err: any) {
    console.error(`[Email] ❌ Task notification failed for lead #${leadId}:`, err.message);
  }
}
