/**
 * Centralised notification service for Kinglike Luxury.
 * Handles Email (Resend), In-App, and Web Push notifications.
 * Every channel returns { sent: boolean, error?: string } so callers
 * can log or return delivery status to the admin.
 *
 * NOTE: SMS is intentionally removed from booking confirmations.
 * Twilio is only used for user authentication (OTP login).
 */

import { Resend } from "resend";
import webpush from "web-push";

// ── Web Push (VAPID) ─────────────────────────────────────────────────────────
const vapidPublicKey  = process.env.VAPID_PUBLIC_KEY;
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;
const vapidSubject    = process.env.VAPID_SUBJECT || "mailto:info@kinglikeluxury.app";

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
  console.log("[Push] VAPID keys configured ✓");
} else {
  console.warn("[Push] VAPID keys not configured — push notifications disabled");
}

export interface NotifResult {
  sent: boolean;
  error?: string;
  sid?: string;
  id?: number;
}

// ── Resend Email ─────────────────────────────────────────────────────────────
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<NotifResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    const err = "RESEND_API_KEY not configured";
    console.warn(`[Email] ${err}`);
    return { sent: false, error: err };
  }
  if (!opts.to) {
    return { sent: false, error: "No recipient email" };
  }
  try {
    const resend = new Resend(key);
    const result = await resend.emails.send({
      from: "Kinglike Luxury <info@kinglikeluxury.app>",
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
    });
    if (result.error) {
      console.error(`[Email] ✗ Resend API error to ${opts.to}:`, result.error);
      return { sent: false, error: JSON.stringify(result.error) };
    }
    console.log(`[Email] ✓ Sent to ${opts.to} — ID: ${result.data?.id}`);
    return { sent: true, sid: result.data?.id };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`[Email] ✗ Exception sending to ${opts.to}: ${msg}`);
    return { sent: false, error: msg };
  }
}

// ── Web Push ─────────────────────────────────────────────────────────────────
export async function sendPushNotification(
  subscription: { endpoint: string; p256dh: string; auth: string },
  payload: { title: string; body: string; icon?: string; data?: Record<string, any> }
): Promise<NotifResult> {
  if (!vapidPublicKey || !vapidPrivateKey) {
    return { sent: false, error: "VAPID keys not configured" };
  }
  try {
    const pushSub = {
      endpoint: subscription.endpoint,
      keys: { p256dh: subscription.p256dh, auth: subscription.auth },
    };
    await webpush.sendNotification(pushSub, JSON.stringify(payload));
    console.log(`[Push] ✓ Sent to endpoint ${subscription.endpoint.slice(0, 60)}…`);
    return { sent: true };
  } catch (err: any) {
    const msg = err?.message || String(err);
    const statusCode = err?.statusCode;
    // 410 = subscription expired/unsubscribed, 404 = not found
    const isGone = statusCode === 410 || statusCode === 404;
    console.error(`[Push] ✗ Failed (${statusCode || "?"}): ${msg}`);
    return { sent: false, error: isGone ? "subscription_expired" : msg };
  }
}

// ── Email HTML templates ──────────────────────────────────────────────────────
const brandHeader = `
  <div style="background:linear-gradient(135deg,#3bcac4,#005476);padding:24px;text-align:center;border-radius:8px 8px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px;font-family:sans-serif;letter-spacing:0.5px">Kinglike Luxury</h1>
    <p style="color:rgba(255,255,255,0.8);font-size:12px;margin:4px 0 0;font-family:sans-serif">Real Estate — Premium Consultations</p>
  </div>`;

const brandFooter = `
  <div style="background:#f8f9fa;padding:16px;text-align:center;border-radius:0 0 8px 8px;font-family:sans-serif">
    <p style="color:#aaa;font-size:11px;margin:0">© Kinglike Luxury Real Estate · <a href="https://kinglikeluxury.app" style="color:#3bcac4;text-decoration:none">kinglikeluxury.app</a></p>
  </div>`;

function wrap(body: string): string {
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
    ${brandHeader}
    <div style="padding:28px 24px;background:#fff">${body}</div>
    ${brandFooter}
  </div>`;
}

function row(label: string, value: string, highlight = false): string {
  return `<tr style="border-bottom:1px solid #f3f4f6">
    <td style="padding:10px 4px;color:#6b7280;font-size:13px;width:42%">${label}</td>
    <td style="padding:10px 4px;font-size:13px;font-weight:${highlight ? "700" : "500"};color:${highlight ? "#005476" : "#111827"}">${value}</td>
  </tr>`;
}

export function buildConsultationConfirmEmail(opts: {
  type: string;
  method: string;
  date: string;
  time: string;
  meetingLink?: string;
  country: string;
  clientName?: string;
  whatsappNumber?: string;
}): string {
  const methodLabel = opts.method.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const typeLabel   = opts.type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const countryLabel = opts.country.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const isWhatsApp  = opts.method.startsWith("whatsapp");

  let connectionInfo = "";
  if (opts.meetingLink) {
    connectionInfo = `
      <div style="background:#f0fdfc;border:1px solid #99f6e4;border-radius:8px;padding:16px;margin:20px 0">
        <p style="margin:0 0 6px;font-size:13px;font-weight:700;color:#005476">🔗 Meeting Link</p>
        <a href="${opts.meetingLink}" style="color:#3bcac4;font-size:13px;word-break:break-all">${opts.meetingLink}</a>
      </div>`;
  } else if (isWhatsApp) {
    const waNum = opts.whatsappNumber || "your registered number";
    connectionInfo = `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:20px 0">
        <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#15803d">💬 WhatsApp Consultation</p>
        <p style="margin:0;font-size:13px;color:#166534">Our team will contact you via WhatsApp at <strong>${waNum}</strong> at the scheduled time.</p>
      </div>`;
  }

  return wrap(`
    <div style="text-align:center;margin-bottom:20px">
      <div style="display:inline-block;background:linear-gradient(135deg,#3bcac4,#005476);border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px">✅</div>
    </div>
    <h2 style="color:#005476;margin:0 0 4px;text-align:center;font-size:20px">Consultation Confirmed!</h2>
    <p style="color:#6b7280;text-align:center;margin:0 0 24px;font-size:14px">
      ${opts.clientName ? `Dear ${opts.clientName}, your` : "Your"} consultation with Kinglike Luxury has been confirmed.
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:4px">
      ${opts.clientName ? row("Client Name", opts.clientName) : ""}
      ${row("Country", countryLabel)}
      ${row("Consultation Type", typeLabel, true)}
      ${row("Date", opts.date, true)}
      ${row("Time", opts.time, true)}
      ${row("Method", methodLabel)}
      ${opts.whatsappNumber ? row("WhatsApp Number", opts.whatsappNumber) : ""}
    </table>
    ${connectionInfo}
    <p style="color:#6b7280;font-size:12px;margin-top:20px">
      If you have any questions, please contact us via WhatsApp or email at <a href="mailto:info@kinglikeluxury.app" style="color:#3bcac4">info@kinglikeluxury.app</a>
    </p>
  `);
}

export function buildConsultationBookedEmail(opts: {
  type: string;
  method: string;
  date: string;
  time: string;
  country: string;
  clientName?: string;
  whatsappNumber?: string;
}): string {
  const methodLabel  = opts.method.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const typeLabel    = opts.type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const countryLabel = opts.country.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return wrap(`
    <h2 style="color:#005476;margin-top:0">📅 Consultation Booking Received</h2>
    <p style="color:#374151">
      ${opts.clientName ? `Dear ${opts.clientName}, thank` : "Thank"} you for booking a consultation with <strong>Kinglike Luxury</strong>. We will confirm your appointment shortly.
    </p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      ${opts.clientName ? row("Client Name", opts.clientName) : ""}
      ${row("Country", countryLabel)}
      ${row("Consultation Type", typeLabel, true)}
      ${row("Date", opts.date, true)}
      ${row("Time", opts.time, true)}
      ${row("Method", methodLabel)}
      ${opts.whatsappNumber ? row("WhatsApp Number", opts.whatsappNumber) : ""}
    </table>
    <div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:14px;margin-top:16px">
      <p style="margin:0;font-size:13px;color:#92400e">⏳ Our team will review your booking and send a confirmation email within 24 hours.</p>
    </div>
  `);
}
