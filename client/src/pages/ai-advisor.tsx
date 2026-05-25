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
  createdAt: string;
}

interface ConversationState {
  conversationId: number | null;
  messages: Message[];
}

// ── Session persistence helpers ───────────────────────────────────────────────
function sessionKey(userId: number | undefined) {
  return `kl_ai_session_${userId ?? "guest"}`;
}
function saveSession(userId: number | undefined, data: { convState: ConversationState; leadScore: LeadScore }) {
  try { sessionStorage.setItem(sessionKey(userId), JSON.stringify(data)); } catch {}
}
function loadSession(userId: number | undefined): { convState: ConversationState; leadScore: LeadScore } | null {
  try {
    const raw = sessionStorage.getItem(sessionKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
function clearSession(userId: number | undefined) {
  try { sessionStorage.removeItem(sessionKey(userId)); } catch {}
}

// ── CTA config per lead score ─────────────────────────────────────────────────
const CTA_CONFIG = {
  hot: {
    headlineAr: "هل أنت مستعد للخطوة التالية؟",
    headlineEn: "Ready to take the next step?",
    color: "from-[#3bcac4] to-[#005476]",
    actions: [
      { labelAr: "احجز استشارة مجانية", labelEn: "Book a Free Consultation", icon: CalendarDays, href: "/consultation", primary: true },
      { labelAr: "تواصل عبر واتساب", labelEn: "Contact on WhatsApp", icon: MessageSquare, href: "https://wa.me/995555000000", primary: false, external: true },
      { labelAr: "جدول مكالمة فيديو", labelEn: "Schedule a Video Call", icon: Video, href: "/consultation", primary: false },
    ],
  },
  warm: {
    headlineAr: "فريقنا يمكنه تجهيز خياراتك المثالية.",
    headlineEn: "Our team can prepare your perfect options.",
    color: "from-[#3bcac4]/80 to-[#005476]/80",
    actions: [
      { labelAr: "احجز استشارة", labelEn: "Book a Consultation", icon: CalendarDays, href: "/consultation", primary: true },
      { labelAr: "استلام الخيارات بالإيميل", labelEn: "Get Options by Email", icon: Mail, href: "/consultation", primary: false },
    ],
  },
  cold: {
    headlineAr: "استكشف بسرعتك الخاصة.",
    headlineEn: "Explore at your own pace.",
    color: "from-[#005476]/60 to-[#3bcac4]/60",
    actions: [
      { labelAr: "تصفح العقارات", labelEn: "View Properties", icon: ChevronRight, href: "/properties", primary: false },
      { labelAr: "احجز استشارة", labelEn: "Book a Consultation", icon: CalendarDays, href: "/consultation", primary: false },
    ],
  },
};

function CtaPanel({ score, lang }: { score: LeadScore; lang: string }) {
  const [, navigate] = useLocation();
  if (!score) return null;
  const cfg = CTA_CONFIG[score];
  const isRtl = lang === "ar" || lang === "he";
  const headline = lang === "ar" ? cfg.headlineAr : cfg.headlineEn;

  return (
    <div className="mx-0 mt-2 mb-3">
      <div className="rounded-2xl overflow-hidden"
        style={{ border: "1px solid rgba(59,202,196,0.22)", background: "rgba(240,253,252,0.7)" }}>
        <div className={`px-4 pt-3 pb-2 bg-gradient-to-r ${cfg.color} flex items-center gap-2`}>
          <Sparkles className="w-3.5 h-3.5 text-white flex-shrink-0" />
          <p className="text-white text-xs font-semibold">{headline}</p>
        </div>
        <div className={`px-4 py-3 flex flex-wrap gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
          {cfg.actions.map((action) => {
            const Icon = action.icon;
            const label = lang === "ar" ? action.labelAr : action.labelEn;
            const cls = `inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition-all ${
              action.primary
                ? "text-white border-transparent"
                : "text-[#005476] border-[#3bcac4]/40 bg-white hover:bg-[#f0fdfc]"
            }`;
            const style = action.primary ? { background: "linear-gradient(135deg, #3bcac4, #005476)" } : {};
            if ((action as any).external) {
              return (
                <a key={action.labelEn} href={action.href} target="_blank" rel="noopener noreferrer"
                  className={cls} style={style}>
                  <Icon className="w-3.5 h-3.5" />{label}<ArrowRight className="w-3 h-3 opacity-60" />
                </a>
              );
            }
            return (
              <button key={action.labelEn} onClick={() => navigate(action.href)} className={cls} style={style}>
                <Icon className="w-3.5 h-3.5" />{label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Typewriter hook ───────────────────────────────────────────────────────────
function useTypewriter() {
  const [displayText, setDisplayText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fullTextRef = useRef("");

  const startTyping = useCallback((text: string, onDone: () => void) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    fullTextRef.current = text;
    const chars = [...text]; // Unicode-safe (Arabic etc.)
    const total = chars.length;
    // Dynamic chars-per-tick so animation stays ~1.5–2s max
    const charsPerTick = Math.max(1, Math.ceil(total / 90));
    const delay = 14;

    setIsTyping(true);
    setDisplayText("");
    let idx = 0;

    function tick() {
      idx = Math.min(idx + charsPerTick, total);
      setDisplayText(chars.slice(0, idx).join(""));
      if (idx < total) {
        timerRef.current = setTimeout(tick, delay);
      } else {
        setIsTyping(false);
        onDone();
      }
    }
    timerRef.current = setTimeout(tick, delay);
  }, []);

  const cancel = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setIsTyping(false);
    setDisplayText("");
  }, []);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return { displayText, isTyping, startTyping, cancel };
}

// ── Main component ────────────────────────────────────────────────────────────
export default function AiAdvisorPage() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const lang = i18n.language;
  const isRtl = lang === "ar" || lang === "he";

  // ── Restore session on mount ────────────────────────────────────────────────
  const [convState, setConvState] = useState<ConversationState>({ conversationId: null, messages: [] });
  const [leadScore, setLeadScore] = useState<LeadScore>(null);
  const [initialized, setInitialized] = useState(false);
  const [typingMsgId, setTypingMsgId] = useState<string | null>(null); // which msg is animating

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [input, setInput] = useState("");

  const { displayText, isTyping, startTyping, cancel } = useTypewriter();

  // Restore saved session
  useEffect(() => {
    if (!user) { setInitialized(true); return; }
    const saved = loadSession(user.id);
    if (saved?.convState?.conversationId && saved.convState.messages.length > 0) {
      setConvState(saved.convState);
      setLeadScore(saved.leadScore);
      setInitialized(true);
    } else {
      setInitialized(false); // will trigger auto-start below
    }
  }, [user?.id]);

  // Save session whenever state changes
  useEffect(() => {
    if (!user || !convState.conversationId) return;
    saveSession(user.id, { convState, leadScore });
  }, [convState, leadScore, user?.id]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convState.messages, isTyping, displayText]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai/start", { language: lang }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      const greetingId = "greeting";
      setConvState({
        conversationId: data.conversationId,
        messages: [], // greeting will be typed in
      });
      setLeadScore(null);
      setInitialized(true);
      setTypingMsgId(greetingId);
      startTyping(data.greeting, () => {
        setConvState(prev => ({
          ...prev,
          messages: [{ id: greetingId, role: "assistant", content: data.greeting, createdAt: new Date().toISOString() }],
        }));
        setTypingMsgId(null);
      });
    },
  });

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", "/api/ai/chat", {
        conversationId: convState.conversationId,
        message,
        language: lang,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      const msgId = Date.now().toString();
      if (data.leadScore) setLeadScore(data.leadScore);
      setTypingMsgId(msgId);
      startTyping(data.message, () => {
        setConvState(prev => ({
          ...prev,
          messages: [
            ...prev.messages,
            { id: msgId, role: "assistant", content: data.message, createdAt: new Date().toISOString() },
          ],
        }));
        setTypingMsgId(null);
      });
    },
  });

  // Auto-start if no session loaded
  useEffect(() => {
    if (!user || initialized || startMutation.isPending || startMutation.isSuccess) return;
    startMutation.mutate();
  }, [user, initialized]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || chatMutation.isPending || isTyping) return;
    setInput("");
    // Cancel any ongoing typewriter and flush it
    if (isTyping && typingMsgId) {
      cancel();
      setTypingMsgId(null);
    }
    setConvState(prev => ({
      ...prev,
      messages: [
        ...prev.messages,
        { id: Date.now().toString() + "u", role: "user", content: text, createdAt: new Date().toISOString() },
      ],
    }));
    chatMutation.mutate(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleRestart = () => {
    cancel();
    clearSession(user?.id);
    setConvState({ conversationId: null, messages: [] });
    setLeadScore(null);
    setInitialized(false);
    setInput("");
    setTypingMsgId(null);
  };

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
          <Button onClick={() => navigate("/login")} className="w-full" style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}>
            {t("auth.login", "Login")}
          </Button>
        </div>
      </div>
    );
  }

  const allMessages = convState.messages;
  const isLoading = startMutation.isPending || chatMutation.isPending;
  const showTypingIndicator = isLoading && !isTyping && !typingMsgId;

  // Last message for CTA
  const lastMsg = allMessages[allMessages.length - 1];
  const showCta = lastMsg?.role === "assistant" && leadScore && !isLoading && !isTyping;

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-[#f0fdfc] flex flex-col" dir={isRtl ? "rtl" : "ltr"}>

      {/* Header */}
      <div className="text-white px-4 pt-8 pb-5 flex-shrink-0" style={{ background: "linear-gradient(135deg, #3bcac4 0%, #005476 100%)" }}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-md flex-shrink-0"
                style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
                <img src={crownIcon} alt="" className="w-7 h-7 object-contain" draggable={false} />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">Kinglike AI Advisor</h1>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <p className="text-white/80 text-xs font-light tracking-wide">
                    {lang === "ar" ? "متاح الآن" : "Online now"}
                  </p>
                </div>
              </div>
            </div>
            {allMessages.length > 0 && (
              <button onClick={handleRestart}
                className="text-white/70 hover:text-white flex items-center gap-1 text-xs transition-colors">
                <RefreshCw className="w-3.5 h-3.5" />
                {lang === "ar" ? "محادثة جديدة" : "New chat"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-2xl mx-auto w-full">
        <div className="space-y-4 pb-2">

          {/* Loading initial greeting */}
          {startMutation.isPending && !isTyping && (
            <div className="flex gap-3">
              <AiAvatar />
              <div className="bg-white shadow-sm border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                <TypingDots />
              </div>
            </div>
          )}

          {/* Rendered messages */}
          {allMessages.map((msg, idx) => {
            const isLastAssistant = idx === allMessages.length - 1 && msg.role === "assistant";
            return (
              <div key={msg.id}>
                <MessageBubble msg={msg} isRtl={isRtl} />
                {/* CTA only after last fully-rendered assistant message */}
                {isLastAssistant && showCta && <CtaPanel score={leadScore} lang={lang} />}
              </div>
            );
          })}

          {/* Typewriter animation bubble */}
          {isTyping && typingMsgId && (
            <div>
              <div className="flex gap-3">
                <AiAvatar />
                <div
                  className="max-w-[78%] rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed bg-white shadow-sm border border-gray-100 text-gray-800"
                  dir={isRtl ? "rtl" : "ltr"}
                >
                  {displayText.split("\n").map((line, i, arr) => (
                    <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
                  ))}
                  <span className="inline-block w-0.5 h-4 bg-[#3bcac4] ml-0.5 animate-pulse align-middle" />
                </div>
              </div>
            </div>
          )}

          {/* Waiting for AI response (after user sends msg, before response starts) */}
          {showTypingIndicator && (
            <div className="flex gap-3">
              <AiAvatar />
              <div className="bg-white shadow-sm border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                <TypingDots />
              </div>
            </div>
          )}

          {/* Error */}
          {(startMutation.isError || chatMutation.isError) && (
            <div className="text-center text-sm text-amber-600 bg-amber-50 px-4 py-3 rounded-xl border border-amber-200 mx-auto max-w-xs">
              {lang === "ar"
                ? "المستشار غير متاح مؤقتاً. حاول مرة أخرى."
                : "AI Advisor is temporarily unavailable. Please try again."}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input bar — always visible */}
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
            disabled={isLoading || startMutation.isPending}
          />
          <Button
            onClick={handleSend}
            disabled={!input.trim() || isLoading || startMutation.isPending}
            className="h-11 w-11 rounded-full p-0 flex-shrink-0 transition-all"
            style={{ background: input.trim() && !isLoading ? "linear-gradient(135deg, #3bcac4, #005476)" : undefined }}
          >
            {isLoading
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

// ── Sub-components ────────────────────────────────────────────────────────────
function AiAvatar() {
  return (
    <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow-sm"
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
      <span className="w-2 h-2 bg-[#3bcac4] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
      <span className="w-2 h-2 bg-[#3bcac4] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
      <span className="w-2 h-2 bg-[#3bcac4] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
    </div>
  );
}

function MessageBubble({ msg, isRtl }: { msg: { id: string; role: string; content: string }; isRtl: boolean }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {isUser ? <UserAvatar /> : <AiAvatar />}
      <div
        className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isUser
            ? "rounded-tr-sm"
            : "bg-white shadow-sm border border-gray-100 text-gray-800 rounded-tl-sm"
        }`}
        style={isUser ? { background: "#3bcac4", color: "#ffffff" } : {}}
        dir={isRtl ? "rtl" : "ltr"}
      >
        {msg.content.split("\n").map((line, i, arr) => (
          <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
        ))}
      </div>
    </div>
  );
}
