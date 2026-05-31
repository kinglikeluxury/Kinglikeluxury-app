import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Brain, MessageSquare, Users, BarChart3, Search, ChevronLeft, ChevronRight,
  ArrowLeft, X, Target, Activity, Calendar, Flame, Thermometer, Snowflake,
  UserCheck, Building2, Phone, Mail, Globe, MapPin, Laptop, FileText, Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────────────────────
interface Conversation {
  id: number; user_id: number; language: string; status: string; message_count: number;
  country: string; city: string; device_type: string; source_page: string;
  created_at: string; updated_at: string;
  username: string; email: string; phone: string;
  lead_score: string; budget: string; goal: string; interested_project: string;
}
interface Message { id: number; conversation_id: number; role: string; content: string; created_at: string; }
interface Lead {
  id: number; user_id: number; username: string; email: string;
  lead_score: string; lead_status: string; assigned_agent_id: number | null;
  assigned_agent_name: string | null; assignment_note: string | null;
  budget: string; goal: string; timeline: string; country: string;
  interested_project: string; whatsapp_contact_number: string;
  account_phone: string; created_at: string; updated_at: string;
  conversation_id: number;
}
interface AdminUser { id: number; username: string; email: string; }
interface MostRequestedProject { project: string; mention_count: number; conversation_count: number; lead_count: number; }
interface AnalyticsData {
  stats: {
    totalConversations: number; todayConversations: number; weekConversations: number;
    monthConversations: number; totalLeads: number; hotLeads: number;
    warmLeads: number; coldLeads: number; averageLeadScore: number;
  };
  convsByDay: { day: string; count: number }[];
  topCountries: { country: string; count: number }[];
  mostRequestedProjects: MostRequestedProject[];
  topLanguages: { language: string; count: number }[];
  topGoals: { goal: string; count: number }[];
  topBudgets: { budget: string; count: number }[];
  topTimelines: { timeline: string; count: number }[];
}

// ── Constants ────────────────────────────────────────────────────────────────
const LEAD_STATUSES = [
  { value: "unassigned", label: "Unassigned", color: "text-gray-600 border-gray-300 bg-gray-100" },
  { value: "assigned",   label: "Assigned",   color: "text-[#3bcac4] border-[#3bcac4]/40 bg-[#3bcac4]/10" },
  { value: "contacted",  label: "Contacted",  color: "text-blue-600 border-blue-200 bg-blue-50" },
  { value: "follow_up",  label: "Follow-up",  color: "text-amber-600 border-amber-200 bg-amber-50" },
  { value: "closed",     label: "Closed",     color: "text-emerald-600 border-emerald-200 bg-emerald-50" },
  { value: "lost",       label: "Lost",       color: "text-red-600 border-red-200 bg-red-50" },
];

// ── Helpers ──────────────────────────────────────────────────────────────────
function ScoreBadge({ score }: { score: string }) {
  if (!score) return <Badge variant="outline" className="text-gray-400 border-gray-300 bg-gray-50 text-xs">—</Badge>;
  const map: Record<string, { label: string; cls: string; Icon: any }> = {
    hot:  { label: "Hot",  cls: "bg-red-50 text-red-600 border-red-200",       Icon: Flame },
    warm: { label: "Warm", cls: "bg-amber-50 text-amber-600 border-amber-200", Icon: Thermometer },
    cold: { label: "Cold", cls: "bg-blue-50 text-blue-600 border-blue-200",    Icon: Snowflake },
  };
  const m = map[score] || { label: score, cls: "bg-gray-100 text-gray-600 border-gray-300", Icon: Target };
  return (
    <Badge variant="outline" className={`${m.cls} flex items-center gap-1 w-fit text-xs font-medium`}>
      <m.Icon className="w-3 h-3" />{m.label}
    </Badge>
  );
}

function StatusBadge({ status }: { status: string }) {
  const s = LEAD_STATUSES.find(x => x.value === status) || LEAD_STATUSES[0];
  return <Badge variant="outline" className={`${s.color} text-xs w-fit font-medium`}>{s.label}</Badge>;
}

function fmt(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtDate(d: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  if (!value || value === "—") return null;
  return (
    <div className="flex items-start gap-2">
      <Icon className="w-3.5 h-3.5 text-[#3bcac4] mt-0.5 shrink-0" />
      <div>
        <p className="text-[10px] text-gray-400 uppercase tracking-wider">{label}</p>
        <p className="text-xs text-[#005476] font-medium">{value}</p>
      </div>
    </div>
  );
}

function Pagination({ page, totalPages, onPage }: { page: number; totalPages: number; onPage: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center gap-2 justify-center pt-4">
      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => onPage(page - 1)}
        className="border-gray-300 text-[#005476] hover:bg-[#3bcac4]/10 hover:border-[#3bcac4]">
        <ChevronLeft className="w-4 h-4" />
      </Button>
      <span className="text-sm text-gray-500">Page {page} of {totalPages}</span>
      <Button size="sm" variant="outline" disabled={page >= totalPages} onClick={() => onPage(page + 1)}
        className="border-gray-300 text-[#005476] hover:bg-[#3bcac4]/10 hover:border-[#3bcac4]">
        <ChevronRight className="w-4 h-4" />
      </Button>
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: number | string; sub?: string; color?: string }) {
  return (
    <Card className="bg-white border border-gray-200 shadow-sm">
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
        <p className={`text-3xl font-bold ${color || "text-[#3bcac4]"}`}>{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function BarList({ title, rows, labelKey, countKey }: { title: string; rows: any[]; labelKey: string; countKey: string }) {
  const max = Math.max(...rows.map(r => r[countKey]), 1);
  return (
    <Card className="bg-white border border-gray-200 shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-[#005476] font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {rows.length === 0 && <p className="text-xs text-gray-400">No data yet</p>}
        {rows.map((r, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <span className="text-xs text-gray-600 w-28 truncate shrink-0">{r[labelKey] || "Unknown"}</span>
            <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
              <div className="h-2 rounded-full bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                style={{ width: `${(r[countKey] / max) * 100}%` }} />
            </div>
            <span className="text-xs text-gray-500 w-6 text-right shrink-0 font-medium">{r[countKey]}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

// shared input/select classes
const inputCls = "bg-white border-gray-300 text-[#005476] placeholder:text-gray-400 text-sm focus:border-[#3bcac4] focus:ring-[#3bcac4]/20";
const selectTriggerCls = "bg-white border-gray-300 text-[#005476] text-sm focus:border-[#3bcac4]";
const selectContentCls = "bg-white border-gray-200 shadow-lg";

// ── Tab: Conversations ───────────────────────────────────────────────────────
function ConversationsTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [leadScore, setLeadScore] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selected, setSelected] = useState<Conversation | null>(null);

  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("search", search);
  if (leadScore !== "all") params.set("leadScore", leadScore);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);

  const { data, isLoading } = useQuery<{ conversations: Conversation[]; total: number; page: number; totalPages: number }>({
    queryKey: ["/api/admin/ai-conversations", page, search, leadScore, dateFrom, dateTo],
    queryFn: () => fetch(`/api/admin/ai-conversations?${params}`).then(r => r.json()),
  });

  const { data: transcript, isLoading: transcriptLoading } = useQuery<{ messages: Message[]; profile: any; conversation: any }>({
    queryKey: ["/api/admin/ai-conversations", selected?.id, "messages"],
    queryFn: () => fetch(`/api/admin/ai-conversations/${selected?.id}/messages`).then(r => r.json()),
    enabled: !!selected,
  });

  const applySearch = () => { setSearch(searchInput); setPage(1); };
  const clearFilters = () => { setSearch(""); setSearchInput(""); setLeadScore("all"); setDateFrom(""); setDateTo(""); setPage(1); };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex gap-1 flex-1 min-w-52">
              <Input placeholder="Search user, email, phone…" value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && applySearch()}
                className={inputCls} />
              <Button size="sm" onClick={applySearch}
                className="bg-[#3bcac4] hover:bg-[#005476] text-white shrink-0">
                <Search className="w-4 h-4" />
              </Button>
            </div>
            <Select value={leadScore} onValueChange={v => { setLeadScore(v); setPage(1); }}>
              <SelectTrigger className={`w-32 ${selectTriggerCls}`}><SelectValue placeholder="Lead score" /></SelectTrigger>
              <SelectContent className={selectContentCls}>
                <SelectItem value="all">All scores</SelectItem>
                <SelectItem value="hot">Hot</SelectItem>
                <SelectItem value="warm">Warm</SelectItem>
                <SelectItem value="cold">Cold</SelectItem>
              </SelectContent>
            </Select>
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              className={`w-36 ${inputCls}`} />
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
              className={`w-36 ${inputCls}`} />
            {(search || leadScore !== "all" || dateFrom || dateTo) && (
              <Button size="sm" variant="ghost" onClick={clearFilters}
                className="text-gray-500 hover:text-[#005476] hover:bg-gray-100">
                <X className="w-4 h-4 mr-1" />Clear
              </Button>
            )}
          </div>
          {data && <p className="text-xs text-gray-400 mt-2">{data.total} conversations found</p>}
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Lead Score</th>
                <th className="text-left px-4 py-3">Language</th>
                <th className="text-left px-4 py-3">Msgs</th>
                <th className="text-left px-4 py-3">Project Interest</th>
                <th className="text-left px-4 py-3">Budget</th>
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && !data?.conversations?.length && (
                <tr><td colSpan={8} className="text-center py-12 text-gray-400">No conversations found</td></tr>
              )}
              {data?.conversations?.map(conv => (
                <tr key={conv.id} className="border-b border-gray-100 hover:bg-[#3bcac4]/5 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#005476]">{conv.username || `User #${conv.user_id}`}</p>
                    <p className="text-xs text-gray-500">{conv.email || conv.phone || "—"}</p>
                  </td>
                  <td className="px-4 py-3"><ScoreBadge score={conv.lead_score} /></td>
                  <td className="px-4 py-3">
                    <span className="text-gray-600 uppercase text-xs font-mono bg-gray-100 px-1.5 py-0.5 rounded">
                      {conv.language || "—"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-[#3bcac4] font-bold">{conv.message_count || 0}</span>
                  </td>
                  <td className="px-4 py-3"><span className="text-gray-700 text-xs">{conv.interested_project || "—"}</span></td>
                  <td className="px-4 py-3"><span className="text-gray-700 text-xs">{conv.budget || "—"}</span></td>
                  <td className="px-4 py-3"><span className="text-gray-500 text-xs">{fmt(conv.created_at)}</span></td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="outline" onClick={() => setSelected(conv)}
                      className="border-[#3bcac4] text-[#3bcac4] hover:bg-[#3bcac4] hover:text-white text-xs transition-colors">
                      View
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Pagination page={page} totalPages={data?.totalPages || 1} onPage={setPage} />

      {/* ── Transcript Dialog ─────────────────────────────────────────────── */}
      <Dialog open={!!selected} onOpenChange={open => !open && setSelected(null)}>
        <DialogContent className="bg-white border border-gray-200 shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col p-0 gap-0">
          {/* Header */}
          <DialogHeader className="px-5 pt-5 pb-3 border-b border-gray-200 shrink-0 bg-gray-50">
            <DialogTitle className="text-[#005476] flex items-center gap-2 text-base font-semibold">
              <MessageSquare className="w-5 h-5 text-[#3bcac4]" />
              Conversation #{selected?.id}
              {selected?.username && (
                <span className="text-gray-500 font-normal text-sm ml-1">— {selected.username}</span>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="flex flex-col sm:flex-row flex-1 overflow-hidden min-h-0">
            {/* Left sidebar — user & lead info */}
            <div className="sm:w-64 shrink-0 border-b sm:border-b-0 sm:border-r border-gray-200 p-4 space-y-4 overflow-y-auto bg-gray-50">

              {/* User info */}
              <div>
                <p className="text-[10px] text-[#3bcac4] uppercase tracking-widest font-bold mb-2 border-b border-gray-200 pb-1">
                  User Info
                </p>
                <div className="space-y-2.5">
                  <InfoRow icon={Users} label="Name" value={selected?.username || `User #${selected?.user_id}`} />
                  <InfoRow icon={Mail} label="Email" value={transcript?.conversation?.email || selected?.email || "—"} />
                  <InfoRow icon={Phone} label="Phone" value={transcript?.conversation?.phone_number || selected?.phone || "—"} />
                  <InfoRow icon={Calendar} label="Date" value={fmtDate(selected?.created_at || "")} />
                  <InfoRow icon={Clock} label="Time" value={selected?.created_at ? new Date(selected.created_at).toLocaleTimeString("en-GB") : "—"} />
                </div>
              </div>

              {/* Session meta */}
              <div>
                <p className="text-[10px] text-[#3bcac4] uppercase tracking-widest font-bold mb-2 border-b border-gray-200 pb-1">
                  Session
                </p>
                <div className="space-y-2.5">
                  <InfoRow icon={Globe} label="Language" value={(selected?.language || "").toUpperCase()} />
                  <InfoRow icon={MapPin} label="Country" value={selected?.country || transcript?.conversation?.country || "—"} />
                  <InfoRow icon={Laptop} label="Device" value={selected?.device_type || "—"} />
                  <InfoRow icon={FileText} label="Source Page" value={selected?.source_page || "—"} />
                </div>
              </div>

              {/* Lead profile */}
              {transcript?.profile && (
                <div>
                  <p className="text-[10px] text-[#3bcac4] uppercase tracking-widest font-bold mb-2 border-b border-gray-200 pb-1">
                    Lead Profile
                  </p>
                  <div className="space-y-2.5">
                    <div>
                      <p className="text-[10px] text-gray-400 uppercase tracking-wider mb-1">Score</p>
                      <ScoreBadge score={transcript.profile.lead_score} />
                    </div>
                    <InfoRow icon={Building2} label="Project" value={transcript.profile.interested_project || "—"} />
                    <InfoRow icon={Target} label="Budget" value={transcript.profile.budget || "—"} />
                    <InfoRow icon={FileText} label="Goal" value={transcript.profile.goal || "—"} />
                    <InfoRow icon={MapPin} label="Country" value={transcript.profile.country || "—"} />
                    <InfoRow icon={Clock} label="Timeline" value={transcript.profile.timeline || "—"} />
                    <InfoRow icon={Phone} label="WhatsApp" value={transcript.profile.whatsapp_contact_number || "—"} />
                    {transcript.profile.assigned_agent_name && (
                      <InfoRow icon={UserCheck} label="Assigned To" value={transcript.profile.assigned_agent_name} />
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Right — chat messages */}
            <ScrollArea className="flex-1 overflow-y-auto bg-white">
              <div className="p-5 space-y-4">
                {transcriptLoading && (
                  <div className="flex items-center justify-center py-12">
                    <div className="w-6 h-6 border-2 border-[#3bcac4] border-t-transparent rounded-full animate-spin" />
                  </div>
                )}
                {!transcriptLoading && transcript?.messages?.length === 0 && (
                  <p className="text-center text-gray-400 py-12">No messages found</p>
                )}
                {transcript?.messages?.map(msg => (
                  <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[82%] rounded-2xl px-4 py-3 text-sm shadow-sm ${
                      msg.role === "user"
                        ? "bg-gray-100 text-[#005476] border border-gray-200 rounded-br-sm"
                        : "bg-[#3bcac4]/12 text-[#005476] border border-[#3bcac4]/25 rounded-bl-sm"
                    }`}
                      style={msg.role !== "user" ? { backgroundColor: "rgba(59,202,196,0.10)" } : {}}>
                      <p className={`text-[10px] mb-1.5 font-bold uppercase tracking-wider ${
                        msg.role === "user" ? "text-gray-500" : "text-[#3bcac4]"
                      }`}>
                        {msg.role === "user" ? (selected?.username || "User") : "AI Assistant"}
                      </p>
                      <p className="whitespace-pre-wrap leading-relaxed text-[#005476]">{msg.content}</p>
                      <p className="text-[10px] text-gray-400 mt-1.5 text-right">{fmt(msg.created_at)}</p>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Assign Dialog ────────────────────────────────────────────────────────────
function AssignDialog({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [agentId, setAgentId] = useState<string>(lead.assigned_agent_id ? String(lead.assigned_agent_id) : "");
  const [status, setStatus] = useState(lead.lead_status || "unassigned");
  const [note, setNote] = useState(lead.assignment_note || "");

  const { data: users = [] } = useQuery<AdminUser[]>({
    queryKey: ["/api/admin/ai-users"],
    queryFn: () => fetch("/api/admin/ai-users").then(r => r.json()),
  });

  const { mutate, isPending } = useMutation({
    mutationFn: () => fetch(`/api/admin/ai-leads/${lead.id}/assign`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        assignedAgentId: agentId && agentId !== "none" ? Number(agentId) : null,
        leadStatus: status,
        assignmentNote: note,
      }),
    }).then(r => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-leads-paged"] });
      toast({ title: "Lead updated", description: "Assignment saved successfully." });
      onClose();
    },
    onError: () => toast({ title: "Error", description: "Failed to save assignment.", variant: "destructive" }),
  });

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent className="bg-white border border-gray-200 shadow-2xl max-w-md">
        <DialogHeader className="pb-2">
          <DialogTitle className="text-[#005476] flex items-center gap-2 font-semibold">
            <UserCheck className="w-5 h-5 text-[#3bcac4]" />
            Assign Lead — {lead.username || `#${lead.id}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Lead summary strip */}
          <div className="bg-gray-50 rounded-lg p-3 text-xs space-y-1.5 border border-gray-200">
            <div className="flex gap-4 flex-wrap">
              <div><span className="text-gray-400">Score: </span><span className="text-[#005476] font-semibold">{lead.lead_score || "—"}</span></div>
              <div><span className="text-gray-400">Project: </span><span className="text-[#005476] font-semibold">{lead.interested_project || "—"}</span></div>
            </div>
            <div><span className="text-gray-400">Budget: </span><span className="text-[#005476] font-semibold">{lead.budget || "—"}</span></div>
            {lead.whatsapp_contact_number && (
              <div><span className="text-gray-400">WhatsApp: </span>
                <a href={`https://wa.me/${lead.whatsapp_contact_number.replace(/\D/g, "")}`} target="_blank" rel="noreferrer"
                  className="text-[#3bcac4] hover:underline font-medium">{lead.whatsapp_contact_number}</a>
              </div>
            )}
          </div>

          {/* Assign to agent */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Assign To Agent</label>
            <Select value={agentId} onValueChange={setAgentId}>
              <SelectTrigger className={selectTriggerCls}><SelectValue placeholder="Select agent…" /></SelectTrigger>
              <SelectContent className={selectContentCls}>
                <SelectItem value="none">Unassigned</SelectItem>
                {users.map(u => (
                  <SelectItem key={u.id} value={String(u.id)}>{u.username}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Status</label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className={selectTriggerCls}><SelectValue /></SelectTrigger>
              <SelectContent className={selectContentCls}>
                {LEAD_STATUSES.map(s => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Internal note */}
          <div className="space-y-1.5">
            <label className="text-xs text-gray-500 font-semibold uppercase tracking-wider">Internal Note</label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
              placeholder="Add a note visible only to admins…"
              className="bg-white border-gray-300 text-[#005476] placeholder:text-gray-400 text-sm resize-none focus:border-[#3bcac4]" />
          </div>

          {/* Actions */}
          <div className="flex gap-2 justify-end pt-1 border-t border-gray-100">
            <Button variant="ghost" onClick={onClose} className="text-gray-500 hover:text-[#005476] hover:bg-gray-100">
              Cancel
            </Button>
            <Button onClick={() => mutate()} disabled={isPending}
              className="bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:opacity-90 text-white font-medium">
              {isPending ? "Saving…" : "Save Assignment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Tab: AI Leads ────────────────────────────────────────────────────────────
function LeadsTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [leadScore, setLeadScore] = useState("all");
  const [leadStatus, setLeadStatus] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [assigning, setAssigning] = useState<Lead | null>(null);

  const params = new URLSearchParams({ page: String(page) });
  if (search) params.set("search", search);
  if (leadScore !== "all") params.set("leadScore", leadScore);
  if (leadStatus !== "all") params.set("leadStatus", leadStatus);
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);

  const { data, isLoading } = useQuery<{ leads: Lead[]; total: number; page: number; totalPages: number }>({
    queryKey: ["/api/admin/ai-leads-paged", page, search, leadScore, leadStatus, dateFrom, dateTo],
    queryFn: () => fetch(`/api/admin/ai-leads-paged?${params}`).then(r => r.json()),
  });

  const applySearch = () => { setSearch(searchInput); setPage(1); };
  const clearFilters = () => { setSearch(""); setSearchInput(""); setLeadScore("all"); setLeadStatus("all"); setDateFrom(""); setDateTo(""); setPage(1); };

  return (
    <div className="space-y-4">
      {/* Filters */}
      <Card className="bg-white border border-gray-200 shadow-sm">
        <CardContent className="pt-4 pb-3">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex gap-1 flex-1 min-w-52">
              <Input placeholder="Search name, email, country, project…" value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && applySearch()}
                className={inputCls} />
              <Button size="sm" onClick={applySearch}
                className="bg-[#3bcac4] hover:bg-[#005476] text-white shrink-0">
                <Search className="w-4 h-4" />
              </Button>
            </div>
            <Select value={leadScore} onValueChange={v => { setLeadScore(v); setPage(1); }}>
              <SelectTrigger className={`w-28 ${selectTriggerCls}`}><SelectValue placeholder="Score" /></SelectTrigger>
              <SelectContent className={selectContentCls}>
                <SelectItem value="all">All scores</SelectItem>
                <SelectItem value="hot">Hot</SelectItem>
                <SelectItem value="warm">Warm</SelectItem>
                <SelectItem value="cold">Cold</SelectItem>
              </SelectContent>
            </Select>
            <Select value={leadStatus} onValueChange={v => { setLeadStatus(v); setPage(1); }}>
              <SelectTrigger className={`w-32 ${selectTriggerCls}`}><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent className={selectContentCls}>
                <SelectItem value="all">All statuses</SelectItem>
                {LEAD_STATUSES.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input type="date" value={dateFrom} onChange={e => { setDateFrom(e.target.value); setPage(1); }}
              className={`w-36 ${inputCls}`} />
            <Input type="date" value={dateTo} onChange={e => { setDateTo(e.target.value); setPage(1); }}
              className={`w-36 ${inputCls}`} />
            {(search || leadScore !== "all" || leadStatus !== "all" || dateFrom || dateTo) && (
              <Button size="sm" variant="ghost" onClick={clearFilters}
                className="text-gray-500 hover:text-[#005476] hover:bg-gray-100">
                <X className="w-4 h-4 mr-1" />Clear
              </Button>
            )}
          </div>
          {data && <p className="text-xs text-gray-400 mt-2">{data.total} leads found</p>}
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="bg-white border border-gray-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-xs uppercase tracking-wider">
                <th className="text-left px-4 py-3">User</th>
                <th className="text-left px-4 py-3">Score</th>
                <th className="text-left px-4 py-3">Status</th>
                <th className="text-left px-4 py-3">Assigned To</th>
                <th className="text-left px-4 py-3">Budget</th>
                <th className="text-left px-4 py-3">Country</th>
                <th className="text-left px-4 py-3">Project Interest</th>
                <th className="text-left px-4 py-3">WhatsApp</th>
                <th className="text-left px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {isLoading && (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">Loading…</td></tr>
              )}
              {!isLoading && !data?.leads?.length && (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">No leads found</td></tr>
              )}
              {data?.leads?.map(lead => (
                <tr key={lead.id} className="border-b border-gray-100 hover:bg-[#3bcac4]/5 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-semibold text-[#005476]">{lead.username || `User #${lead.user_id}`}</p>
                    <p className="text-xs text-gray-500">{lead.email || "—"}</p>
                  </td>
                  <td className="px-4 py-3"><ScoreBadge score={lead.lead_score} /></td>
                  <td className="px-4 py-3"><StatusBadge status={lead.lead_status || "unassigned"} /></td>
                  <td className="px-4 py-3">
                    {lead.assigned_agent_name
                      ? <span className="text-[#3bcac4] text-xs flex items-center gap-1 font-medium">
                          <UserCheck className="w-3 h-3" />{lead.assigned_agent_name}
                        </span>
                      : <span className="text-gray-400 text-xs">—</span>
                    }
                  </td>
                  <td className="px-4 py-3"><span className="text-gray-700 text-xs">{lead.budget || "—"}</span></td>
                  <td className="px-4 py-3"><span className="text-gray-700 text-xs">{lead.country || "—"}</span></td>
                  <td className="px-4 py-3"><span className="text-gray-700 text-xs">{lead.interested_project || "—"}</span></td>
                  <td className="px-4 py-3">
                    {lead.whatsapp_contact_number
                      ? <a href={`https://wa.me/${lead.whatsapp_contact_number.replace(/\D/g,"")}`}
                          target="_blank" rel="noreferrer"
                          className="text-[#3bcac4] hover:text-[#005476] hover:underline text-xs font-medium">
                          {lead.whatsapp_contact_number}
                        </a>
                      : <span className="text-gray-400 text-xs">—</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="outline" onClick={() => setAssigning(lead)}
                      className="border-[#3bcac4] text-[#3bcac4] hover:bg-[#3bcac4] hover:text-white text-xs transition-colors whitespace-nowrap">
                      <UserCheck className="w-3 h-3 mr-1" />Assign
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Pagination page={page} totalPages={data?.totalPages || 1} onPage={setPage} />
      {assigning && <AssignDialog lead={assigning} onClose={() => setAssigning(null)} />}
    </div>
  );
}

// ── Tab: Analytics ───────────────────────────────────────────────────────────
function AnalyticsTab() {
  const { data, isLoading } = useQuery<AnalyticsData>({
    queryKey: ["/api/admin/ai-analytics"],
    queryFn: () => fetch("/api/admin/ai-analytics").then(r => r.json()),
    refetchInterval: 60000,
  });

  if (isLoading) return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i} className="bg-white border border-gray-200 animate-pulse">
          <CardContent className="pt-5 h-20" />
        </Card>
      ))}
    </div>
  );

  if (!data) return <p className="text-gray-500 text-center py-12">Failed to load analytics</p>;
  const { stats } = data;

  return (
    <div className="space-y-6">
      {/* Conversations stats */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2 font-semibold">
          <Activity className="w-3.5 h-3.5 text-[#3bcac4]" /> Conversations
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Total" value={stats.totalConversations} />
          <StatCard label="Today" value={stats.todayConversations} color="text-emerald-600" />
          <StatCard label="This Week" value={stats.weekConversations} color="text-blue-600" />
          <StatCard label="This Month" value={stats.monthConversations} color="text-purple-600" />
        </div>
      </div>

      {/* Lead stats */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2 font-semibold">
          <Target className="w-3.5 h-3.5 text-[#3bcac4]" /> AI Leads
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Total Leads" value={stats.totalLeads} />
          <StatCard label="Hot Leads" value={stats.hotLeads} color="text-red-500" sub="High priority" />
          <StatCard label="Warm Leads" value={stats.warmLeads} color="text-amber-500" sub="Follow up" />
          <StatCard label="Cold Leads" value={stats.coldLeads} color="text-blue-500" sub="Nurture" />
        </div>
      </div>

      {/* 14-day sparkline */}
      {data.convsByDay.length > 0 && (
        <Card className="bg-white border border-gray-200 shadow-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-[#005476] font-semibold flex items-center gap-2">
              <Calendar className="w-4 h-4 text-[#3bcac4]" /> Conversations — Last 14 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-end gap-1 h-28">
              {data.convsByDay.map((d, i) => {
                const max = Math.max(...data.convsByDay.map(x => x.count), 1);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 group">
                    <span className="text-xs text-gray-500 opacity-0 group-hover:opacity-100 transition-opacity">
                      {d.count}
                    </span>
                    <div className="w-full rounded-t"
                      style={{ height: `${Math.max((d.count / max) * 100, 4)}%`, background: "linear-gradient(to top, #3bcac4, #005476)" }} />
                    <span className="text-[10px] text-gray-400">
                      {new Date(d.day).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Most Requested Projects */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-widest mb-3 flex items-center gap-2 font-semibold">
          <Building2 className="w-3.5 h-3.5 text-[#3bcac4]" /> Most Requested Projects
        </p>
        <Card className="bg-white border border-gray-200 shadow-sm overflow-hidden">
          {!data.mostRequestedProjects?.length ? (
            <CardContent className="py-10 text-center text-gray-400 text-sm">
              No project data yet
            </CardContent>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200 text-gray-500 text-xs uppercase tracking-wider">
                    <th className="text-left px-4 py-3">#</th>
                    <th className="text-left px-4 py-3">Project Name</th>
                    <th className="text-center px-4 py-3">Mentions</th>
                    <th className="text-center px-4 py-3">Conversations</th>
                    <th className="text-center px-4 py-3">Related Leads</th>
                    <th className="text-left px-4 py-3">Interest Level</th>
                  </tr>
                </thead>
                <tbody>
                  {data.mostRequestedProjects.map((p, idx) => {
                    const maxLeads = Math.max(...data.mostRequestedProjects.map(x => x.lead_count), 1);
                    return (
                      <tr key={idx} className="border-b border-gray-100 hover:bg-[#3bcac4]/5 transition-colors">
                        <td className="px-4 py-3">
                          <span className={`text-sm font-bold ${idx === 0 ? "text-[#3bcac4]" : idx === 1 ? "text-gray-400" : idx === 2 ? "text-amber-500" : "text-gray-300"}`}>
                            {idx + 1}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="font-semibold text-[#005476]">{p.project}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-[#3bcac4] font-bold">{p.mention_count}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-blue-600 font-bold">{p.conversation_count}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-amber-600 font-bold">{p.lead_count}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="w-24 bg-gray-100 rounded-full h-2 overflow-hidden">
                              <div className="h-2 rounded-full bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                                style={{ width: `${(p.lead_count / maxLeads) * 100}%` }} />
                            </div>
                            <span className="text-xs text-gray-500 font-medium">
                              {Math.round((p.lead_count / maxLeads) * 100)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Bar charts grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <BarList title="Top Countries" rows={data.topCountries} labelKey="country" countKey="count" />
        <BarList title="Languages" rows={data.topLanguages} labelKey="language" countKey="count" />
        <BarList title="Investment Goals" rows={data.topGoals} labelKey="goal" countKey="count" />
        <BarList title="Budget Ranges" rows={data.topBudgets} labelKey="budget" countKey="count" />
        <BarList title="Timelines" rows={data.topTimelines} labelKey="timeline" countKey="count" />
      </div>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────────────────────
export default function AiIntelligencePage() {
  const [activeTab, setActiveTab] = useState<"conversations" | "leads" | "analytics">("conversations");

  const tabs = [
    { id: "conversations" as const, label: "Conversations", Icon: MessageSquare },
    { id: "leads"         as const, label: "AI Leads",      Icon: Users },
    { id: "analytics"     as const, label: "Analytics",     Icon: BarChart3 },
  ];

  return (
    <div className="min-h-screen bg-gray-50 text-[#005476]">
      <div className="max-w-7xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href="/admin/dashboard">
            <Button variant="ghost" size="sm" className="text-gray-500 hover:text-[#005476] hover:bg-gray-100">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center shadow-md shrink-0">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-[#3bcac4] to-[#005476] bg-clip-text text-transparent">
                AI Intelligence Center
              </h1>
              <p className="text-xs text-gray-500">Monitor AI conversations, leads, and performance analytics</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white border border-gray-200 shadow-sm rounded-xl p-1 mb-6 w-fit">
          {tabs.map(({ id, label, Icon }) => (
            <button key={id} onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium transition-all ${
                activeTab === id
                  ? "bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white shadow-sm"
                  : "text-gray-500 hover:text-[#005476] hover:bg-gray-50"
              }`}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {activeTab === "conversations" && <ConversationsTab />}
        {activeTab === "leads"         && <LeadsTab />}
        {activeTab === "analytics"     && <AnalyticsTab />}
      </div>
    </div>
  );
}
