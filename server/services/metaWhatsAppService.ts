/**
 * Meta Cloud API — Centralized WhatsApp Sending Service
 *
 * Sends automated WhatsApp messages via:
 *   POST https://graph.facebook.com/v23.0/{PHONE_NUMBER_ID}/messages
 *
 * Phone Number ID : 1110445448828325  (env: WHATSAPP_PHONE_NUMBER_ID)
 * WABA ID         : 2006683553274156  (env: WHATSAPP_BUSINESS_ACCOUNT_ID)
 * Access Token    : env WHATSAPP_ACCESS_TOKEN  (falls back to META_ACCESS_TOKEN)
 *
 * Used for: welcome messages, weekly updates, inactive-user reminders.
 * NOT used for public property contact buttons (those use +995591000058).
 * NOT used for CRM employee WhatsApp icons (those open wa.me/[lead_phone]).
 * NOT used for SMS/OTP (Twilio handles that).
 */

const PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID ?? "1110445448828325";

const API_URL = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

function getToken(): string | null {
  return process.env.WHATSAPP_ACCESS_TOKEN ?? process.env.META_ACCESS_TOKEN ?? null;
}

export function isMetaWhatsAppConfigured(): boolean {
  return !!(getToken() && PHONE_NUMBER_ID);
}

/** Call once at server startup to log configuration status. */
export function validateMetaWhatsAppConfig(): void {
  const token = getToken();
  if (!token) {
    console.warn(
      "[MetaWhatsApp] WHATSAPP_ACCESS_TOKEN (or META_ACCESS_TOKEN) not set — " +
      "automated WhatsApp sending is disabled"
    );
    return;
  }
  console.log(
    `[MetaWhatsApp] Configured ✓ — Phone ID: ${PHONE_NUMBER_ID} | ` +
    `token_len=${token.length}`
  );
}

/** Strip everything except digits — Meta requires no + prefix. */
function toMetaPhone(phone: string): string {
  return phone.replace(/[^0-9]/g, "");
}

export interface MetaSendResult {
  success:        boolean;
  recipient:      string;
  messageId?:     string;
  error?:         string;
  responseStatus?: number;
}

/**
 * Send a WhatsApp text message via Meta Cloud API.
 *
 * @param phone   - Recipient phone in any format; will be normalised.
 * @param message - Plain text body (max 4096 chars).
 * @param context - Optional label for log lines (e.g. "welcome", "weekly_update").
 */
export async function sendMetaWhatsApp(
  phone:    string,
  message:  string,
  context?: string
): Promise<MetaSendResult> {
  const token     = getToken();
  const recipient = toMetaPhone(phone);
  const tag       = `[MetaWhatsApp]${context ? `[${context}]` : ""}`;

  if (!token) {
    console.warn(`${tag} Token not configured — skip ${recipient}`);
    return { success: false, recipient, error: "WHATSAPP_ACCESS_TOKEN not set" };
  }
  if (!recipient) {
    console.warn(`${tag} Invalid phone: "${phone}"`);
    return { success: false, recipient: phone, error: "Invalid phone number" };
  }

  const payload = {
    messaging_product: "whatsapp",
    to:   recipient,
    type: "text",
    text: { body: message },
  };

  console.log(`${tag} → POST to=${recipient} chars=${message.length}`);

  try {
    const res = await fetch(API_URL, {
      method:  "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:  `Bearer ${token}`,
      },
      body:   JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });

    const raw = await res.text();
    let parsed: any = null;
    try { parsed = JSON.parse(raw); } catch { /* not JSON */ }

    const messageId = parsed?.messages?.[0]?.id;
    const success   = res.ok && !!messageId;

    if (success) {
      console.log(`${tag} ✓ sent msgId=${messageId}`);
    } else {
      const errMsg = parsed?.error?.message ?? raw.slice(0, 200);
      console.error(`${tag} ✗ HTTP ${res.status} — ${errMsg}`);
    }

    return {
      success,
      recipient,
      messageId,
      error:          success ? undefined : (parsed?.error?.message ?? `HTTP ${res.status}`),
      responseStatus: res.status,
    };
  } catch (err: any) {
    console.error(`${tag} fetch error:`, err.message);
    return { success: false, recipient, error: err.message };
  }
}
