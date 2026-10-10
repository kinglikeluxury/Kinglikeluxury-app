import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { MessageCircle, RefreshCw, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import {
  WhatsAppMonitoringWorkspace,
  type ConversationFilter,
  type PreviewState,
  type WhatsappWorkspaceMode,
} from "@/components/whatsapp/WhatsAppMonitoringWorkspace";
import {
  employeeWhatsappRepository,
} from "@/lib/whatsappEmployeeMonitoringEmployeeRepository";
import type {
  MockConversation,
} from "@/lib/whatsappEmployeeMonitoringMock";
import whatsappMonitoringStyles from "@/pages/admin/whatsapp-employee-monitoring.css?raw";
import tajawalBoldUrl from "@/assets/fonts/tajawal/Tajawal-Bold.woff2";
import tajawalMediumUrl from "@/assets/fonts/tajawal/Tajawal-Medium.woff2";
import tajawalRegularUrl from "@/assets/fonts/tajawal/Tajawal-Regular.woff2";

const STYLE_ID = "kinglike-family-whatsapp-styles";
const HISTORY_KEY = "kinglikeFamilyWhatsappEmployeePanel";
const scopedWhatsappStyles = whatsappMonitoringStyles
  .replaceAll("../../assets/fonts/tajawal/Tajawal-Regular.woff2", tajawalRegularUrl)
  .replaceAll("../../assets/fonts/tajawal/Tajawal-Medium.woff2", tajawalMediumUrl)
  .replaceAll("../../assets/fonts/tajawal/Tajawal-Bold.woff2", tajawalBoldUrl);

type EmployeeConversation = MockConversation & {
  hasDeletedMessages: boolean;
  hasMedia: boolean;
};

type MobilePanel = "conversations" | "chat";

const EMPTY_PREVIEW_MESSAGE = (conversationId: string): MockConversation["messages"][number] => ({
  id: `${conversationId}-preview`,
  direction: "incoming",
  kind: "text",
  text: "",
  time: "",
  dateLabel: "",
});

function withPreviewMessage(conversation: EmployeeConversation): EmployeeConversation {
  return conversation.messages.length > 0
    ? conversation
    : { ...conversation, messages: [EMPTY_PREVIEW_MESSAGE(conversation.id)] };
}

export default function EmployeeWhatsappPage() {
  const { t: translate } = useTranslation();
  const t = (key: string, fallback: string): string =>
    String(translate(key, { defaultValue: fallback }));
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const [conversations, setConversations] = useState<EmployeeConversation[]>([]);
  const [selectedConversationId, setSelectedConversationId] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("conversations");
  const [preview, setPreview] = useState<PreviewState>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState("");
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);
  const [isRtl, setIsRtl] = useState(false);

  const isAuthorized = Boolean(
    user && user.role === "sub_agent" && user.isActive === true && user.isAdmin !== true,
  );

  useEffect(() => {
    setIsRtl(typeof document !== "undefined" && document.documentElement.dir === "rtl");
  }, []);

  useEffect(() => {
    document.getElementById(STYLE_ID)?.remove();
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = scopedWhatsappStyles;
    document.head.appendChild(style);
    return () => style.remove();
  }, []);

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate("/login");
    } else if (user.isAdmin) {
      navigate("/admin/whatsapp-monitoring");
    } else if (!isAuthorized) {
      navigate("/");
    }
  }, [isAuthorized, isLoading, navigate, user]);

  const loadConversations = useCallback(async () => {
    if (!isAuthorized) return;
    setLoadState("loading");
    setErrorMessage("");
    try {
      const rows = (await employeeWhatsappRepository.listConversations()).map(withPreviewMessage);
      setConversations(rows);
      setSelectedConversationId((current) =>
        current && rows.some((conversation) => conversation.id === current)
          ? current
          : rows[0]?.id ?? "",
      );
      setLoadState("ready");
    } catch (error) {
      setLoadState("error");
      setErrorMessage(error instanceof Error ? error.message : "Unable to load WhatsApp mock data");
    }
  }, [isAuthorized]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!isAuthorized) return;
    const currentState = window.history.state;
    if (currentState?.[HISTORY_KEY] !== "conversations") {
      window.history.replaceState(
        { ...(currentState ?? {}), [HISTORY_KEY]: "conversations" },
        "",
        window.location.href,
      );
    }
    setMobilePanel("conversations");

    const handlePopState = (event: PopStateEvent) => {
      setMobilePanel(event.state?.[HISTORY_KEY] === "chat" ? "chat" : "conversations");
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [isAuthorized]);

  useEffect(() => {
    if (!isAuthorized || !selectedConversationId) return;
    const selected = conversations.find((conversation) => conversation.id === selectedConversationId);
    if (!selected || selected.messages.length > 1 || selected.messages[0]?.text) return;

    let cancelled = false;
    setIsMessagesLoading(true);
    setErrorMessage("");
    void employeeWhatsappRepository.getConversationMessages(selectedConversationId)
      .then((conversation) => {
        if (cancelled) return;
        setConversations((current) =>
          current.map((item) => item.id === conversation.id ? conversation : item),
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setErrorMessage(error instanceof Error ? error.message : "Unable to load conversation messages");
      })
      .finally(() => {
        if (!cancelled) setIsMessagesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [conversations, isAuthorized, selectedConversationId]);

  const filteredConversations = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return conversations.filter((conversation) => {
      const matchesSearch = !normalizedSearch ||
        `${conversation.customerName} ${conversation.customerPhone}`.toLowerCase().includes(normalizedSearch);
      const matchesFilter =
        filter === "all" ||
        (filter === "unread" && conversation.unreadCount > 0) ||
        (filter === "archived" && conversation.archived === true) ||
        (filter === "deleted" && conversation.hasDeletedMessages) ||
        (filter === "media" && conversation.hasMedia);
      return matchesSearch && matchesFilter;
    });
  }, [conversations, filter, search]);

  const selectedConversation = conversations.find(
    (conversation) => conversation.id === selectedConversationId,
  );

  const handleConversationSelect = (id: string) => {
    setSelectedConversationId(id);
    if (mobilePanel !== "chat") {
      window.history.pushState(
        { ...(window.history.state ?? {}), [HISTORY_KEY]: "chat" },
        "",
        window.location.href,
      );
      setMobilePanel("chat");
    }
  };

  const handleBack = () => {
    window.history.back();
  };

  if (isLoading || !user || !isAuthorized) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center bg-[#f4f8f8]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#3bcac4] border-t-transparent" />
      </div>
    );
  }

  const workspaceMode: WhatsappWorkspaceMode = "employee";

  return (
    <div className="kinglike-family-whatsapp flex h-[calc(100dvh-4rem)] min-h-0 flex-col overflow-hidden bg-[#f4f8f8] px-3 pb-3 pt-6 sm:p-5 lg:p-7">
      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#3bcac4]">
              <MessageCircle className="h-4 w-4" />
              {t("whatsappMonitoring.employeeLabel", "Employee workspace")}
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#005476] sm:text-3xl">
              {t("whatsappMonitoring.title", "Kinglike Family WhatsApp")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              {t("whatsappMonitoring.employeeSubtitle", "Your assigned mock WhatsApp conversations only.")}
            </p>
          </div>
          <Badge variant="outline" className="border-[#3bcac4] bg-white text-[#005476]">
            {t("whatsappMonitoring.mockOnly", "Mock data only")}
          </Badge>
        </div>

        {loadState === "loading" ? (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white">
            <div className="text-center text-sm text-slate-500">
              <RefreshCw className="mx-auto mb-3 h-6 w-6 animate-spin text-[#3bcac4]" />
              {t("whatsappMonitoring.loading", "Loading mock conversations…")}
            </div>
          </div>
        ) : loadState === "error" ? (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-red-100 bg-white p-6">
            <div className="max-w-md text-center">
              <p className="font-semibold text-red-700">{t("whatsappMonitoring.errorTitle", "Unable to load conversations")}</p>
              <p className="mt-2 text-sm text-slate-500">{errorMessage}</p>
              <Button className="mt-4" onClick={() => void loadConversations()}>
                {t("whatsappMonitoring.retry", "Try again")}
              </Button>
            </div>
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-slate-200 bg-white p-6">
            <div className="max-w-md text-center">
              <MessageCircle className="mx-auto mb-3 h-10 w-10 text-[#3bcac4]" />
              <p className="font-semibold text-slate-800">
                No WhatsApp account is linked to your profile yet.
              </p>
              <p className="mt-2 text-sm text-slate-500">
                {t("whatsappMonitoring.emptyDescription", "Only conversations explicitly assigned to your mock employee account are shown.")}
              </p>
            </div>
          </div>
        ) : (
          <>
            {errorMessage && (
              <div className="mb-2 flex items-center justify-between rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                <span>{errorMessage}</span>
                <button type="button" onClick={() => setErrorMessage("")} aria-label="Dismiss error">
                  <X className="h-4 w-4" />
                </button>
              </div>
            )}
            <WhatsAppMonitoringWorkspace
              workspaceMode={workspaceMode}
              conversations={filteredConversations}
              selectedConversationId={selectedConversationId}
              selectedConversation={selectedConversation}
              search={search}
              filter={filter}
              onConversationSelect={handleConversationSelect}
              onSearch={setSearch}
              onFilter={setFilter}
              onConversationsBack={handleBack}
              onChatBack={handleBack}
              onPreview={setPreview}
              mobilePanel={mobilePanel}
              isRtl={isRtl}
              t={t}
            />
            {isMessagesLoading && (
              <p className="mt-2 text-center text-xs text-slate-400">
                {t("whatsappMonitoring.loadingMessages", "Loading conversation messages…")}
              </p>
            )}
          </>
        )}
      </div>

      {preview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4" role="dialog" aria-modal="true" aria-label={preview.title}>
          <div className="relative max-h-[90vh] max-w-4xl overflow-hidden rounded-2xl bg-white p-3 shadow-2xl">
            <Button type="button" variant="secondary" size="icon" className="absolute end-5 top-5 z-10 rounded-full" onClick={() => setPreview(null)} aria-label={t("whatsappMonitoring.closePreview", "Close preview")}>
              <X className="h-4 w-4" />
            </Button>
            <img src={preview.url} alt={preview.title} className="max-h-[80vh] w-auto max-w-full rounded-xl object-contain" />
            {preview.kind === "video" && (
              <div className="absolute inset-x-0 bottom-7 mx-auto w-fit rounded-full bg-black/65 px-4 py-2 text-xs font-medium text-white">
                {t("whatsappMonitoring.videoPlaceholder", "Video preview placeholder")}
              </div>
            )}
            <p className="px-2 pt-2 text-sm font-medium text-slate-700">{preview.title}</p>
          </div>
        </div>
      )}
    </div>
  );
}