import { withKayInternalClient } from "./kayInternalDatabase";

export const KAY_ONE_TURN_MAX_AUDIO_BYTES = 2 * 1024 * 1024;
export const KAY_ONE_TURN_MAX_TRANSCRIPT_CHARS = 4000;
export const KAY_ONE_TURN_MAX_REPLY_CHARS = 360;
export const KAY_ONE_TURN_TIMEOUT_MS = 30_000;

export type KayOneTurnCall = {
  id: number;
  caller: string;
  target_user_id: number;
  initiated_by_user_id: number;
  status: string;
  reason_code: string;
  idempotency_key?: string | null;
};

export type KayOneTurnResult = {
  audio: Buffer;
  mediaType: string;
  transcript: string;
  replyText: string;
};

export type KayReasoningInput = {
  transcript: string;
  context: {
    scope: "ADMIN_TEST_TAREK_ONLY";
    callId: number;
    sessionId: number;
    initiatedByUserId: 1;
    targetUserId: 1;
    reasonCode: "ADMIN_TEST";
    customerDataIncluded: false;
  };
};

export interface KayReadOnlyReasoningAdapter {
  respond(input: KayReasoningInput): Promise<string>;
}

// read-only by construction: only approved ADMIN_TEST context and transcript
// reach the adapter, and this module has no CRM mutation client.
type KayOneTurnError = Error & { code: string; status: number };

function oneTurnError(code: string, status = 503, message = code): KayOneTurnError {
  return Object.assign(new Error(message), { code, status });
}

function timeoutSignal(milliseconds: number): AbortSignal {
  return AbortSignal.timeout(milliseconds);
}

function voiceServiceConfig() {
  const baseUrl = String(process.env.KAY_VOICE_SERVICE_URL || "").replace(/\/+$/, "");
  const apiKey = String(process.env.KAY_VOICE_SERVICE_API_KEY || "").trim();
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw oneTurnError("KAY_VOICE_SERVICE_NOT_CONFIGURED");
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !apiKey) {
    throw oneTurnError("KAY_VOICE_SERVICE_NOT_CONFIGURED");
  }
  return { baseUrl, apiKey };
}

async function voiceRequest(
  pathname: string,
  init: RequestInit,
  stage: "STT" | "TTS",
): Promise<Response> {
  const { baseUrl, apiKey } = voiceServiceConfig();
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        ...(init.headers || {}),
      },
      signal: timeoutSignal(KAY_ONE_TURN_TIMEOUT_MS),
    });
  } catch {
    throw oneTurnError(`KAY_ONE_TURN_${stage}_TIMEOUT`);
  }
  if (!response.ok) {
    throw oneTurnError(
      response.status === 504 ? `KAY_ONE_TURN_${stage}_TIMEOUT` : `KAY_ONE_TURN_${stage}_UNAVAILABLE`,
    );
  }
  return response;
}

export async function transcribeKayOneTurn(audio: Buffer): Promise<string> {
  if (!audio.length || audio.length > KAY_ONE_TURN_MAX_AUDIO_BYTES) {
    throw oneTurnError("KAY_ONE_TURN_AUDIO_INVALID", 400);
  }
  const response = await voiceRequest(
    "/v1/stt",
    {
      method: "POST",
      headers: { "Content-Type": "audio/wav", "Content-Length": String(audio.length) },
      body: audio,
    },
    "STT",
  );
  let payload: any;
  try {
    payload = await response.json();
  } catch {
    throw oneTurnError("KAY_ONE_TURN_STT_INVALID_RESPONSE");
  }
  const transcript = typeof payload?.text === "string"
    ? payload.text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
    : "";
  if (!transcript) throw oneTurnError("KAY_ONE_TURN_STT_EMPTY", 422);
  return transcript.slice(0, KAY_ONE_TURN_MAX_TRANSCRIPT_CHARS);
}

function sanitizeArabicReply(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, KAY_ONE_TURN_MAX_REPLY_CHARS);
}

export class OpenAIKayReadOnlyReasoningAdapter implements KayReadOnlyReasoningAdapter {
  async respond(input: KayReasoningInput): Promise<string> {
    const apiKey = String(process.env.OPENAI_API_KEY || "");
    if (!apiKey) throw oneTurnError("KAY_ONE_TURN_REASONING_NOT_CONFIGURED");
    const model = String(process.env.KAY_REASONING_MODEL || "gpt-4o-mini");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), KAY_ONE_TURN_TIMEOUT_MS);
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
        body: JSON.stringify({
          model,
          temperature: 0.2,
          max_tokens: 120,
          messages: [
            {
              role: "system",
              content: [
                "أنت Kay في اختبار صوتي داخلي محدود لمستخدم واحد اسمه طارق.",
                "أجب بالعربية الشامية/الفصحى المبسطة بجملة أو جملتين قصيرتين مناسبين للنطق.",
                "هذا المسار للرد فقط: لا تنشئ أو تعدّل عملاء أو مهام أو ملاحظات أو تعيينات أو وسوم أو درجات.",
                "لا تستخدم أو تطلب أي بيانات عملاء. إذا كان السؤال يتطلب بيانات غير موجودة، قل إنك لا تملك هذه البيانات.",
                "السياق المعتمد: ADMIN_TEST، لا يوجد customer data.",
              ].join(" "),
            },
            {
              role: "user",
              content: JSON.stringify({
                transcript: input.transcript,
                context: input.context,
              }),
            },
          ],
        }),
      });
      if (!response.ok) throw oneTurnError("KAY_ONE_TURN_REASONING_UNAVAILABLE");
      const payload: any = await response.json().catch(() => null);
      const text = payload?.choices?.[0]?.message?.content;
      const reply = typeof text === "string" ? sanitizeArabicReply(text) : "";
      if (!reply) throw oneTurnError("KAY_ONE_TURN_REASONING_EMPTY");
      return reply;
    } catch (error: any) {
      if (error?.code?.startsWith("KAY_ONE_TURN_")) throw error;
      throw oneTurnError(
        error?.name === "AbortError" ? "KAY_ONE_TURN_REASONING_TIMEOUT" : "KAY_ONE_TURN_REASONING_UNAVAILABLE",
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

export async function synthesizeKayOneTurn(replyText: string): Promise<{ audio: Buffer; mediaType: string }> {
  const text = sanitizeArabicReply(replyText);
  if (!text) throw oneTurnError("KAY_ONE_TURN_TTS_EMPTY", 422);
  const response = await voiceRequest(
    "/v1/tts",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voice: "kay_male", language: "ar" }),
    },
    "TTS",
  );
  const audio = Buffer.from(await response.arrayBuffer());
  if (!audio.length || !audio.subarray(0, 4).equals(Buffer.from("RIFF"))) {
    throw oneTurnError("KAY_ONE_TURN_TTS_INVALID_AUDIO");
  }
  return { audio, mediaType: response.headers.get("content-type") || "audio/wav" };
}

export function assertKayOneTurnCall(call: KayOneTurnCall): void {
  if (
    call.caller !== "KAY" ||
    call.status !== "ACTIVE" ||
    call.reason_code !== "ADMIN_TEST" ||
    Number(call.initiated_by_user_id) !== 1 ||
    Number(call.target_user_id) !== 1 ||
    !String(call.idempotency_key || "").startsWith("DIRECT_ADMIN_TEST_")
  ) {
    throw oneTurnError("KAY_ONE_TURN_SCOPE_DENIED", 403);
  }
  if (process.env.KAY_AUTOMATIC_INTERNAL_CALLS_ENABLED !== "false") {
    throw oneTurnError("KAY_ONE_TURN_AUTOMATION_DISABLED", 423);
  }
}

async function reserveOneTurn(callId: number): Promise<void> {
  const result = await withKayInternalClient(client =>
    client.query(
      `INSERT INTO kay_voice_one_turn_sessions
         (call_session_id,status,created_at,started_at)
       SELECT c.id,'PROCESSING',NOW(),NOW()
         FROM kay_internal_call_sessions c
         JOIN kay_recording_sessions r ON r.call_session_id=c.id
        WHERE c.id=$1
          AND c.status='ACTIVE'
          AND c.caller='KAY'
          AND c.reason_code='ADMIN_TEST'
          AND c.initiated_by_user_id=1
          AND c.target_user_id=1
          AND r.notice_status='PLAYED'
          AND r.recording_status IN ('NOTICE_PLAYED','RECORDING')
       ON CONFLICT (call_session_id) DO NOTHING
       RETURNING call_session_id`,
      [callId],
    ),
  );
  if (result.rowCount !== 1) throw oneTurnError("KAY_ONE_TURN_ALREADY_USED", 409);
}

async function finishOneTurn(callId: number, status: "COMPLETED" | "FAILED", failureReason?: string) {
  await withKayInternalClient(client =>
    client.query(
      `UPDATE kay_voice_one_turn_sessions
          SET status=$2, failure_reason=$3, ended_at=NOW()
        WHERE call_session_id=$1 AND status='PROCESSING'`,
      [callId, status, failureReason || null],
    ),
  );
}

export async function processKayOneTurn(input: {
  call: KayOneTurnCall;
  connectionId: string;
  audio: Buffer;
  reasoning?: KayReadOnlyReasoningAdapter;
}): Promise<KayOneTurnResult> {
  assertKayOneTurnCall(input.call);
  if (!input.connectionId) throw oneTurnError("KAY_ONE_TURN_CONNECTION_REQUIRED", 401);
  await reserveOneTurn(input.call.id);
  try {
    const transcript = await transcribeKayOneTurn(input.audio);
    const context: KayReasoningInput["context"] = {
      scope: "ADMIN_TEST_TAREK_ONLY",
      callId: input.call.id,
      sessionId: input.call.id,
      initiatedByUserId: 1,
      targetUserId: 1,
      reasonCode: "ADMIN_TEST",
      customerDataIncluded: false,
    };
    const reasoning = input.reasoning || new OpenAIKayReadOnlyReasoningAdapter();
    const replyText = await reasoning.respond({ transcript, context });
    const synthesized = await synthesizeKayOneTurn(replyText);
    await finishOneTurn(input.call.id, "COMPLETED");
    return { ...synthesized, transcript, replyText };
  } catch (error: any) {
    const code = typeof error?.code === "string" && error.code.startsWith("KAY_ONE_TURN_")
      ? error.code
      : "KAY_ONE_TURN_FAILED";
    await finishOneTurn(input.call.id, "FAILED", code).catch(() => {});
    throw error?.code ? error : oneTurnError(code);
  }
}