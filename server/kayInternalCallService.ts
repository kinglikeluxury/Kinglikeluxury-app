import type { Express, RequestHandler, Response } from "express";
import { ServerResponse, type IncomingMessage, type Server } from "http";
import { randomUUID } from "crypto";
import { WebSocketServer, WebSocket } from "ws";
import { sendPushNotification } from "./notificationService";
import { withKayInternalClient } from "./kayInternalDatabase";
import { withKayReadonlyAnalysis } from "./kayAnalysisDatabase";

const KAY_INTERNAL_CALL_USER_IDS = new Set([1, 24, 29, 31]);
const KAY_INTERNAL_CALL_EVENTS = new Set([
  "call_offer",
  "call_answer",
  "ice_candidate",
  "call_reject",
  "call_end",
  "call_busy",
]);
const KAY_INTERNAL_CALLS_ENABLED = () => process.env.KAY_INTERNAL_CALLS_ENABLED === "true";
const MAX_RAW_MESSAGE_BYTES = 64 * 1024;
const MAX_SDP_BYTES = 32 * 1024;
const MAX_CANDIDATE_BYTES = 16 * 1024;

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

async function getCall(callId: number) {
  const result = await withKayInternalClient(client =>
    client.query(
      `SELECT id,caller,target_user_id,initiated_by_user_id,status,reason_code
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
  } | undefined;
}

async function getLatestRingingCall(targetUserId: number) {
  const result = await withKayInternalClient(client =>
    client.query(
      `SELECT id,caller,target_user_id,status,reason_code
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
  reasonCode?: string;
  title?: string;
  idempotencyKey?: string;
}) {
  requireEnabled();
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
  const idempotencyKey = input.idempotencyKey || randomUUID();
  const reasonCode = String(input.reasonCode || "MANUAL_INTERNAL_TEST").trim().slice(0, 80);
  if (!reasonCode) throw httpError(400, "KAY_INTERNAL_CALL_REASON_REQUIRED");
  const title = sanitizeTitle(input.title);

  const result = await withKayInternalClient(client =>
    createIdempotentCall(client, target.id, initiator.id, reasonCode, idempotencyKey)
  );
  const call = result.rows[0];
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

function validateSignal(message: any) {
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
        RETURNING id,target_user_id,initiated_by_user_id`,
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
    initiatingConnectionByCall.delete(callId);
    answeringConnectionByCall.delete(callId);
    await deliverOrQueueSignal(peerId, { type: "call_end", callId });
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
        RETURNING id,target_user_id,initiated_by_user_id`,
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
    initiatingConnectionByCall.delete(callId);
    answeringConnectionByCall.delete(callId);
    await deliverOrQueueSignal(peerId, { type: "call_end", callId }, deliveryOptions);
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
  app.post("/api/admin/kay/internal-calls", async (req: any, res: Response) => {
    try {
      const call = await createKayInternalCall({
        initiatorUserId: Number(req.session?.userId),
        targetUserId: Number(req.body?.targetUserId),
        initiatorConnectionId: String(req.body?.initiatorConnectionId || ""),
        reasonCode: req.body?.reasonCode,
        title: req.body?.title,
        idempotencyKey: req.body?.idempotencyKey,
      });
      return res.status(201).json(call);
    } catch (error: any) {
      return res.status(error?.status || 500).json({ message: error?.message || "Unable to create Kay internal call." });
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
          client.on("message", async raw => {
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
              }
              if (type === "call_reject") await updateCallStatus(callId, "REJECTED", ["RINGING"]);
              if (type === "call_busy") await updateCallStatus(callId, "BUSY", ["RINGING"]);
              if (type === "call_end") await updateCallStatus(callId, "ENDED", ["RINGING", "ACTIVE"]);
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
                answeringConnectionByCall.delete(callId);
              }
              void call;
            } catch (error: any) {
              if (error?.status === 401 || error?.status === 403) {
                client.close(1008, "Not authorized");
              } else if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: "error", message: error?.message || "KAY_INTERNAL_CALL_SIGNAL_FAILED" }));
              }
            }
          });
        });
      }).catch(() => rejectUpgrade(socket));
    });
  });
}