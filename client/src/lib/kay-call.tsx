import { useCallback, useEffect, useMemo, useRef, useState, createContext, useContext } from "react";
import { Mic, MicOff, Phone, PhoneOff, X } from "lucide-react";
import { useAuth } from "./auth";
import { Button } from "@/components/ui/button";

export const KAY_INTERNAL_CALL_USER_IDS = new Set([1, 24, 29, 31]);
export const KAY_AUDIO_CONSTRAINTS: MediaStreamConstraints = { audio: true, video: false };
export const KAY_TAREK_TEST_MESSAGE =
  "مساء الخير أستاذ طارق، معك كاي. هذه أول مكالمة تجريبية مباشرة بيني وبينك داخل تطبيق كينغ لايك. إذا كنت تسمعني بشكل واضح، فالاتصال يعمل بشكل صحيح.";

export type KayCallStatus = "idle" | "incoming" | "connecting" | "connected" | "ended" | "error";
export type KayIncomingCall = {
  callId: number;
  caller: "KAY";
  targetUserId: number;
  targetName: string;
  reasonCode?: string;
  title?: string;
  direct?: boolean;
  expiry?: string;
};

export function kayCallUrl(pathname: string = window.location.pathname): string {
  return pathname === "/admin/kay/call" ? pathname : "/admin/kay/call";
}

export function isKayCallPushUrl(url: string = window.location.href): boolean {
  try {
    const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    return new URL(url, origin).pathname === "/admin/kay/call";
  } catch {
    return false;
  }
}

function socketUrl() {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/kay-calls`;
}

function safeBriefing(text: string) {
  return text.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
}

function formatDuration(startedAt: number | null, now: number) {
  if (!startedAt) return "00:00";
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

type KayCallContextValue = {
  status: KayCallStatus;
  incomingCall: KayIncomingCall | null;
  callTitle: string;
  callReason: string;
  muted: boolean;
  duration: string;
  answer: () => Promise<void>;
  startCall: (targetUserId: number, reasonCode: string, title?: string, initiationType?: string) => Promise<void>;
  reject: () => void;
  end: () => void;
  toggleMute: () => void;
};

const KayCallContext = createContext<KayCallContextValue | null>(null);

export function useKayCall() {
  const context = useContext(KayCallContext);
  if (!context) throw new Error("useKayCall must be used within KayCallProvider");
  return context;
}

export function IncomingKayCall({
  call,
  canAnswer,
  onAnswer,
  onReject,
}: {
  call: KayIncomingCall;
  canAnswer: boolean;
  onAnswer: () => void;
  onReject: () => void;
}) {
  return (
    <section className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-md rounded-2xl border border-[#b9d9d6] bg-[#fbfdfd] p-5 shadow-2xl" role="dialog" aria-label="Incoming Kay call">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-[#59838a]">Internal Kay call</p>
          <h2 className="mt-1 text-xl font-bold text-[#005476]">Kay is calling</h2>
          <p className="mt-1 text-sm text-slate-600">{call.targetName}</p>
          {call.title && <p className="mt-3 text-sm font-medium text-[#163b3b]">{call.title}</p>}
        </div>
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[#d8eee8] text-[#005476]">
          <Phone className="h-5 w-5" />
        </span>
      </div>
      <div className="mt-5 flex gap-3">
          <Button className="flex-1 bg-[#16736e] hover:bg-[#125e5a]" onClick={onAnswer} disabled={!canAnswer}>
          <Phone className="h-4 w-4" /> {canAnswer ? "Answer" : "Preparing…"}
        </Button>
        <Button className="flex-1" variant="outline" onClick={onReject}>
          <X className="h-4 w-4" /> Reject
        </Button>
      </div>
    </section>
  );
}

export function KayActiveCall({
  status,
  duration,
  muted,
  title,
  onMute,
  onEnd,
  micLevel = 0,
}: {
  status: Exclude<KayCallStatus, "idle" | "incoming">;
  duration: string;
  muted: boolean;
  title: string;
  onMute: () => void;
  onEnd: () => void;
  micLevel?: number;
}) {
  return (
    <section className="fixed inset-x-4 bottom-4 z-[100] mx-auto max-w-md rounded-2xl border border-[#b9d9d6] bg-[#fbfdfd] p-5 shadow-2xl" role="dialog" aria-label="Active Kay call">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-[#d8eee8] text-[#005476]">
          <Phone className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-widest text-[#59838a]">Internal Kay call</p>
          <h2 className="truncate text-lg font-bold text-[#005476]">{title || "Kay call"}</h2>
        </div>
        <span className="font-mono text-sm text-slate-600">{status === "connected" ? duration : "Connecting…"}</span>
      </div>
      <p className="mt-3 text-sm text-slate-600">{status === "connected" ? "Connected" : status === "error" ? "Call unavailable" : "Connecting securely…"}</p>
      {status === "connected" && <div className="mt-3 flex items-end gap-1" aria-label="Microphone activity">
        {[0, 1, 2, 3, 4].map((bar) => <span key={bar} className="w-1 rounded-full bg-[#16736e]" style={{ height: `${6 + Math.min(18, micLevel * (bar + 1) * 3)}px` }} />)}
      </div>}
      <div className="mt-5 flex gap-3">
        <Button variant="outline" onClick={onMute} disabled={status !== "connected"} aria-label={muted ? "Unmute" : "Mute"}>
          {muted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />} {muted ? "Unmute" : "Mute"}
        </Button>
        <Button className="flex-1 bg-red-700 hover:bg-red-800" onClick={onEnd}>
          <PhoneOff className="h-4 w-4" /> End call
        </Button>
      </div>
    </section>
  );
}

export function KayCallInitiator() {
  const { user } = useAuth();
  const { status, startCall } = useKayCall();
  const [targetUserId, setTargetUserId] = useState(24);
  const [title, setTitle] = useState("Internal Kay briefing");
  const [error, setError] = useState("");
  const isAdmin = user?.id === 1 && user.isAdmin;
  const busy = status === "connecting" || status === "connected" || status === "incoming";
  const targets = [
    [1, "Tarek / admin"],
    [24, "Fadi"],
    [29, "Samer"],
    [31, "jwana"],
  ] as const;

  if (!isAdmin) {
    return <p className="text-sm text-slate-600">Internal Kay calling is available to the Kay administrator only.</p>;
  }

  const initiate = async () => {
    setError("");
    try {
      await startCall(
        targetUserId,
        targetUserId === 1 ? "ADMIN_TEST" : "MANUAL_INTERNAL_TEST",
        targetUserId === 1 ? KAY_TAREK_TEST_MESSAGE : title,
        targetUserId === 1 ? "ADMIN_TEST" : "MANUAL",
      );
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : "Internal Kay calling is unavailable.");
    }
  };

  return (
    <section className="mx-auto max-w-xl rounded-2xl border border-[#d9e7e6] bg-[#fbfdfd] p-6" aria-label="Start internal Kay call">
      <p className="text-xs font-bold uppercase tracking-widest text-[#59838a]">Admin-only test</p>
      <h1 className="mt-2 text-2xl font-bold text-[#005476]">Start an internal Kay call</h1>
      <p className="mt-2 text-sm text-slate-600">Audio stays inside the app. No customer records, phone numbers, or CRM fields are used.</p>
      <label className="mt-5 block text-sm font-medium text-[#163b3b]">
        Internal staff member
        <select className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3" value={targetUserId} onChange={(event) => setTargetUserId(Number(event.target.value))} disabled={busy}>
          {targets.map(([id, name]) => <option value={id} key={id}>{name}</option>)}
        </select>
      </label>
      <label className="mt-4 block text-sm font-medium text-[#163b3b]">
        Briefing title
        <input className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3" value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} disabled={busy} />
      </label>
      <div className="mt-5 flex items-center gap-3">
        <Button onClick={initiate} disabled={busy || !title.trim()}>
          <Phone className="h-4 w-4" /> {status === "connecting" ? "Connecting…" : "Start call"}
        </Button>
        {status === "error" && <span className="text-sm text-red-700">Calls are off or unavailable.</span>}
      </div>
      {error && <p className="mt-3 text-sm text-red-700" role="alert">{error}</p>}
      {status === "idle" && <p className="mt-3 text-xs text-slate-500">The backend kill switch must be enabled for a test call.</p>}
    </section>
  );
}

export function KayCallProvider({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const socketRef = useRef<WebSocket | null>(null);
  const connectionIdRef = useRef<string | null>(null);
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const micAnimationRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const pendingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingCandidatesRef = useRef<RTCIceCandidateInit[]>([]);
  const incomingCallRef = useRef<KayIncomingCall | null>(null);
  const statusRef = useRef<KayCallStatus>("idle");
  const socketReadyRef = useRef<Promise<void> | null>(null);
  const reconnectRef = useRef<number | null>(null);
  const peerDisconnectRef = useRef<number | null>(null);
  const initiatedCallIdsRef = useRef<Set<number>>(new Set());
  const spokenTestCallIdsRef = useRef<Set<number>>(new Set());
  const directExpiryTimerRef = useRef<number | null>(null);
  const [status, setStatus] = useState<KayCallStatus>("idle");
  const [incomingCall, setIncomingCall] = useState<KayIncomingCall | null>(null);
  const [muted, setMuted] = useState(false);
  const [offerReady, setOfferReady] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [now, setNow] = useState(Date.now());
  const [micLevel, setMicLevel] = useState(0);
  const [callError, setCallError] = useState("");
  const [directTestReady, setDirectTestReady] = useState(false);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const authorized = !!user && KAY_INTERNAL_CALL_USER_IDS.has(user.id) && (user.isAdmin || user.role === "sub_agent");
  const activeCall = incomingCall;
  const callTitle = activeCall?.title || "Kay internal briefing";
  const callReason = activeCall?.reasonCode || "";
  const duration = formatDuration(startedAt, now);

  const send = useCallback((message: Record<string, unknown>) => {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }, []);

  const waitForSocket = useCallback(async () => {
    if (socketRef.current?.readyState === WebSocket.OPEN && connectionIdRef.current) return;
    if (!socketReadyRef.current) {
      socketReadyRef.current = new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 5000;
        const poll = () => {
          if (socketRef.current?.readyState === WebSocket.OPEN && connectionIdRef.current) return resolve();
          if (Date.now() >= deadline) return reject(new Error("Kay call signaling is unavailable."));
          window.setTimeout(poll, 50);
        };
        poll();
      }).finally(() => { socketReadyRef.current = null; });
    }
    return socketReadyRef.current;
  }, []);

  const cleanup = useCallback(() => {
    if (peerDisconnectRef.current) {
      window.clearTimeout(peerDisconnectRef.current);
      peerDisconnectRef.current = null;
    }
    if (directExpiryTimerRef.current !== null) {
      window.clearTimeout(directExpiryTimerRef.current);
      directExpiryTimerRef.current = null;
    }
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (micAnimationRef.current !== null) cancelAnimationFrame(micAnimationRef.current);
    micAnimationRef.current = null;
    if (audioContextRef.current) void audioContextRef.current.close();
    audioContextRef.current = null;
    if (peerRef.current) {
      peerRef.current.onconnectionstatechange = null;
      peerRef.current.close();
    }
    peerRef.current = null;
    pendingOfferRef.current = null;
    pendingCandidatesRef.current = [];
    setOfferReady(false);
    if (audioRef.current) audioRef.current.srcObject = null;
    window.speechSynthesis?.cancel();
    setMicLevel(0);
    setIncomingCall(null);
    incomingCallRef.current = null;
    setMuted(false);
    setStartedAt(null);
    setStatus("idle");
    setCallError("");
  }, []);

  const answerDirect = useCallback(async (call: KayIncomingCall) => {
    const stream = await navigator.mediaDevices.getUserMedia(KAY_AUDIO_CONSTRAINTS);
    streamRef.current = stream;
    const context = new AudioContext();
    audioContextRef.current = context;
    const analyser = context.createAnalyser();
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      if (!streamRef.current) return;
      analyser.getByteTimeDomainData(data);
      setMicLevel(Math.abs(data.reduce((sum, value) => sum + value - 128, 0)) / data.length);
      micAnimationRef.current = requestAnimationFrame(tick);
    };
    tick();
    const response = await fetch(`/api/admin/kay/internal-calls/${call.callId}/answer`, { method: "POST", credentials: "include" });
    if (!response.ok) throw new Error("Unable to answer Kay call.");
    setStatus("connected");
    setStartedAt(Date.now());
    if ("speechSynthesis" in window) {
      const utterance = new SpeechSynthesisUtterance(KAY_TAREK_TEST_MESSAGE);
      utterance.lang = "ar";
      const voices = window.speechSynthesis.getVoices().filter((voice) => voice.lang.toLowerCase().startsWith("ar"));
      utterance.voice = voices.find((voice) => /(male|tarik|tarek|hamed|maged|omar|ahmed)/i.test(voice.name)) || voices[0] || null;
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    }
  }, []);

  const playTarekTestVoice = useCallback((callId: number) => {
    if (initiatedCallIdsRef.current.has(callId) || spokenTestCallIdsRef.current.has(callId)) return;
    if (incomingCallRef.current?.reasonCode !== "ADMIN_TEST" || !("speechSynthesis" in window)) return;
    const utterance = new SpeechSynthesisUtterance(KAY_TAREK_TEST_MESSAGE);
    utterance.lang = "ar";
    const arabicVoices = window.speechSynthesis.getVoices()
      .filter((voice) => voice.lang.toLowerCase().startsWith("ar"));
    utterance.voice = arabicVoices.find((voice) =>
      /(male|tarik|tarek|hamed|maged|omar|ahmed)/i.test(voice.name)
    ) || arabicVoices[0] || null;
    spokenTestCallIdsRef.current.add(callId);
    window.speechSynthesis.speak(utterance);
  }, []);

  const monitorPeer = useCallback((peer: RTCPeerConnection, callId: number) => {
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") {
        if (peerDisconnectRef.current) window.clearTimeout(peerDisconnectRef.current);
        peerDisconnectRef.current = null;
        setStatus("connected");
        setStartedAt(current => current || Date.now());
        playTarekTestVoice(callId);
        return;
      }
      if (peer.connectionState === "failed" || peer.connectionState === "closed") {
        send({ type: "call_end", callId });
        cleanup();
        setStatus("error");
        return;
      }
      if (peer.connectionState === "disconnected" && !peerDisconnectRef.current) {
        setStatus("connecting");
        peerDisconnectRef.current = window.setTimeout(() => {
          send({ type: "call_end", callId });
          cleanup();
          setStatus("error");
        }, 8000);
      }
    };
  }, [cleanup, playTarekTestVoice, send]);

  const answer = useCallback(async () => {
    if (!incomingCall) return;
    try {
      setStatus("connecting");
      if (incomingCall.direct) {
        await answerDirect(incomingCall);
        return;
      }
      const stream = await navigator.mediaDevices.getUserMedia(KAY_AUDIO_CONSTRAINTS);
      streamRef.current = stream;
      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      monitorPeer(peer, incomingCall.callId);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.ontrack = (event) => {
        if (audioRef.current) {
          audioRef.current.srcObject = event.streams[0];
          void audioRef.current.play().catch(() => {});
        }
      };
      peer.onicecandidate = (event) => {
        if (event.candidate) send({ type: "ice_candidate", callId: incomingCall.callId, candidate: event.candidate.toJSON() });
      };
      if (!pendingOfferRef.current) throw new Error("Kay call offer is missing.");
      await peer.setRemoteDescription(pendingOfferRef.current);
      for (const candidate of pendingCandidatesRef.current) await peer.addIceCandidate(candidate).catch(() => {});
      const answerDescription = await peer.createAnswer();
      await peer.setLocalDescription(answerDescription);
      send({ type: "call_answer", callId: incomingCall.callId, sdp: answerDescription });
    } catch {
      if (incomingCall) send({ type: "call_reject", callId: incomingCall.callId });
      cleanup();
      setStatus("error");
    }
  }, [answerDirect, cleanup, incomingCall, monitorPeer, send]);

  const startCall = useCallback(async (targetUserId: number, reasonCode: string, title?: string, initiationType = "MANUAL") => {
    if (!user?.isAdmin || user.id !== 1 || !KAY_INTERNAL_CALL_USER_IDS.has(targetUserId)) {
      throw new Error("Only the Kay administrator may start an internal call.");
    }
    let createdCallId: number | null = null;
    try {
      setStatus("connecting");
      if (targetUserId === 1 && initiationType === "ADMIN_TEST") {
        const response = await fetch("/api/admin/kay/internal-calls/start", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target_user_id: 1, reason_code: "ADMIN_TEST", test_mode: true }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload.call_session_id) throw new Error(payload.message || "Kay direct calls are unavailable.");
        return;
      }
      await waitForSocket();
      const response = await fetch("/api/admin/kay/internal-calls", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetUserId,
          initiatorConnectionId: connectionIdRef.current,
          initiationType,
          reasonCode: safeBriefing(reasonCode),
          title: title ? safeBriefing(title) : undefined,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.callId) throw new Error(payload.error || "Kay internal calls are unavailable.");
      createdCallId = Number(payload.callId);
      if (!Number.isInteger(createdCallId) || createdCallId < 1) {
        throw new Error("Kay internal call returned an invalid session.");
      }
      initiatedCallIdsRef.current.add(createdCallId);
      const call: KayIncomingCall = {
        callId: createdCallId,
        caller: "KAY",
        targetUserId,
        targetName: safeBriefing(payload.targetName || `User ${targetUserId}`),
        reasonCode: safeBriefing(payload.reasonCode || reasonCode),
        title: payload.title ? safeBriefing(payload.title) : (title ? safeBriefing(title) : undefined),
      };
      incomingCallRef.current = call;
      setIncomingCall(call);
      const stream = await navigator.mediaDevices.getUserMedia(KAY_AUDIO_CONSTRAINTS);
      streamRef.current = stream;
      const peer = new RTCPeerConnection();
      peerRef.current = peer;
      monitorPeer(peer, call.callId);
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.ontrack = (event) => {
        if (audioRef.current) {
          audioRef.current.srcObject = event.streams[0];
          void audioRef.current.play().catch(() => {});
        }
      };
      peer.onicecandidate = (event) => {
        if (event.candidate) send({ type: "ice_candidate", callId: call.callId, candidate: event.candidate.toJSON() });
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      send({ type: "call_offer", callId: call.callId, sdp: offer });
    } catch (error) {
      if (createdCallId) send({ type: "call_end", callId: createdCallId });
      cleanup();
      setStatus("error");
      throw error;
    }
  }, [cleanup, monitorPeer, send, user, waitForSocket]);

  const reject = useCallback(async () => {
    try {
      if (incomingCall?.direct) {
        const response = await fetch(`/api/admin/kay/internal-calls/${incomingCall.callId}/reject`, { method: "POST", credentials: "include" });
        if (!response.ok) throw new Error("Unable to reject Kay call.");
      } else if (incomingCall) send({ type: "call_reject", callId: incomingCall.callId });
      cleanup();
    } catch {
      cleanup();
      setCallError("Kay call was not rejected on the server.");
    }
  }, [cleanup, incomingCall, send]);

  const end = useCallback(async () => {
    try {
      if (incomingCall?.direct) {
        const response = await fetch(`/api/admin/kay/internal-calls/${incomingCall.callId}/end`, { method: "POST", credentials: "include" });
        if (!response.ok) throw new Error("Unable to end Kay call.");
      } else if (incomingCall) send({ type: "call_end", callId: incomingCall.callId });
      cleanup();
    } catch {
      cleanup();
      setCallError("Kay call was not ended on the server.");
    }
  }, [cleanup, incomingCall, send]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !next; });
    setMuted(next);
  }, [muted]);

  useEffect(() => {
    if (!startedAt) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [startedAt]);

  useEffect(() => {
    if (!authorized || user?.id !== 1 || !user.isAdmin || status !== "idle") {
      setDirectTestReady(false);
      return;
    }
    let disposed = false;
    const check = async () => {
      const response = await fetch("/api/admin/kay/internal-calls/test-readiness", { credentials: "include" }).catch(() => null);
      const payload = await response?.json().catch(() => ({}));
      if (!disposed) setDirectTestReady(response?.ok === true && payload?.ready === true);
    };
    void check();
    const interval = window.setInterval(check, 2000);
    return () => {
      disposed = true;
      window.clearInterval(interval);
    };
  }, [authorized, status, user?.id, user?.isAdmin]);

  useEffect(() => {
    if (isLoading || !authorized) return;
    let disposed = false;
    const connect = () => {
      if (disposed) return;
      const socket = new WebSocket(socketUrl());
      socketRef.current = socket;
      socket.onmessage = (event) => {
        let message: any;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message?.type === "call_socket_ready" && typeof message.connectionId === "string") {
          connectionIdRef.current = message.connectionId;
          return;
        }
        if (message?.type === "error") {
          cleanup();
          setStatus("error");
          return;
        }
        if (message?.type === "KAY_CALL_ENDED") {
          if (Number(message.call_session_id) === incomingCallRef.current?.callId) cleanup();
          return;
        }
        if (!message?.callId && message?.type !== "incoming_call" && message?.type !== "KAY_CALL_INCOMING") return;
        if (message.type === "KAY_CALL_INCOMING") {
          const callId = Number(message.call_session_id);
          if (Number.isInteger(callId) && callId > 0 && !incomingCallRef.current) {
            const directCall: KayIncomingCall = {
              callId, caller: "KAY", targetUserId: user?.id || 1, targetName: "Kay",
              reasonCode: safeBriefing(String(message.reason_code || "")),
              title: safeBriefing(String(message.display_title || "Kay is calling")),
              direct: true, expiry: String(message.expiry || ""),
            };
            incomingCallRef.current = directCall;
            setIncomingCall(directCall);
            setOfferReady(true);
            setStatus("incoming");
            const expiresAt = Date.parse(directCall.expiry || "");
            if (Number.isFinite(expiresAt)) {
              const expire = () => {
                if (incomingCallRef.current?.callId !== callId) return;
                void fetch(`/api/admin/kay/internal-calls/${callId}/end`, { method: "POST", credentials: "include" })
                  .then((response) => {
                    if (!response.ok) throw new Error("expiry persistence failed");
                    cleanup();
                  })
                  .catch(() => {
                    cleanup();
                    setCallError("Kay call expired; server cleanup is pending.");
                  });
              };
              if (expiresAt <= Date.now()) expire();
              else directExpiryTimerRef.current = window.setTimeout(expire, expiresAt - Date.now());
            }
          }
        } else if (message.type === "incoming_call") {
          if (Number(message.targetUserId) !== user?.id || message.caller !== "KAY") return;
          const incomingCallId = Number(message.callId);
          if (!Number.isInteger(incomingCallId) || incomingCallId < 1) return;
          if (incomingCallRef.current?.callId === incomingCallId) return;
          if (incomingCallRef.current && statusRef.current !== "idle" && statusRef.current !== "ended" && statusRef.current !== "error") {
            send({ type: "call_busy", callId: incomingCallId });
            return;
          }
          setIncomingCall({
            callId: incomingCallId,
            caller: "KAY",
            targetUserId: Number(message.targetUserId),
            targetName: String(message.targetName || "Internal user"),
            reasonCode: typeof message.reasonCode === "string" ? message.reasonCode : undefined,
            title: typeof message.title === "string" ? safeBriefing(message.title) : undefined,
          });
          incomingCallRef.current = {
            callId: incomingCallId,
            caller: "KAY",
            targetUserId: Number(message.targetUserId),
            targetName: String(message.targetName || "Internal user"),
            reasonCode: typeof message.reasonCode === "string" ? message.reasonCode : undefined,
            title: typeof message.title === "string" ? safeBriefing(message.title) : undefined,
          };
          setStatus("incoming");
        } else if (Number(message.callId) === incomingCallRef.current?.callId) {
          if (message.type === "call_offer") {
            pendingOfferRef.current = message.sdp;
            setOfferReady(true);
          }
          if (message.type === "ice_candidate") {
            if (peerRef.current?.remoteDescription) void peerRef.current.addIceCandidate(message.candidate).catch(() => {});
            else pendingCandidatesRef.current.push(message.candidate);
          }
          if (message.type === "call_answer" && peerRef.current) {
            void peerRef.current.setRemoteDescription(message.sdp).then(async () => {
              for (const candidate of pendingCandidatesRef.current) await peerRef.current?.addIceCandidate(candidate).catch(() => {});
              pendingCandidatesRef.current = [];
              setStatus("connected");
              setStartedAt(Date.now());
            }).catch(() => {
              if (incomingCallRef.current) send({ type: "call_end", callId: incomingCallRef.current.callId });
              cleanup();
              setStatus("error");
            });
          }
          if (["call_reject", "call_end", "call_busy"].includes(message.type)) cleanup();
        }
      };
      socket.onclose = (event) => {
        connectionIdRef.current = null;
        cleanup();
        if (!disposed && event.code !== 1008) reconnectRef.current = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectRef.current) window.clearTimeout(reconnectRef.current);
      socketRef.current?.close();
      socketRef.current = null;
      cleanup();
    };
  }, [authorized, cleanup, isLoading, send, user?.id]);

  const value = useMemo(() => ({ status, incomingCall, callTitle, callReason, muted, duration, answer, startCall, reject, end, toggleMute }), [answer, callReason, callTitle, duration, end, incomingCall, muted, reject, startCall, status, toggleMute]);

  return (
    <KayCallContext.Provider value={value}>
      {children}
      {callError && <div className="fixed bottom-4 left-4 z-[110] rounded-lg bg-red-50 px-4 py-2 text-sm text-red-800 shadow" role="alert">{callError}</div>}
      <audio ref={audioRef} autoPlay aria-hidden="true" />
      {directTestReady && status === "idle" && (
        <Button
          className="fixed bottom-5 right-5 z-[120] bg-[#005476] shadow-2xl hover:bg-[#003f59]"
          onClick={() => {
            setDirectTestReady(false);
            void startCall(1, "ADMIN_TEST", "Kay is calling", "ADMIN_TEST").catch((error) => {
              setCallError(error instanceof Error ? error.message : "Kay direct test call could not start.");
              setStatus("idle");
            });
          }}
        >
          <Phone className="h-4 w-4" /> اتصل بي من KAY الآن
        </Button>
      )}
      {status === "incoming" && incomingCall && <IncomingKayCall call={incomingCall} canAnswer={offerReady || incomingCall.direct === true} onAnswer={answer} onReject={reject} />}
      {(status === "connecting" || status === "connected" || status === "error") && (
        <KayActiveCall status={status} duration={duration} muted={muted} title={callTitle} micLevel={micLevel} onMute={toggleMute} onEnd={end} />
      )}
    </KayCallContext.Provider>
  );
}