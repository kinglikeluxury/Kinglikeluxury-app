import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { Send, Bot, User, Loader2, Crown, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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

export default function AiAdvisorPage() {
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const [input, setInput] = useState("");
  const [convState, setConvState] = useState<ConversationState>({ conversationId: null, messages: [] });
  const [started, setStarted] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [convState.messages]);

  const startMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/ai/start", { language: i18n.language }),
    onSuccess: async (res: any) => {
      const data = await res.json();
      setConvState({
        conversationId: data.conversationId,
        messages: [{ id: "0", role: "assistant", content: data.greeting, createdAt: new Date().toISOString() }],
      });
      setStarted(true);
    },
  });

  const chatMutation = useMutation({
    mutationFn: async (message: string) => {
      const res = await apiRequest("POST", "/api/ai/chat", {
        conversationId: convState.conversationId,
        message,
        language: i18n.language,
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
  };

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#3bcac4]/10 to-[#005476]/10">
        <div className="bg-white rounded-2xl shadow-xl p-8 max-w-sm w-full mx-4 text-center">
          <Crown className="w-16 h-16 mx-auto mb-4 text-[#3bcac4]" />
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
              <div className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center">
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold">{t("aiAdvisor.title", "AI Investment Advisor")}</h1>
                <p className="text-white/70 text-xs">{t("aiAdvisor.subtitle", "Kinglike Luxury — Premium Advisory")}</p>
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
            <div className="w-20 h-20 rounded-full flex items-center justify-center mb-6" style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}>
              <Crown className="w-10 h-10 text-white" />
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
                {t("aiAdvisor.unavailable", "AI Advisor is temporarily unavailable. Please book a consultation with our team.")}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4 pb-2">
            {convState.messages.map((msg) => (
              <div key={msg.id} className={`flex gap-3 ${msg.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                  msg.role === "assistant"
                    ? "bg-gradient-to-br from-[#3bcac4] to-[#005476]"
                    : "bg-gray-200"
                }`}>
                  {msg.role === "assistant"
                    ? <Bot className="w-4 h-4 text-white" />
                    : <User className="w-4 h-4 text-gray-500" />}
                </div>
                <div className={`max-w-[78%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  msg.role === "user"
                    ? "bg-[#005476] text-white rounded-tr-sm"
                    : "bg-white shadow-sm border border-gray-100 text-gray-800 rounded-tl-sm"
                }`}>
                  {msg.content.split("\n").map((line, i) => (
                    <span key={i}>{line}{i < msg.content.split("\n").length - 1 && <br />}</span>
                  ))}
                </div>
              </div>
            ))}
            {chatMutation.isPending && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-white" />
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
