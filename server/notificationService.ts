/**
 * Centralised notification service for Kinglike Luxury.
 * Handles SMS (Twilio), Email (Resend) and In-App notifications.
 * Every channel returns { sent: boolean, error?: string } so callers
 * can log or return delivery status to the admin.
 */

import Twilio from "twilio";
import { Resend } from "resend";

// ── Twilio ──────────────────────────────────────────────────────────────────
const twilioClient =
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
    ? Twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
    : null;

export interface NotifResult {
  sent: boolean;
  error?: string;
  sid?: string;
}

export async function sendSMS(to: string, body: string): Promise<NotifResult> {
  if (!twilioClient) {
    const err = "Twilio not configured (missing TWILIO_ACCOUNT_SID or TWILIO_AUTH_TOKEN)";
    console.warn(`[SMS] ${err}`);
    return { sent: false, error: err };
  }
  if (!to) {
    return { sent: false, error: "No recipient phone number" };
  }
  try {
    const msgSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
    const fromNumber = process.env.TWILIO_PHONE_NUMBER;
    const msgData: any = { body, to };
    if (msgSid) {
      msgData.messagingServiceSid = msgSid;
    } else if (fromNumber) {
      msgData.from = fromNumber;
    } else {
      return { sent: false, error: "No TWILIO_MESSAGING_SERVICE_SID or TWILIO_PHONE_NUMBER configured" };
    }
    const result = await twilioClient.messages.create(msgData);
    console.log(`[SMS] ✓ Sent to ${to} — SID: ${result.sid} Status: ${result.status}`);
    return { sent: true, sid: result.sid };
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error(`[SMS] ✗ Failed to ${to}: ${msg}`);
    return { sent: false, error: msg };
  }
}

// ── Resend Email ────────────────────────────────────────────────────────────
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

// ── Email HTML templates ────────────────────────────────────────────────────
const brandHeader = `
  <div style="background:linear-gradient(135deg,#3bcac4,#005476);padding:24px;text-align:center;border-radius:8px 8px 0 0">
    <h1 style="color:#fff;margin:0;font-size:22px;font-family:sans-serif">Kinglike Luxury</h1>
  </div>`;

const brandFooter = `
  <div style="background:#f8f9fa;padding:16px;text-align:center;border-radius:0 0 8px 8px;font-family:sans-serif">
    <p style="color:#aaa;font-size:11px;margin:0">© Kinglike Luxury Real Estate</p>
  </div>`;

function wrap(body: string): string {
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb">
    ${brandHeader}
    <div style="padding:24px;background:#fff">${body}</div>
    ${brandFooter}
  </div>`;
}

export function buildConsultationConfirmEmail(opts: {
  type: string;
  method: string;
  date: string;
  time: string;
  meetingLink?: string;
  country: string;
}): string {
  const methodLabel = opts.method.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const typeLabel = opts.type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  let connectionInfo = "";
  if (opts.meetingLink) {
    connectionInfo = `<p style="margin:12px 0"><strong>Meeting Link:</strong><br>
      <a href="${opts.meetingLink}" style="color:#3bcac4">${opts.meetingLink}</a></p>`;
  } else if (opts.method.startsWith("whatsapp")) {
    connectionInfo = `<p style="background:#f0fdf4;border:1px solid #bbf7d0;padding:10px;border-radius:6px;margin:12px 0;color:#166534">
      📱 Our team will contact you via WhatsApp at the scheduled time.</p>`;
  }
  return wrap(`
    <h2 style="color:#005476;margin-top:0">✅ Consultation Confirmed!</h2>
    <p style="color:#374151">Your consultation has been confirmed by the Kinglike Luxury team.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:8px 4px;color:#6b7280;width:40%">Type</td><td style="padding:8px 4px;font-weight:600">${typeLabel}</td></tr>
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:8px 4px;color:#6b7280">Country</td><td style="padding:8px 4px">${opts.country}</td></tr>
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:8px 4px;color:#6b7280">Date</td><td style="padding:8px 4px;font-weight:600">${opts.date}</td></tr>
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:8px 4px;color:#6b7280">Time</td><td style="padding:8px 4px;font-weight:600">${opts.time}</td></tr>
      <tr><td style="padding:8px 4px;color:#6b7280">Method</td><td style="padding:8px 4px">${methodLabel}</td></tr>
    </table>
    ${connectionInfo}
    <p style="color:#6b7280;font-size:13px">If you have questions, please contact us via WhatsApp.</p>
  `);
}

export function buildConsultationBookedEmail(opts: {
  type: string;
  method: string;
  date: string;
  time: string;
  country: string;
}): string {
  const methodLabel = opts.method.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  const typeLabel = opts.type.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return wrap(`
    <h2 style="color:#005476;margin-top:0">📅 Consultation Booked</h2>
    <p style="color:#374151">Thank you for booking a consultation with Kinglike Luxury. We will confirm your appointment shortly.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0">
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:8px 4px;color:#6b7280;width:40%">Type</td><td style="padding:8px 4px;font-weight:600">${typeLabel}</td></tr>
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:8px 4px;color:#6b7280">Country</td><td style="padding:8px 4px">${opts.country}</td></tr>
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:8px 4px;color:#6b7280">Date</td><td style="padding:8px 4px;font-weight:600">${opts.date}</td></tr>
      <tr style="border-bottom:1px solid #f3f4f6"><td style="padding:8px 4px;color:#6b7280">Time</td><td style="padding:8px 4px;font-weight:600">${opts.time}</td></tr>
      <tr><td style="padding:8px 4px;color:#6b7280">Method</td><td style="padding:8px 4px">${methodLabel}</td></tr>
    </table>
  `);
}
