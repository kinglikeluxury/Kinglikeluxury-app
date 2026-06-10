/**
 * Meta Cloud API — Interactive Message Helper
 * Sends WhatsApp interactive messages (reply buttons or list messages).
 *
 * ≤3 options  → reply button message
 * ≥4 options  → list message (single section)
 *
 * All sends are logged to Chat History (whatsapp_api_conversations /
 * whatsapp_api_messages) via the same pattern as metaWhatsAppService.ts.
 */

import { pool } from "./db";

const PHONE_NUMBER_ID =
  process.env.WHATSAPP_PHONE_NUMBER_ID ?? "1110445448828325";

const API_URL = `https://graph.facebook.com/v23.0/${PHONE_NUMBER_ID}/messages`;

function getToken(): string | null {
  return process.env.WHATSAPP_ACCESS_TOKEN ?? process.env.META_ACCESS_TOKEN ?? null;
}

/** Strip everything except digits (Meta requires no + prefix). */
function toMetaPhone(p: string): string {
  return p.replace(/[^0-9]/g, "");
}

export interface InteractiveOption {
  id:    string;
  title: string;
  description?: string;
}

export interface InteractiveSendResult {
  success:   boolean;
  wamid?:    string;
  error?:    string;
}

/**
 * Send an interactive message with button or list, depending on option count.
 *
 * @param phone     Recipient phone (any format; will be normalised)
 * @param bodyText  Message body / question text (max 1024 chars for buttons, 4096 for lists)
 * @param options   Reply choices (2–3 → buttons; 4–10 → list)
 * @param listButtonLabel  Label for the list-trigger button (default "اختر")
 */
export async function sendInteractiveMessage(
  phone: string,
  bodyText: string,
  options: InteractiveOption[],
  listButtonLabel = "اختر",
): Promise<InteractiveSendResult> {
  const token = getToken();
  if (!token) {
    return { success: false, error: "WHATSAPP_ACCESS_TOKEN not configured" };
  }

  const to = toMetaPhone(phone);
  if (!to) {
    return { success: false, error: `Invalid phone: ${phone}` };
  }

  // Build interactive payload
  let interactivePayload: object;

  if (options.length <= 3) {
    // Reply buttons (max 3)
    interactivePayload = {
      type: "button",
      body: { text: bodyText.slice(0, 1024) },
      action: {
        buttons: options.slice(0, 3).map(o => ({
          type: "reply",
          reply: {
            id:    o.id.slice(0, 256),
            title: o.title.slice(0, 20),
          },
        })),
      },
    };
  } else {
    // List message (max 10 rows per section)
    interactivePayload = {
      type: "list",
      body: { text: bodyText.slice(0, 4096) },
      action: {
        button: listButtonLabel.slice(0, 20),
        sections: [
          {
            rows: options.slice(0, 10).map(o => ({
              id:          o.id.slice(0, 256),
              title:       o.title.slice(0, 24),
              description: (o.description ?? "").slice(0, 72),
            })),
          },
        ],
      },
    };
  }

  const body = JSON.stringify({
    messaging_product: "whatsapp",
    to,
    type: "interactive",
    interactive: interactivePayload,
  });

  try {
    const res = await fetch(API_URL, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body,
    });

    const json: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg = json?.error?.message ?? `HTTP ${res.status}`;
      console.error(`[InteractiveMsg] ✗ Send failed to=${to}:`, errMsg);
      await logToHistory(to, bodyText, "failed", undefined, errMsg);
      return { success: false, error: errMsg };
    }

    const wamid: string | undefined = json?.messages?.[0]?.id;
    console.log(`[InteractiveMsg] ✓ Sent to=${to} | wamid=${wamid ?? "—"}`);
    await logToHistory(to, bodyText, "sent", wamid);
    return { success: true, wamid };
  } catch (err: any) {
    console.error(`[InteractiveMsg] ✗ Network error to=${to}:`, err.message);
    await logToHistory(to, bodyText, "failed", undefined, err.message);
    return { success: false, error: err.message };
  }
}

/** Send a plain text message (reuses the same API, logs to history). */
export async function sendQualTextMessage(
  phone: string,
  text: string,
): Promise<InteractiveSendResult> {
  const token = getToken();
  if (!token) return { success: false, error: "No token" };

  const to = toMetaPhone(phone);

  const body = JSON.stringify({
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text.slice(0, 4096) },
  });

  try {
    const res = await fetch(API_URL, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body,
    });

    const json: any = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = json?.error?.message ?? `HTTP ${res.status}`;
      console.error(`[QualTextMsg] ✗ to=${to}:`, errMsg);
      await logToHistory(to, text, "failed", undefined, errMsg);
      return { success: false, error: errMsg };
    }

    const wamid: string | undefined = json?.messages?.[0]?.id;
    console.log(`[QualTextMsg] ✓ Sent to=${to} | wamid=${wamid ?? "—"}`);
    await logToHistory(to, text, "sent", wamid);
    return { success: true, wamid };
  } catch (err: any) {
    await logToHistory(to, text, "failed", undefined, err.message);
    return { success: false, error: err.message };
  }
}

// ── Private: log outbound message to Chat History ────────────────────────────

async function logToHistory(
  phone:    string,
  text:     string,
  status:   string,
  wamid?:   string,
  errorMsg?: string,
  msgType:  string = "interactive",
): Promise<void> {
  const client = await pool.connect();
  try {
    const convResult = await client.query(`
      INSERT INTO whatsapp_api_conversations
        (phone_number, last_message_at, last_message_preview, source, updated_at)
      VALUES ($1, NOW(), $2, 'qualification', NOW())
      ON CONFLICT (phone_number) DO UPDATE SET
        last_message_at      = NOW(),
        last_message_preview = EXCLUDED.last_message_preview,
        source               = 'qualification',
        updated_at           = NOW()
      RETURNING id
    `, [phone, text.slice(0, 120)]);

    const convId = convResult.rows[0]?.id;
    if (!convId) return;

    await client.query(`
      INSERT INTO whatsapp_api_messages
        (conversation_id, direction, message_text, message_type,
         wamid, status, context_label, error_message, created_at)
      VALUES ($1, 'outbound', $2, $3, $4, $5, 'qualification', $6, NOW())
    `, [convId, text, msgType, wamid ?? null, status, errorMsg ?? null]);
  } catch {
    // non-critical
  } finally {
    client.release();
  }
}

// ── Template sender: first-contact opener for cold leads ─────────────────────
//
// Sends the approved "kinglike_qual_opener" template (Arabic, UTILITY category).
// This is the ONLY compliant way to open a WhatsApp conversation with a cold
// lead outside a 24-hour customer-initiated window.
//
// Template name : kinglike_qual_opener
// Language      : ar
// Category      : UTILITY
// Buttons (quick reply):
//   index 0  payload=QUAL_YES   "✅ نعم، أود المتابعة"
//   index 1  payload=QUAL_LATER "⏳ لاحقاً"
//
// When the user taps a button Meta sends msg.type="button" with
// msg.button.payload = "QUAL_YES" | "QUAL_LATER"
//
export async function sendQualOpenerTemplate(
  phone: string,
  templateName = "kinglike_qual_opener",
): Promise<InteractiveSendResult> {
  const token = getToken();
  if (!token) return { success: false, error: "No token" };

  const to = toMetaPhone(phone);
  if (!to) return { success: false, error: `Invalid phone: ${phone}` };

  const body = JSON.stringify({
    messaging_product: "whatsapp",
    recipient_type:    "individual",
    to,
    type:     "template",
    template: {
      name:     templateName,
      language: { code: "ar" },
      components: [
        {
          type:     "button",
          sub_type: "quick_reply",
          index:    "0",
          parameters: [{ type: "payload", payload: "QUAL_YES" }],
        },
        {
          type:     "button",
          sub_type: "quick_reply",
          index:    "1",
          parameters: [{ type: "payload", payload: "QUAL_LATER" }],
        },
      ],
    },
  });

  try {
    const res = await fetch(API_URL, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body,
    });

    const json: any = await res.json().catch(() => ({}));

    if (!res.ok) {
      const errMsg = json?.error?.message ?? `HTTP ${res.status}`;
      console.error(`[QualTemplate] ✗ TEMPLATE_SENT FAILED to=${to} template=${templateName}: ${errMsg}`);
      await logToHistory(to, `[TEMPLATE:${templateName}]`, "failed", undefined, errMsg, "template");
      return { success: false, error: errMsg };
    }

    const wamid: string | undefined = json?.messages?.[0]?.id;
    console.log(`[QualTemplate] ✓ TEMPLATE_SENT to=${to} | template=${templateName} | wamid=${wamid ?? "—"}`);
    await logToHistory(to, `[TEMPLATE:${templateName}]`, "sent", wamid, undefined, "template");
    return { success: true, wamid };
  } catch (err: any) {
    console.error(`[QualTemplate] ✗ Network error to=${to}:`, err.message);
    await logToHistory(to, `[TEMPLATE:${templateName}]`, "failed", undefined, err.message, "template");
    return { success: false, error: err.message };
  }
}
