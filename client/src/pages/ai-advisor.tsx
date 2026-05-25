import { useState, useRef, useEffect } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  Send, User, Loader2, RefreshCw, Sparkles,
  CalendarDays, MessageSquare, Video, Mail, ArrowRight, ChevronRight,
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

// ── CTA config per lead score ─────────────────────────────────────────────────
// Score label is NEVER shown to the user — only the action buttons
const CTA_CONFIG = {
  hot: {
    headline: "Ready to take the next step?",
    headlineAr: "هل أنت مستعد للخطوة التالية؟",
    headlineRu: "Готовы сделать следующий шаг?",
    headlineTr: "Bir sonraki adıma hazır mısınız?",
    color: "from-[#3bcac4] to-[#005476]",
    actions: [
      { label: "Book a Consultation", labelAr: "احجز استشارة", icon: CalendarDays, href: "/consultation", primary: true },
      { label: "Contact on WhatsApp", labelAr: "تواصل عبر واتساب", icon: MessageSquare, href: "https://wa.me/995555000000", primary: false, external: true },
      { label: "Schedule a Video Call", labelAr: "جدول مكالمة فيديو", icon: Video, href: "/consultation", primary: false },
    ],
  },
  warm: {
    headline: "Our team can prepare your options.",
    headlineAr: "فريقنا يمكنه تجهيز خياراتك.",
    headlineRu: "Наша команда готова подобрать варианты.",
    headlineTr: "Ekibimiz seçeneklerinizi hazırlayabilir.",
    color: "from-[#3bcac4]/80 to-[#005476]/80",
    actions: [
      { label: "Book a Consultation", labelAr: "احجز استشارة", icon: CalendarDays, href: "/consultation", primary: true },
      { label: "Get Options by Email", labelAr: "استلام الخيارات بالإيميل", icon: Mail, href: "/consultation", primary: false },
    ],
  },
  cold: {
    headline: "Explore at your own pace.",
    headlineAr: "استكشف بسرعتك الخاصة.",
    headlineRu: "Изучайте в удобном темпе.",
    headlineTr: "Kendi hızınızda keşfedin.",
    color: "from-[#005476]/60 to-[#3bcac4]/60",
    actions: [
      { label: "View Properties", labelAr: "تصفح العقارات", icon: ChevronRight, href: "/properties", primary: false },
      { label: "Book a Consultation", labelAr: "احجز استشارة", icon: CalendarDays, href: "/consultation", primary: false },
    ],
  },
};

function CtaPanel({ score, lang }: { score: LeadScore; lang: string }) {
  const [, navigate] = useLocation();
  if (!score) return null;
  const cfg = CTA_CONFIG[score];
  const isRtl = lang === "ar" || lang === "he";
  const headline =
    lang === "ar" ? cfg.headlineAr :
    lang === "ru" ? cfg.headlineRu :
    lang === "tr" ? cfg.headlineTr :
    cfg.headline;

  return (
    <div className="mx-0 mt-1 mb-3">
      <div className={`rounded-2xl overflow-hidden border border-white/30`}
        style={{ background: "linear-gradient(135deg, rgba(59,202,196,0.08), rgba(0,84,118,0.06))", border: "1px solid rgba(59,202,196,0.20)" }}>
        <div className={`px-4 pt-3 pb-2 bg-gradient-to-r ${cfg.color} flex items-center gap-2`}>
          <Sparkles className="w-3.5 h-3.5 text-white flex-shrink-0" />
          <p className="text-white text-xs font-semibold">{headline}</p>
        </div>
        <div className={`px-4 py-3 flex flex-wrap gap-2 ${isRtl ? "flex-row-reverse" : ""}`}>
          {cfg.actions.map((action) => {
            const Icon = action.icon;
            const label = lang === "ar" ? action.labelAr : action.label;
            if (action.external) {
              return (
                <a
                  key={action.label}
                  href={action.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition-all ${
                    action.primary
                      ? "text-white border-[#005476]"
                      : "text-[#005476] border-[#3bcac4]/40 bg-white hover:bg-[#f0fdfc]"
                  }`}
                  style={action.primary ? { background: "linear-gradient(135deg, #3bcac4, #005476)" } : {}}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {label}
                  <ArrowRight className="w-3 h-3 opacity-60" />
                </a>
              );
            }
            return (
              <button
                key={action.label}
                onClick={() => navigate(action.href)}
                className={`inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border transition-all ${
                  action.primary
                    ? "text-white border-[#005476]"
                    : "text-[#005476] border-[#3bcac4]/40 bg-white hover:bg-[#f0fdfc]"
                }`}
                style={action.primary ? { background: "linear-gradient(135deg, #3bcac4, #005476)" } : {}}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default function AiAdvisorPage() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const [input, setInput] = useState("");
  const [convState, setConvState] = useState<ConversationState>({ conversationId: null, messages: [] });
  const [started, setStarted] = useState(false);
  const [leadScore, setLeadScore] = useState<LeadScore>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lang = i18n.language;

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convState.messages, leadScore]);

  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai/start", { language: lang }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      setConvState({
        conversationId: data.conversationId,
        messages: [{ id: "0", role: "assistant", content: data.greeting, createdAt: new Date().toISOString() }],
      });
      setLeadScore(null);
      setStarted(true);
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
      setConvState((prev) => ({
        ...prev,
        messages: [
          ...prev.messages,
          { id: Date.now().toString(), role: "assistant", content: data.message, createdAt: new Date().toISOString() },
        ],
      }));
      if (data.leadScore) setLeadScore(data.leadScore);
    },
  });

  const handleSend = () => {
    const text = input.trim();
    if (!text || chatMutation.isPending) return;
    setInput("");
    setConvState((prev) => ({
      ...prev,
      messages: [
        ...prev.messages,
        { id: Date.now().toString() + "u", role: "user", content: text, createdAt: new Date().toISOString() },
      ],
    }));
    chatMutation.mutate(text);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleRestart = () => {
    setConvState({ conversationId: null, messages: [] });
    setStarted(false);
    setInput("");
    setLeadScore(null);
  };

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

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-[#f0fdfc] flex flex-col">
      {/* Header */}
      <div className="text-white px-4 pt-8 pb-5" style={{ background: "linear-gradient(135deg, #3bcac4 0%, #005476 100%)" }}>
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-full bg-white flex items-center justify-center shadow-md flex-shrink-0"
                style={{ boxShadow: "0 2px 12px rgba(0,0,0,0.15)" }}>
                <img src={crownIcon} alt="" className="w-7 h-7 object-contain" draggable={false} />
              </div>
              <div>
                <h1 className="text-lg font-bold tracking-tight">Kinglike AI Advisor</h1>
                <p className="text-white/75 text-xs font-light tracking-wide">Luxury Real Estate Intelligence</p>
              </div>
            </div>
            {started && (
              <button onClick={handleRestart} className="text-white/70 hover:text-white flex items-center gap-1 text-xs">
                <RefreshCw className="w-3.5 h-3.5" />
                {t("aiAdvisor.newChat", "New chat")}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 max-w-2xl mx-auto w-full">
        {!started ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-16">
            <div className="w-20 h-20 rounded-full bg-white flex items-center justify-center mb-6 shadow-lg"
              style={{ boxShadow: "0 4px 24px rgba(59,202,196,0.35), 0 2px 8px rgba(0,0,0,0.10)" }}>
              <img src={crownIcon} alt="" className="w-12 h-12 object-contain" draggable={false} />
            </div>
            <h2 className="text-2xl font-bold text-[#005476] mb-3">{t("aiAdvisor.welcome", "Welcome to AI Advisor")}</h2>
            <p className="text-gray-500 max-w-sm mb-8 leading-relaxed text-sm">
              {t("aiAdvisor.welcomeDesc", "I'll help you find the best real estate opportunities based on your goals, budget, and preferences.")}
            </p>
            <Button
              onClick={() => startMutation.mutate()}
              disabled={startMutation.isPending}
              className="px-8 py-3 rounded-2xl text-white font-semibold text-base shadow-lg"
              style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}
            >
              {startMutation.isPending ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />{t("common.loading", "Loading...")}</>
              ) : (
                <><Sparkles className="w-4 h-4 mr-2" />{t("aiAdvisor.startChat", "Start Conversation")}</>
              )}
            </Button>
            {startMutation.isError && (
              <p className="mt-4 text-sm text-amber-600 bg-amber-50 px-4 py-2 rounded-xl border border-amber-200">
                {t("aiAdvisor.unavailable", "AI Advisor is temporarily unavailable. Please try again later.")}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4 pb-2">
            {convState.messages.map((msg, idx) => {
              const isLast = idx === convState.messages.length - 1;
              const showCta = isLast && msg.role === "assistant" && leadScore && !chatMutation.isPending;
              return (
                <div key={msg.id}>
                  <div className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      msg.role === "assistant" ? "bg-white shadow-sm" : "bg-gray-200"
                    }`}
                      style={msg.role === "assistant" ? { border: "1.5px solid rgba(59,202,196,0.35)" } : {}}>
                      {msg.role === "assistant"
                        ? <img src={crownIcon} alt="" className="w-5 h-5 object-contain" draggable={false} />
                        : <User className="w-4 h-4 text-gray-500" />}
                    </div>
                    <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                      msg.role === "user"
                        ? "bg-[#005476] text-white rounded-tr-sm"
                        : "bg-white shadow-sm border border-gray-100 text-gray-800 rounded-tl-sm"
                    }`}>
                      {msg.content.split("\n").map((line, i, arr) => (
                        <span key={i}>{line}{i < arr.length - 1 && <br />}</span>
                      ))}
                    </div>
                  </div>
                  {/* Dynamic CTA panel — shown below last AI message, never shows score label */}
                  {showCta && <CtaPanel score={leadScore} lang={lang} />}
                </div>
              );
            })}

            {/* Typing indicator */}
            {chatMutation.isPending && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-white flex items-center justify-center flex-shrink-0 shadow-sm"
                  style={{ border: "1.5px solid rgba(59,202,196,0.35)" }}>
                  <img src={crownIcon} alt="" className="w-5 h-5 object-contain" draggable={false} />
                </div>
                <div className="bg-white shadow-sm border border-gray-100 rounded-2xl rounded-tl-sm px-4 py-3">
                  <div className="flex gap-1 items-center h-5">
                    <span className="w-2 h-2 bg-[#3bcac4] rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                    <span className="w-2 h-2 bg-[#3bcac4] rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                    <span className="w-2 h-2 bg-[#3bcac4] rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input */}
      {started && (
        <div className="border-t border-gray-100 bg-white px-4 py-3 max-w-2xl mx-auto w-full">
          <div className="flex gap-2 items-end">
            <Textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t("aiAdvisor.placeholder", "Type your message...")}
              className="flex-1 min-h-[44px] max-h-32 resize-none rounded-2xl border-gray-200 focus:border-[#3bcac4] focus:ring-[#3bcac4]/20 text-sm"
              rows={1}
              disabled={chatMutation.isPending}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || chatMutation.isPending}
              className="h-11 w-11 rounded-full p-0 flex-shrink-0"
              style={{ background: input.trim() ? "linear-gradient(135deg, #3bcac4, #005476)" : undefined }}
            >
              {chatMutation.isPending
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <Send className="w-4 h-4" />}
            </Button>
          </div>
          <p className="text-center text-[10px] text-gray-400 mt-2">
            {t("aiAdvisor.disclaimer", "AI responses are for guidance only. Final recommendations from our advisory team.")}
          </p>
        </div>
      )}
    </div>
  );
}
