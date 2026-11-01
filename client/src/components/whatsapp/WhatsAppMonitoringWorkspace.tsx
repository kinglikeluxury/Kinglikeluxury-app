import { useRef, useState } from "react";
import {
  Archive,
  ArrowDownToLine,
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
  Users,
  Video,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  EMPTY_WAV_DATA_URL,
  MOCK_PDF_DATA_URL,
  type MockConversation,
  type MockEmployee,
  type MockMessage,
} from "@/lib/whatsappEmployeeMonitoringMock";

export type WhatsappWorkspaceMode = "admin" | "employee";
export type ConversationFilter = "all" | "unread" | "archived" | "deleted" | "media";
export type PreviewState = { kind: "image" | "video"; url: string; title: string } | null;

const FILTERS: ConversationFilter[] = ["all", "unread", "archived", "deleted", "media"];
const technicalTokenPattern =
  /(https?:\/\/[^\s]+|\+\d[\d\s().-]{6,}\d|\b\d{1,3}(?:,\d{3})+(?:\.\d+)?(?:\s*[A-Z]{3})?\b|\b\d{1,2}:\d{2}\b)/g;

function UnicodeText({ children, className }: { children: string; className?: string }) {
  const nodes = children.split(technicalTokenPattern).map((part, index) =>
    index % 2 === 1
      ? <span key={`${index}-${part}`} dir="ltr" className="whitespace-nowrap">{part}</span>
      : part,
  );
  return <span dir="auto" className={cn("whitespace-pre-wrap break-words [unicode-bidi:plaintext]", className)}>{nodes}</span>;
}

function LtrText({ children, className }: { children: string; className?: string }) {
  return <span dir="ltr" className={cn("break-words [unicode-bidi:isolate]", className)}>{children}</span>;
}

function getLastMessage(conversation: MockConversation): MockMessage | undefined {
  return conversation.messages[conversation.messages.length - 1];
}

function getLastMessageLabel(message?: MockMessage): string {
  if (!message) return "";
  if (message.kind === "deleted") return "Deleted message";
  if (message.media) return ({ image: "Photo", video: "Video", audio: "Voice message", file: message.media.name })[message.media.kind];
  return message.text;
}

function MobileBackIcon({ isRtl }: { isRtl: boolean }) {
  return isRtl ? <ChevronRight className="h-5 w-5" /> : <ChevronLeft className="h-5 w-5" />;
}

function MessageStatus({ status }: { status?: MockMessage["status"] }) {
  if (!status) return null;
  return status === "sent"
    ? <Check className="h-3.5 w-3.5" />
    : <CheckCheck className={cn("h-3.5 w-3.5", status === "read" ? "text-[#3bcac4]" : "text-slate-400")} />;
}

function AudioPreview({ name }: { name: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      try { await audio.play(); } catch { setIsPlaying(false); }
    } else {
      audio.pause();
    }
  };
  return (
    <div className="flex min-w-[220px] items-center gap-3 rounded-xl bg-white/80 px-3 py-2">
      <audio
        ref={audioRef}
        src={EMPTY_WAV_DATA_URL}
        preload="metadata"
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
      />
      <Button type="button" size="icon" variant="outline" className="h-8 w-8 rounded-full" onClick={toggle} aria-label={isPlaying ? "Pause audio" : "Play audio"}>
        {isPlaying ? <Square className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 fill-current" />}
      </Button>
      <div className="flex flex-1 items-center gap-0.5">
        {Array.from({ length: 20 }).map((_, index) => <span key={index} className={cn("w-1 rounded-full bg-[#3bcac4]", index % 4 === 0 ? "h-5" : "h-2")} />)}
      </div>
      <span className="sr-only">{name}</span>
    </div>
  );
}

function MessageMedia({ message, onPreview }: { message: MockMessage; onPreview: (preview: Exclude<PreviewState, null>) => void }) {
  const media = message.media;
  if (!media) return null;
  if (media.kind === "audio") return <AudioPreview name={media.name} />;
  if (media.kind === "file") {
    return (
      <div className="flex min-w-[220px] items-center gap-3 rounded-xl bg-white/70 p-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-50 text-red-500"><FileText className="h-5 w-5" /></span>
        <span className="min-w-0 flex-1"><LtrText className="block truncate text-sm font-medium">{media.name}</LtrText>{media.size && <LtrText className="block text-xs text-slate-500">{media.size}</LtrText>}</span>
        <a href={MOCK_PDF_DATA_URL} download={media.name} className="rounded-full p-2 text-[#005476] hover:bg-white" aria-label={`Download ${media.name}`}><ArrowDownToLine className="h-4 w-4" /></a>
      </div>
    );
  }
  const previewKind = media.kind as "image" | "video";
  return (
    <button type="button" className="group relative block overflow-hidden rounded-xl text-start" onClick={() => onPreview({ kind: previewKind, url: media.url, title: media.name })}>
      <img src={media.url} alt={media.name} className="max-h-56 w-full max-w-[290px] object-cover transition-transform group-hover:scale-[1.02]" />
      <span className="absolute bottom-2 start-2 rounded-full bg-black/55 px-2 py-1 text-[11px] text-white">{media.kind === "video" ? "Open video preview" : "Open image"}</span>
    </button>
  );
}

function EmployeePanel({ employees, selectedEmployeeId, onSelect, t }: { employees: MockEmployee[]; selectedEmployeeId: string; onSelect: (id: string) => void; t: (key: string, fallback: string) => string }) {
  return (
    <aside className="flex min-h-0 flex-1 flex-col border-e border-slate-200 bg-white">
      <div className="border-b border-slate-200 px-4 py-4"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#005476]">Kinglike Luxury</p><h2 className="mt-1 text-lg font-semibold text-slate-900">{t("whatsappMonitoring.employees", "Employees")}</h2></div>
      <div className="flex-1 overflow-y-auto p-3">
        {employees.map((employee) => <button key={employee.id} type="button" onClick={() => onSelect(employee.id)} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-3 text-start", selectedEmployeeId === employee.id ? "bg-[#e7f8f7]" : "hover:bg-slate-50")}><img src={employee.avatar} alt="" className="h-11 w-11 rounded-full" /><span className="min-w-0 flex-1 truncate text-sm font-semibold">{employee.name}</span></button>)}
      </div>
    </aside>
  );
}

function ConversationPanel({ conversations, selectedConversationId, search, filter, onSearch, onFilter, onSelect, onBack, isRtl, t }: {
  conversations: MockConversation[]; selectedConversationId: string; search: string; filter: ConversationFilter;
  onSearch: (value: string) => void; onFilter: (value: ConversationFilter) => void; onSelect: (id: string) => void;
  onBack: () => void; isRtl: boolean; t: (key: string, fallback: string) => string;
}) {
  const labels: Record<ConversationFilter, string> = { all: t("whatsappMonitoring.filterAll", "All"), unread: t("whatsappMonitoring.filterUnread", "Unread"), archived: t("whatsappMonitoring.filterArchived", "Archived"), deleted: t("whatsappMonitoring.filterDeleted", "Deleted Events"), media: t("whatsappMonitoring.filterMedia", "Has Media") };
  return (
    <section className="flex min-h-0 flex-1 flex-col border-e border-slate-200 bg-[#f7f9fa]">
      <div className="border-b border-slate-200 bg-white px-4 py-4">
        <div className="flex items-center gap-2"><Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack} aria-label={t("whatsappMonitoring.back", "Back")}><MobileBackIcon isRtl={isRtl} /></Button><div className="min-w-0 flex-1"><h2 className="text-lg font-semibold text-slate-900">{t("whatsappMonitoring.conversations", "Conversations")}</h2><p className="text-xs text-slate-400">{conversations.length} {t("whatsappMonitoring.mockConversations", "mock conversations")}</p></div><Archive className="h-5 w-5 text-slate-400" /></div>
        <div className="relative mt-4"><Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input value={search} onChange={(event) => onSearch(event.target.value)} placeholder={t("whatsappMonitoring.searchPlaceholder", "Search by name or number")} className="h-10 border-slate-200 bg-slate-50 ps-9" aria-label={t("whatsappMonitoring.searchPlaceholder", "Search by name or number")} /></div>
        <div className="mt-3 flex gap-1.5 overflow-x-auto pb-1">{FILTERS.map((item) => <button key={item} type="button" onClick={() => onFilter(item)} className={cn("whitespace-nowrap rounded-full border px-3 py-1.5 text-xs", filter === item ? "border-[#005476] bg-[#005476] text-white" : "border-slate-200 bg-white text-slate-500")}>{labels[item]}</button>)}</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {conversations.length === 0 ? <div className="flex h-full min-h-48 flex-col items-center justify-center px-6 text-center text-slate-400"><Search className="mb-3 h-8 w-8" /><p className="text-sm font-medium">{t("whatsappMonitoring.noConversations", "No conversations found")}</p></div> : conversations.map((conversation) => {
          const lastMessage = getLastMessage(conversation);
          return <button key={conversation.id} type="button" onClick={() => onSelect(conversation.id)} className={cn("flex w-full gap-3 border-b border-slate-200 px-4 py-3 text-start", selectedConversationId === conversation.id ? "bg-[#e7f8f7]" : "bg-white hover:bg-slate-50")}><img src={conversation.avatar} alt="" className="h-11 w-11 shrink-0 rounded-full" /><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><UnicodeText className="truncate text-sm font-semibold text-slate-900">{conversation.customerName}</UnicodeText><LtrText className="shrink-0 text-[11px] text-slate-400">{lastMessage?.time ?? ""}</LtrText></span><LtrText className="block text-xs text-slate-500">{conversation.customerPhone}</LtrText><span className="mt-1 flex items-center justify-between gap-2"><span className="truncate text-xs text-slate-400">{getLastMessageLabel(lastMessage)}</span>{conversation.unreadCount > 0 && <span className="rounded-full bg-[#3bcac4] px-1.5 text-[10px] font-bold text-white">{conversation.unreadCount}</span>}</span></span></button>;
        })}
      </div>
    </section>
  );
}

function ChatPanel({ conversation, employee, onBack, onPreview, isRtl, t }: { conversation?: MockConversation; employee?: MockEmployee; onBack: () => void; onPreview: (preview: Exclude<PreviewState, null>) => void; isRtl: boolean; t: (key: string, fallback: string) => string }) {
  if (!conversation) return <section className="flex min-h-0 flex-1 items-center justify-center bg-[#efeae2] p-8 text-center text-slate-500"><div><MessageCircle className="mx-auto mb-3 h-10 w-10 text-[#3bcac4]" /><p className="font-medium">{t("whatsappMonitoring.selectConversation", "Select a conversation")}</p></div></section>;
  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[#efeae2]">
      <header className="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3"><Button variant="ghost" size="icon" className="lg:hidden" onClick={onBack} aria-label={t("whatsappMonitoring.back", "Back")}><MobileBackIcon isRtl={isRtl} /></Button><img src={conversation.avatar} alt="" className="h-10 w-10 rounded-full" /><div className="min-w-0 flex-1"><UnicodeText className="block truncate text-sm font-semibold text-slate-900">{conversation.customerName}</UnicodeText><LtrText className="block truncate text-xs text-slate-500">{conversation.customerPhone}</LtrText></div>{employee && <div className="hidden text-end sm:block"><p className="text-[11px] uppercase tracking-wide text-slate-400">{t("whatsappMonitoring.employee", "Employee")}</p><UnicodeText className="block text-xs font-semibold text-[#005476]">{employee.name}</UnicodeText></div>}<Button variant="ghost" size="icon" aria-label={t("whatsappMonitoring.moreActions", "More actions")}><MoreVertical className="h-5 w-5 text-slate-500" /></Button></header>
      <div className="flex-1 overflow-y-auto px-3 py-5 sm:px-8"><div className="mx-auto max-w-3xl"><div className="mb-5 flex justify-center"><span className="rounded-lg bg-white/75 px-3 py-1 text-[11px] font-medium text-slate-500 shadow-sm">{t("whatsappMonitoring.archivedPreview", "Archived monitoring preview")}</span></div>{conversation.messages.map((message, index) => { const previous = conversation.messages[index - 1]; return <div key={message.id}>{(!previous || previous.dateLabel !== message.dateLabel) && <div className="my-4 flex justify-center"><LtrText className="rounded-lg bg-white/75 px-3 py-1 text-[11px] text-slate-500 shadow-sm">{message.dateLabel}</LtrText></div>}<div className={cn("mb-2 flex", message.direction === "outgoing" ? "justify-end" : "justify-start")}><div className={cn("max-w-[90%] rounded-xl px-3 py-2 text-sm shadow-sm sm:max-w-[72%]", message.direction === "outgoing" ? "bg-[#d9fdd3]" : "bg-white")}>{message.kind === "deleted" && <div className="mb-1 text-[11px] text-slate-500">Deleted from WhatsApp</div>}{message.media && <MessageMedia message={message} onPreview={onPreview} />}{message.text && <p><UnicodeText>{message.text}</UnicodeText></p>}<div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-slate-400"><LtrText>{message.time}</LtrText><MessageStatus status={message.status} /></div></div></div></div>; })}</div></div>
      <div className="whatsapp-composer border-t border-slate-200 bg-white px-3 py-3 sm:px-5"><div className="mx-auto flex max-w-3xl items-center gap-2"><Button type="button" variant="ghost" size="icon" disabled aria-label={t("whatsappMonitoring.attach", "Attach")}><Paperclip className="h-5 w-5 text-slate-400" /></Button><Button type="button" variant="ghost" size="icon" disabled aria-label={t("whatsappMonitoring.emoji", "Emoji")}><Smile className="h-5 w-5 text-slate-400" /></Button><Input disabled placeholder={t("whatsappMonitoring.sendingLater", "Sending will be enabled in a later phase")} className="h-10 bg-slate-50 text-slate-400" aria-label={t("whatsappMonitoring.sendingLater", "Sending will be enabled in a later phase")} /><Button type="button" size="icon" disabled aria-label={t("whatsappMonitoring.send", "Send")}><Send className="h-4 w-4" /></Button></div><p className="mx-auto mt-1 max-w-3xl text-center text-[10px] text-slate-400">{t("whatsappMonitoring.composerDisabled", "Sending is disabled in this mock-only phase")}</p></div>
    </section>
  );
}

export interface WhatsAppMonitoringWorkspaceProps {
  workspaceMode: WhatsappWorkspaceMode;
  employees?: MockEmployee[];
  conversations: MockConversation[];
  selectedEmployeeId?: string;
  selectedConversationId: string;
  search: string;
  filter: ConversationFilter;
  selectedConversation?: MockConversation;
  activeEmployee?: MockEmployee;
  onEmployeeSelect?: (id: string) => void;
  onConversationsNext?: () => void;
  onConversationSelect: (id: string) => void;
  onSearch: (value: string) => void;
  onFilter: (value: ConversationFilter) => void;
  onConversationsBack: () => void;
  onChatBack: () => void;
  onPreview: (preview: Exclude<PreviewState, null>) => void;
  mobilePanel?: "conversations" | "chat";
  isRtl: boolean;
  t: (key: string, fallback: string) => string;
}

export function WhatsAppMonitoringWorkspace({
  workspaceMode,
  employees = [],
  conversations,
  selectedEmployeeId = "all",
  selectedConversationId,
  search,
  filter,
  selectedConversation,
  activeEmployee,
  onEmployeeSelect,
  onConversationsNext,
  onConversationSelect,
  onSearch,
  onFilter,
  onConversationsBack,
  onChatBack,
  onPreview,
  mobilePanel = "conversations",
  isRtl,
  t,
}: WhatsAppMonitoringWorkspaceProps) {
  const isEmployeeWorkspace = workspaceMode === "employee";
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl shadow-[#005476]/5">
      {!isEmployeeWorkspace && <div className={cn("min-h-0 min-w-0 flex-1 lg:flex lg:w-[220px] lg:flex-none", mobilePanel === "conversations" ? "flex" : "hidden")}><EmployeePanel employees={employees} selectedEmployeeId={selectedEmployeeId} onSelect={onEmployeeSelect ?? (() => undefined)} t={t} /></div>}
      <div className={cn("min-h-0 min-w-0 flex-1", mobilePanel === "chat" ? "hidden lg:flex" : "flex", isEmployeeWorkspace ? "lg:w-[380px] lg:flex-none" : "lg:w-[340px] lg:flex-none")}><ConversationPanel conversations={conversations} selectedConversationId={selectedConversationId} search={search} filter={filter} onSearch={onSearch} onFilter={onFilter} onSelect={onConversationSelect} onBack={onConversationsBack} isRtl={isRtl} t={t} /></div>
      <div className={cn("min-h-0 min-w-0 flex-1", mobilePanel === "chat" ? "flex" : "hidden lg:flex")}><ChatPanel conversation={selectedConversation} employee={isEmployeeWorkspace ? undefined : activeEmployee} onBack={onChatBack} onPreview={onPreview} isRtl={isRtl} t={t} /></div>
      {workspaceMode === "admin" && onConversationsNext && <span className="sr-only" aria-hidden="true">{String(Boolean(onConversationsNext))}</span>}
    </div>
  );
}