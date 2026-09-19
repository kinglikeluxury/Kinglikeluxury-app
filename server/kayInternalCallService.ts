import type { Express, RequestHandler, Response } from "express";
import { ServerResponse, type IncomingMessage, type Server } from "http";
import { randomUUID } from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { sendPushNotification } from "./notificationService";
import { withKayInternalClient } from "./kayInternalDatabase";
import { withKayReadonlyAnalysis } from "./kayAnalysisDatabase";
import {
  assertKayCallWindow,
  callAntiSpamDecision,
  createCommitmentFromCallOutcome,
  getMeaningfulEmployeeActionItems,
} from "./kaySupervisorIntelligenceService";
import {
  ensureKayRecordingSession,
  onKayCallAnswered,
  onKayCallEnded,
  onKayRecordingNoticePlayed,
  onKayRecordingStarted,
  recordKayRecordingObjection,
  finalizeKayRecordingAndUpload,
  markKayRecordingCaptureFailed,
} from "./kayRecordingService";
import { KAY_RECORDING_MAX_AUDIO_BYTES } from "./kayRecordingStorage";

const KAY_INTERNAL_CALL_USER_IDS = new Set([1, 24, 29, 31]);
const KAY_INTERNAL_CALL_EVENTS = new Set([
  "call_offer",
  "call_answer",
  "ice_candidate",
  "call_reject",
  "call_end",
  "call_busy",
  "recording_notice_result",
  "recording_objection",
  "recording_upload_begin",
  "recording_upload_chunk",
  "recording_upload_complete",
]);

function tarekTestWindowConfigured(): boolean {
  return Boolean(
    process.env.KAY_AFTER_HOURS_TAREK_TEST_STARTED_AT ||
    process.env.KAY_AFTER_HOURS_TAREK_TEST_EXPIRES_AT,
  );
}

function tarekTestWindowActive(now = new Date()): boolean {
  const startedAt = new Date(process.env.KAY_AFTER_HOURS_TAREK_TEST_STARTED_AT || "");
  const expiresAt = new Date(process.env.KAY_AFTER_HOURS_TAREK_TEST_EXPIRES_AT || "");
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(expiresAt.getTime())) return false;
  return process.env.KAY_AUTOMATIC_INTERNAL_CALLS_ENABLED === "false" &&
    startedAt.getTime() <= now.getTime() &&
    expiresAt.getTime() > now.getTime() &&
    expiresAt.getTime() - startedAt.getTime() <= 15 * 60 * 1000;
}

function tarekAdminTestRetryEnabled(now = new Date()): boolean {
  return process.env.KAY_TAREK_ADMIN_TEST_RETRY_ENABLED === "true" &&
    tarekTestWindowActive(now);
}

function adminTestAllowedCount(now = new Date()): number {
  return tarekAdminTestRetryEnabled(now) ? 2 : 1;
}

const KAY_INTERNAL_CALLS_ENABLED = () => {
  if (process.env.KAY_INTERNAL_CALLS_ENABLED !== "true") return false;
  const startedRaw = process.env.KAY_AFTER_HOURS_TAREK_TEST_STARTED_AT;
  const expiresRaw = process.env.KAY_AFTER_HOURS_TAREK_TEST_EXPIRES_AT;
  if (!startedRaw && !expiresRaw) return true;
  return tarekTestWindowActive();
};
const MAX_RAW_MESSAGE_BYTES = 64 * 1024;
const MAX_SDP_BYTES = 32 * 1024;
const MAX_CANDIDATE_BYTES = 16 * 1024;
const MAX_RECORDING_CHUNK_BYTES = 40 * 1024;
let afterHoursTarekTestTimer: NodeJS.Timeout | null = null;
const directExpiryTimers = new Map<number, NodeJS.Timeout>();

type CallUser = { id: number; username: string; isAdmin: boolean; role: string; isActive: boolean };
type CallSocket = WebSocket & { kayUserId?: number; kayRequest?: IncomingMessage; kayConnectionId?: string };
type DeliveryOptions = { requiredConnectionId?: string; excludedConnectionId?: string };
type ForwardedSignal =
  | { type: "call_offer" | "call_answer"; callId: number; sdp: { type: "offer" | "answer"; sdp: string } }
  | { type: "ice_candidate"; callId: number; candidate: Record<string, unknown> }
  | { type: "call_reject" | "call_end" | "call_busy"; callId: number };

const socketsByUser = new Map<number, Set<CallSocket>>();
const pendingOffersByCall = new Map<number, { sdp: { type: "offer"; sdp: string }; title?: string }>();
const initiatingConnectionByCall = new Map<number, string>();
const answeringConnectionByCall = new Map<number, string>();
type PendingRecordingUpload = {
  userId: number;
  connectionId: string;
  contentType: string;
  totalBytes: number;
  bytes: number;
  chunks: Buffer[];
  complete: boolean;
};
const pendingRecordingUploadsByCall = new Map<number, PendingRecordingUpload>();
const pendingSignalsByUser = new Map<number, Array<{ event: ForwardedSignal; options: DeliveryOptions; expiresAt: number }>>();
const SIGNAL_TTL_MS = 2 * 60 * 1000;
const MAX_QUEUED_SIGNALS_PER_USER = 96;

function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

async function loadAuthorizedUser(userId: number): Promise<CallUser> {
  if (!KAY_INTERNAL_CALL_USER_IDS.has(userId)) throw httpError(403, "KAY_INTERNAL_CALL_USER_NOT_ALLOWED");
  const result = await withKayReadonlyAnalysis(client =>
    client.query(
      `SELECT id,username,is_admin,role,is_active FROM users WHERE id=$1 LIMIT 1`,
      [userId],
    )
  );
  const row = result.rows[0];
  const validRole =
    userId === 1
      ? row?.is_admin === true
      : row?.is_admin === false && row?.role === "sub_agent";
  if (!row || row.is_active !== true || !validRole) {
    throw httpError(403, "KAY_INTERNAL_CALL_USER_NOT_AUTHORIZED");
  }
  return { id: Number(row.id), username: String(row.username), isAdmin: row.is_admin === true, role: String(row.role), isActive: true };
}

function requireEnabled() {
  if (!KAY_INTERNAL_CALLS_ENABLED()) throw httpError(423, "KAY_INTERNAL_CALLS_DISABLED");
}

function disableAfterHoursTarekTestRuntime() {
  process.env.KAY_INTERNAL_CALLS_ENABLED = "false";
  delete process.env.KAY_AFTER_HOURS_TAREK_TEST_STARTED_AT;
  delete process.env.KAY_AFTER_HOURS_TAREK_TEST_EXPIRES_AT;
  if (afterHoursTarekTestTimer) clearTimeout(afterHoursTarekTestTimer);
  afterHoursTarekTestTimer = null;
}

function scheduleDirectExpiry(callId: number, expiresAt: Date) {
  const existing = directExpiryTimers.get(callId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    void withKayInternalClient(async client => {
      const result = await client.query(
        `UPDATE kay_internal_call_sessions SET status='ENDED',ended_at=COALESCE(ended_at,NOW())
          WHERE id=$1 AND status IN ('RINGING','ACTIVE') RETURNING id,target_user_id`,
        [callId],
      );
      directExpiryTimers.delete(callId);
      if (result.rowCount) {
        await deliverToConnectedSockets(Number(result.rows[0].target_user_id), {
          type: "KAY_CALL_ENDED", call_session_id: callId,
        });
      }
    }).catch(() => {});
  }, Math.max(0, expiresAt.getTime() - Date.now()));
  directExpiryTimers.set(callId, timer);
}

function armAfterHoursTarekTestExpiry(expiresAt: Date) {
  if (afterHoursTarekTestTimer) clearTimeout(afterHoursTarekTestTimer);
  afterHoursTarekTestTimer = setTimeout(() => {
    void withKayInternalClient(async client => {
      const result = await client.query(
        `UPDATE kay_internal_call_sessions
            SET status='ENDED',ended_at=COALESCE(ended_at,NOW())
          WHERE reason_code='ADMIN_TEST' AND status IN ('RINGING','ACTIVE')
          RETURNING id`,
      );
      for (const row of result.rows) {
        const callId = Number(row.id);
        await deliverToConnectedSockets(1, { type: "call_end", callId });
        dropQueuedCallSignals(callId);
        clearEphemeralCallState(callId);
        initiatingConnectionByCall.delete(callId);
        answeringConnectionByCall.delete(callId);
      }
      disableAfterHoursTarekTestRuntime();
    }).catch(() => disableAfterHoursTarekTestRuntime());
  }, Math.max(0, expiresAt.getTime() - Date.now()));
}

async function getCall(callId: number) {
  const result = await withKayInternalClient(client =>
    client.query(
      `SELECT id,caller,target_user_id,initiated_by_user_id,status,reason_code,idempotency_key,created_at
         FROM kay_internal_call_sessions WHERE id=$1 LIMIT 1`,
      [callId],
    )
  );
  return result.rows[0] as {
    id: number;
    caller: string;
    target_user_id: number;
    initiated_by_user_id: number;
    status: string;
    reason_code: string;
    idempotency_key: string;
    created_at: Date;
  } | undefined;
}

async function finalizePendingKayRecording(callId: number) {
  const pending = pendingRecordingUploadsByCall.get(callId);
  pendingRecordingUploadsByCall.delete(callId);
  const call = await getCall(callId).catch(() => undefined);
  if (call && isDirectCall(call) && !isAllowedDirectKayRecordingTest(call)) {
    await markKayRecordingCaptureFailed(callId, "KAY_DIRECT_CALL_AUDIO_NOT_CAPTURED").catch(() => {});
    return { ok: false, reason: "KAY_DIRECT_CALL_AUDIO_NOT_CAPTURED" };
  }
  if (!pending || !pending.complete || pending.bytes !== pending.totalBytes) {
    await markKayRecordingCaptureFailed(callId, "RECORDING_CAPTURE_INCOMPLETE").catch(() => {});
    return { ok: false, reason: "RECORDING_CAPTURE_INCOMPLETE" };
  }
  try {
    const uploaded = await finalizeKayRecordingAndUpload({
      callSessionId: callId,
      audio: Buffer.concat(pending.chunks, pending.bytes),
      contentType: pending.contentType,
    });
    return { ok: true, uploaded };
  } catch (error: any) {
    return { ok: false, reason: error?.code || "KAY_RECORDING_UPLOAD_FAILED" };
  }
}

function isDirectCall(call: { idempotency_key?: string | null }) {
  return typeof call.idempotency_key === "string" && call.idempotency_key.startsWith("DIRECT_");
}

function isAllowedDirectKayRecordingTest(call: {
  idempotency_key?: string | null;
  reason_code?: string | null;
  target_user_id?: number | string | null;
  initiated_by_user_id?: number | string | null;
}) {
  return isDirectCall(call) &&
    call.reason_code === "ADMIN_TEST" &&
    Number(call.target_user_id) === 1 &&
    Number(call.initiated_by_user_id) === 1;
}

function directExpiry(call: { reason_code: string; created_at: Date }) {
  if (call.reason_code === "ADMIN_TEST") {
    const configured = new Date(process.env.KAY_AFTER_HOURS_TAREK_TEST_EXPIRES_AT || "");
    if (!Number.isNaN(configured.getTime())) return configured;
  }
  return new Date(new Date(call.created_at).getTime() + 2 * 60 * 1000);
}

async function getLatestRingingCall(targetUserId: number) {
  const result = await withKayInternalClient(client =>
    client.query(
      `SELECT id,caller,target_user_id,status,reason_code,idempotency_key,created_at
         FROM kay_internal_call_sessions
         WHERE target_user_id=$1 AND status='RINGING'
        ORDER BY created_at DESC LIMIT 1`,
      [targetUserId],
    )
  );
  return result.rows[0] as any;
}

function clearEphemeralCallState(callId: number) {
  pendingOffersByCall.delete(callId);
}

function pruneQueuedSignals(userId: number) {
  const remaining = (pendingSignalsByUser.get(userId) || []).filter(item => item.expiresAt > Date.now());
  if (remaining.length) pendingSignalsByUser.set(userId, remaining);
  else pendingSignalsByUser.delete(userId);
  return remaining;
}

function queueSignal(userId: number, event: ForwardedSignal, options: DeliveryOptions = {}) {
  const queue = pruneQueuedSignals(userId);
  queue.push({ event, options, expiresAt: Date.now() + SIGNAL_TTL_MS });
  pendingSignalsByUser.set(userId, queue.slice(-MAX_QUEUED_SIGNALS_PER_USER));
}

function dropQueuedCallSignals(callId: number) {
  pendingSignalsByUser.forEach((queue, userId) => {
    const remaining = queue.filter(item => item.event.callId !== callId && item.expiresAt > Date.now());
    if (remaining.length) pendingSignalsByUser.set(userId, remaining);
    else pendingSignalsByUser.delete(userId);
  });
}

function reloadSocketSession(request: IncomingMessage): Promise<number> {
  return new Promise((resolve, reject) => {
    const requestSession = (request as any).session;
    if (!requestSession?.reload) return reject(httpError(401, "KAY_INTERNAL_CALL_SESSION_REQUIRED"));
    requestSession.reload((error: unknown) => {
      const userId = Number((request as any).session?.userId);
      if (error || !Number.isInteger(userId) || userId < 1) {
        return reject(httpError(401, "KAY_INTERNAL_CALL_SESSION_EXPIRED"));
      }
      resolve(userId);
    });
  });
}

export function isAllowedKayCallOrigin(request: Pick<IncomingMessage, "headers">): boolean {
  const origin = request.headers.origin;
  const host = request.headers.host;
  if (!origin || !host) return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.host === host;
  } catch {
    return false;
  }
}

async function sendToSocketIfAuthorized(
  socket: CallSocket,
  event: Record<string, unknown>,
  options: DeliveryOptions = {},
): Promise<boolean> {
  if (socket.readyState !== WebSocket.OPEN || !socket.kayRequest || !socket.kayUserId) return false;
  if (options.requiredConnectionId && socket.kayConnectionId !== options.requiredConnectionId) return false;
  if (options.excludedConnectionId && socket.kayConnectionId === options.excludedConnectionId) return false;
  try {
    const currentUserId = await reloadSocketSession(socket.kayRequest);
    if (currentUserId !== socket.kayUserId) throw httpError(401, "KAY_INTERNAL_CALL_SESSION_CHANGED");
    await loadAuthorizedUser(currentUserId);
    if (socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(event));
    return true;
  } catch {
    socket.close(1008, "Session expired");
    return false;
  }
}

async function deliverToConnectedSockets(
  userId: number,
  event: Record<string, unknown>,
  options: DeliveryOptions = {},
) {
  const sockets = Array.from(socketsByUser.get(userId) || []);
  return (await Promise.all(sockets.map(socket => sendToSocketIfAuthorized(socket, event, options)))).some(Boolean);
}

async function deliverOrQueueSignal(
  userId: number,
  event: ForwardedSignal,
  options: DeliveryOptions = {},
) {
  const delivered = await deliverToConnectedSockets(userId, event, options);
  if (!delivered) queueSignal(userId, event, options);
}

async function flushQueuedSignals(userId: number, socket: CallSocket) {
  const queue = pruneQueuedSignals(userId);
  if (!queue.length) return;
  const remaining: typeof queue = [];
  for (const item of queue) {
    if (!(await sendToSocketIfAuthorized(socket, item.event, item.options))) remaining.push(item);
  }
  if (remaining.length) pendingSignalsByUser.set(userId, remaining);
  else pendingSignalsByUser.delete(userId);
}

async function updateCallStatus(callId: number, status: string, allowedStatuses: string[]) {
  const result = await withKayInternalClient(client =>
    client.query(
      `UPDATE kay_internal_call_sessions
          SET status=$2,
              answered_at=CASE WHEN $2='ACTIVE' THEN COALESCE(answered_at,NOW()) ELSE answered_at END,
              ended_at=CASE WHEN $2 IN ('ENDED','REJECTED','BUSY') THEN COALESCE(ended_at,NOW()) ELSE ended_at END
        WHERE id=$1 AND status=ANY($3::text[])
        RETURNING id`,
      [callId, status, allowedStatuses],
    )
  );
  if (result.rowCount !== 1) throw httpError(409, "KAY_INTERNAL_CALL_STATE_CHANGED");
}

async function sendFallbackPush(targetUserId: number) {
  if (Array.from(socketsByUser.get(targetUserId) || []).some(socket => socket.readyState === WebSocket.OPEN)) return;
  const subscriptions = await withKayReadonlyAnalysis(client =>
    client.query(
      `SELECT endpoint,p256dh,auth FROM push_subscriptions WHERE user_id=$1`,
      [targetUserId],
    )
  );
  await Promise.allSettled(subscriptions.rows.map(row =>
    sendPushNotification(
      { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
      { title: "Kay is calling", body: "Kay is calling", data: { kayCall: true, path: "/admin/kay/call" } },
    )
  ));
}

export async function createKayInternalCall(input: {
  initiatorUserId: number;
  targetUserId: number;
  initiatorConnectionId: string;
  initiationType?: string;
  reasonCode?: string;
  title?: string;
  idempotencyKey?: string;
}) {
  requireEnabled();
  const now = new Date();
  const testExpiresAt = new Date(process.env.KAY_AFTER_HOURS_TAREK_TEST_EXPIRES_AT || "");
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (!idempotencyKey) throw httpError(400, "KAY_INTERNAL_CALL_IDEMPOTENCY_KEY_REQUIRED");
  if (/^DIRECT_/i.test(idempotencyKey)) {
    throw httpError(400, "KAY_INTERNAL_CALL_RESERVED_IDEMPOTENCY_KEY");
  }
  const initiator = await loadAuthorizedUser(input.initiatorUserId);
  if (!initiator.isAdmin) throw httpError(403, "KAY_INTERNAL_CALL_ADMIN_REQUIRED");
  const target = await loadAuthorizedUser(input.targetUserId);
  const initiatorSocket = Array.from(socketsByUser.get(initiator.id) || []).find(socket =>
    socket.kayConnectionId === input.initiatorConnectionId &&
    socket.readyState === WebSocket.OPEN
  );
  if (!initiatorSocket) throw httpError(409, "KAY_INTERNAL_CALL_INITIATOR_SOCKET_REQUIRED");
  if (target.id === initiator.id) {
    const hasSeparateTargetSocket = Array.from(socketsByUser.get(target.id) || []).some(socket =>
      socket.kayConnectionId !== input.initiatorConnectionId &&
      socket.readyState === WebSocket.OPEN
    );
    if (!hasSeparateTargetSocket) {
      throw httpError(409, "KAY_INTERNAL_CALL_SELF_TARGET_REQUIRES_SECOND_SESSION");
    }
  }
  const reasonCode = String(input.reasonCode || "MANUAL_INTERNAL_TEST").trim().toUpperCase().slice(0, 80);
  if (!/^[A-Z0-9_]+$/.test(reasonCode)) throw httpError(400, "KAY_INTERNAL_CALL_REASON_REQUIRED");
  const initiationType = String(input.initiationType || "MANUAL").trim().toUpperCase();
  const requestedAdminTest = initiationType === "ADMIN_TEST" || reasonCode === "ADMIN_TEST";
  const testOverrideActive =
    initiationType === "ADMIN_TEST" &&
    reasonCode === "ADMIN_TEST" &&
    initiator.id === 1 &&
    target.id === 1 &&
    tarekTestWindowActive(now);
  if (requestedAdminTest && !testOverrideActive) {
    throw httpError(423, "KAY_AFTER_HOURS_TAREK_TEST_OVERRIDE_INACTIVE");
  }
  if (tarekTestWindowConfigured() && !testOverrideActive) {
    throw httpError(423, "KAY_TAREK_ADMIN_TEST_ONLY");
  }
  if (!testOverrideActive) assertKayCallWindow(now);
  const title = sanitizeTitle(input.title);

  const meaningfulActionItems = testOverrideActive
    ? true
    : await getMeaningfulEmployeeActionItems(target.id);
  const transaction = await withKayInternalClient(async client => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock($1,$2)", [126322, target.id]);
      const existing = await client.query(
        `SELECT id,caller,target_user_id,initiated_by_user_id,status,reason_code,idempotency_key,created_at
           FROM kay_internal_call_sessions WHERE idempotency_key=$1 LIMIT 1`,
        [idempotencyKey],
      );
      if (existing.rows[0]) {
        const call = existing.rows[0];
        if (Number(call.target_user_id) !== target.id ||
            Number(call.initiated_by_user_id) !== initiator.id ||
            call.reason_code !== reasonCode) {
          throw httpError(409, "KAY_INTERNAL_CALL_IDEMPOTENCY_CONFLICT");
        }
        await client.query("COMMIT");
        return { result: existing, created: false };
      }
      if (requestedAdminTest) {
        const consumed = await client.query(
          `SELECT COUNT(*)::integer AS consumed_count
             FROM kay_internal_call_sessions
            WHERE reason_code='ADMIN_TEST'`,
        );
        if (Number(consumed.rows[0]?.consumed_count || 0) >= adminTestAllowedCount(now)) {
          throw httpError(423, "KAY_AFTER_HOURS_TAREK_TEST_ALREADY_CONSUMED");
        }
      }
      const history = await client.query(
        `SELECT status,reason_code,created_at FROM kay_internal_call_sessions
          WHERE target_user_id=$1
            AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul'
          ORDER BY created_at DESC LIMIT 20`,
        [target.id],
      );
      const overdueCommitment = await client.query(
        `SELECT EXISTS(SELECT 1 FROM kay_commitments
          WHERE employee_id=$1 AND status IN ('PENDING','ACCEPTED','EXTENDED','OVERDUE')
            AND (due_at AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul')::date = (NOW() AT TIME ZONE 'Europe/Istanbul')::date
            AND due_at < (NOW() AT TIME ZONE 'UTC')) AS materially_overdue`,
        [target.id],
      );
      if (!testOverrideActive) {
        const spam = callAntiSpamDecision({
          now,
          sessions: history.rows.map(row => ({ status: row.status, reasonCode: row.reason_code, createdAt: row.created_at })),
          meaningfulActionItems,
          materiallyOverdueSameDayCommitment: overdueCommitment.rows[0]?.materially_overdue === true,
          reasonCode,
        });
        if (!spam.allowed) throw httpError(429, `KAY_INTERNAL_CALL_${spam.reason}`);
      }
      const inserted = await createIdempotentCall(client, target.id, initiator.id, reasonCode, idempotencyKey);
      await client.query("COMMIT");
      return { result: inserted, created: true };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  });
  const result = transaction.result;
  const call = result.rows[0];
  if (!transaction.created) {
    return { ...call, callId: call.id, targetName: target.username, replayed: true };
  }
  try {
    await ensureKayRecordingSession({
      callSessionId: Number(call.id),
      archiveType: target.id === 1 ? "MANAGER_DEBRIEF" : "EMPLOYEE_CALL",
      employeeId: target.id === 1 ? null : target.id,
      employeeName: target.id === 1 ? null : target.username,
      counterpartName: target.id === 1 ? "Tarek" : "Kay",
    });
  } catch (error: any) {
    await updateCallStatus(Number(call.id), "ENDED", ["RINGING"]).catch(() => {});
    throw error;
  }
  if (testOverrideActive) armAfterHoursTarekTestExpiry(testExpiresAt);
  initiatingConnectionByCall.set(Number(call.id), input.initiatorConnectionId);
  if (title) {
    pendingOffersByCall.set(Number(call.id), {
      sdp: { type: "offer", sdp: "" },
      title,
    });
  }
  const invite = {
    type: "incoming_call",
    callId: call.id,
    caller: "KAY",
    targetUserId: target.id,
    targetName: target.username,
    reasonCode: call.reason_code,
    ...(title ? { title } : {}),
  };
  const invitationDelivered = await deliverToConnectedSockets(target.id, invite, {
    ...(target.id === initiator.id ? { excludedConnectionId: input.initiatorConnectionId } : {}),
  });
  if (!invitationDelivered) {
    await sendFallbackPush(target.id);
  }
  return { ...call, callId: call.id, targetName: target.username, ...(title ? { title } : {}) };
}

function sanitizeTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/[<>]/g, "").replace(/\s+/g, " ").trim();
  return title ? title.slice(0, 120) : null;
}

async function createIdempotentCall(
  client: any,
  targetUserId: number,
  initiatorUserId: number,
  reasonCode: string,
  idempotencyKey: string,
) {
  const existing = await client.query(
    `SELECT id,caller,target_user_id,initiated_by_user_id,status,reason_code,idempotency_key,created_at
       FROM kay_internal_call_sessions WHERE idempotency_key=$1 LIMIT 1`,
    [idempotencyKey],
  );
  if (existing.rows[0]) {
    const call = existing.rows[0];
    if (Number(call.target_user_id) !== targetUserId ||
        Number(call.initiated_by_user_id) !== initiatorUserId ||
        call.reason_code !== reasonCode) {
      throw httpError(409, "KAY_INTERNAL_CALL_IDEMPOTENCY_CONFLICT");
    }
    return existing;
  }
  try {
    return await client.query(
      `INSERT INTO kay_internal_call_sessions
        (caller,target_user_id,initiated_by_user_id,status,reason_code,idempotency_key)
       VALUES ('KAY',$1,$2,'RINGING',$3,$4)
       RETURNING id,caller,target_user_id,status,reason_code,idempotency_key,created_at`,
      [targetUserId, initiatorUserId, reasonCode, idempotencyKey],
    );
  } catch (error: any) {
    if (error?.code !== "23505") throw error;
    const raced = await client.query(
      `SELECT id,caller,target_user_id,initiated_by_user_id,status,reason_code,idempotency_key,created_at
         FROM kay_internal_call_sessions WHERE idempotency_key=$1 LIMIT 1`,
      [idempotencyKey],
    );
    const call = raced.rows[0];
    if (!call || Number(call.target_user_id) !== targetUserId ||
        Number(call.initiated_by_user_id) !== initiatorUserId ||
        call.reason_code !== reasonCode) {
      throw httpError(409, "KAY_INTERNAL_CALL_IDEMPOTENCY_CONFLICT");
    }
    return raced;
  }
}

async function authorizeSignal(
  callId: number,
  senderUserId: number,
  senderConnectionId: string,
  type: string,
) {
  requireEnabled();
  const sender = await loadAuthorizedUser(senderUserId);
  const call = await getCall(callId);
  if (!call) throw httpError(404, "KAY_INTERNAL_CALL_NOT_FOUND");
  if (call.caller !== "KAY") throw httpError(409, "KAY_INTERNAL_CALL_INVALID_CALLER");
  const [initiator, target] = await Promise.all([
    loadAuthorizedUser(Number(call.initiated_by_user_id)),
    loadAuthorizedUser(Number(call.target_user_id)),
  ]);
  if (!initiator.isAdmin || initiator.id !== 1) {
    throw httpError(403, "KAY_INTERNAL_CALL_ADMIN_INITIATOR_REQUIRED");
  }
  const initiatingConnectionId = initiatingConnectionByCall.get(callId);
  if (!initiatingConnectionId) throw httpError(409, "KAY_INTERNAL_CALL_INITIATOR_CONNECTION_LOST");
  const sameUser = initiator.id === target.id;
  const isCaller = sender.id === initiator.id &&
    senderConnectionId === initiatingConnectionId;
  const isTarget = sender.id === target.id &&
    (!sameUser || senderConnectionId !== initiatingConnectionId);
  if (!isCaller && !isTarget) throw httpError(403, "KAY_INTERNAL_CALL_PARTICIPANT_REQUIRED");
  if (type === "call_offer" && (!isCaller || call.status !== "RINGING")) throw httpError(409, "KAY_INTERNAL_CALL_OFFER_ONLY_WHILE_RINGING");
  if ((type === "call_answer" || type === "call_reject" || type === "call_busy") &&
      (!isTarget || call.status !== "RINGING")) {
    throw httpError(409, "KAY_INTERNAL_CALL_TARGET_ACTION_ONLY_WHILE_RINGING");
  }
  if (type === "ice_candidate" && !["RINGING", "ACTIVE"].includes(call.status)) {
    throw httpError(409, "KAY_INTERNAL_CALL_ICE_ONLY_WHILE_ACTIVE");
  }
  if (type === "call_end" && !["RINGING", "ACTIVE"].includes(call.status)) {
    throw httpError(409, "KAY_INTERNAL_CALL_END_ONLY_WHILE_ACTIVE");
  }
  if (type.startsWith("recording_")) {
    if (!isTarget || call.status !== "ACTIVE") {
      throw httpError(409, "KAY_RECORDING_TARGET_ONLY_WHILE_ACTIVE");
    }
    if (answeringConnectionByCall.get(callId) !== senderConnectionId) {
      throw httpError(403, "KAY_RECORDING_ANSWERING_CONNECTION_REQUIRED");
    }
  }
  return {
    sender,
    initiator,
    target,
    call,
    peerId: isCaller ? target.id : initiator.id,
    deliveryOptions: isCaller
      ? (sameUser ? { excludedConnectionId: initiatingConnectionId } : {})
      : { requiredConnectionId: initiatingConnectionId },
  };
}

function assertExactKeys(value: Record<string, unknown>, keys: string[]) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    throw httpError(400, "KAY_INTERNAL_CALL_INVALID_SIGNAL_SHAPE");
  }
}

function assertAllowedKeys(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).some(key => !keys.includes(key))) {
    throw httpError(400, "KAY_INTERNAL_CALL_INVALID_SIGNAL_SHAPE");
  }
}

function validateSignal(message: any): any {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw httpError(400, "KAY_INTERNAL_CALL_INVALID_SIGNAL");
  }
  const type = String(message.type || "");
  if (!KAY_INTERNAL_CALL_EVENTS.has(type) || !Number.isInteger(message.callId) || message.callId < 1) {
    throw httpError(400, "KAY_INTERNAL_CALL_INVALID_SIGNAL");
  }
  if (type === "call_offer" || type === "call_answer") {
    assertExactKeys(message, ["type", "callId", "sdp"]);
    if (!message.sdp || typeof message.sdp !== "object" || Array.isArray(message.sdp)) {
      throw httpError(400, "KAY_INTERNAL_CALL_INVALID_SDP");
    }
    assertExactKeys(message.sdp, ["type", "sdp"]);
    const expectedSdpType = type === "call_offer" ? "offer" : "answer";
    if (message.sdp.type !== expectedSdpType ||
        typeof message.sdp.sdp !== "string" || message.sdp.sdp.length < 1 ||
        Buffer.byteLength(message.sdp.sdp, "utf8") > MAX_SDP_BYTES) {
      throw httpError(400, "KAY_INTERNAL_CALL_INVALID_SDP");
    }
    return { type, callId: message.callId, sdp: message.sdp };
  }
  if (type === "ice_candidate") {
    assertExactKeys(message, ["type", "callId", "candidate"]);
    const candidate = message.candidate;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate) ||
        typeof candidate.candidate !== "string" || candidate.candidate.length < 1 ||
        Buffer.byteLength(candidate.candidate, "utf8") > MAX_CANDIDATE_BYTES ||
        (candidate.sdpMid !== null && typeof candidate.sdpMid !== "string") ||
        (candidate.sdpMid && candidate.sdpMid.length > 256) ||
        (candidate.sdpMLineIndex !== null && !Number.isInteger(candidate.sdpMLineIndex))) {
      throw httpError(400, "KAY_INTERNAL_CALL_INVALID_CANDIDATE");
    }
    assertAllowedKeys(candidate, ["candidate", "sdpMid", "sdpMLineIndex", "usernameFragment"]);
    return { type, callId: message.callId, candidate };
  }
  if (type === "recording_notice_result") {
    assertAllowedKeys(message, ["type", "callId", "played", "failureReason"]);
    if (typeof message.played !== "boolean" ||
        (message.failureReason !== undefined &&
          (typeof message.failureReason !== "string" || message.failureReason.length > 500))) {
      throw httpError(400, "KAY_RECORDING_INVALID_NOTICE_RESULT");
    }
    return {
      type,
      callId: message.callId,
      played: message.played,
      ...(message.failureReason === undefined ? {} : { failureReason: message.failureReason }),
    };
  }
  if (type === "recording_objection") {
    assertAllowedKeys(message, ["type", "callId"]);
    return { type, callId: message.callId };
  }
  if (type === "recording_upload_begin") {
    assertExactKeys(message, ["type", "callId", "contentType", "totalBytes"]);
    if (typeof message.contentType !== "string" ||
        message.contentType.length < 1 || message.contentType.length > 120 ||
        !Number.isSafeInteger(message.totalBytes) ||
        message.totalBytes < 1 || message.totalBytes > KAY_RECORDING_MAX_AUDIO_BYTES) {
      throw httpError(400, "KAY_RECORDING_INVALID_UPLOAD_BEGIN");
    }
    return { type, callId: message.callId, contentType: message.contentType, totalBytes: message.totalBytes };
  }
  if (type === "recording_upload_chunk") {
    assertExactKeys(message, ["type", "callId", "data"]);
    if (typeof message.data !== "string" ||
        message.data.length < 1 || message.data.length > Math.ceil(MAX_RECORDING_CHUNK_BYTES * 4 / 3) + 8 ||
        message.data.length % 4 !== 0 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(message.data)) {
      throw httpError(400, "KAY_RECORDING_INVALID_UPLOAD_CHUNK");
    }
    const chunk = Buffer.from(message.data, "base64");
    if (!chunk.length || chunk.length > MAX_RECORDING_CHUNK_BYTES ||
        chunk.toString("base64") !== message.data) {
      throw httpError(400, "KAY_RECORDING_INVALID_UPLOAD_CHUNK");
    }
    return { type, callId: message.callId, data: message.data };
  }
  if (type === "recording_upload_complete") {
    assertExactKeys(message, ["type", "callId"]);
    return { type, callId: message.callId };
  }
  assertExactKeys(message, ["type", "callId"]);
  return { type, callId: message.callId };
}

function addSocket(userId: number, socket: CallSocket) {
  const sockets = socketsByUser.get(userId) || new Set<CallSocket>();
  sockets.add(socket);
  socketsByUser.set(userId, sockets);
}

async function endCallsForDisconnectedUser(userId: number) {
  if (!KAY_INTERNAL_CALLS_ENABLED()) return;
  const result = await withKayInternalClient(client =>
    client.query(
      `UPDATE kay_internal_call_sessions
          SET status='ENDED',ended_at=COALESCE(ended_at,NOW())
        WHERE status IN ('RINGING','ACTIVE')
          AND (target_user_id=$1 OR initiated_by_user_id=$1)
        RETURNING id,target_user_id,initiated_by_user_id,reason_code`,
      [userId],
    )
  );
  for (const row of result.rows) {
    const callId = Number(row.id);
    const peerId = Number(row.target_user_id) === userId
      ? Number(row.initiated_by_user_id)
      : Number(row.target_user_id);
    dropQueuedCallSignals(callId);
    clearEphemeralCallState(callId);
    pendingRecordingUploadsByCall.delete(callId);
    initiatingConnectionByCall.delete(callId);
    answeringConnectionByCall.delete(callId);
    await onKayCallEnded(callId).catch(() => {});
    await finalizePendingKayRecording(callId);
    await deliverOrQueueSignal(peerId, { type: "call_end", callId });
    if (row.reason_code === "ADMIN_TEST") disableAfterHoursTarekTestRuntime();
  }
}

async function endCallsForDisconnectedSocket(userId: number, connectionId: string) {
  const boundCallIds: number[] = [];
  initiatingConnectionByCall.forEach((boundConnectionId, callId) => {
    if (boundConnectionId === connectionId) boundCallIds.push(callId);
  });
  answeringConnectionByCall.forEach((boundConnectionId, callId) => {
    if (boundConnectionId === connectionId && !boundCallIds.includes(callId)) boundCallIds.push(callId);
  });

  if (userId === 1) {
    const remainingConnectionIds = new Set(
      Array.from(socketsByUser.get(userId) || [])
        .filter(socket => socket.readyState === WebSocket.OPEN)
        .map(socket => socket.kayConnectionId)
        .filter((value): value is string => !!value)
    );
    const selfCalls = await withKayInternalClient(client =>
      client.query(
        `SELECT id FROM kay_internal_call_sessions
          WHERE status='RINGING' AND target_user_id=$1 AND initiated_by_user_id=$1`,
        [userId],
      )
    );
    for (const row of selfCalls.rows) {
      const callId = Number(row.id);
      const initiatingConnectionId = initiatingConnectionByCall.get(callId);
      const hasEligibleTarget = Array.from(remainingConnectionIds).some(id => id !== initiatingConnectionId);
      if (!hasEligibleTarget && !boundCallIds.includes(callId)) boundCallIds.push(callId);
    }
  }

  if (!boundCallIds.length) return;
  const result = await withKayInternalClient(client =>
    client.query(
      `UPDATE kay_internal_call_sessions
          SET status='ENDED',ended_at=COALESCE(ended_at,NOW())
        WHERE id=ANY($1::int[]) AND status IN ('RINGING','ACTIVE')
        RETURNING id,target_user_id,initiated_by_user_id,reason_code`,
      [boundCallIds],
    )
  );
  for (const row of result.rows) {
    const callId = Number(row.id);
    const initiatingConnectionId = initiatingConnectionByCall.get(callId);
    const answeringConnectionId = answeringConnectionByCall.get(callId);
    const closingWasInitiator = initiatingConnectionId === connectionId;
    const peerId = closingWasInitiator
      ? Number(row.target_user_id)
      : Number(row.initiated_by_user_id);
    const deliveryOptions: DeliveryOptions = closingWasInitiator
      ? (answeringConnectionId
          ? { requiredConnectionId: answeringConnectionId }
          : { excludedConnectionId: initiatingConnectionId })
      : { requiredConnectionId: initiatingConnectionId };
    dropQueuedCallSignals(callId);
    clearEphemeralCallState(callId);
    pendingRecordingUploadsByCall.delete(callId);
    initiatingConnectionByCall.delete(callId);
    answeringConnectionByCall.delete(callId);
    await onKayCallEnded(callId).catch(() => {});
    await finalizePendingKayRecording(callId);
    await deliverOrQueueSignal(peerId, { type: "call_end", callId }, deliveryOptions);
    if (row.reason_code === "ADMIN_TEST") disableAfterHoursTarekTestRuntime();
  }
}

function removeSocket(userId: number, socket: CallSocket) {
  const sockets = socketsByUser.get(userId);
  sockets?.delete(socket);
  if (socket.kayConnectionId) {
    void endCallsForDisconnectedSocket(userId, socket.kayConnectionId).catch(() => {});
  }
  if (sockets?.size === 0) {
    socketsByUser.delete(userId);
    void endCallsForDisconnectedUser(userId).catch(() => {});
  }
}

function rejectUpgrade(socket: any, code = 1008) {
  try { socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n"); } finally { socket.destroy(); }
  return code;
}

export function registerKayInternalCallRoutes(
  app: Express,
  httpServer: Server,
  sessionMiddleware: RequestHandler,
) {
  app.get("/api/admin/kay/internal-calls/test-readiness", async (req: any, res: Response) => {
    try {
      const admin = await loadAuthorizedUser(Number(req.session?.userId));
      if (!admin.isAdmin || admin.id !== 1) throw httpError(403, "KAY_INTERNAL_CALL_ADMIN_REQUIRED");
      const started = new Date(process.env.KAY_AFTER_HOURS_TAREK_TEST_STARTED_AT || "");
      const expires = new Date(process.env.KAY_AFTER_HOURS_TAREK_TEST_EXPIRES_AT || "");
      const now = new Date();
      const overrideActive =
        KAY_INTERNAL_CALLS_ENABLED() &&
        process.env.KAY_AUTOMATIC_INTERNAL_CALLS_ENABLED === "false" &&
        !Number.isNaN(started.getTime()) &&
        !Number.isNaN(expires.getTime()) &&
        started <= now &&
        expires > now &&
        expires.getTime() - started.getTime() <= 15 * 60 * 1000;
      if (!overrideActive) return res.status(200).json({ ready: false });
      const consumed = await withKayInternalClient(client =>
        client.query(`SELECT COUNT(*)::integer AS consumed_count
                        FROM kay_internal_call_sessions
                       WHERE reason_code='ADMIN_TEST'`)
      );
      return res.status(200).json({
        ready: Number(consumed.rows[0]?.consumed_count || 0) < adminTestAllowedCount(now),
        expiry: expires.toISOString(),
      });
    } catch (error: any) {
      return res.status(error?.status || 500).json({ ready: false });
    }
  });

  // Direct virtual-caller path: KAY has no browser/WebSocket peer. The target
  // socket is only used as the authenticated delivery channel for the ring.
  app.post("/api/admin/kay/internal-calls/start", async (req: any, res: Response) => {
    try {
      requireEnabled();
      const admin = await loadAuthorizedUser(Number(req.session?.userId));
      if (!admin.isAdmin || admin.id !== 1) throw httpError(403, "KAY_INTERNAL_CALL_ADMIN_REQUIRED");
      const targetUserId = Number(req.body?.target_user_id);
      const testMode = req.body?.test_mode === true;
      if (targetUserId !== 1) throw httpError(403, "KAY_DIRECT_CALL_TARGET_MUST_BE_TAREK");
      const target = await loadAuthorizedUser(targetUserId);
      const reasonCode = String(req.body?.reason_code || (testMode ? "ADMIN_TEST" : "MANUAL_INTERNAL_TEST"))
        .trim().toUpperCase().slice(0, 80);
      if (!/^[A-Z0-9_]+$/.test(reasonCode)) throw httpError(400, "KAY_INTERNAL_CALL_REASON_REQUIRED");
      if ((testMode === true) !== (reasonCode === "ADMIN_TEST")) {
        throw httpError(400, "KAY_DIRECT_CALL_TEST_MODE_REASON_MISMATCH");
      }
      const now = new Date();
      const expires = new Date(process.env.KAY_AFTER_HOURS_TAREK_TEST_EXPIRES_AT || "");
      const overrideActive = testMode && reasonCode === "ADMIN_TEST" &&
        tarekTestWindowActive(now);
      if (testMode && !overrideActive) throw httpError(423, "KAY_AFTER_HOURS_TAREK_TEST_OVERRIDE_INACTIVE");
      if (tarekTestWindowConfigured() && !overrideActive) {
        throw httpError(423, "KAY_TAREK_ADMIN_TEST_ONLY");
      }
      if (!overrideActive) assertKayCallWindow(now);
      const meaningfulActionItems = testMode
        ? true
        : await getMeaningfulEmployeeActionItems(target.id);
      const idempotencyKey = `DIRECT_${testMode ? "ADMIN_TEST" : "MANUAL"}_${randomUUID()}`;
      const result = await withKayInternalClient(async client => {
        await client.query("BEGIN");
        try {
          await client.query("SELECT pg_advisory_xact_lock($1,$2)", [126322, target.id]);
          if (testMode) {
            const consumed = await client.query(
              `SELECT COUNT(*)::integer AS consumed_count
                 FROM kay_internal_call_sessions
                WHERE reason_code='ADMIN_TEST'`,
            );
            if (Number(consumed.rows[0]?.consumed_count || 0) >= adminTestAllowedCount(now)) {
              throw httpError(423, "KAY_AFTER_HOURS_TAREK_TEST_ALREADY_CONSUMED");
            }
          }
          const ringingDirect = await client.query(
            `SELECT id,reason_code,created_at FROM kay_internal_call_sessions
              WHERE target_user_id=$1 AND status='RINGING' AND idempotency_key LIKE 'DIRECT_%'`,
            [target.id],
          );
          for (const stale of ringingDirect.rows) {
            const staleExpiry = directExpiry(stale);
            if (staleExpiry.getTime() <= now.getTime()) {
              await client.query(
                `UPDATE kay_internal_call_sessions SET status='ENDED',ended_at=COALESCE(ended_at,NOW())
                  WHERE id=$1 AND status='RINGING'`,
                [stale.id],
              );
            }
          }
          const activeDirect = await client.query(
            `SELECT id FROM kay_internal_call_sessions
              WHERE target_user_id=$1 AND idempotency_key LIKE 'DIRECT_%'
                AND status IN ('RINGING','ACTIVE') LIMIT 1`,
            [target.id],
          );
          if (activeDirect.rows[0]) throw httpError(409, "KAY_DIRECT_CALL_ALREADY_ACTIVE");
          if (!testMode) {
            const history = await client.query(
              `SELECT status,reason_code,created_at FROM kay_internal_call_sessions
                WHERE target_user_id=$1
                  AND created_at >= date_trunc('day', NOW() AT TIME ZONE 'Europe/Istanbul') AT TIME ZONE 'Europe/Istanbul'
                ORDER BY created_at DESC LIMIT 20`,
              [target.id],
            );
            const spam = callAntiSpamDecision({
              now,
              sessions: history.rows.map(row => ({ status: row.status, reasonCode: row.reason_code, createdAt: row.created_at })),
              meaningfulActionItems,
              materiallyOverdueSameDayCommitment: false,
              reasonCode,
            });
            if (!spam.allowed) throw httpError(429, `KAY_INTERNAL_CALL_${spam.reason}`);
          }
          const inserted = await createIdempotentCall(client, target.id, admin.id, reasonCode, idempotencyKey);
          await client.query("COMMIT");
          return inserted.rows[0];
        } catch (error) {
          await client.query("ROLLBACK").catch(() => {});
          throw error;
        }
      });
      const callId = Number(result.id);
      try {
        await ensureKayRecordingSession({
          callSessionId: callId,
          archiveType: "MANAGER_DEBRIEF",
          counterpartName: "Tarek",
        });
      } catch (error: any) {
        await updateCallStatus(callId, "ENDED", ["RINGING"]).catch(() => {});
        throw error;
      }
      const expiry = overrideActive ? expires : new Date(now.getTime() + 2 * 60 * 1000);
      if (overrideActive) armAfterHoursTarekTestExpiry(expires);
      scheduleDirectExpiry(callId, expiry);
      await deliverToConnectedSockets(target.id, {
        type: "KAY_CALL_INCOMING",
        call_session_id: callId,
        reason_code: reasonCode,
        display_title: "Kay is calling",
        expiry: expiry.toISOString(),
      });
      return res.status(201).json({ call_session_id: callId, expiry: expiry.toISOString() });
    } catch (error: any) {
      return res.status(error?.status || 500).json({ message: error?.message || "Unable to start direct Kay call." });
    }
  });

  for (const [action, nextStatus, allowed] of [
    ["answer", "ACTIVE", ["RINGING"]],
    ["reject", "REJECTED", ["RINGING"]],
    ["end", "ENDED", ["RINGING", "ACTIVE"]],
  ] as const) {
    app.post(`/api/admin/kay/internal-calls/:callId/${action}`, async (req: any, res: Response) => {
      try {
        requireEnabled();
        const target = await loadAuthorizedUser(Number(req.session?.userId));
        if (target.id !== 1) throw httpError(403, "KAY_DIRECT_CALL_TARGET_REQUIRED");
        const callId = Number(req.params.callId);
        if (!Number.isInteger(callId) || callId < 1) throw httpError(400, "KAY_INTERNAL_CALL_ID_REQUIRED");
        const call = await getCall(callId);
        if (!call || !isDirectCall(call) || call.caller !== "KAY" || Number(call.target_user_id) !== target.id) {
          throw httpError(404, "KAY_INTERNAL_CALL_NOT_FOUND");
        }
        let targetSocket: CallSocket | undefined;
        if (action === "answer") {
          const connectionId = String(req.body?.connectionId || "");
          targetSocket = Array.from(socketsByUser.get(target.id) || []).find(socket =>
            socket.kayConnectionId === connectionId && socket.readyState === WebSocket.OPEN
          );
          if (!targetSocket) throw httpError(409, "KAY_DIRECT_CALL_TARGET_SOCKET_REQUIRED");
          answeringConnectionByCall.set(callId, connectionId);
        } else if (action === "end") {
          const connectionId = answeringConnectionByCall.get(callId);
          targetSocket = Array.from(socketsByUser.get(target.id) || []).find(socket =>
            socket.kayConnectionId === connectionId && socket.readyState === WebSocket.OPEN
          );
        }
        const expiry = directExpiry(call);
        if (expiry.getTime() <= Date.now()) {
          if (action !== "end") {
            await updateCallStatus(callId, "ENDED", ["RINGING", "ACTIVE"]);
            throw httpError(410, "KAY_DIRECT_CALL_EXPIRED");
          }
          await updateCallStatus(callId, "ENDED", ["RINGING", "ACTIVE"]);
          directExpiryTimers.get(callId) && clearTimeout(directExpiryTimers.get(callId));
          directExpiryTimers.delete(callId);
          await deliverToConnectedSockets(target.id, { type: "KAY_CALL_ENDED", call_session_id: callId });
          return res.status(200).json({ call_session_id: callId, status: "ENDED" });
        }
        await updateCallStatus(callId, nextStatus, [...allowed]);
        if (nextStatus === "ACTIVE") {
          await onKayCallAnswered(callId);
        } else {
          await onKayCallEnded(callId).catch(error => console.error("[KayRecording] end hook failed:", error?.message || error));
          if (action === "end") {
            const recordingResult = await finalizePendingKayRecording(callId);
            if (targetSocket) {
              await sendToSocketIfAuthorized(targetSocket, {
                type: "recording_upload_result",
                callId,
                ok: recordingResult.ok,
                ...(recordingResult.ok ? {} : { reason: recordingResult.reason }),
              }).catch(() => {});
            }
          }
        }
        if (nextStatus !== "ACTIVE") {
          directExpiryTimers.get(callId) && clearTimeout(directExpiryTimers.get(callId));
          directExpiryTimers.delete(callId);
        }
        if (action !== "answer") {
          await deliverToConnectedSockets(target.id, { type: "KAY_CALL_ENDED", call_session_id: callId });
          if (call.reason_code === "ADMIN_TEST") disableAfterHoursTarekTestRuntime();
        }
        return res.status(200).json({ call_session_id: callId, status: nextStatus });
      } catch (error: any) {
        return res.status(error?.status || 500).json({ message: error?.message || "Unable to update Kay call." });
      }
    });
  }

  app.post("/api/admin/kay/internal-calls", async (req: any, res: Response) => {
    try {
      const call = await createKayInternalCall({
        initiatorUserId: Number(req.session?.userId),
        targetUserId: Number(req.body?.targetUserId),
        initiatorConnectionId: String(req.body?.initiatorConnectionId || ""),
        initiationType: req.body?.initiationType,
        reasonCode: req.body?.reasonCode,
        title: req.body?.title,
        idempotencyKey: req.body?.idempotencyKey,
      });
      return res.status(201).json(call);
    } catch (error: any) {
      return res.status(error?.status || 500).json({ message: error?.message || "Unable to create Kay internal call." });
    }
  });

  app.post("/api/admin/kay/internal-calls/:callId/commitments", async (req: any, res: Response) => {
    try {
      requireEnabled();
      const actor = await loadAuthorizedUser(Number(req.session?.userId));
      if (!actor.isAdmin || actor.id !== 1) throw httpError(403, "KAY_INTERNAL_CALL_ADMIN_REQUIRED");
      const sourceCallSessionId = Number(req.params.callId);
      const employeeId = Number(req.body?.employeeId);
      const leadRef = req.body?.leadRef == null ? null : Number(req.body.leadRef);
      const actionType = String(req.body?.actionType || "").trim().slice(0, 120);
      const dueAt = new Date(req.body?.dueAt);
      if (!Number.isInteger(sourceCallSessionId) || sourceCallSessionId < 1 ||
          !Number.isInteger(employeeId) || employeeId < 1 ||
          (leadRef !== null && (!Number.isInteger(leadRef) || leadRef < 1)) ||
          !actionType || Number.isNaN(dueAt.getTime())) {
        throw httpError(400, "KAY_INTERNAL_CALL_COMMITMENT_INVALID");
      }
      const result = await createCommitmentFromCallOutcome({
        sourceCallSessionId,
        employeeId,
        leadRef,
        actionType,
        dueAt,
      });
      return res.status(result.rowCount ? 201 : 200).json(result.rows[0] || { existing: true });
    } catch (error: any) {
      return res.status(error?.status || 500).json({ message: error?.message || "Unable to save Kay call commitment." });
    }
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_RAW_MESSAGE_BYTES });
  httpServer.on("upgrade", (request: IncomingMessage, socket, head) => {
    const requestUrl = new URL(request.url || "/", "http://localhost");
    if (requestUrl.pathname !== "/ws/kay-calls") return;
    if (!KAY_INTERNAL_CALLS_ENABLED()) return rejectUpgrade(socket);
    if (!isAllowedKayCallOrigin(request)) return rejectUpgrade(socket);

    const response = new ServerResponse(request);
    sessionMiddleware(request as any, response as any, () => {
      const userId = Number((request as any).session?.userId);
      loadAuthorizedUser(userId).then(() => {
        wss.handleUpgrade(request, socket, head, ws => {
          const client = ws as CallSocket;
          client.kayUserId = userId;
          client.kayRequest = request;
          client.kayConnectionId = randomUUID();
          addSocket(userId, client);
          client.send(JSON.stringify({ type: "call_socket_ready", connectionId: client.kayConnectionId }));
          client.on("close", () => removeSocket(userId, client));
          getLatestRingingCall(userId).then(async call => {
            if (!call || client.readyState !== WebSocket.OPEN) return;
            const initiatingConnectionId = initiatingConnectionByCall.get(Number(call.id));
            if (Number(call.target_user_id) === userId &&
                initiatingConnectionId === client.kayConnectionId) {
              return;
            }
            const target = await loadAuthorizedUser(Number(call.target_user_id));
            if (isDirectCall(call)) {
              const expiry = directExpiry(call);
              if (expiry.getTime() <= Date.now()) {
                await updateCallStatus(Number(call.id), "ENDED", ["RINGING"]);
                return;
              }
              await sendToSocketIfAuthorized(client, {
                type: "KAY_CALL_INCOMING",
                call_session_id: Number(call.id),
                reason_code: call.reason_code,
                display_title: "Kay is calling",
                expiry: expiry.toISOString(),
              });
              return;
            }
            const pendingOffer = pendingOffersByCall.get(Number(call.id));
            await sendToSocketIfAuthorized(client, {
              type: "incoming_call",
              callId: call.id,
              caller: "KAY",
              targetUserId: target.id,
              targetName: target.username,
              reasonCode: call.reason_code,
              ...(pendingOffer?.title ? { title: pendingOffer.title } : {}),
            });
            if (pendingOffer?.sdp.sdp && client.readyState === WebSocket.OPEN) {
              await sendToSocketIfAuthorized(client, {
                type: "call_offer",
                callId: Number(call.id),
                sdp: pendingOffer.sdp,
              }, {
                ...(initiatingConnectionId
                  ? { excludedConnectionId: initiatingConnectionId }
                  : {}),
              });
            }
          }).then(() => flushQueuedSignals(userId, client)).catch(() => {});
          let messageChain = Promise.resolve();
          client.on("message", raw => {
            const processMessage = async () => {
              try {
                if (Buffer.byteLength(raw.toString(), "utf8") > MAX_RAW_MESSAGE_BYTES) {
                  throw httpError(413, "KAY_INTERNAL_CALL_SIGNAL_TOO_LARGE");
                }
                const message = validateSignal(JSON.parse(raw.toString()));
                const { type, callId } = message;
                const currentUserId = await reloadSocketSession(request);
                if (currentUserId !== client.kayUserId) {
                  throw httpError(401, "KAY_INTERNAL_CALL_SESSION_CHANGED");
                }
                const { call, peerId, deliveryOptions } = await authorizeSignal(
                  callId,
                  currentUserId,
                  client.kayConnectionId || "",
                  type,
                );

                if (type === "recording_notice_result") {
                  const result = await onKayRecordingNoticePlayed(
                    callId,
                    message.played === true,
                    message.failureReason,
                  );
                  if (!result.rowCount) throw httpError(409, "KAY_RECORDING_NOTICE_STATE_CHANGED");
                  if (message.played === true) {
                    const started = await onKayRecordingStarted(callId);
                    if (!started.rowCount) throw httpError(409, "KAY_RECORDING_START_STATE_CHANGED");
                  }
                  return;
                }
                if (type === "recording_objection") {
                  const result = await recordKayRecordingObjection(callId);
                  if (!result.rowCount) throw httpError(409, "KAY_RECORDING_OBJECTION_STATE_CHANGED");
                  return;
                }
                if (type === "recording_upload_begin") {
                  if (pendingRecordingUploadsByCall.has(callId)) {
                    throw httpError(409, "KAY_RECORDING_UPLOAD_ALREADY_STARTED");
                  }
                  pendingRecordingUploadsByCall.set(callId, {
                    userId: currentUserId,
                    connectionId: client.kayConnectionId || "",
                    contentType: message.contentType,
                    totalBytes: message.totalBytes,
                    bytes: 0,
                    chunks: [],
                    complete: false,
                  });
                  return;
                }
                if (type === "recording_upload_chunk") {
                  const pending = pendingRecordingUploadsByCall.get(callId);
                  if (!pending ||
                      pending.userId !== currentUserId ||
                      pending.connectionId !== client.kayConnectionId ||
                      pending.complete) {
                    throw httpError(409, "KAY_RECORDING_UPLOAD_NOT_OPEN");
                  }
                  const chunk = Buffer.from(message.data, "base64");
                  if (pending.bytes + chunk.length > pending.totalBytes ||
                      pending.bytes + chunk.length > KAY_RECORDING_MAX_AUDIO_BYTES) {
                    throw httpError(413, "KAY_RECORDING_UPLOAD_TOO_LARGE");
                  }
                  pending.chunks.push(chunk);
                  pending.bytes += chunk.length;
                  return;
                }
                if (type === "recording_upload_complete") {
                  const pending = pendingRecordingUploadsByCall.get(callId);
                  if (!pending ||
                      pending.userId !== currentUserId ||
                      pending.connectionId !== client.kayConnectionId ||
                      pending.bytes !== pending.totalBytes) {
                    throw httpError(409, "KAY_RECORDING_UPLOAD_INCOMPLETE");
                  }
                  pending.complete = true;
                  return;
                }

                if (type === "call_offer") {
                  const existing = pendingOffersByCall.get(callId);
                  pendingOffersByCall.set(callId, {
                    sdp: message.sdp as { type: "offer"; sdp: string },
                    ...(existing?.title ? { title: existing.title } : {}),
                  });
                }
                if (type === "call_answer") {
                  await updateCallStatus(callId, "ACTIVE", ["RINGING"]);
                  answeringConnectionByCall.set(callId, client.kayConnectionId || "");
                  await onKayCallAnswered(callId);
                }
                if (type === "call_reject") await updateCallStatus(callId, "REJECTED", ["RINGING"]);
                if (type === "call_busy") await updateCallStatus(callId, "BUSY", ["RINGING"]);
                if (type === "call_end") {
                  await updateCallStatus(callId, "ENDED", ["RINGING", "ACTIVE"]);
                  await onKayCallEnded(callId);
                  const recordingResult = await finalizePendingKayRecording(callId);
                  if (client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify({
                      type: "recording_upload_result",
                      callId,
                      ok: recordingResult.ok,
                      ...(recordingResult.ok ? {} : { reason: recordingResult.reason }),
                    }));
                  }
                }
                const event = (
                  type === "call_offer" || type === "call_answer"
                    ? { type, callId, sdp: message.sdp }
                    : type === "ice_candidate"
                      ? { type, callId, candidate: message.candidate }
                      : { type, callId }
                ) as ForwardedSignal;
                if (type === "call_reject" || type === "call_busy" || type === "call_end") {
                  dropQueuedCallSignals(callId);
                }
                await deliverOrQueueSignal(peerId, event, deliveryOptions);
                if (type === "call_reject" || type === "call_busy" || type === "call_end") client.send(JSON.stringify({ type, callId }));
                if (type === "call_answer" || type === "call_reject" || type === "call_busy" || type === "call_end") {
                  clearEphemeralCallState(callId);
                }
                if (type === "call_reject" || type === "call_busy" || type === "call_end") {
                  initiatingConnectionByCall.delete(callId);
                  if (type !== "call_end") answeringConnectionByCall.delete(callId);
                  if (call.reason_code === "ADMIN_TEST") disableAfterHoursTarekTestRuntime();
                }
              } catch (error: any) {
                if (error?.status === 401 || error?.status === 403) {
                  client.close(1008, "Not authorized");
                } else if (client.readyState === WebSocket.OPEN) {
                  client.send(JSON.stringify({ type: "error", message: error?.message || "KAY_INTERNAL_CALL_SIGNAL_FAILED" }));
                }
              }
            };
            messageChain = messageChain.then(processMessage, processMessage);
          });
        });
      }).catch(() => rejectUpgrade(socket));
    });
  });
}