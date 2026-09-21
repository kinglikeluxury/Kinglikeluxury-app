import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "wouter";
import {
  Archive,
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  FileText,
  Image as ImageIcon,
  MessageCircle,
  Mic,
  MoreVertical,
  Paperclip,
  Play,
  Search,
  Send,
  Smile,
  Square,
  Trash2,
  Users,
  Video,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  EMPLOYEE_STATUS_LABELS,
  EMPTY_WAV_DATA_URL,
  MOCK_CONVERSATIONS,
  MOCK_EMPLOYEES,
  MOCK_PDF_DATA_URL,
  type EmployeeStatus,
  type MediaKind,
  type MockConversation,
  type MockEmployee,
  type MockMessage,
} from "@/lib/whatsappEmployeeMonitoringMock";

type ConversationFilter = "all" | "unread" | "archived" | "deleted" | "media";
type MobilePanel = "employees" | "conversations" | "chat";
type PreviewState = { kind: "image" | "video"; url: string; title: string } | null;

const FILTERS: ConversationFilter[] = ["all", "unread", "archived", "deleted", "media"];
const unicodeTextStyle: CSSProperties = {
  unicodeBidi: "plaintext",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};
const technicalTextStyle: CSSProperties = {
  unicodeBidi: "isolate",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};
const technicalTokenPattern =
  /(https?:\/\/[^\s]+|(?:[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,})|\+\d[\d\s().-]{6,}\d|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s*[A-Z]{3})?\b|\b\d{1,2}:\d{2}\b)/gu;

function renderUnicodeText(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(technicalTokenPattern)) {
    const token = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) nodes.push(text.slice(lastIndex, index));
    nodes.push(
      <span key={`${index}-${token}`} dir="ltr" style={technicalTextStyle}>
        {token}
      </span>,
    );
    lastIndex = index + token.length;
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function UnicodeText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <span dir="auto" className={className} style={unicodeTextStyle}>
      {renderUnicodeText(children)}
    </span>
  );
}

function LtrText({
  children,
  className,
}: {
  children: string;
  className?: string;
}) {
  return (
    <span dir="ltr" className={className} style={technicalTextStyle}>
      {children}
    </span>
  );
}

function formatDuration(seconds = 0) {
  return `0:${String(seconds).padStart(2, "0")}`;
}

function getLastMessage(conversation: MockConversation) {
  return conversation.messages[conversation.messages.length - 1];
}

function getLastMessageLabel(message: MockMessage) {
  if (message.kind === "deleted") return "Deleted message";
  if (message.kind === "note") return "Internal note";
  if (message.media) {
    return {
      image: "Photo",
      video: "Video",
      audio: "Voice message",
      file: message.media.name,
    }[message.media.kind];
  }
  return message.text;
}

function statusColor(status: EmployeeStatus) {
  return {
    connected: "bg-[#3bcac4]",
    attention: "bg-amber-400",
    disconnected: "bg-slate-400",
  }[status];
}

function MessageStatus({ status }: { status?: MockMessage["status"] }) {
  if (!status) return null;
  if (status === "sent") return <Check className="h-3.5 w-3.5" />;
  return (
    <CheckCheck
      className={cn("h-3.5 w-3.5", status === "read" ? "text-[#3bcac4]" : "text-slate-400")}
    />
  );
}

function MediaIcon({ kind }: { kind: MediaKind }) {
  if (kind === "image") return <ImageIcon className="h-4 w-4" />;
  if (kind === "video") return <Video className="h-4 w-4" />;
  if (kind === "audio") return <Mic className="h-4 w-4" />;
  return <FileText className="h-4 w-4" />;
}

function EmployeePanel({
  employees,
  selectedEmployeeId,
  onSelect,
  onNext,
  t,
}: {
  employees: MockEmployee[];
  selectedEmployeeId: string;
  onSelect: (id: string) => void;
  onNext: () => void;
  t: (key: string, fallback: string) => string;
}) {
  return (
    <aside className="flex min-h-0 flex-1 flex-col border-e border-slate-200 bg-white lg:min-w-0">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#005476]">
            Kinglike Luxury
          </p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{t("whatsappMonitoring.employees", "Employees")}</h2>
        </div>
        <Users className="h-5 w-5 text-[#3bcac4]" />
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <p className="mb-2 px-2 text-xs font-medium uppercase tracking-wide text-slate-400">
          {t("whatsappMonitoring.monitoringList", "Monitoring list")}
        </p>
        <div className="space-y-1">
          {employees.map((employee) => (
            <button
              key={employee.id}
              type="button"
              onClick={() => onSelect(employee.id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start transition-colors",
                selectedEmployeeId === employee.id
                  ? "bg-[#e7f8f7] text-[#005476]"
                  : "text-slate-700 hover:bg-slate-50",
              )}
            >
              <div className="relative shrink-0">
                <img src={employee.avatar} alt="" className="h-11 w-11 rounded-full" />
                <span
                  className={cn(
                    "absolute -bottom-0.5 -end-0.5 h-3 w-3 rounded-full border-2 border-white",
                    statusColor(employee.status),
                  )}
                />
              </div>
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                   <UnicodeText className="block truncate text-sm font-semibold">{employee.name}</UnicodeText>
                  {employee.id !== "all" && (
                    <span className="text-[10px] text-slate-400">
                      {MOCK_CONVERSATIONS.filter((item) => item.employeeId === employee.id).reduce(
                        (sum, item) => sum + item.unreadCount,
                        0,
                      )}
                    </span>
                  )}
                </span>
                 <UnicodeText
                   className="mt-0.5 block truncate text-xs text-slate-400"
                 >
                   {employee.id === "all" ? employee.role : EMPLOYEE_STATUS_LABELS[employee.status]}
                 </UnicodeText>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-slate-300 lg:hidden" />
            </button>
          ))}
        </div>
      </div>
      <div className="border-t border-slate-200 p-3 lg:hidden">
        <Button className="w-full bg-[#005476] hover:bg-[#00425d]" onClick={onNext}>
          {t("whatsappMonitoring.viewConversations", "View conversations")}
          <ChevronRight className="ms-2 h-4 w-4" />
        </Button>
      </div>
    </aside>
  );
}

function ConversationPanel({
  conversations,
  selectedConversationId,
  search,
  filter,
  onSearch,
  onFilter,
  onSelect,
  onBack,
  t,
}: {
  conversations: MockConversation[];
  selectedConversationId: string;
  search: string;
  filter: ConversationFilter;
  onSearch: (value: string) => void;
  onFilter: (value: ConversationFilter) => void;
  onSelect: (id: string) => void;
  onBack: () => void;
  t: (key: string, fallback: string) => string;
}) {
  const filterLabels: Record<ConversationFilter, string> = {
    all: t("whatsappMonitoring.filterAll", "All"),
    unread: t("whatsappMonitoring.filterUnread", "Unread"),
    archived: t("whatsappMonitoring.filterArchived", "Archived"),
    deleted: t("whatsappMonitoring.filterDeleted", "Deleted Events"),
    media: t("whatsappMonitoring.filterMedia", "Has Media"),
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col border-e border-slate-200 bg-[#f7f9fa] lg:min-w-0">
      <div className="border-b border-slate-200 bg-white px-4 py-4">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack} aria-label={t("whatsappMonitoring.back", "Back")}>
            <ChevronLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold text-slate-900">{t("whatsappMonitoring.conversations", "Conversations")}</h2>
            <p className="text-xs text-slate-400">{conversations.length} {t("whatsappMonitoring.mockConversations", "mock conversations")}</p>
          </div>
          <Archive className="h-5 w-5 text-slate-400" />
        </div>
        <div className="relative mt-4">
          <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => onSearch(event.target.value)}
            placeholder={t("whatsappMonitoring.searchPlaceholder", "Search by name or number")}
            className="h-10 border-slate-200 bg-slate-50 ps-9"
            aria-label={t("whatsappMonitoring.searchPlaceholder", "Search by name or number")}
          />
        </div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">
          {FILTERS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => onFilter(item)}
              className={cn(
                "whitespace-nowrap rounded-full border px-3 py-1.5 text-xs transition-colors",
                filter === item
                  ? "border-[#005476] bg-[#005476] text-white"
                  : "border-slate-200 bg-white text-slate-500 hover:border-[#3bcac4]",
              )}
            >
              {filterLabels[item]}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? (
          <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center text-slate-400">
            <Search className="mb-3 h-8 w-8" />
            <p className="text-sm font-medium">{t("whatsappMonitoring.noConversations", "No conversations found")}</p>
          </div>
        ) : (
          conversations.map((conversation) => {
            const lastMessage = getLastMessage(conversation);
            return (
              <button
                key={conversation.id}
                type="button"
                onClick={() => onSelect(conversation.id)}
                className={cn(
                  "flex w-full gap-3 border-b border-slate-200 px-4 py-3 text-start transition-colors",
                  selectedConversationId === conversation.id ? "bg-[#e7f8f7]" : "bg-white hover:bg-slate-50",
                )}
              >
                <img src={conversation.avatar} alt="" className="h-12 w-12 shrink-0 rounded-full" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <UnicodeText className="block truncate text-sm font-semibold text-slate-800">
                      {conversation.customerName}
                    </UnicodeText>
                    <LtrText className="shrink-0 text-[11px] text-slate-400">{lastMessage.time}</LtrText>
                  </span>
                  <span className="mt-1 flex items-center gap-1.5">
                    {lastMessage.media && <MediaIcon kind={lastMessage.media.kind} />}
                    <span className="truncate text-xs text-slate-500">{getLastMessageLabel(lastMessage)}</span>
                  </span>
                  <span className="mt-1 flex items-center justify-between gap-2">
                     <LtrText className="block truncate text-[11px] text-slate-400">{conversation.customerPhone}</LtrText>
                    {conversation.unreadCount > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#3bcac4] px-1 text-[10px] font-bold text-[#005476]">
                        {conversation.unreadCount}
                      </span>
                    )}
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}

function dataUrlToBlobUrl(dataUrl: string) {
  const [header, base64] = dataUrl.split(",");
  const mimeType = header.match(/^data:(.*?);base64$/)?.[1] ?? "application/octet-stream";
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return URL.createObjectURL(new Blob([bytes], { type: mimeType }));
}

function useLocalBlobUrl(dataUrl: string) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    const nextBlobUrl = dataUrlToBlobUrl(dataUrl);
    setBlobUrl(nextBlobUrl);

    return () => {
      URL.revokeObjectURL(nextBlobUrl);
    };
  }, [dataUrl]);

  return blobUrl;
}

function AudioPreview({ name, durationSeconds = 0 }: { name: string; durationSeconds?: number }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const audioUrl = useLocalBlobUrl(EMPTY_WAV_DATA_URL);
  const [isPlaying, setIsPlaying] = useState(false);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;

    if (!audio.paused) {
      audio.pause();
      return;
    }

    if (audio.ended || !Number.isFinite(audio.currentTime)) {
      audio.currentTime = 0;
    }

    try {
      await audio.play();
    } catch {
      setIsPlaying(false);
    }
  };

  return (
    <div className="flex min-w-[220px] items-center gap-3 rounded-xl bg-white/80 px-3 py-2">
      <audio
        ref={audioRef}
        src={audioUrl ?? undefined}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => {
          setIsPlaying(false);
          if (audioRef.current) audioRef.current.currentTime = 0;
        }}
        onError={() => setIsPlaying(false)}
      />
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-8 w-8 rounded-full"
        onClick={toggle}
        disabled={!audioUrl}
        aria-label={isPlaying ? "Pause audio" : "Play audio"}
      >
        {isPlaying ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
      </Button>
      <div className="flex flex-1 items-center gap-0.5">
        {Array.from({ length: 24 }).map((_, index) => (
          <span key={index} className={cn("w-1 rounded-full bg-[#3bcac4]", index % 4 === 0 ? "h-5" : index % 3 === 0 ? "h-3" : "h-2")} />
        ))}
      </div>
      <span className="text-[11px] text-slate-500">{formatDuration(durationSeconds)}</span>
      <span className="sr-only">{name}</span>
    </div>
  );
}

function MessageMedia({
  message,
  onPreview,
}: {
  message: MockMessage;
  onPreview: (preview: Exclude<PreviewState, null>) => void;
}) {
  if (!message.media) return null;
  const { media } = message;
  if (media.kind === "audio") {
    return <AudioPreview name={media.name} durationSeconds={media.durationSeconds} />;
  }
  if (media.kind === "file") {
    return (
      <div className="flex min-w-[220px] items-center gap-3 rounded-xl bg-white/70 p-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-500">
          <FileText className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{media.name}</span>
          <span className="text-xs text-slate-500">{media.size}</span>
        </span>
        <a
          href={MOCK_PDF_DATA_URL}
          download={media.name}
          className="rounded-full p-2 text-[#005476] hover:bg-white"
          aria-label={`Download ${media.name}`}
        >
          <ArrowDownToLine className="h-4 w-4" />
        </a>
      </div>
    );
  }
  if (media.kind !== "image" && media.kind !== "video") return null;
  const previewKind = media.kind as "image" | "video";
  return (
    <button
      type="button"
      className="group relative block overflow-hidden rounded-xl text-start"
      onClick={() => onPreview({ kind: previewKind, url: media.url, title: media.name })}
    >
      <img src={media.url} alt={media.name} className="max-h-56 w-full max-w-[290px] object-cover transition-transform group-hover:scale-[1.02]" />
      <span className="absolute bottom-2 start-2 rounded-full bg-black/55 px-2 py-1 text-[11px] text-white">
        {media.kind === "video" ? "Open video preview" : "Open image"}
      </span>
    </button>
  );
}

function ChatPanel({
  conversation,
  employee,
  onBack,
  onPreview,
  t,
}: {
  conversation: MockConversation | undefined;
  employee: MockEmployee | undefined;
  onBack: () => void;
  onPreview: (preview: Exclude<PreviewState, null>) => void;
  t: (key: string, fallback: string) => string;
}) {
  if (!conversation) {
    return (
      <section className="flex min-h-0 flex-1 items-center justify-center bg-[#efeae2] p-8 text-center text-slate-500">
        <div>
          <MessageCircle className="mx-auto mb-3 h-10 w-10 text-[#3bcac4]" />
          <p className="font-medium">{t("whatsappMonitoring.selectConversation", "Select a conversation")}</p>
        </div>
      </section>
    );
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[#efeae2]">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack} aria-label={t("whatsappMonitoring.back", "Back")}>
          <ChevronLeft className="h-5 w-5" />
        </Button>
        <img src={conversation.avatar} alt="" className="h-10 w-10 rounded-full" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-slate-900">{conversation.customerName}</h2>
          <p className="truncate text-xs text-slate-500">{conversation.customerPhone}</p>
        </div>
        <div className="hidden text-end sm:block">
          <p className="text-[11px] uppercase tracking-wide text-slate-400">{t("whatsappMonitoring.employee", "Employee")}</p>
          <p className="text-xs font-semibold text-[#005476]">{employee?.name}</p>
        </div>
        <Button variant="ghost" size="icon" aria-label={t("whatsappMonitoring.moreActions", "More actions")}>
          <MoreVertical className="h-5 w-5 text-slate-500" />
        </Button>
      </header>

      <div className="flex-1 overflow-y-auto px-3 py-5 sm:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-5 flex justify-center">
            <span className="rounded-lg bg-white/75 px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm">
              {t("whatsappMonitoring.archivedPreview", "Archived monitoring preview")}
            </span>
          </div>
          {conversation.messages.map((message, index) => {
            const previous = conversation.messages[index - 1];
            return (
              <div key={message.id}>
                {(!previous || previous.dateLabel !== message.dateLabel) && (
                  <div className="my-4 flex justify-center">
                    <span className="rounded-lg bg-white/75 px-3 py-1 text-[11px] text-slate-500 shadow-sm">{message.dateLabel}</span>
                  </div>
                )}
                {message.kind === "note" ? (
                  <div className="mx-auto my-3 max-w-md rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 shadow-sm">
                    <div className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                      <FileText className="h-3.5 w-3.5" />
                      {t("whatsappMonitoring.internalNote", "Internal note")}
                    </div>
                    {message.text}
                  </div>
                ) : (
                  <div className={cn("mb-2 flex", message.direction === "outgoing" ? "justify-end" : "justify-start")}>
                    <div
                      className={cn(
                        "max-w-[90%] rounded-xl px-3 py-2 text-sm shadow-sm sm:max-w-[72%]",
                        message.kind === "deleted"
                          ? "border border-dashed border-slate-300 bg-slate-100 text-slate-500"
                          : message.direction === "outgoing"
                            ? "rounded-ee-sm bg-[#d9fdd3] text-slate-800"
                            : "rounded-es-sm bg-white text-slate-800",
                      )}
                    >
                      {message.replyTo && (
                        <div className="mb-2 border-s-2 border-[#3bcac4] bg-black/5 px-2 py-1 text-xs text-slate-500">
                          {message.replyTo}
                        </div>
                      )}
                      {message.kind === "deleted" && (
                        <div className="mb-1 flex items-center gap-1.5 text-xs italic">
                          <Trash2 className="h-3.5 w-3.5" />
                          {t("whatsappMonitoring.deletedFromWhatsapp", "Deleted from WhatsApp")}
                        </div>
                      )}
                      {message.media && <MessageMedia message={message} onPreview={onPreview} />}
                      {message.kind !== "deleted" && message.kind !== "media" && <p className="whitespace-pre-wrap">{message.text}</p>}
                      {message.kind === "deleted" && <p className="italic">{message.text}</p>}
                      <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400">
                        {message.deletedAt && <span>{t("whatsappMonitoring.deletedAt", "Deleted")} {message.deletedAt}</span>}
                        <span>{message.time}</span>
                        <MessageStatus status={message.status} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="border-t border-slate-200 bg-white px-3 py-3 sm:px-5">
        <div className="mx-auto flex max-w-3xl items-center gap-2">
          <Button type="button" variant="ghost" size="icon" disabled aria-label={t("whatsappMonitoring.attach", "Attach")}>
            <Paperclip className="h-5 w-5 text-slate-400" />
          </Button>
          <Button type="button" variant="ghost" size="icon" disabled aria-label={t("whatsappMonitoring.emoji", "Emoji")}>
            <Smile className="h-5 w-5 text-slate-400" />
          </Button>
          <Input
            disabled
            placeholder={t("whatsappMonitoring.sendingLater", "Sending will be enabled in a later phase")}
            className="h-10 bg-slate-50 text-slate-400"
            aria-label={t("whatsappMonitoring.sendingLater", "Sending will be enabled in a later phase")}
          />
          <Button type="button" size="icon" disabled aria-label={t("whatsappMonitoring.send", "Send")}>
            <Send className="h-4 w-4" />
          </Button>
        </div>
        <p className="mx-auto mt-1 max-w-3xl text-center text-[10px] text-slate-400">
          {t("whatsappMonitoring.composerDisabled", "Sending is disabled in this mock-only phase")}
        </p>
      </div>
    </section>
  );
}

export default function WhatsappEmployeeMonitoringPage() {
  const { t: translate } = useTranslation();
  const t = (key: string, fallback: string): string =>
    String(translate(key, { defaultValue: fallback }));
  const { user, isLoading } = useAuth();
  const [, navigate] = useLocation();
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("all");
  const [selectedConversationId, setSelectedConversationId] = useState(MOCK_CONVERSATIONS[0]?.id ?? "");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("employees");
  const [preview, setPreview] = useState<PreviewState>(null);

  useEffect(() => {
    if (!isLoading && (!user || !user.isAdmin)) navigate("/");
  }, [isLoading, navigate, user]);

  const filteredConversations = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return MOCK_CONVERSATIONS.filter((conversation) => {
      const matchesEmployee = selectedEmployeeId === "all" || conversation.employeeId === selectedEmployeeId;
      const matchesSearch =
        !normalizedSearch ||
        conversation.customerName.toLowerCase().includes(normalizedSearch) ||
        conversation.customerPhone.toLowerCase().includes(normalizedSearch);
      const matchesFilter =
        filter === "all" ||
        (filter === "unread" && conversation.unreadCount > 0) ||
        (filter === "archived" && conversation.archived) ||
        (filter === "deleted" && conversation.messages.some((message) => message.kind === "deleted")) ||
        (filter === "media" && conversation.messages.some((message) => Boolean(message.media)));
      return matchesEmployee && matchesSearch && matchesFilter;
    });
  }, [filter, search, selectedEmployeeId]);

  const selectedEmployee = MOCK_EMPLOYEES.find((employee) => employee.id === selectedEmployeeId) ?? MOCK_EMPLOYEES[0];
  const selectedConversation = MOCK_CONVERSATIONS.find((conversation) => conversation.id === selectedConversationId);
  const activeEmployee = MOCK_EMPLOYEES.find((employee) => employee.id === selectedConversation?.employeeId) ?? selectedEmployee;

  const selectEmployee = (id: string) => {
    setSelectedEmployeeId(id);
    const nextConversation = MOCK_CONVERSATIONS.find((conversation) => id === "all" || conversation.employeeId === id);
    if (nextConversation) setSelectedConversationId(nextConversation.id);
    setMobilePanel("conversations");
  };

  const selectConversation = (id: string) => {
    setSelectedConversationId(id);
    setMobilePanel("chat");
  };

  if (isLoading || !user?.isAdmin) {
    return <div className="min-h-[70vh] bg-slate-50" aria-label="Loading admin workspace" />;
  }

  return (
    <div className="min-h-[calc(100dvh-4rem)] bg-[#f4f8f8] p-3 sm:p-5 lg:p-7">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-[#3bcac4]">
              <MessageCircle className="h-4 w-4" />
              {t("whatsappMonitoring.adminLabel", "Admin workspace")}
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-[#005476] sm:text-3xl">
              {t("whatsappMonitoring.title", "WhatsApp Monitoring")}
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-slate-500">
              {t("whatsappMonitoring.subtitle", "A safe mock archive for reviewing employee conversations.")}
            </p>
          </div>
          <Badge variant="outline" className="border-[#3bcac4] bg-white text-[#005476]">
            {t("whatsappMonitoring.mockOnly", "Mock data only")}
          </Badge>
        </div>

        <div className="flex h-[calc(100dvh-11rem)] min-h-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-[#005476]/5">
          <div className={cn("min-w-0 flex-1 lg:flex lg:w-[220px] lg:flex-none", mobilePanel === "employees" ? "flex" : "hidden")}>
            <EmployeePanel
              employees={MOCK_EMPLOYEES}
              selectedEmployeeId={selectedEmployeeId}
              onSelect={selectEmployee}
              onNext={() => setMobilePanel("conversations")}
              t={t}
            />
          </div>
          <div className={cn("min-w-0 flex-1 lg:flex lg:w-[340px] lg:flex-none", mobilePanel === "conversations" ? "flex" : "hidden")}>
            <ConversationPanel
              conversations={filteredConversations}
              selectedConversationId={selectedConversationId}
              search={search}
              filter={filter}
              onSearch={setSearch}
              onFilter={setFilter}
              onSelect={selectConversation}
              onBack={() => setMobilePanel("employees")}
              t={t}
            />
          </div>
          <div className={cn("min-w-0 flex-1 lg:flex", mobilePanel === "chat" ? "flex" : "hidden")}>
            <ChatPanel
              conversation={selectedConversation}
              employee={activeEmployee}
              onBack={() => setMobilePanel("conversations")}
              onPreview={setPreview}
              t={t}
            />
          </div>
        </div>
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