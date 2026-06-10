import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
  MessageCircle, Search, Phone, User, CheckCheck, Check,
  Clock, AlertCircle, Loader2, ChevronLeft, ChevronRight,
  RefreshCw, ArrowLeft,
} from "lucide-react";

// ── Types ────────────────────────────────────────────────────────────────────

interface Conversation {
  id: number;
  phone_number: string;
  contact_name: string | null;
  lead_id: number | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  unread_count: number;
  source: string;
  assigned_agent_id: number | null;
  crm_name: string | null;
  assigned_agent_name: string | null;
  message_count: number;
}

interface Message {
  id: number;
  direction: "outbound" | "inbound";
  message_text: string;
  message_type: string;
  wamid: string | null;
  status: string;
  context_label: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string | null;
}

interface ConversationDetail {
  conversation: Conversation & { crm_phone: string | null };
  messages: Message[];
}

interface ConvList { rows: Conversation[]; total: number; page: number }

interface Stats {
  total_conversations: string;
  total_outbound: string;
  total_inbound: string;
  total_failed: string;
  total_delivered: string;
  last_24h: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const PAGE_SIZE = 40;

function sourceBadge(source: string) {
  const map: Record<string, { label: string; cls: string }> = {
    crm:              { label: "CRM",       cls: "bg-blue-100 text-blue-700 border-blue-200" },
    meta_lead:        { label: "Meta Lead", cls: "bg-indigo-100 text-indigo-700 border-indigo-200" },
    manual:           { label: "Manual",    cls: "bg-slate-100 text-slate-600 border-slate-200" },
    ai:               { label: "AI",        cls: "bg-[#3bcac4]/10 text-[#005476] border-[#3bcac4]/30" },
    unknown:          { label: "Unknown",   cls: "bg-gray-100 text-gray-500 border-gray-200" },
  };
  const s = map[source] ?? map.unknown;
  return <Badge className={`text-xs border ${s.cls}`}>{s.label}</Badge>;
}

function statusIcon(status: string) {
  if (status === "read")      return <CheckCheck className="h-3.5 w-3.5 text-[#3bcac4]" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5 text-slate-300" />;
  if (status === "sent")      return <Check className="h-3.5 w-3.5 text-slate-300" />;
  if (status === "failed")    return <AlertCircle className="h-3.5 w-3.5 text-red-300" />;
  return <Clock className="h-3.5 w-3.5 text-slate-200" />;
}

function statusLabel(status: string): { text: string; cls: string } {
  if (status === "read")      return { text: "Read",      cls: "text-[#3bcac4]" };
  if (status === "delivered") return { text: "Delivered", cls: "text-slate-300" };
  if (status === "sent")      return { text: "Sent",      cls: "text-white/50" };
  if (status === "failed")    return { text: "Failed",    cls: "text-red-300" };
  return                             { text: "Pending",   cls: "text-white/30" };
}

function fmtTime(ts: string | null): string {
  if (!ts) return "—";
  const d = new Date(ts);
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtFull(ts: string): string {
  return new Date(ts).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function WhatsappApiChatHistoryPage() {
  const [search, setSearch]       = useState("");
  const [source, setSource]       = useState("");
  const [dateFrom, setDateFrom]   = useState("");
  const [dateTo, setDateTo]       = useState("");
  const [page, setPage]           = useState(1);
  const [activeConv, setActiveConv] = useState<Conversation | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const { data: stats } = useQuery<Stats>({
    queryKey: ["/api/admin/whatsapp-api/stats"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/whatsapp-api/stats")).json(),
    refetchInterval: 30_000,
  });

  const { data: convData, isLoading: convLoading, refetch: refetchConvs } = useQuery<ConvList>({
    queryKey: ["/api/admin/whatsapp-api/conversations", search, source, dateFrom, dateTo, page],
    queryFn: async () => {
      const p = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
      if (search)   p.set("search",   search);
      if (source)   p.set("source",   source);
      if (dateFrom) p.set("dateFrom", dateFrom);
      if (dateTo)   p.set("dateTo",   dateTo);
      return (await apiRequest("GET", `/api/admin/whatsapp-api/conversations?${p}`)).json();
    },
    refetchInterval: 30_000,
  });

  const { data: detail, isLoading: detailLoading } = useQuery<ConversationDetail>({
    queryKey: ["/api/admin/whatsapp-api/conversations", activeConv?.id, "messages"],
    queryFn: async () =>
      (await apiRequest("GET", `/api/admin/whatsapp-api/conversations/${activeConv!.id}/messages`)).json(),
    enabled: !!activeConv,
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (detail) {
      setTimeout(() => messagesEndRef.current?.scrollIntoView({ behavior: "smooth" }), 80);
    }
  }, [detail]);

  const convs  = convData?.rows  ?? [];
  const total  = convData?.total ?? 0;
  const pages  = Math.ceil(total / PAGE_SIZE);

  // ── Layout ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 pb-8">

      {/* Header */}
      <div className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white px-6 py-8">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <div className="p-2.5 bg-white/20 rounded-xl">
              <MessageCircle className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">WhatsApp API Chat History</h1>
              <p className="text-white/75 text-sm mt-0.5">
                Admin-only view of all WhatsApp Cloud API conversations
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto text-white/80 hover:text-white hover:bg-white/10"
              onClick={() => refetchConvs()}
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          {/* Stats row */}
          {stats && (
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
              {[
                { label: "Conversations", val: stats.total_conversations },
                { label: "Sent",          val: stats.total_outbound },
                { label: "Delivered ✓✓",  val: stats.total_delivered },
                { label: "Received",      val: stats.total_inbound },
                { label: "Failed",        val: stats.total_failed },
                { label: "Last 24h",      val: stats.last_24h },
              ].map(s => (
                <div key={s.label} className="bg-white/10 rounded-xl px-4 py-3 text-center">
                  <p className="text-2xl font-bold">{parseInt(s.val || "0").toLocaleString()}</p>
                  <p className="text-white/70 text-xs mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-5">
        <div className="flex gap-4 h-[calc(100vh-280px)] min-h-[500px]">

          {/* ── Left Panel: Conversation List ───────────────────────────── */}
          <div className={`flex flex-col ${activeConv ? "hidden lg:flex" : "flex"} w-full lg:w-[380px] shrink-0`}>

            {/* Filters */}
            <Card className="p-3 mb-3 shadow-sm">
              <div className="flex gap-2 mb-2">
                <div className="relative flex-1">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                  <Input
                    className="pl-8 h-8 text-sm"
                    placeholder="Search phone, name…"
                    value={search}
                    onChange={e => { setSearch(e.target.value); setPage(1); }}
                  />
                </div>
                <Select value={source || "all"} onValueChange={v => { setSource(v === "all" ? "" : v); setPage(1); }}>
                  <SelectTrigger className="h-8 text-xs w-[110px]"><SelectValue placeholder="Source" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All sources</SelectItem>
                    <SelectItem value="crm">CRM</SelectItem>
                    <SelectItem value="meta_lead">Meta Lead</SelectItem>
                    <SelectItem value="ai">AI</SelectItem>
                    <SelectItem value="manual">Manual</SelectItem>
                    <SelectItem value="unknown">Unknown</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex gap-2">
                <Input type="date" className="h-7 text-xs flex-1" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }} />
                <Input type="date" className="h-7 text-xs flex-1" value={dateTo}   onChange={e => { setDateTo(e.target.value);   setPage(1); }} />
              </div>
            </Card>

            {/* List */}
            <Card className="flex-1 overflow-y-auto shadow-sm divide-y divide-slate-100">
              {convLoading ? (
                <div className="flex items-center justify-center h-40">
                  <Loader2 className="h-5 w-5 animate-spin text-[#3bcac4]" />
                </div>
              ) : convs.length === 0 ? (
                <div className="text-center py-16 text-slate-400">
                  <MessageCircle className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">No conversations yet</p>
                  <p className="text-xs mt-1 text-slate-300">Messages sent via WhatsApp API will appear here</p>
                </div>
              ) : (
                convs.map(conv => (
                  <button
                    key={conv.id}
                    className={`w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${activeConv?.id === conv.id ? "bg-[#3bcac4]/5 border-r-2 border-[#3bcac4]" : ""}`}
                    onClick={() => setActiveConv(conv)}
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3bcac4]/20 to-[#005476]/20 flex items-center justify-center shrink-0 mt-0.5">
                        <User className="h-4 w-4 text-[#005476]" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-medium text-sm text-[#005476] truncate">
                            {conv.crm_name || conv.contact_name || conv.phone_number}
                          </span>
                          <span className="text-xs text-slate-400 shrink-0">{fmtTime(conv.last_message_at)}</span>
                        </div>
                        <div className="flex items-center gap-1 mt-0.5">
                          <Phone className="h-3 w-3 text-slate-400 shrink-0" />
                          <span className="text-xs text-slate-400 truncate">+{conv.phone_number}</span>
                        </div>
                        {conv.last_message_preview && (
                          <p className="text-xs text-slate-500 truncate mt-0.5">{conv.last_message_preview}</p>
                        )}
                        <div className="flex items-center gap-1.5 mt-1">
                          {sourceBadge(conv.source)}
                          <span className="text-xs text-slate-300">{conv.message_count} msg{conv.message_count !== 1 ? "s" : ""}</span>
                          {conv.unread_count > 0 && (
                            <span className="ml-auto bg-[#3bcac4] text-white text-xs rounded-full w-4 h-4 flex items-center justify-center font-bold">
                              {conv.unread_count}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </Card>

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between mt-2 px-1">
                <span className="text-xs text-slate-500">{total.toLocaleString()} total</span>
                <div className="flex items-center gap-1">
                  <Button size="icon" variant="outline" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <span className="text-xs text-slate-500 px-2">{page}/{pages}</span>
                  <Button size="icon" variant="outline" className="h-7 w-7" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* ── Right Panel: Chat Thread ─────────────────────────────────── */}
          <div className={`flex-1 flex flex-col ${activeConv ? "flex" : "hidden lg:flex"}`}>
            {!activeConv ? (
              <Card className="flex-1 flex items-center justify-center text-center text-slate-400 shadow-sm">
                <div>
                  <MessageCircle className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p className="font-medium text-slate-500">Select a conversation</p>
                  <p className="text-xs mt-1">Choose a contact from the left to view messages</p>
                </div>
              </Card>
            ) : (
              <Card className="flex-1 flex flex-col overflow-hidden shadow-sm">

                {/* Thread header */}
                <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 bg-white shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="lg:hidden h-8 w-8 text-slate-500"
                    onClick={() => setActiveConv(null)}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </Button>
                  <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#3bcac4]/20 to-[#005476]/20 flex items-center justify-center shrink-0">
                    <User className="h-4 w-4 text-[#005476]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#005476] truncate text-sm">
                      {activeConv.crm_name || activeConv.contact_name || activeConv.phone_number}
                    </p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Phone className="h-3 w-3" />+{activeConv.phone_number}
                      </span>
                      {sourceBadge(activeConv.source)}
                      {activeConv.lead_id && (
                        <a
                          href={`/admin/crm/${activeConv.lead_id}`}
                          className="text-xs text-[#3bcac4] underline underline-offset-2"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          CRM Lead #{activeConv.lead_id}
                        </a>
                      )}
                    </div>
                  </div>
                  {activeConv.assigned_agent_name && (
                    <span className="text-xs text-slate-400 hidden sm:block">
                      Agent: <span className="font-medium text-slate-600">{activeConv.assigned_agent_name}</span>
                    </span>
                  )}
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2 bg-slate-50">
                  {detailLoading ? (
                    <div className="flex items-center justify-center h-full">
                      <Loader2 className="h-5 w-5 animate-spin text-[#3bcac4]" />
                    </div>
                  ) : !detail?.messages?.length ? (
                    <div className="flex items-center justify-center h-full text-slate-400">
                      <div className="text-center">
                        <MessageCircle className="h-10 w-10 mx-auto mb-2 opacity-20" />
                        <p className="text-sm">No messages in this conversation</p>
                      </div>
                    </div>
                  ) : (
                    <>
                      {detail.messages.map((msg, idx) => {
                        const isOut = msg.direction === "outbound";
                        const prevMsg = detail.messages[idx - 1];
                        const showDateSep = !prevMsg || new Date(msg.created_at).toDateString() !== new Date(prevMsg.created_at).toDateString();

                        return (
                          <div key={msg.id}>
                            {/* Date separator */}
                            {showDateSep && (
                              <div className="flex items-center gap-2 my-3">
                                <div className="flex-1 h-px bg-slate-200" />
                                <span className="text-xs text-slate-400 px-2 bg-slate-50">
                                  {new Date(msg.created_at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                                </span>
                                <div className="flex-1 h-px bg-slate-200" />
                              </div>
                            )}

                            {/* Bubble */}
                            <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}>
                              <div className={`max-w-[72%] rounded-2xl px-3.5 py-2.5 shadow-sm ${
                                isOut
                                  ? "bg-gradient-to-br from-[#3bcac4] to-[#00a99d] text-white rounded-br-sm"
                                  : "bg-white text-slate-800 rounded-bl-sm border border-slate-100"
                              }`}>
                                {/* Context label */}
                                {msg.context_label && (
                                  <p className={`text-xs mb-1 font-medium ${isOut ? "text-white/70" : "text-slate-400"}`}>
                                    [{msg.context_label}]
                                  </p>
                                )}

                                {/* Message body */}
                                <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                                  {msg.message_text || <em className="opacity-50">No text content</em>}
                                </p>

                                {/* Footer: time + status */}
                                <div className={`flex items-center gap-1 mt-1.5 ${isOut ? "justify-end" : "justify-start"}`}>
                                  <span className={`text-xs ${isOut ? "text-white/60" : "text-slate-400"}`}>
                                    {fmtFull(msg.created_at)}
                                  </span>
                                  {isOut && (
                                    <span
                                      className="flex items-center gap-0.5 ml-1"
                                      title={
                                        msg.updated_at
                                          ? `Status updated: ${fmtFull(msg.updated_at)}`
                                          : `Status: ${msg.status}`
                                      }
                                    >
                                      {statusIcon(msg.status)}
                                      <span className={`text-xs font-medium ${statusLabel(msg.status).cls}`}>
                                        {statusLabel(msg.status).text}
                                      </span>
                                    </span>
                                  )}
                                </div>

                                {/* Error message */}
                                {msg.error_message && (
                                  <p className="text-xs text-red-200 mt-1 border-t border-red-300/30 pt-1">
                                    ✗ {msg.error_message}
                                  </p>
                                )}

                                {/* WAMID */}
                                {msg.wamid && (
                                  <p className={`text-xs mt-0.5 font-mono ${isOut ? "text-white/40" : "text-slate-300"}`}
                                     title={`Meta Message ID: ${msg.wamid}`}>
                                    {msg.wamid.slice(0, 24)}…
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                      <div ref={messagesEndRef} />
                    </>
                  )}
                </div>

                {/* Footer note */}
                <div className="px-4 py-2.5 border-t border-slate-100 bg-white shrink-0">
                  <p className="text-xs text-slate-400 text-center">
                    This is a read-only audit view. Messages are sent via the WhatsApp API only.
                  </p>
                </div>
              </Card>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
