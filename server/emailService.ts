import nodemailer from "nodemailer";
import { db } from "./db";
import { notificationTemplates, notificationLogs, users } from "@shared/schema";
import { eq, and } from "drizzle-orm";

const GMAIL_USER = process.env.GMAIL_USER;
const GMAIL_PASS = process.env.GMAIL_APP_PASSWORD;

function createTransporter() {
  if (!GMAIL_USER || !GMAIL_PASS) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: GMAIL_USER, pass: GMAIL_PASS },
  });
}

export function isEmailConfigured(): boolean {
  return !!(GMAIL_USER && GMAIL_PASS);
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
      <p style="color:#555;line-height:1.9;font-size:15px">
        إليك أحدث العقارات الفاخرة المتاحة هذا الأسبوع على منصتنا.
      </p>
      <div style="background:#f0f9f9;border-radius:12px;padding:24px;margin:24px 0">
        <p style="color:#3bcac4;font-weight:bold;margin:0 0 12px;font-size:16px">🏠 عقارات جديدة بانتظارك</p>
        <p style="color:#555;line-height:1.8;margin:0">
          شقق فاخرة، فيلات راقية، وأراضٍ استثمارية في أفضل المواقع.
        </p>
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
      <p style="color:#555;line-height:1.9;font-size:15px">
        لاحظنا أنك لم تزرنا منذ فترة — ونحن نشتاق إليك!
      </p>
      <p style="color:#555;line-height:1.9;font-size:15px">
        لديك الكثير من العقارات الجديدة والعروض الحصرية التي لم تراها بعد.
      </p>
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
  const transporter = createTransporter();
  if (!transporter) {
    console.log("[Email] Gmail not configured — skipping welcome email for", user.email);
    return;
  }

  const template = await getOrCreateTemplate("email", "welcome");
  if (!template || !template.isActive) return;

  const vars = { username: user.username };
  try {
    await transporter.sendMail({
      from: `"Kinglike Luxury" <${GMAIL_USER}>`,
      to: user.email,
      subject: fillTemplate(template.subject ?? "", vars),
      html: fillTemplate(template.bodyHtml ?? "", vars),
      text: fillTemplate(template.bodyText ?? "", vars),
    });
    await logNotification({ userId: user.id, type: "email", trigger: "welcome", recipient: user.email, status: "sent" });
    console.log("[Email] Welcome email sent to", user.email);
  } catch (err: any) {
    await logNotification({ userId: user.id, type: "email", trigger: "welcome", recipient: user.email, status: "failed", error: err.message });
    console.error("[Email] Failed to send welcome email:", err.message);
  }
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
  const transporter = createTransporter();
  if (!transporter) {
    console.log("[Email] Gmail not configured — skipping admin notification for property #" + property.id);
    return;
  }

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
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280;width:40%">رقم العقار / ID</td>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-weight:bold;color:#111827">#${property.id}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">العنوان / Title</td>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;font-weight:bold;color:#111827">${property.title}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">النوع / Type</td>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827">${typeLabels[property.propertyType] || property.propertyType}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">السعر / Price</td>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#005476;font-weight:bold">${priceFormatted}</td>
      </tr>
      <tr>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">الموقع / Location</td>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827">${property.location}</td>
      </tr>
      ${property.ownerName ? `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">صاحب العقار</td>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827">${property.ownerName}</td>
      </tr>` : ""}
      ${property.ownerPhone ? `<tr>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#6b7280">الهاتف / Phone</td>
        <td style="padding:10px 0;border-bottom:1px solid #e5e7eb;color:#111827">${property.ownerPhone}</td>
      </tr>` : ""}
      ${property.ownerEmail ? `<tr>
        <td style="padding:10px 0;color:#6b7280">البريد / Email</td>
        <td style="padding:10px 0;color:#111827">${property.ownerEmail}</td>
      </tr>` : ""}
    </table>
    <div style="text-align:center;margin-top:28px">
      <a href="https://kinglikeluxury.app/admin/dashboard"
         style="background:linear-gradient(135deg,#3bcac4,#005476);color:#fff;padding:14px 30px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:15px;display:inline-block">
        مراجعة العقار والموافقة عليه ←
      </a>
    </div>
  </div>
  <div style="background:#005476;padding:14px;border-radius:0 0 12px 12px;text-align:center">
    <p style="color:rgba(255,255,255,0.7);margin:0;font-size:12px">Kinglike Luxury · info@kinglikeluxury.app</p>
  </div>
</div>`;

  try {
    await transporter.sendMail({
      from: `"Kinglike Luxury" <${GMAIL_USER}>`,
      to: ADMIN_EMAIL,
      subject: `🏠 عقار جديد بحاجة للمراجعة — ${property.title}`,
      html,
    });
    console.log(`[Email] Admin notification sent for property #${property.id}: "${property.title}"`);
  } catch (err: any) {
    console.error("[Email] Failed to send admin notification:", err.message);
  }
}

export async function sendBulkEmail(trigger: "weekly_update" | "inactive_reminder") {
  const transporter = createTransporter();
  if (!transporter) {
    console.log("[Email] Gmail not configured — skipping bulk send for", trigger);
    return { sent: 0, failed: 0, skipped: "not configured" };
  }

  const template = await getOrCreateTemplate("email", trigger);
  if (!template || !template.isActive) return { sent: 0, failed: 0, skipped: "template inactive" };

  const allUsers = await db.select().from(users);
  let targetUsers = allUsers.filter(u => u.email);

  if (trigger === "inactive_reminder") {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    targetUsers = targetUsers.filter(u => new Date(u.createdAt) < cutoff);
  }

  let sent = 0, failed = 0;
  for (const user of targetUsers) {
    const vars = { username: user.username };
    try {
      await transporter.sendMail({
        from: `"Kinglike Luxury" <${GMAIL_USER}>`,
        to: user.email!,
        subject: fillTemplate(template.subject ?? "", vars),
        html: fillTemplate(template.bodyHtml ?? "", vars),
        text: fillTemplate(template.bodyText ?? "", vars),
      });
      await logNotification({ userId: user.id, type: "email", trigger, recipient: user.email!, status: "sent" });
      sent++;
      await new Promise(r => setTimeout(r, 200));
    } catch (err: any) {
      await logNotification({ userId: user.id, type: "email", trigger, recipient: user.email!, status: "failed", error: err.message });
      failed++;
    }
  }

  console.log(`[Email] Bulk ${trigger}: ${sent} sent, ${failed} failed`);
  return { sent, failed };
}
