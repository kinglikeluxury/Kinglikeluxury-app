import { useState, useRef, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  Send, User, Loader2, RefreshCw, Sparkles,
  CalendarDays, MessageSquare, Video, Mail, ChevronRight, ArrowRight,
} from "lucide-react";
import crownIcon from "@assets/crown-icon.png";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type LeadScore = "hot" | "warm" | "cold" | null;

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
}

interface ConversationState {
  conversationId: number | null;
  messages: Message[];
}

// ── Session persistence ───────────────────────────────────────────────────────
const SK = (uid?: number) => `kl_ai_v2_${uid ?? "g"}`;

function saveSession(uid: number | undefined, d: { conv: ConversationState; score: LeadScore }) {
  try { sessionStorage.setItem(SK(uid), JSON.stringify(d)); } catch {}
}
function loadSession(uid: number | undefined) {
  try { const r = sessionStorage.getItem(SK(uid)); return r ? JSON.parse(r) : null; } catch { return null; }
}
function clearSession(uid: number | undefined) {
  try { sessionStorage.removeItem(SK(uid)); } catch {}
}

// ── CTA config ────────────────────────────────────────────────────────────────
const CTA: Record<NonNullable<LeadScore>, { ar: string; en: string; grad: string; actions: any[] }> = {
  hot: {
    ar: "هل أنت مستعد للخطوة التالية؟",
    en: "Ready to take the next step?",
    grad: "from-[#3bcac4] to-[#005476]",
    actions: [
      { ar: "احجز استشارة مجانية", en: "Book a Free Consultation", Icon: CalendarDays, href: "/consultation", primary: true },
      { ar: "تواصل عبر واتساب", en: "WhatsApp Us", Icon: MessageSquare, href: "https://wa.me/995555000000", primary: false, ext: true },
      { ar: "مكالمة فيديو", en: "Schedule Video Call", Icon: Video, href: "/consultation", primary: false },
    ],
  },
  warm: {
    ar: "فريقنا يمكنه تجهيز خياراتك المثالية.",
    en: "Our team can prepare your perfect options.",
    grad: "from-[#3bcac4]/80 to-[#005476]/80",
    actions: [
      { ar: "احجز استشارة", en: "Book a Consultation", Icon: CalendarDays, href: "/consultation", primary: true },
      { ar: "خيارات بالإيميل", en: "Get Options by Email", Icon: Mail, href: "/consultation", primary: false },
    ],
  },
  cold: {
    ar: "استكشف بسرعتك الخاصة.",
    en: "Explore at your own pace.",
    grad: "from-[#005476]/60 to-[#3bcac4]/60",
    actions: [
      { ar: "تصفح العقارات", en: "View Properties", Icon: ChevronRight, href: "/properties", primary: false },
      { ar: "احجز استشارة", en: "Book a Consultation", Icon: CalendarDays, href: "/consultation", primary: false },
    ],
  },
};

function CtaPanel({ score, lang }: { score: LeadScore; lang: string }) {
  const [, nav] = useLocation();
  if (!score) return null;
  const cfg = CTA[score];
  const isRtl = lang === "ar" || lang === "he";
  return (
    <div className="mt-2 mb-3">
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(59,202,196,0.22)", background: "rgba(240,253,252,0.7)" }}>
        <div className={`px-4 pt-3 pb-2 bg-gradient-to-r ${cfg.grad} flex items-center gap-2`}>
          <Sparkles className="w-3.5 h-3.5 text-white flex-shrink-0" />
          <p className="text-white text-xs font-semibold">{lang === "ar" ? cfg.ar : cfg.en}</p>
        </div>
        <div className={`px-4 py-3 flex flex-wrap gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
          {cfg.actions.map((a) => {
            const label = lang === "ar" ? a.ar : a.en;
            const cls = `inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition-all ${
              a.primary ? "text-white border-transparent" : "text-[#005476] border-[#3bcac4]/40 bg-white hover:bg-[#f0fdfc]"
            }`;
            const style = a.primary ? { background: "linear-gradient(135deg,#3bcac4,#005476)" } : {};
            if (a.ext) return (
              <a key={a.en} href={a.href} target="_blank" rel="noopener noreferrer" className={cls} style={style}>
                <a.Icon className="w-3.5 h-3.5" />{label}<ArrowRight className="w-3 h-3 opacity-60" />
              </a>
            );
            return (
              <button key={a.en} onClick={() => nav(a.href)} className={cls} style={style}>
                <a.Icon className="w-3.5 h-3.5" />{label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────
function AiAvatar() {
  return (
    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow-sm flex-shrink-0"
      style={{ border: "1.5px solid rgba(59,202,196,0.35)" }}>
      <img src={crownIcon} alt="" className="w-5 h-5 object-contain" draggable={false} />
    </div>
  );
}

function UserAvatar() {
  return (
    <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
      <User className="w-4 h-4 text-gray-500" />
    </div>
  );
}

function TypingDots() {
  return (
    <div className="flex gap-1 items-center h-5">
      {[0, 150, 300].map((d) => (
        <span key={d} className="w-2 h-2 bg-[#3bcac4] rounded-full animate-bounce" style={{ animationDelay: `${d}ms` }} />
      ))}
    </div>
  );
}

function Bubble({ msg, isRtl }: { msg: Message; isRtl: boolean }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {isUser ? <UserAvatar /> : <AiAvatar />}
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser ? "rounded-tr-sm" : "bg-white shadow-sm border border-gray-100 text-gray-800 rounded-tl-sm"
        }`}
        style={isUser ? { background: "#3bcac4", color: "#fff" } : {}}
        dir={isRtl ? "rtl" : "ltr"}
      >
        {msg.content.split("\n").map((l, i, a) => <span key={i}>{l}{i < a.length - 1 && <br />}</span>)}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function AiAdvisorPage() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const lang = i18n.language;
  const isRtl = lang === "ar" || lang === "he";

  const [conv, setConv] = useState<ConversationState>({ conversationId: null, messages: [] });
  const [leadScore, setLeadScore] = useState<LeadScore>(null);
  const [input, setInput] = useState("");
  const [initialized, setInitialized] = useState(false);

  // Streaming state
  const [streamText, setStreamText] = useState("");       // text being streamed in real-time
  const [isStreaming, setIsStreaming] = useState(false);  // AI is actively streaming
  const [isWaiting, setIsWaiting] = useState(false);     // waiting for first chunk (typing dots)

  const abortRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // ── Session restore ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) { setInitialized(true); return; }
    const saved = loadSession(user.id);
    if (saved?.conv?.conversationId && saved.conv.messages.length > 0) {
      setConv(saved.conv);
      setLeadScore(saved.score);
      setInitialized(true);
    }
    // initialized stays false → triggers auto-start below
  }, [user?.id]);

  // Persist on change
  useEffect(() => {
    if (!user || !conv.conversationId) return;
    saveSession(user.id, { conv, score: leadScore });
  }, [conv, leadScore, user?.id]);

  // Scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conv.messages, streamText, isWaiting]);

  // ── Start conversation ──────────────────────────────────────────────────────
  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai/start", { language: lang }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      const greetingId = "greeting-" + Date.now();
      setLeadScore(null);
      setInitialized(true);

      // Stream the greeting with typewriter
      const chars = [...(data.greeting as string)];
      const total = chars.length;
      const cpt = Math.max(1, Math.ceil(total / 80));
      let idx = 0;
      setIsStreaming(true);
      setStreamText("");

      const tick = () => {
        idx = Math.min(idx + cpt, total);
        setStreamText(chars.slice(0, idx).join(""));
        if (idx < total) {
          setTimeout(tick, 14);
        } else {
          setIsStreaming(false);
          setStreamText("");
          setConv({ conversationId: data.conversationId, messages: [{ id: greetingId, role: "assistant", content: data.greeting }] });
        }
      };
      setTimeout(tick, 14);
    },
  });

  // Auto-start
  useEffect(() => {
    if (!user || initialized || startMutation.isPending || startMutation.isSuccess) return;
    startMutation.mutate();
  }, [user, initialized]);

  // ── Streaming chat ──────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || isStreaming || isWaiting) return;

    const userMsgId = Date.now().toString() + "u";
    setConv(prev => ({
      ...prev,
      messages: [...prev.messages, { id: userMsgId, role: "user", content: text }],
    }));
    setInput("");
    setIsWaiting(true);
    setStreamText("");

    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        signal: abortRef.current.signal,
        body: JSON.stringify({ conversationId: conv.conversationId, message: text, language: lang }),
      });

      if (!response.ok || !response.body) {
        setIsWaiting(false);
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let accumulated = "";
      let finalMsg = "";
      setIsWaiting(false);
      setIsStreaming(true);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: any;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          if (evt.t) {
            accumulated += evt.t;
            setStreamText(accumulated);
          }

          if (evt.done) {
            finalMsg = evt.message ?? accumulated;
            if (evt.leadScore) setLeadScore(evt.leadScore);
          }

          if (evt.error) {
            finalMsg = evt.message ?? (lang === "ar"
              ? "عذراً، حدث خطأ مؤقت. حاول مرة أخرى."
              : "Sorry, a temporary error occurred. Please try again.");
          }
        }
      }

      // Commit streamed message
      const aiMsgId = Date.now().toString() + "a";
      setConv(prev => ({
        ...prev,
        messages: [...prev.messages, { id: aiMsgId, role: "assistant", content: finalMsg || accumulated }],
      }));
      setStreamText("");
      setIsStreaming(false);

    } catch (err: any) {
      if (err.name !== "AbortError") {
        setConv(prev => ({
          ...prev,
          messages: [...prev.messages, {
            id: Date.now().toString() + "err",
            role: "assistant",
            content: lang === "ar" ? "عذراً، حدث خطأ مؤقت. حاول مرة أخرى." : "Sorry, a temporary error. Please try again.",
          }],
        }));
      }
      setIsStreaming(false);
      setIsWaiting(false);
      setStreamText("");
    }
  }, [conv.conversationId, lang, isStreaming, isWaiting]);

  const handleSend = () => { const t = input.trim(); if (t) sendMessage(t); };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleRestart = () => {
    abortRef.current?.abort();
    clearSession(user?.id);
    setConv({ conversationId: null, messages: [] });
    setLeadScore(null);
    setInitialized(false);
    setStreamText("");
    setIsStreaming(false);
    setIsWaiting(false);
    setInput("");
    startMutation.reset();
  };

  const isBusy = isStreaming || isWaiting || startMutation.isPending;
  const lastAiIdx = [...conv.messages].map((m, i) => m.role === "assistant" ? i : -1).filter(i => i >= 0).pop() ?? -1;

  // ── Not logged in ───────────────────────────────────────────────────────────
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#3bcac4]/10 to-[#005476]/10">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full mx-4 text-center">
          <div className="w-16 h-16 rounded-full bg-white mx-auto mb-4 flex items-center justify-center shadow-lg"
            style={{ boxShadow: "0 4px 20px rgba(59,202,196,0.35)" }}>
            <img src={crownIcon} alt="" className="w-10 h-10 object-contain" draggable={false} />
          </div>
          <h2 className="text-xl font-bold text-[#005476] mb-2">{t("aiAdvisor.loginRequired", "Login Required")}</h2>
          <p className="text-gray-500 mb-6 text-sm">{t("aiAdvisor.loginHint", "Please log in to access the AI Investment Advisor.")}</p>
          <Button onClick={() => navigate("/login")} className="w-full" style={{ background: "linear-gradient(135deg,#3bcac4,#005476)" }}>
            {t("auth.login", "Login")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-[#f0fdfc] flex flex-col" dir={isRtl ? "rtl" : "ltr"}>

      {/* ── Header ── */}
      <div className="text-white px-4 pt-8 pb-5 flex-shrink-0" style={{ background: "linear-gradient(135deg,#3bcac4 0%,#005476 100%)" }}>
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-md"
              style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
              <img src={crownIcon} alt="" className="w-7 h-7 object-contain" draggable={false} />
            </div>
            <div>
              <h1 className="text-lg font-bold tracking-tight">Kinglike AI Advisor</h1>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-2 h-2 rounded-full bg-green-400" style={{ animation: isBusy ? "none" : "pulse 2s infinite" }} />
                <p className="text-white/80 text-xs">
                  {isBusy
                    ? (lang === "ar" ? "يكتب..." : "Typing...")
                    : (lang === "ar" ? "متاح الآن" : "Online")}
                </p>
              </div>
            </div>
          </div>
          {conv.messages.length > 0 && (
            <button onClick={handleRestart} className="text-white/70 hover:text-white flex items-center gap-1 text-xs transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
              {lang === "ar" ? "محادثة جديدة" : "New chat"}
            </button>
          )}
        </div>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-2xl mx-auto w-full">
        <div className="space-y-4 pb-2">

          {/* Initial loading dots */}
          {startMutation.isPending && !isStreaming && (
            <div className="flex gap-3">
              <AiAvatar />
              <div className="bg-white shadow-sm border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                <TypingDots />
              </div>
            </div>
          )}

          {/* Rendered messages */}
          {conv.messages.map((msg, idx) => (
            <div key={msg.id}>
              <Bubble msg={msg} isRtl={isRtl} />
              {/* CTA after last AI message when idle */}
              {idx === lastAiIdx && leadScore && !isBusy && !streamText && (
                <CtaPanel score={leadScore} lang={lang} />
              )}
            </div>
          ))}

          {/* Waiting dots (before first streaming chunk) */}
          {isWaiting && (
            <div className="flex gap-3">
              <AiAvatar />
              <div className="bg-white shadow-sm border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                <TypingDots />
              </div>
            </div>
          )}

          {/* Live streaming bubble */}
          {isStreaming && streamText && (
            <div className="flex gap-3">
              <AiAvatar />
              <div className="max-w-[78%] rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed bg-white shadow-sm border border-gray-100 text-gray-800"
                dir={isRtl ? "rtl" : "ltr"}>
                {streamText.split("\n").map((l, i, a) => <span key={i}>{l}{i < a.length - 1 && <br />}</span>)}
                <span className="inline-block w-0.5 h-4 bg-[#3bcac4] ml-0.5 animate-pulse align-middle" />
              </div>
            </div>
          )}

          {/* Error */}
          {startMutation.isError && (
            <div className="text-center text-sm text-amber-600 bg-amber-50 px-4 py-3 rounded-xl border border-amber-200 mx-auto max-w-xs">
              {lang === "ar" ? "المستشار غير متاح مؤقتاً. حاول لاحقاً." : "AI Advisor is temporarily unavailable."}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* ── Input bar ── */}
      <div className="border-t border-gray-100 bg-white px-4 py-3 flex-shrink-0 max-w-2xl mx-auto w-full">
        <div className={`flex gap-2 items-end ${isRtl ? "flex-row-reverse" : ""}`}>
          <Textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={lang === "ar" ? "اكتب رسالتك..." : "Type your message..."}
            className="flex-1 min-h-[44px] max-h-32 resize-none rounded-2xl border-gray-200 focus:border-[#3bcac4] focus:ring-[#3bcac4]/20 text-sm"
            style={{ direction: isRtl ? "rtl" : "ltr", textAlign: isRtl ? "right" : "left" }}
            rows={1}
            disabled={isBusy}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isBusy}
            className="h-11 w-11 rounded-full p-0 flex-shrink-0 transition-all"
            style={{ background: input.trim() && !isBusy ? "linear-gradient(135deg,#3bcac4,#005476)" : undefined }}
          >
            {isBusy
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className={`w-4 h-4 ${isRtl ? "rotate-180" : ""}`} />}
          </Button>
        </div>
        <p className="text-center text-[10px] text-gray-400 mt-2">
          {lang === "ar"
            ? "ردود الذكاء الاصطناعي للتوجيه فقط. التوصيات النهائية من فريق الاستشارة لدينا."
            : "AI responses are for guidance only. Final recommendations from our advisory team."}
        </p>
      </div>
    </div>
  );
}
