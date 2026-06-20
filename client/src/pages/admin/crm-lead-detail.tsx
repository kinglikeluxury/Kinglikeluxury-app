import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { validatePhone, validateEmail } from "@shared/crmValidation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  ArrowLeft, Phone, Mail, MapPin, Target, Building2, Crown,
  Flame, Thermometer, Snowflake, Clock, MessageSquare, User,
  Edit3, Save, X, Loader2, Trash2, CheckCircle2, UserCheck,
  Calendar, Globe, FileText, Plus, CheckSquare, ListTodo,
  DollarSign, CalendarDays, Bot, RefreshCw, UserX, StopCircle,
  AlertCircle, ChevronDown, ChevronUp, Send, MailOpen, Pause, Play,
  TrendingUp, MousePointerClick, Eye, Hash,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import type { CrmLead, CrmNote, CrmTask, CrmProject, WhatsappAiConversation, WhatsappAiMessage, WhatsappAiAgentReport } from "@shared/schema";

interface NoteWithUser extends CrmNote { authorName?: string | null }
interface LeadDetail extends CrmLead {
  crmNotes: NoteWithUser[];
  crmTasks: CrmTask[];
  assigneeName?: string | null;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  new:                   { label: "New",                                                    color: "bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40" },
  no_answer_1:           { label: "No Answer 1",                                            color: "bg-slate-100 text-slate-500 border border-slate-300" },
  no_answer_2:           { label: "No Answer 2",                                            color: "bg-slate-100 text-slate-500 border border-slate-300" },
  no_answer_3:           { label: "No Answer 3",                                            color: "bg-slate-100 text-slate-500 border border-slate-300" },
  will_think:            { label: "Will Think",                                             color: "bg-[#005476]/10 text-[#005476] border border-[#005476]/30" },
  follow_up:             { label: "Follow Up",                                              color: "bg-[#3bcac4]/20 text-[#005476] border border-[#3bcac4]/50" },
  hot_buyer:             { label: "Hot Buyer",                                              color: "bg-[#005476] text-white border border-[#005476]" },
  entering_lead:         { label: "Entering Lead",                                          color: "bg-[#3bcac4]/10 text-[#3bcac4] border border-[#3bcac4]/30" },
  deposited:             { label: "Deposited",                                              color: "bg-[#3bcac4]/30 text-[#005476] border border-[#3bcac4]/70" },
  reserved:              { label: "Reserved",                                               color: "bg-[#005476]/20 text-[#005476] border border-[#005476]/50" },
  purchased:             { label: "Purchased",                                              color: "bg-[#005476] text-white border border-[#005476]" },
  broker:                { label: "Broker",                                                 color: "bg-[#005476]/15 text-[#005476] border border-[#005476]/40" },
  second_hand:           { label: "Second Hand",                                            color: "bg-slate-100 text-slate-600 border border-slate-300" },
  junk_lead:             { label: "Junk Lead",                                              color: "bg-gray-100 text-gray-400 border border-gray-200" },
  no_answer_converted:   { label: "After 3 No Answer - Converted to Another Sales Manager", color: "bg-slate-200 text-slate-600 border border-slate-300" },
  lost_competition:      { label: "Lost Competition",                                       color: "bg-gray-100 text-gray-500 border border-gray-300" },
  agency:                { label: "Agency",     color: "bg-[#005476]/10 text-[#005476] border border-[#005476]/25" },
  qualified:             { label: "Qualified",  color: "bg-[#3bcac4]/25 text-[#005476] border border-[#3bcac4]/60" },
  converted:             { label: "Converted",  color: "bg-[#005476] text-white border border-[#005476]" },
  lost:                  { label: "Lost",       color: "bg-gray-100 text-gray-500 border border-gray-300" },
  no_answer:             { label: "No Answer",    color: "bg-slate-100 text-slate-500 border border-slate-300" },
  interested:            { label: "Interested",   color: "bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40" },
  not_qualified:         { label: "Not Qualified", color: "bg-gray-100 text-gray-500 border border-gray-300" },
  re_sale:               { label: "Re-Sale",       color: "bg-[#3bcac4]/20 text-[#005476] border border-[#3bcac4]/50" },
  after_3_no_answer_whatsapp_contacted: { label: "After 3 No Answer (WhatsApp Contacted)", color: "bg-slate-200 text-slate-700 border border-slate-400" },
  not_interested_maybe_later:           { label: "Not Interested for Now - Maybe Later",   color: "bg-gray-100 text-gray-500 border border-gray-300" },
  sold_by_kinglike_luxury:              { label: "Sold by Kinglike Luxury",                color: "bg-[#005476] text-white border border-[#005476]" },
  no_answer_4:                          { label: "No Answer 4",                            color: "bg-slate-100 text-slate-500 border border-slate-300" },
  new_fresh_after_3_no_answer:          { label: "New Fresh - after 3 no answer",          color: "bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40" },
};

const SCORE_CONFIG: Record<string, { label: string; Icon: any; color: string; bg: string }> = {
  hot:  { label: "Hot",  Icon: Flame,       color: "text-red-500",   bg: "bg-red-50" },
  warm: { label: "Warm", Icon: Thermometer, color: "text-amber-500", bg: "bg-amber-50" },
  cold: { label: "Cold", Icon: Snowflake,   color: "text-sky-500",   bg: "bg-sky-50" },
};

const PRIORITY_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  high:   { label: "High",   color: "text-red-600",   bg: "bg-red-50 border-red-200" },
  medium: { label: "Medium", color: "text-amber-600", bg: "bg-amber-50 border-amber-200" },
  low:    { label: "Low",    color: "text-green-600", bg: "bg-green-50 border-green-200" },
};

const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta", website: "Website", whatsapp: "WhatsApp", excel: "Excel", manual: "Manual",
};

const STATUSES = [
  "new","no_answer_1","no_answer_2","no_answer_3","will_think","follow_up",
  "hot_buyer","entering_lead","deposited","reserved","purchased",
  "broker","second_hand","junk_lead","no_answer_converted","lost_competition",
  "not_qualified","re_sale",
  "after_3_no_answer_whatsapp_contacted","not_interested_maybe_later","sold_by_kinglike_luxury",
  "no_answer_4","new_fresh_after_3_no_answer",
];
const SOURCES = ["meta","website","whatsapp","excel","manual"];
const INTERESTED_COUNTRIES = ["Georgia", "Turkey", "Northern Cyprus", "United Arab Emirates"];

const CITY_SUGGESTIONS: Record<string, string[]> = {
  "Georgia":              ["Batumi", "Tbilisi", "Gonio", "Kvariati", "Kobuleti", "Bakuriani", "Gudauri", "Kutaisi", "Other"],
  "Turkey":               ["Istanbul", "Antalya", "Bodrum", "Fethiye", "Alanya", "Ankara", "Bursa", "Other"],
  "Northern Cyprus":      ["Iskele", "Kyrenia", "Esentepe", "Famagusta", "Tatlisu", "Lefke", "Nicosia", "Other"],
  "United Arab Emirates": ["Dubai", "Abu Dhabi", "Ras Al Khaimah", "Sharjah", "Ajman", "Other"],
};

function genMonths(): string[] {
  const res: string[] = [];
  let y = 2026, m = 6;
  while (y < 2030 || (y === 2030 && m <= 6)) {
    res.push(`${String(m).padStart(2, "0")}.${y}`);
    m++; if (m > 12) { m = 1; y++; }
  }
  return res;
}
const PURCHASE_MONTHS = genMonths();
const BUDGETS = Array.from({ length: (2000000 - 40000) / 5000 + 1 }, (_, i) => 40000 + i * 5000);
function fmtBudget(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `$${(n / 1000).toFixed(0)}K`;
}

type FieldType = "text" | "phone" | "email" | "select" | "textarea" | "readonly";
interface SelectOption { value: string; label: string }

interface InlineFieldProps {
  fieldKey: string;
  label: string;
  icon: any;
  displayValue?: string | null;
  editValue: string;
  type?: FieldType;
  options?: SelectOption[];
  placeholder?: string;
  noneLabel?: string;
  extraInfo?: string | null;
  activeField: string | null;
  fieldDraft: string;
  fieldError: string | null;
  onStart: () => void;
  onChange: (v: string) => void;
  onSave: () => void;
  onCancel: () => void;
  isSaving: boolean;
}

function InlineEditField({
  fieldKey, label, icon: Icon, displayValue, type = "text",
  options, placeholder, noneLabel = "— Not specified —", extraInfo,
  activeField, fieldDraft, fieldError,
  onStart, onChange, onSave, onCancel, isSaving,
}: InlineFieldProps) {
  const isActive = activeField === fieldKey;

  if (type === "readonly") {
    if (!displayValue) return null;
    return (
      <div className="flex items-start gap-3 py-2.5 border-b last:border-0">
        <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-sm font-medium text-[#005476]">{displayValue}</p>
        </div>
      </div>
    );
  }

  if (!isActive) {
    return (
      <div
        className="group flex items-start gap-3 py-2.5 border-b last:border-0 cursor-pointer hover:bg-[#3bcac4]/5 rounded px-1 -mx-1 transition-colors"
        onClick={onStart}
      >
        <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-sm font-medium text-[#005476] truncate">
            {displayValue || (
              <span className="italic text-muted-foreground/40 text-xs font-normal">Click to add...</span>
            )}
          </p>
        </div>
        <Edit3 className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-50 mt-1.5 shrink-0 transition-opacity" />
      </div>
    );
  }

  return (
    <div className="py-2.5 border-b last:border-0 bg-[#3bcac4]/5 rounded-md px-2 -mx-1">
      <div className="flex items-center gap-2 mb-1.5">
        <Icon className="h-4 w-4 text-[#3bcac4] shrink-0" />
        <span className="text-xs font-semibold text-[#005476]">{label}</span>
      </div>

      {type === "textarea" ? (
        <Textarea
          autoFocus
          value={fieldDraft}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="text-sm w-full"
          onKeyDown={e => { if (e.key === "Escape") onCancel(); }}
        />
      ) : type === "select" ? (
        <Select value={fieldDraft || "__none__"} onValueChange={v => { onChange(v === "__none__" ? "" : v); }}>
          <SelectTrigger className="h-8 text-sm bg-white">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{noneLabel}</SelectItem>
            {options?.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
      ) : (
        <Input
          autoFocus
          value={fieldDraft}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`h-8 text-sm bg-white ${fieldError ? "border-red-400" : ""}`}
          onKeyDown={e => {
            if (e.key === "Enter") onSave();
            if (e.key === "Escape") onCancel();
          }}
        />
      )}

      {fieldError && (
        <p className="text-xs text-red-500 mt-1">{fieldError}</p>
      )}
      {extraInfo && (
        <p className="text-xs text-[#3bcac4] mt-1 flex items-center gap-1">
          <MapPin className="h-3 w-3" />{extraInfo}
        </p>
      )}

      <div className="flex items-center gap-2 mt-2">
        <Button
          size="sm"
          className="h-6 text-xs bg-gradient-to-r from-[#3bcac4] to-[#005476] px-3 gap-1"
          onClick={onSave}
          disabled={isSaving}
        >
          {isSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
          Save
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={onCancel}>
          <X className="h-3 w-3" /> Cancel
        </Button>
      </div>
    </div>
  );
}

const EMPTY_TASK = { title: "", description: "", dueDate: "", dueTime: "", priority: "medium" };

export default function CrmLeadDetailPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/admin/crm/:id");
  const { user, isLoading: authLoading } = useAuth();

  // Back-to-CRM helper.
  // Primary destination is ALWAYS the explicit route /admin/crm.
  // Filter state encoded by crm-leads.tsx in ?from= is appended ONLY when it
  // is a safe query string (starts with "?") so the final URL always begins
  // with "/admin/crm". If anything is wrong the fallback is "/admin/crm".
  // Never navigates to "/", never uses history.back(), never uses navigate(-1).
  function goCrmList() {
    try {
      const fromQs = new URLSearchParams(window.location.search).get("from");
      if (fromQs && fromQs.startsWith("?")) {
        navigate("/admin/crm" + fromQs);
        return;
      }
    } catch (_) { /* ignore */ }
    navigate("/admin/crm");
  }
  const { toast } = useToast();

  const leadId = Number(params?.id);

  const [activeField, setActiveField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [detectedCountry, setDetectedCountry] = useState("");

  const [newNote, setNewNote] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);
  const [editTaskOpen, setEditTaskOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<CrmTask | null>(null);
  const [editTaskForm, setEditTaskForm] = useState(EMPTY_TASK);
  const [statusDialog, setStatusDialog] = useState<{ newStatus: string; note: string } | null>(null);
  const [pendingFieldSave, setPendingFieldSave] = useState<{
    fieldKey: string; label: string; oldRaw: string; patch: Record<string, any>; draft: string;
  } | null>(null);
  const [subAgentComment, setSubAgentComment] = useState("");
  const [transferTargetId, setTransferTargetId] = useState<string>("");
  const [transferComment, setTransferComment] = useState<string>("");
  const [projectMultiOpen, setProjectMultiOpen] = useState(false);
  const [projectMultiPicked, setProjectMultiPicked] = useState<string[]>([]);
  const [countryMultiOpen, setCountryMultiOpen] = useState(false);
  const [countryMultiPicked, setCountryMultiPicked] = useState<string[]>([]);
  const [cityMultiOpen, setCityMultiOpen] = useState(false);
  const [cityMultiPicked, setCityMultiPicked] = useState<string[]>([]);

  // Non-hook computations (safe before hooks)
  const isSubAgent = user?.role === "sub_agent";
  const isCrmAuthorized = !authLoading && !!user && (!!user.isAdmin || isSubAgent);
  // Samer (id=29) and Fadi (id=24) may only edit the Notes field
  const isNotesOnlyUser = user?.id === 24 || user?.id === 29;

  // ── ALL hooks before any conditional return (Rules of Hooks) ────────────
  const { data: lead, isLoading, error: leadError } = useQuery<LeadDetail>({
    queryKey: ["/api/admin/crm/leads", leadId],
    queryFn: () => fetch(`/api/admin/crm/leads/${leadId}`).then(r => {
      if (r.status === 403) throw new Error("ACCESS_DENIED");
      if (!r.ok) throw new Error("NOT_FOUND");
      return r.json();
    }),
    enabled: isCrmAuthorized && !!leadId,
    retry: false,
  });

  const { data: adminUsers = [] } = useQuery<{ id: number; username: string; role?: string }[]>({
    queryKey: ["/api/admin/crm/assignable-agents"],
    queryFn: () => fetch("/api/admin/crm/assignable-agents").then(r => r.json()),
    enabled: isCrmAuthorized,
  });

  const { data: projects = [] } = useQuery<CrmProject[]>({
    queryKey: ["/api/admin/crm/projects"],
    queryFn: () => fetch("/api/admin/crm/projects").then(r => {
      if (!r.ok) return [];
      return r.json();
    }),
    enabled: isCrmAuthorized,
  });

  const invalidateLead = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads", leadId] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads"] });
  };

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CrmLead>) => apiRequest("PATCH", `/api/admin/crm/leads/${leadId}`, data),
    onSuccess: () => { invalidateLead(); toast({ title: "Lead updated" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const addNoteMutation = useMutation({
    mutationFn: (note: string) => apiRequest("POST", `/api/admin/crm/leads/${leadId}/notes`, { note }),
    onSuccess: () => { invalidateLead(); setNewNote(""); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/admin/crm/leads/${leadId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads"] });
      toast({ title: "Lead deleted" });
      goCrmList();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createTaskMutation = useMutation({
    mutationFn: (data: typeof taskForm) =>
      apiRequest("POST", `/api/admin/crm/leads/${leadId}/tasks`, data),
    onSuccess: () => {
      invalidateLead();
      toast({ title: "Task created" });
      setNewTaskOpen(false);
      setTaskForm(EMPTY_TASK);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const completeTaskMutation = useMutation({
    mutationFn: (taskId: number) =>
      apiRequest("PATCH", `/api/admin/crm/leads/${leadId}/tasks/${taskId}`, {
        completedAt: new Date().toISOString(),
      }),
    onSuccess: () => { invalidateLead(); toast({ title: "Task marked complete" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteTaskMutation = useMutation({
    mutationFn: (taskId: number) =>
      apiRequest("DELETE", `/api/admin/crm/leads/${leadId}/tasks/${taskId}`),
    onSuccess: () => { invalidateLead(); toast({ title: "Task removed" }); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateTaskMutation = useMutation({
    mutationFn: ({ taskId, data }: { taskId: number; data: typeof EMPTY_TASK }) =>
      apiRequest("PATCH", `/api/admin/crm/leads/${leadId}/tasks/${taskId}`, data),
    onSuccess: () => {
      invalidateLead();
      toast({ title: "Task updated" });
      setEditTaskOpen(false);
      setEditingTask(null);
      setEditTaskForm(EMPTY_TASK);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function openEditTask(task: CrmTask) {
    setEditingTask(task);
    setEditTaskForm({
      title:       task.title       ?? "",
      description: task.description ?? "",
      dueDate:     task.dueDate     ?? "",
      dueTime:     task.dueTime     ?? "",
      priority:    task.priority    ?? "medium",
    });
    setEditTaskOpen(true);
  }

  const reassignMutation = useMutation({
    mutationFn: (data: { targetId: number | null; comment: string }) =>
      apiRequest("POST", `/api/admin/crm/leads/${leadId}/reassign`, data),
    onSuccess: () => {
      invalidateLead();
      toast({ title: "Lead reassigned successfully" });
      setTransferTargetId("");
      setTransferComment("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Email Nurturing hooks ──────────────────────────────────────────────────
  const { data: nurturingData, refetch: nurturingRefetch } = useQuery<{
    status: any; events: any[];
  }>({
    queryKey: ["/api/admin/email-nurturing/lead", leadId],
    queryFn: () =>
      fetch(`/api/admin/email-nurturing/lead/${leadId}`).then(r => {
        if (r.status === 403) return { status: null, events: [] };
        if (!r.ok) throw new Error("Failed");
        return r.json();
      }),
    enabled: isCrmAuthorized && !!leadId && (user?.isAdmin ?? false),
  });

  const pauseNurturingMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/email-nurturing/lead/${leadId}/pause`),
    onSuccess: () => { nurturingRefetch(); toast({ title: "Email sequence paused" }); },
  });
  const resumeNurturingMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/email-nurturing/lead/${leadId}/resume`),
    onSuccess: () => { nurturingRefetch(); toast({ title: "Email sequence resumed" }); },
  });
  const stopNurturingMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/email-nurturing/lead/${leadId}/stop`, { reason: "manual_admin" }),
    onSuccess: () => { nurturingRefetch(); toast({ title: "Email sequence stopped" }); },
  });
  const startNurturingMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/email-nurturing/lead/${leadId}/start`),
    onSuccess: () => { nurturingRefetch(); toast({ title: "Email sequence started" }); },
  });

  // ── WhatsApp AI hooks ────────────────────────────────────────────────────
  const [aiOpen, setAiOpen] = useState(false);
  const [aiTab, setAiTab] = useState<"transcript" | "report">("transcript");

  const { data: aiData, isLoading: aiLoading, refetch: aiRefetch } = useQuery<{
    conversation: WhatsappAiConversation | null;
    messages: WhatsappAiMessage[];
    report: WhatsappAiAgentReport | null;
  }>({
    queryKey: ["/api/admin/whatsapp-ai/lead", leadId],
    queryFn: () =>
      fetch(`/api/admin/whatsapp-ai/lead/${leadId}`).then(r => {
        if (r.status === 403) return { conversation: null, messages: [], report: null };
        if (!r.ok) throw new Error("Failed to load AI conversation");
        return r.json();
      }),
    enabled: isCrmAuthorized && !!leadId,
  });

  const generateReportMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/admin/whatsapp-ai/lead/${leadId}/report/generate`, {}),
    onSuccess: () => {
      aiRefetch();
      toast({ title: "AI report generated" });
    },
    onError: (e: any) => toast({ title: "Report generation failed", description: e.message, variant: "destructive" }),
  });

  const updateAiStatusMutation = useMutation({
    mutationFn: (body: { status: string; handoff_reason?: string }) =>
      apiRequest("PATCH", `/api/admin/whatsapp-ai/lead/${leadId}/status`, body),
    onSuccess: () => {
      aiRefetch();
      toast({ title: "Conversation status updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const initAiMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", `/api/admin/whatsapp-ai/lead/${leadId}/init`, {}),
    onSuccess: () => {
      aiRefetch();
      toast({ title: "AI conversation initialized" });
    },
    onError: (e: any) => toast({ title: "Init failed", description: e.message, variant: "destructive" }),
  });

  // ── WA Qualification hooks ───────────────────────────────────────────────
  const [qualOpen, setQualOpen] = useState(false);
  const [qualConvOpen, setQualConvOpen] = useState(false);
  const [aiConvOpen, setAiConvOpen] = useState(false);
  const [qualScoreOverride, setQualScoreOverride] = useState("");

  const { data: qualData, isLoading: qualLoading, refetch: qualRefetch } = useQuery<{
    session: { id: number; state: string; score: number | null; qualified_score: string | null; qualified_at: string | null; opt_out: boolean } | null;
    answers: { question_key: string; answer_label: string }[];
    summary: string | null;
    conversationHistory: { role: string; content: string }[];
    latestEscalation: { escalationType: string; escalationLabel: string; createdAt: string } | null;
  }>({
    queryKey: ["/api/admin/wa-qual/lead", leadId],
    queryFn: () =>
      fetch(`/api/admin/wa-qual/lead/${leadId}`).then(r => {
        if (r.status === 404 || r.status === 403) return { session: null, answers: [], summary: null, conversationHistory: [], latestEscalation: null };
        if (!r.ok) throw new Error("Failed to load qualification data");
        return r.json();
      }),
    enabled: isCrmAuthorized && !!leadId,
  });

  const restartQualMutation = useMutation({
    mutationFn: async () => {
      const r = await apiRequest("POST", `/api/admin/wa-qual/lead/${leadId}/restart`, {});
      return r.json() as Promise<{ ok?: boolean; wamid?: string; sessionId?: number; message?: string }>;
    },
    onSuccess: (data) => {
      qualRefetch();
      toast({
        title: "✅ WhatsApp template sent",
        description: data.wamid
          ? `Message delivered · WAMID: ${data.wamid.slice(0, 52)}…`
          : "Template accepted by Meta",
      });
    },
    onError: (e: any) => {
      const msg: string = e.message ?? "Unknown error";
      const isActive = msg.toLowerCase().includes("active");
      toast({
        title: isActive ? "Session already active" : "Re-qualify failed",
        description: msg,
        variant: "destructive",
      });
    },
  });

  const rescoreMutation = useMutation({
    mutationFn: () => apiRequest("POST", `/api/admin/crm/leads/${lead?.id}/rescore`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads", lead?.id] });
    },
  });

  const overrideQualScoreMutation = useMutation({
    mutationFn: (score: string) => apiRequest("PATCH", `/api/admin/wa-qual/lead/${leadId}/score`, { score }),
    onSuccess: () => {
      qualRefetch();
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads", leadId] });
      toast({ title: "Qualification score updated" });
      setQualScoreOverride("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Auth guard — effect-based redirect avoids "setState during render" ──
  useEffect(() => {
    if (!authLoading && !isCrmAuthorized) {
      navigate("/");
    }
  }, [authLoading, isCrmAuthorized, navigate]);

  if (authLoading || !isCrmAuthorized) return null;

  function openField(key: string, rawValue: string) {
    if (isNotesOnlyUser && key !== "notes") return;
    setActiveField(key);
    setFieldDraft(rawValue ?? "");
    setFieldError(null);
    setDetectedCountry(key === "phone" ? (lead?.country ?? "") : "");
  }

  function changeField(value: string) {
    setFieldDraft(value);
    if (activeField === "phone") {
      const r = validatePhone(value);
      setDetectedCountry(r.valid ? r.country : "");
      setFieldError(value.trim() && !r.valid ? (r.error ?? null) : null);
    } else if (activeField === "email") {
      if (value.trim()) {
        const r = validateEmail(value);
        setFieldError(r.valid ? null : (r.error ?? null));
      } else {
        setFieldError(null);
      }
    } else {
      setFieldError(null);
    }
  }

  function cancelField() {
    setActiveField(null);
    setFieldDraft("");
    setFieldError(null);
    setDetectedCountry("");
  }

  function openStatusDialog(newStatus: string) {
    if (!lead || newStatus === lead.status) return;
    // Only these critical statuses require a written reason — all others save instantly
    const REQUIRES_REASON = [
      "purchased", "reserved", "deposited",
      "junk_lead", "lost_competition", "not_qualified", "re_sale",
    ];
    if (!REQUIRES_REASON.includes(newStatus)) {
      const oldLabel = STATUS_CONFIG[lead.status]?.label ?? lead.status;
      const newLabel = STATUS_CONFIG[newStatus]?.label ?? newStatus;
      updateMutation.mutate({ status: newStatus } as any, {
        onSuccess: () => {
          addNoteMutation.mutate(`[Status Change] ${oldLabel} → ${newLabel}`);
        },
      });
      return;
    }
    setStatusDialog({ newStatus, note: "" });
  }

  function confirmStatusChange() {
    if (!statusDialog || !lead) return;
    const note = statusDialog.note.trim();
    if (!note) return;
    const oldLabel = STATUS_CONFIG[lead.status]?.label ?? lead.status;
    const newLabel = STATUS_CONFIG[statusDialog.newStatus]?.label ?? statusDialog.newStatus;
    updateMutation.mutate({ status: statusDialog.newStatus, _comment: note } as any, {
      onSuccess: () => {
        addNoteMutation.mutate(
          `[Status Change] ${oldLabel} → ${newLabel}\nNote: ${note}`
        );
        setStatusDialog(null);
      },
    });
  }

  function saveField(fieldKey: string, label: string, oldRaw: string) {
    const draft = fieldDraft;

    if (fieldKey === "phone") {
      const r = validatePhone(draft);
      if (!r.valid) { setFieldError(r.error ?? "Invalid phone number."); return; }
    }
    if (fieldKey === "email" && draft.trim()) {
      const r = validateEmail(draft);
      if (!r.valid) { setFieldError(r.error ?? "Invalid email address."); return; }
    }

    const patch: Record<string, any> = { [fieldKey]: draft || null };
    // Only auto-set country from phone if the lead has no country yet (preserve manual overrides)
    if (fieldKey === "phone" && detectedCountry && !lead?.country) {
      patch.country = detectedCountry;
    }

    if (isSubAgent) {
      // These fields save directly — no reason/comment required from sub-agents
      const NO_REASON_FIELDS = [
        "fullName", "firstName", "lastName",
        "phone", "email", "country", "interestedCountry", "city",
        "projectInterest", "budget", "expectedPurchaseMonth",
        "leadSource", "description", "notes",
      ];
      if (NO_REASON_FIELDS.includes(fieldKey)) {
        updateMutation.mutate(patch as Partial<CrmLead>, {
          onSuccess: () => {
            if (draft !== oldRaw) {
              const oldDisplay = oldRaw || "—";
              const newDisplay = draft || "—";
              addNoteMutation.mutate(`[Updated] ${label}: "${oldDisplay}" → "${newDisplay}"`);
            }
            cancelField();
          },
        });
        return;
      }
      // All other fields (not in the list above): require a comment/reason
      setPendingFieldSave({ fieldKey, label, oldRaw, patch, draft });
      return;
    }

    updateMutation.mutate(patch as Partial<CrmLead>, {
      onSuccess: () => {
        if (draft !== oldRaw) {
          const oldDisplay = oldRaw || "—";
          const newDisplay = draft || "—";
          addNoteMutation.mutate(`[Updated] ${label}: "${oldDisplay}" → "${newDisplay}"`);
        }
        cancelField();
      },
    });
  }

  function submitFieldWithComment() {
    if (!pendingFieldSave || !subAgentComment.trim()) return;
    const { label, oldRaw, patch, draft } = pendingFieldSave;
    updateMutation.mutate({ ...patch, _comment: subAgentComment.trim() } as any, {
      onSuccess: () => {
        if (draft !== oldRaw) {
          const oldDisplay = oldRaw || "—";
          const newDisplay = draft || "—";
          addNoteMutation.mutate(`[Updated] ${label}: "${oldDisplay}" → "${newDisplay}"\nComment: ${subAgentComment.trim()}`);
        }
        setPendingFieldSave(null);
        setSubAgentComment("");
        cancelField();
      },
      onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
    });
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-10 w-10 animate-spin text-[#3bcac4]" />
      </div>
    );
  }

  if (!lead) {
    const isAccessDenied = (leadError as Error | null)?.message === "ACCESS_DENIED";
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <p className="text-muted-foreground">
          {isAccessDenied
            ? "Access denied — this lead is not assigned to you."
            : "Lead not found."}
        </p>
        <Button className="mt-4" onClick={goCrmList}>Back to CRM</Button>
      </div>
    );
  }

  const scoreCfg   = SCORE_CONFIG[lead.leadScore ?? "cold"] ?? SCORE_CONFIG.cold;
  const statusCfg  = STATUS_CONFIG[lead.status] ?? STATUS_CONFIG.new;
  const displayName = lead.fullName || `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || "Unnamed Lead";
  const tasks = lead.crmTasks ?? [];
  const pendingTasks = tasks.filter(t => !t.completedAt);
  const doneTasks    = tasks.filter(t =>  t.completedAt);

  const sharedFieldProps = {
    activeField,
    fieldDraft,
    fieldError,
    onChange: changeField,
    onCancel: cancelField,
    isSaving: updateMutation.isPending,
  };

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={goCrmList} className="gap-1.5 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to CRM
          </Button>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium text-[#005476]">{displayName}</span>
        </div>
        {!isSubAgent && (
          <Button
            variant="outline" size="sm"
            className="gap-1.5 text-red-500 hover:text-red-600 hover:border-red-300"
            onClick={() => { if (confirm("Delete this lead?")) deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Lead Info */}
        <div className="lg:col-span-2 space-y-5">

          {/* Identity Card */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center text-white font-bold text-lg shrink-0">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    {/* Inline-editable full name */}
                    {activeField === "fullName" ? (
                      <div className="flex items-center gap-2">
                        <Input
                          autoFocus
                          value={fieldDraft}
                          onChange={e => changeField(e.target.value)}
                          className="text-base font-bold h-8 w-48"
                          placeholder="Full name"
                          onKeyDown={e => {
                            if (e.key === "Enter") saveField("fullName", "Full Name", lead.fullName ?? "");
                            if (e.key === "Escape") cancelField();
                          }}
                        />
                        <Button
                          size="sm" className="h-7 bg-gradient-to-r from-[#3bcac4] to-[#005476] px-2"
                          onClick={() => saveField("fullName", "Full Name", lead.fullName ?? "")}
                          disabled={updateMutation.isPending}
                        >
                          {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        </Button>
                        <Button size="sm" variant="ghost" className="h-7 px-2" onClick={cancelField}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    ) : (
                      <div
                        className="group flex items-center gap-1.5 cursor-pointer"
                        onClick={() => openField("fullName", lead.fullName ?? "")}
                        title="Click to edit name"
                      >
                        <h2 className="text-xl font-bold text-[#005476]">{displayName}</h2>
                        <Edit3 className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-50 transition-opacity" />
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${scoreCfg.bg} ${scoreCfg.color}`}>
                        <scoreCfg.Icon className="h-3 w-3" />
                        {scoreCfg.label}
                      </span>
                      {(() => {
                        const stage = (lead as any).waStage as string | null;
                        if (!stage || stage === "new_lead") return null;
                        const WA_STAGE_CONFIG: Record<string, { label: string; color: string }> = {
                          interested:       { label: "💬 Interested",       color: "bg-green-50 text-green-700 border border-green-200" },
                          qualified:        { label: "✅ Qualified",         color: "bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40" },
                          advisor_assigned: { label: "👤 Advisor Assigned",  color: "bg-[#005476]/10 text-[#005476] border border-[#005476]/30" },
                        };
                        const cfg = WA_STAGE_CONFIG[stage];
                        if (!cfg) return null;
                        return (
                          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
                            <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                            {cfg.label}
                          </span>
                        );
                      })()}
                      {pendingTasks.length > 0 && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-[#3bcac4]/10 text-[#005476]">
                          <ListTodo className="h-3 w-3" />
                          {pendingTasks.length} task{pendingTasks.length !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">#{lead.id}</span>
              </div>
            </CardHeader>

            <CardContent className="pt-0">
              <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1">
                <Edit3 className="h-3 w-3" />
                Click any field to edit it
              </p>

              {/* Phone */}
              <InlineEditField
                {...sharedFieldProps}
                fieldKey="phone"
                label="Phone"
                icon={Phone}
                displayValue={lead.phone}
                editValue={lead.phone ?? ""}
                type="text"
                placeholder="+971 50 123 4567"
                extraInfo={detectedCountry ? `Detected country: ${detectedCountry}` : undefined}
                onStart={() => openField("phone", lead.phone ?? "")}
                onSave={() => saveField("phone", "Phone", lead.phone ?? "")}
              />

              {/* WhatsApp quick-contact — shown only when phone is present and field is not in edit mode */}
              {lead.phone && activeField !== "phone" && (
                <a
                  href={`https://wa.me/${lead.phone.replace(/[\s+\-()[\]]/g, "")}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs font-medium text-green-600 hover:text-green-700 hover:underline -mt-1.5 mb-1 ml-7 w-fit py-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <SiWhatsapp className="h-3.5 w-3.5" />
                  Open in WhatsApp
                </a>
              )}

              {/* Email */}
              <InlineEditField
                {...sharedFieldProps}
                fieldKey="email"
                label="Email"
                icon={Mail}
                displayValue={lead.email}
                editValue={lead.email ?? ""}
                type="email"
                placeholder="email@example.com"
                onStart={() => openField("email", lead.email ?? "")}
                onSave={() => saveField("email", "Email", lead.email ?? "")}
              />

              {/* Origin Country — auto-detected from phone, also manually editable */}
              <InlineEditField
                {...sharedFieldProps}
                fieldKey="country"
                label="Origin Country (auto from phone)"
                icon={MapPin}
                displayValue={lead.country}
                editValue={lead.country ?? ""}
                type="text"
                placeholder="e.g. Georgia"
                onStart={() => openField("country", lead.country ?? "")}
                onSave={() => saveField("country", "Origin Country", lead.country ?? "")}
              />

              {/* Interested Country — multi-select */}
              {(() => {
                const currentCountries = (lead.interestedCountry ?? "")
                  .split(";").map(v => v.trim()).filter(Boolean);
                if (!countryMultiOpen) {
                  return (
                    <div
                      className={`group flex items-start gap-3 py-2.5 border-b last:border-0 rounded px-1 -mx-1 transition-colors ${isNotesOnlyUser ? "opacity-60 cursor-default" : "cursor-pointer hover:bg-[#3bcac4]/5"}`}
                      onClick={() => {
                        if (isNotesOnlyUser) return;
                        setCountryMultiPicked(currentCountries);
                        setCountryMultiOpen(true);
                      }}
                    >
                      <Globe className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground">Interested Country</p>
                        {currentCountries.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {currentCountries.map(c => (
                              <span key={c} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40">{c}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="italic text-muted-foreground/40 text-xs font-normal">Click to add...</span>
                        )}
                      </div>
                      {!isNotesOnlyUser && <Edit3 className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-50 mt-1.5 shrink-0 transition-opacity" />}
                    </div>
                  );
                }
                return (
                  <div className="py-2.5 border-b last:border-0 bg-[#3bcac4]/5 rounded-md px-2 -mx-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Globe className="h-4 w-4 text-[#3bcac4] shrink-0" />
                      <span className="text-xs font-semibold text-[#005476]">Interested Country</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {INTERESTED_COUNTRIES.map(name => {
                        const selected = countryMultiPicked.includes(name);
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() =>
                              setCountryMultiPicked(prev =>
                                selected ? prev.filter(v => v !== name) : [...prev, name]
                              )
                            }
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                              selected
                                ? "bg-[#3bcac4] text-white border-[#3bcac4]"
                                : "bg-white text-[#005476] border-[#005476]/30 hover:border-[#3bcac4]"
                            }`}
                          >
                            {selected && <X className="h-2.5 w-2.5" />}
                            {name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-6 text-xs bg-gradient-to-r from-[#3bcac4] to-[#005476] px-3 gap-1"
                        onClick={() => {
                          const oldRaw = lead.interestedCountry ?? "";
                          const newValue = countryMultiPicked.join(";");
                          updateMutation.mutate({ interestedCountry: newValue || null } as any, {
                            onSuccess: () => {
                              if (oldRaw !== newValue) {
                                addNoteMutation.mutate(
                                  `[Updated] Interested Country: "${oldRaw || "—"}" → "${newValue || "—"}"`
                                );
                              }
                              setCountryMultiOpen(false);
                            },
                          });
                        }}
                        disabled={updateMutation.isPending}
                      >
                        {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => setCountryMultiOpen(false)}>
                        <X className="h-3 w-3" /> Cancel
                      </Button>
                    </div>
                  </div>
                );
              })()}

              {/* City — multi-select, pool from all selected interested countries */}
              {(() => {
                const currentCities = (lead.city ?? "")
                  .split(";").map(v => v.trim()).filter(Boolean);
                const selectedCountries = (lead.interestedCountry ?? "")
                  .split(";").map(v => v.trim()).filter(Boolean);
                const cityPool: string[] = Array.from(
                  new Set(selectedCountries.flatMap(c => CITY_SUGGESTIONS[c] ?? []))
                );

                if (!cityMultiOpen) {
                  return (
                    <div
                      className={`group flex items-start gap-3 py-2.5 border-b last:border-0 rounded px-1 -mx-1 transition-colors ${isNotesOnlyUser ? "opacity-60 cursor-default" : "cursor-pointer hover:bg-[#3bcac4]/5"}`}
                      onClick={() => {
                        if (isNotesOnlyUser) return;
                        setCityMultiPicked(currentCities);
                        setCityMultiOpen(true);
                      }}
                    >
                      <MapPin className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground">City (Optional)</p>
                        {currentCities.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {currentCities.map(c => (
                              <span key={c} className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40">{c}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="italic text-muted-foreground/40 text-xs font-normal">Click to add...</span>
                        )}
                      </div>
                      {!isNotesOnlyUser && <Edit3 className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-50 mt-1.5 shrink-0 transition-opacity" />}
                    </div>
                  );
                }

                return (
                  <div className="py-2.5 border-b last:border-0 bg-[#3bcac4]/5 rounded-md px-2 -mx-1">
                    <div className="flex items-center gap-2 mb-2">
                      <MapPin className="h-4 w-4 text-[#3bcac4] shrink-0" />
                      <span className="text-xs font-semibold text-[#005476]">City (Optional)</span>
                    </div>
                    {cityPool.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {cityPool.map(name => {
                          const selected = cityMultiPicked.includes(name);
                          return (
                            <button
                              key={name}
                              type="button"
                              onClick={() =>
                                setCityMultiPicked(prev =>
                                  selected ? prev.filter(v => v !== name) : [...prev, name]
                                )
                              }
                              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                                selected
                                  ? "bg-[#3bcac4] text-white border-[#3bcac4]"
                                  : "bg-white text-[#005476] border-[#005476]/30 hover:border-[#3bcac4]"
                              }`}
                            >
                              {selected && <X className="h-2.5 w-2.5" />}
                              {name}
                            </button>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="mb-3">
                        <Input
                          autoFocus
                          value={cityMultiPicked[0] ?? ""}
                          onChange={e => setCityMultiPicked(e.target.value ? [e.target.value] : [])}
                          placeholder="Enter city..."
                          className="h-8 text-sm bg-white"
                        />
                        <p className="text-xs text-muted-foreground mt-1">Select an Interested Country first to see city suggestions.</p>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-6 text-xs bg-gradient-to-r from-[#3bcac4] to-[#005476] px-3 gap-1"
                        onClick={() => {
                          const oldRaw = lead.city ?? "";
                          const newValue = cityMultiPicked.join(";");
                          updateMutation.mutate({ city: newValue || null } as any, {
                            onSuccess: () => {
                              if (oldRaw !== newValue) {
                                addNoteMutation.mutate(
                                  `[Updated] City: "${oldRaw || "—"}" → "${newValue || "—"}"`
                                );
                              }
                              setCityMultiOpen(false);
                            },
                          });
                        }}
                        disabled={updateMutation.isPending}
                      >
                        {updateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" className="h-6 text-xs gap-1" onClick={() => setCityMultiOpen(false)}>
                        <X className="h-3 w-3" /> Cancel
                      </Button>
                    </div>
                  </div>
                );
              })()}

              {/* Project Interest — multi-select */}
              {(() => {
                const currentProjects = (lead.projectInterest ?? "")
                  .split(";")
                  .map(v => v.trim())
                  .filter(Boolean);

                if (!projectMultiOpen) {
                  return (
                    <div
                      className="group flex items-start gap-3 py-2.5 border-b last:border-0 cursor-pointer hover:bg-[#3bcac4]/5 rounded px-1 -mx-1 transition-colors"
                      onClick={() => {
                        setProjectMultiPicked(currentProjects);
                        setProjectMultiOpen(true);
                      }}
                    >
                      <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground">Project Interest</p>
                        {currentProjects.length > 0 ? (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {currentProjects.map(p => (
                              <span
                                key={p}
                                className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40"
                              >
                                {p}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span className="italic text-muted-foreground/40 text-xs font-normal">Click to add...</span>
                        )}
                      </div>
                      <Edit3 className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-50 mt-1.5 shrink-0 transition-opacity" />
                    </div>
                  );
                }

                const activeProjectNames = projects.filter(p => p.isActive).map(p => p.name);

                return (
                  <div className="py-2.5 border-b last:border-0 bg-[#3bcac4]/5 rounded-md px-2 -mx-1">
                    <div className="flex items-center gap-2 mb-2">
                      <Building2 className="h-4 w-4 text-[#3bcac4] shrink-0" />
                      <span className="text-xs font-semibold text-[#005476]">Project Interest</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5 mb-3">
                      {activeProjectNames.map(name => {
                        const selected = projectMultiPicked.includes(name);
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() =>
                              setProjectMultiPicked(prev =>
                                selected ? prev.filter(v => v !== name) : [...prev, name]
                              )
                            }
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                              selected
                                ? "bg-[#3bcac4] text-white border-[#3bcac4]"
                                : "bg-white text-[#005476] border-[#005476]/30 hover:border-[#3bcac4]"
                            }`}
                          >
                            {selected && <X className="h-2.5 w-2.5" />}
                            {name}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-6 text-xs bg-gradient-to-r from-[#3bcac4] to-[#005476] px-3 gap-1"
                        onClick={() => {
                          const oldRaw = lead.projectInterest ?? "";
                          const newValue = projectMultiPicked.join(";");
                          updateMutation.mutate({ projectInterest: newValue || null } as any, {
                            onSuccess: () => {
                              if (oldRaw !== newValue) {
                                addNoteMutation.mutate(
                                  `[Updated] Project Interest: "${oldRaw || "—"}" → "${newValue || "—"}"`
                                );
                              }
                              setProjectMultiOpen(false);
                            },
                          });
                        }}
                        disabled={updateMutation.isPending}
                      >
                        {updateMutation.isPending
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <Save className="h-3 w-3" />}
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 text-xs gap-1"
                        onClick={() => setProjectMultiOpen(false)}
                      >
                        <X className="h-3 w-3" /> Cancel
                      </Button>
                    </div>
                  </div>
                );
              })()}

              {/* Budget */}
              <InlineEditField
                {...sharedFieldProps}
                fieldKey="budget"
                label="Budget"
                icon={DollarSign}
                displayValue={lead.budget ? fmtBudget(Number(lead.budget)) : null}
                editValue={lead.budget ?? ""}
                type="select"
                options={BUDGETS.map(n => ({ value: String(n), label: fmtBudget(n) }))}
                noneLabel="— Not specified —"
                onStart={() => openField("budget", lead.budget ?? "")}
                onSave={() => saveField("budget", "Budget", lead.budget ?? "")}
              />

              {/* Expected Purchase Month */}
              <InlineEditField
                {...sharedFieldProps}
                fieldKey="expectedPurchaseMonth"
                label="Expected Purchase Month"
                icon={CalendarDays}
                displayValue={lead.expectedPurchaseMonth}
                editValue={lead.expectedPurchaseMonth ?? ""}
                type="select"
                options={PURCHASE_MONTHS.map(m => ({ value: m, label: m }))}
                noneLabel="— Not specified —"
                onStart={() => openField("expectedPurchaseMonth", lead.expectedPurchaseMonth ?? "")}
                onSave={() => saveField("expectedPurchaseMonth", "Expected Purchase Month", lead.expectedPurchaseMonth ?? "")}
              />

              {/* Lead Source */}
              <InlineEditField
                {...sharedFieldProps}
                fieldKey="leadSource"
                label="Lead Source"
                icon={Target}
                displayValue={SOURCE_LABELS[lead.leadSource] ?? lead.leadSource}
                editValue={lead.leadSource}
                type="select"
                options={SOURCES.map(s => ({ value: s, label: SOURCE_LABELS[s] }))}
                noneLabel="— Select source —"
                onStart={() => openField("leadSource", lead.leadSource)}
                onSave={() => saveField("leadSource", "Lead Source", lead.leadSource)}
              />

              {/* Meta fields — read-only display */}
              {lead.campaignName && (
                <InlineEditField
                  {...sharedFieldProps}
                  fieldKey="campaignName"
                  label="Campaign"
                  icon={Globe}
                  displayValue={lead.campaignName}
                  editValue={lead.campaignName ?? ""}
                  type="text"
                  placeholder="Campaign name"
                  onStart={() => openField("campaignName", lead.campaignName ?? "")}
                  onSave={() => saveField("campaignName", "Campaign", lead.campaignName ?? "")}
                />
              )}
              {lead.adsetName && (
                <InlineEditField
                  {...sharedFieldProps}
                  fieldKey="adsetName"
                  label="Ad Set"
                  icon={FileText}
                  displayValue={lead.adsetName}
                  editValue={lead.adsetName ?? ""}
                  type="readonly"
                  onStart={() => {}}
                  onSave={() => {}}
                />
              )}
              {lead.adName && (
                <InlineEditField
                  {...sharedFieldProps}
                  fieldKey="adName"
                  label="Ad Name"
                  icon={FileText}
                  displayValue={lead.adName}
                  editValue={lead.adName ?? ""}
                  type="readonly"
                  onStart={() => {}}
                  onSave={() => {}}
                />
              )}
              {lead.formName && (
                <InlineEditField
                  {...sharedFieldProps}
                  fieldKey="formName"
                  label="Form Name"
                  icon={FileText}
                  displayValue={lead.formName}
                  editValue={lead.formName ?? ""}
                  type="readonly"
                  onStart={() => {}}
                  onSave={() => {}}
                />
              )}

              {/* Meta Attribution IDs — read-only, shown only when at least one ID exists */}
              {(lead.metaCampaignId || lead.metaAdId || lead.metaAdsetId || lead.metaFormId) && (
                <div className="py-2.5 border-b last:border-0">
                  <div className="flex items-center gap-2 mb-2">
                    <Hash className="h-4 w-4 text-[#3bcac4] shrink-0" />
                    <span className="text-xs font-semibold text-[#005476]">Meta Attribution</span>
                  </div>
                  <div className="space-y-1.5 ml-6">
                    {lead.metaCampaignId && (
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-muted-foreground w-24 shrink-0 pt-0.5">Campaign ID</span>
                        <span className="text-xs font-mono text-[#005476] break-all">{lead.metaCampaignId}</span>
                      </div>
                    )}
                    {lead.metaAdId && (
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-muted-foreground w-24 shrink-0 pt-0.5">Ad ID</span>
                        <span className="text-xs font-mono text-[#005476] break-all">{lead.metaAdId}</span>
                      </div>
                    )}
                    {lead.metaAdsetId && (
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-muted-foreground w-24 shrink-0 pt-0.5">Adset ID</span>
                        <span className="text-xs font-mono text-[#005476] break-all">{lead.metaAdsetId}</span>
                      </div>
                    )}
                    {lead.metaFormId && (
                      <div className="flex items-start gap-2">
                        <span className="text-xs text-muted-foreground w-24 shrink-0 pt-0.5">Form ID</span>
                        <span className="text-xs font-mono text-[#005476] break-all">{lead.metaFormId}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Description */}
              <InlineEditField
                {...sharedFieldProps}
                fieldKey="description"
                label="Description"
                icon={FileText}
                displayValue={lead.description}
                editValue={lead.description ?? ""}
                type="textarea"
                placeholder="Lead description..."
                onStart={() => openField("description", lead.description ?? "")}
                onSave={() => saveField("description", "Description", lead.description ?? "")}
              />

              {/* Internal Notes */}
              <InlineEditField
                {...sharedFieldProps}
                fieldKey="notes"
                label="Internal Notes"
                icon={FileText}
                displayValue={lead.notes}
                editValue={lead.notes ?? ""}
                type="textarea"
                placeholder="Internal notes..."
                onStart={() => openField("notes", lead.notes ?? "")}
                onSave={() => saveField("notes", "Internal Notes", lead.notes ?? "")}
              />
            </CardContent>
          </Card>

          {/* Tasks */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base text-[#005476] flex items-center gap-2">
                  <ListTodo className="h-4 w-4" /> Tasks
                  {pendingTasks.length > 0 && (
                    <span className="text-xs font-normal text-muted-foreground">({pendingTasks.length} pending)</span>
                  )}
                </CardTitle>
                <Button size="sm" variant="outline" className="gap-1.5 h-7 text-xs"
                  onClick={() => setNewTaskOpen(true)}>
                  <Plus className="h-3.5 w-3.5" /> New Task
                </Button>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {tasks.length === 0 ? (
                <div className="text-center py-6 text-sm text-muted-foreground">
                  <ListTodo className="h-7 w-7 mx-auto mb-2 opacity-20" />
                  No tasks yet.
                </div>
              ) : (
                <div className="space-y-2">
                  {[...pendingTasks, ...doneTasks].map(task => {
                    const pcfg = PRIORITY_CONFIG[task.priority ?? "medium"] ?? PRIORITY_CONFIG.medium;
                    const isDone = !!task.completedAt;
                    return (
                      <div key={task.id}
                        className={`flex items-start gap-3 p-3 rounded-lg border text-sm transition-opacity ${isDone ? "opacity-50 bg-gray-50" : "bg-white"}`}>
                        <div className={`mt-0.5 shrink-0 px-1.5 py-0.5 rounded text-xs font-medium border ${pcfg.bg} ${pcfg.color}`}>
                          {pcfg.label}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className={`font-medium text-[#005476] ${isDone ? "line-through" : ""}`}>{task.title}</p>
                          {task.description && (
                            <p className="text-xs text-muted-foreground mt-0.5">{task.description}</p>
                          )}
                          {(task.dueDate || task.dueTime) && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                              <Clock className="h-3 w-3" />
                              {task.dueDate} {task.dueTime}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {!isDone && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-green-500 hover:text-green-700"
                              onClick={() => completeTaskMutation.mutate(task.id)}
                              disabled={completeTaskMutation.isPending}>
                              <CheckCircle2 className="h-4 w-4" />
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-[#3bcac4] hover:text-[#005476]"
                            onClick={() => openEditTask(task)}
                            title="Edit task">
                            <Edit3 className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                            onClick={() => { if (confirm("Delete this task?")) deleteTaskMutation.mutate(task.id); }}
                            disabled={deleteTaskMutation.isPending}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notes / Activity Timeline */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base text-[#005476] flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Activity Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-2 mb-5">
                <Textarea
                  rows={2}
                  placeholder="Add a note, call log, or update..."
                  value={newNote}
                  onChange={e => setNewNote(e.target.value)}
                  className="flex-1 resize-none"
                />
                <Button
                  className="bg-gradient-to-r from-[#3bcac4] to-[#005476] self-end"
                  size="sm"
                  disabled={!newNote.trim() || addNoteMutation.isPending}
                  onClick={() => addNoteMutation.mutate(newNote)}
                >
                  {addNoteMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add"}
                </Button>
              </div>

              {lead.crmNotes.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-20" />
                  No notes yet. Add the first activity above.
                </div>
              ) : (
                <div className="space-y-3">
                  {[...lead.crmNotes].reverse().map((note, i) => {
                    const isStatusChange = note.note.startsWith("[Status Change]");
                    const isReassignment = note.note.startsWith("[Reassignment]");
                    const isAuto = note.note.startsWith("[Updated]") || isStatusChange;
                    return (
                      <div key={note.id} className="flex gap-3">
                        <div className="flex flex-col items-center">
                          <div className={`h-7 w-7 rounded-full flex items-center justify-center text-white text-xs font-bold shrink-0 ${
                            isReassignment
                              ? "bg-[#3bcac4]"
                              : isStatusChange
                              ? "bg-[#005476]"
                              : isAuto
                              ? "bg-[#3bcac4]/60"
                              : "bg-gradient-to-br from-[#3bcac4] to-[#005476]"
                          }`}>
                            {(note.authorName ?? (isAuto || isReassignment ? "S" : "A")).charAt(0).toUpperCase()}
                          </div>
                          {i < lead.crmNotes.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                        </div>
                        <div className="flex-1 pb-3">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-sm font-medium text-[#005476]">
                              {note.authorName ?? (isAuto || isReassignment ? "System" : "Admin")}
                            </span>
                            {isStatusChange && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#005476]/10 text-[#005476] border border-[#005476]/20">
                                Status Change
                              </span>
                            )}
                            {isReassignment && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40">
                                Lead Transfer
                              </span>
                            )}
                            <span className="text-xs text-muted-foreground">
                              {new Date(note.createdAt).toLocaleDateString()} {new Date(note.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                            </span>
                          </div>
                          <p className={`text-sm rounded-lg px-3 py-2 border whitespace-pre-wrap ${
                            isReassignment
                              ? "bg-[#3bcac4]/5 text-[#005476] border-[#3bcac4]/30 text-xs font-medium"
                              : isStatusChange
                              ? "bg-[#005476]/5 text-[#005476] border-[#005476]/20 text-xs font-medium"
                              : isAuto
                              ? "bg-[#3bcac4]/5 text-[#005476]/70 border-[#3bcac4]/20 text-xs"
                              : "bg-gray-50 text-gray-700"
                          }`}>
                            {note.note
                              .replace(/^\[Status Change\] /, "")
                              .replace(/^\[Reassignment\] /, "")}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* RIGHT: Controls */}
        <div className="space-y-4">
          {/* Status */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#005476]">Lead Status</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => openStatusDialog(s)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-sm font-medium transition-all flex items-center justify-between ${
                    lead.status === s
                      ? `${STATUS_CONFIG[s].color} ring-1 ring-inset ring-current`
                      : "hover:bg-gray-50 text-gray-600"
                  }`}
                >
                  {STATUS_CONFIG[s].label}
                  {lead.status === s && <CheckCircle2 className="h-4 w-4" />}
                </button>
              ))}
            </CardContent>
          </Card>

          {/* Score */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#005476]">Lead Score</CardTitle>
            </CardHeader>
            <CardContent className="pt-0 grid grid-cols-3 gap-2">
              {(["hot","warm","cold"] as const).map(score => {
                const cfg = SCORE_CONFIG[score];
                const active = lead.leadScore === score;
                return (
                  <button
                    key={score}
                    onClick={() => {
                      updateMutation.mutate({ leadScore: score } as Partial<CrmLead>, {
                        onSuccess: () => {
                          if (score !== lead.leadScore) {
                            addNoteMutation.mutate(`[Updated] Lead Score: "${lead.leadScore ?? "cold"}" → "${score}"`);
                          }
                        },
                      });
                    }}
                    className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border-2 transition-all ${
                      active ? `border-current ${cfg.bg} ${cfg.color}` : "border-transparent hover:border-gray-200 text-gray-500"
                    }`}
                  >
                    <cfg.Icon className="h-5 w-5" />
                    <span className="text-xs font-medium">{cfg.label}</span>
                  </button>
                );
              })}
            </CardContent>
          </Card>

          {/* AI Score */}
          {(() => {
            const aiCat     = (lead as any).ai_score_category  as string | null;
            const aiVal     = (lead as any).ai_score           as number | null;
            const aiReason  = (lead as any).ai_score_reason    as string | null;
            const aiUpdated = (lead as any).ai_score_updated_at as string | null;
            const catCfg: Record<string, { emoji: string; textCls: string; barCls: string }> = {
              HOT:  { emoji: "🔥", textCls: "text-orange-500", barCls: "bg-orange-400" },
              WARM: { emoji: "🟡", textCls: "text-amber-500",  barCls: "bg-amber-400"  },
              COLD: { emoji: "❄️", textCls: "text-sky-400",    barCls: "bg-sky-400"    },
            };
            const c = catCfg[aiCat ?? ""] ?? null;
            return (
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-[#005476] flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Bot className="h-4 w-4" /> AI Score
                    </span>
                    {user?.isAdmin && (
                      <button
                        className="flex items-center gap-1 text-[10px] text-[#005476] hover:text-[#3bcac4] transition-colors disabled:opacity-50"
                        onClick={() => rescoreMutation.mutate()}
                        disabled={rescoreMutation.isPending}
                      >
                        <RefreshCw className={`h-3 w-3 ${rescoreMutation.isPending ? "animate-spin" : ""}`} />
                        Re-score
                      </button>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0 space-y-2">
                  {c && aiVal != null ? (
                    <>
                      <div className="flex items-center gap-2">
                        <span className={`text-3xl font-bold ${c.textCls}`}>{aiVal}</span>
                        <span className="text-xs text-muted-foreground self-end pb-1">/100</span>
                        <span className={`ml-auto text-sm font-bold ${c.textCls}`}>{c.emoji} {aiCat}</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${c.barCls}`} style={{ width: `${aiVal}%` }} />
                      </div>
                      {aiReason && (
                        <pre className="text-[10px] text-muted-foreground bg-gray-50 rounded-lg p-2 whitespace-pre-wrap leading-relaxed border max-h-36 overflow-y-auto">
                          {aiReason}
                        </pre>
                      )}
                      {aiUpdated && (
                        <p className="text-[10px] text-muted-foreground">
                          Scored {new Date(aiUpdated).toLocaleDateString()}
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-3">
                      <p className="text-xs text-muted-foreground mb-2">Not scored yet</p>
                      {user?.isAdmin && (
                        <button
                          className="text-xs px-3 py-1.5 rounded-lg border border-[#3bcac4] text-[#005476] hover:bg-[#3bcac4]/10 transition-colors disabled:opacity-50 flex items-center gap-1 mx-auto"
                          onClick={() => rescoreMutation.mutate()}
                          disabled={rescoreMutation.isPending}
                        >
                          <Bot className="h-3 w-3" />
                          {rescoreMutation.isPending ? "Scoring…" : "Score this Lead"}
                        </button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })()}

          {/* Assignment — admin: select + reassign via /reassign endpoint */}
          {user?.isAdmin && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#005476] flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4" /> Assign Agent
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <Select
                  value={lead.assignedTo ? String(lead.assignedTo) : "unassigned"}
                  onValueChange={v => reassignMutation.mutate({ targetId: v === "unassigned" ? null : Number(v), comment: "" })}
                  disabled={reassignMutation.isPending}
                >
                  <SelectTrigger className="w-full text-sm">
                    <SelectValue placeholder="Unassigned" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unassigned">Unassigned</SelectItem>
                    {adminUsers.map((u: any) => (
                      <SelectItem key={u.id} value={String(u.id)}>
                        {u.username}
                        {u.role === "sub_agent" && (
                          <span className="ml-1 text-xs text-gray-400">(Agent)</span>
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {lead.assigneeName && (
                  <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                    <User className="h-3 w-3" /> Assigned to {lead.assigneeName}
                  </p>
                )}
              </CardContent>
            </Card>
          )}
          {/* Sub-agent: Transfer Lead — only for leads assigned to this sub-agent */}
          {!user?.isAdmin && isSubAgent && (
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-[#005476] flex items-center gap-1.5">
                  <UserCheck className="h-4 w-4" /> Transfer Lead
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Currently assigned to:{" "}
                  <strong>{lead.assigneeName ?? "Unassigned"}</strong>
                </p>
                {lead.assignedTo === user?.id ? (
                  <>
                    <Select value={transferTargetId} onValueChange={setTransferTargetId}>
                      <SelectTrigger className="w-full text-sm">
                        <SelectValue placeholder="Select agent to transfer to..." />
                      </SelectTrigger>
                      <SelectContent>
                        {adminUsers
                          .filter((u: any) => u.id !== user?.id)
                          .map((u: any) => (
                            <SelectItem key={u.id} value={String(u.id)}>
                              {u.username}
                              {u.role === "sub_agent" && (
                                <span className="ml-1 text-xs text-gray-400">(Agent)</span>
                              )}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Textarea
                      value={transferComment}
                      onChange={e => setTransferComment(e.target.value)}
                      placeholder="Reason for transfer (required)"
                      className="text-sm min-h-[80px] resize-none"
                    />
                    <Button
                      className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:opacity-90 gap-2 text-sm"
                      disabled={!transferTargetId || !transferComment.trim() || reassignMutation.isPending}
                      onClick={() =>
                        reassignMutation.mutate({
                          targetId: Number(transferTargetId),
                          comment: transferComment.trim(),
                        })
                      }
                    >
                      {reassignMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <UserCheck className="h-4 w-4" />
                      )}
                      Transfer Lead
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground italic">
                    You can only transfer leads assigned to you.
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Mark Converted */}
          {lead.status !== "converted" && (
            <Button
              className="w-full bg-gradient-to-r from-green-500 to-green-700 hover:from-green-600 hover:to-green-800 gap-2"
              onClick={() => openStatusDialog("converted")}
              disabled={updateMutation.isPending}
            >
              <CheckCircle2 className="h-4 w-4" /> Mark as Converted
            </Button>
          )}

          {/* Timestamps */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#005476] flex items-center gap-1.5">
                <Clock className="h-4 w-4" /> Timestamps
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <Calendar className="h-3 w-3" />
                <span>Created: {new Date(lead.createdAt).toLocaleDateString()}</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-3 w-3" />
                <span>Updated: {new Date(lead.updatedAt).toLocaleDateString()}</span>
              </div>
              {lead.lastContactAt && (
                <div className="flex items-center gap-2">
                  <Phone className="h-3 w-3" />
                  <span>Last contact: {new Date(lead.lastContactAt).toLocaleDateString()}</span>
                </div>
              )}
              <Button
                variant="outline" size="sm" className="w-full mt-2 text-xs gap-1.5"
                onClick={() => updateMutation.mutate({ lastContactAt: new Date().toISOString() as any })}
                disabled={updateMutation.isPending}
              >
                <Phone className="h-3 w-3" /> Mark Contacted Now
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── WhatsApp AI Qualification Section ─────────────────────────────── */}
      {aiData !== undefined && (
        <div className="mt-6">
          {/* No conversation yet — admin: init card | sub_agent: read-only notice */}
          {!aiData.conversation && user?.isAdmin && (
            <Card className="border-0 shadow-sm border border-dashed border-[#3bcac4]/40">
              <CardContent className="py-6 flex flex-col items-center gap-3 text-center">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#3bcac4]/20 to-[#005476]/20 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-[#005476]" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[#005476]">WhatsApp AI Qualification</p>
                  <p className="text-xs text-muted-foreground mt-0.5">No AI conversation exists for this lead yet.</p>
                </div>
                <Button
                  size="sm"
                  className="bg-gradient-to-r from-[#3bcac4] to-[#005476] gap-1.5 text-xs"
                  disabled={initAiMutation.isPending}
                  onClick={() => initAiMutation.mutate()}
                >
                  {initAiMutation.isPending
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    : <Bot className="h-3.5 w-3.5" />}
                  Initialize AI Conversation
                </Button>
              </CardContent>
            </Card>
          )}

          {/* No conversation yet — sub_agent read-only notice */}
          {!aiData.conversation && isSubAgent && (
            <Card className="border-0 shadow-sm border border-dashed border-[#3bcac4]/40">
              <CardContent className="py-6 flex flex-col items-center gap-2 text-center">
                <div className="h-10 w-10 rounded-full bg-gradient-to-br from-[#3bcac4]/20 to-[#005476]/20 flex items-center justify-center">
                  <Bot className="h-5 w-5 text-[#005476]" />
                </div>
                <p className="text-sm font-medium text-[#005476]">WhatsApp AI Qualification</p>
                <p className="text-xs text-muted-foreground">No WhatsApp AI conversation found for this lead.</p>
              </CardContent>
            </Card>
          )}

          {aiData.conversation && (
          <Card className="border-0 shadow-sm overflow-hidden">
            {/* Header — always visible */}
            <CardHeader
              className="pb-3 cursor-pointer select-none bg-gradient-to-r from-[#005476]/5 to-[#3bcac4]/5 hover:from-[#005476]/10 hover:to-[#3bcac4]/10 transition-colors"
              onClick={() => setAiOpen(o => !o)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center shrink-0">
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                  <div>
                    <CardTitle className="text-sm font-semibold text-[#005476] flex items-center gap-2">
                      {user?.isAdmin ? "WhatsApp AI Conversation" : "AI WhatsApp Conversation & Summary"}
                      {/* Status badge */}
                      {(() => {
                        const s = aiData.conversation!.status;
                        const cfg: Record<string, string> = {
                          draft:       "bg-slate-100 text-slate-600 border-slate-300",
                          active:      "bg-[#3bcac4]/20 text-[#005476] border-[#3bcac4]/50",
                          completed:   "bg-[#005476]/15 text-[#005476] border-[#005476]/30",
                          needs_human: "bg-amber-50 text-amber-700 border-amber-200",
                          stopped:     "bg-red-50 text-red-600 border-red-200",
                        };
                        const labels: Record<string, string> = {
                          draft: "Draft", active: "Active", completed: "Completed",
                          needs_human: "Needs Human", stopped: "Stopped",
                        };
                        return (
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${cfg[s] ?? "bg-gray-100 text-gray-600 border-gray-200"}`}>
                            {labels[s] ?? s}
                          </span>
                        );
                      })()}
                    </CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Phase 1 — Internal only · No WhatsApp message sent
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {aiData.report?.priorityScore && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      aiData.report.priorityScore === "high"
                        ? "bg-red-50 text-red-600"
                        : aiData.report.priorityScore === "medium"
                        ? "bg-amber-50 text-amber-600"
                        : "bg-green-50 text-green-600"
                    }`}>
                      {aiData.report.priorityScore.toUpperCase()} PRIORITY
                    </span>
                  )}
                  {aiOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>
              </div>
            </CardHeader>

            {aiOpen && (
              <CardContent className="pt-0">
                {/* Tab bar */}
                <div className="flex gap-1 border-b mb-4 mt-3">
                  {(["transcript", "report"] as const).map(t => (
                    <button
                      key={t}
                      onClick={() => setAiTab(t)}
                      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                        aiTab === t
                          ? "border-[#3bcac4] text-[#005476]"
                          : "border-transparent text-muted-foreground hover:text-[#005476]"
                      }`}
                    >
                      {t === "transcript" ? "Conversation" : "Agent Report"}
                    </button>
                  ))}
                </div>

                {/* ── Transcript tab ───────────────────────────────────── */}
                {aiTab === "transcript" && (
                  <div className="space-y-4">
                    {aiLoading ? (
                      <div className="flex items-center gap-2 text-muted-foreground text-sm py-4 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading conversation…
                      </div>
                    ) : aiData.messages.length === 0 ? (
                      <div className="text-center text-muted-foreground text-sm py-6">
                        <Bot className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        No messages yet
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-[400px] overflow-y-auto pr-1">
                        {aiData.messages.map((msg) => {
                          const isAi = msg.sender === "ai";
                          const isClient = msg.sender === "client";
                          const isSystem = msg.sender === "system" || msg.sender === "admin";
                          const payload = msg.rawPayloadJson as Record<string, string> | null;
                          const isRecovery = payload?.messageType === "no_answer_3_recovery";

                          if (isSystem) {
                            return (
                              <div key={msg.id} className="flex justify-center">
                                <span className="text-[10px] text-muted-foreground bg-gray-50 px-3 py-1 rounded-full border">
                                  {msg.messageText}
                                </span>
                              </div>
                            );
                          }

                          if (isRecovery) {
                            return (
                              <div key={msg.id} className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3 space-y-1.5">
                                <div className="flex items-center gap-2">
                                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
                                    <Bot className="h-3 w-3" />
                                    No Answer 3 Recovery Draft
                                  </span>
                                  <span className="text-[10px] text-muted-foreground ml-auto">
                                    {payload?.triggeredAt
                                      ? new Date(payload.triggeredAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })
                                      : new Date(msg.createdAt).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}
                                  </span>
                                </div>
                                <p className="text-sm text-amber-900 whitespace-pre-wrap break-words leading-relaxed" dir="rtl">
                                  {msg.messageText}
                                </p>
                                <p className="text-[10px] text-amber-600 opacity-70">
                                  Draft only — not sent via WhatsApp (Phase 1)
                                </p>
                              </div>
                            );
                          }

                          return (
                            <div key={msg.id} className={`flex ${isClient ? "justify-end" : "justify-start"}`}>
                              <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap break-words ${
                                isAi
                                  ? "bg-gradient-to-br from-[#005476]/8 to-[#3bcac4]/8 text-[#005476] border border-[#3bcac4]/20"
                                  : "bg-[#005476] text-white"
                              }`}>
                                <div className="flex items-center gap-1.5 mb-1">
                                  {isAi && <Bot className="h-3 w-3 opacity-60 shrink-0" />}
                                  <span className="text-[10px] font-medium opacity-60">
                                    {isAi ? "AI (Khalid)" : "Client"}
                                  </span>
                                  <span className="text-[10px] opacity-40 ml-auto">
                                    {new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                </div>
                                {msg.messageText}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Admin action buttons */}
                    {user?.isAdmin && (
                      <div className="flex flex-wrap gap-2 pt-3 border-t">
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-amber-600 border-amber-200 hover:bg-amber-50 text-xs"
                          disabled={updateAiStatusMutation.isPending}
                          onClick={() => updateAiStatusMutation.mutate({ status: "needs_human", handoff_reason: "Admin marked" })}
                        >
                          {updateAiStatusMutation.isPending
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <UserX className="h-3.5 w-3.5" />}
                          Mark Needs Human
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50 text-xs"
                          disabled={updateAiStatusMutation.isPending}
                          onClick={() => updateAiStatusMutation.mutate({ status: "stopped" })}
                        >
                          {updateAiStatusMutation.isPending
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <StopCircle className="h-3.5 w-3.5" />}
                          Stop AI
                        </Button>
                        {aiData.conversation!.status === "stopped" || aiData.conversation!.status === "needs_human" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-[#3bcac4] border-[#3bcac4]/40 hover:bg-[#3bcac4]/10 text-xs"
                            disabled={updateAiStatusMutation.isPending}
                            onClick={() => updateAiStatusMutation.mutate({ status: "draft" })}
                          >
                            <RefreshCw className="h-3.5 w-3.5" /> Reactivate
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          className="gap-1.5 text-slate-400 border-slate-200 text-xs cursor-not-allowed opacity-60 ml-auto"
                          disabled
                          title="WhatsApp API integration — Phase 2"
                        >
                          <Send className="h-3.5 w-3.5" /> Send via WhatsApp API — Phase 2
                        </Button>
                      </div>
                    )}

                    {/* Handoff reason */}
                    {aiData.conversation!.handoffReason && (
                      <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-800">
                        <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                        Handoff reason: {aiData.conversation!.handoffReason}
                      </div>
                    )}
                  </div>
                )}

                {/* ── Report tab ───────────────────────────────────────── */}
                {aiTab === "report" && (
                  <div className="space-y-4">
                    {aiData.report ? (
                      <>
                        {/* Summary */}
                        {aiData.report.summaryText && (
                          <div className="bg-[#005476]/5 border border-[#005476]/15 rounded-lg px-4 py-3">
                            <p className="text-xs font-semibold text-[#005476] mb-1 flex items-center gap-1">
                              <FileText className="h-3.5 w-3.5" /> Summary
                            </p>
                            <p className="text-sm text-[#005476]/80 leading-relaxed">
                              {aiData.report.summaryText}
                            </p>
                          </div>
                        )}

                        {/* Qualification grid */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                          {[
                            { label: "Country", value: aiData.report.country },
                            { label: "City",    value: aiData.report.city },
                            { label: "Budget",  value: aiData.report.budget },
                            { label: "Property Type", value: aiData.report.propertyType },
                            { label: "Payment Method", value: aiData.report.paymentMethod },
                            { label: "Investment Goal", value: aiData.report.investmentGoal },
                            { label: "Buying Timeframe", value: aiData.report.buyingTimeframe },
                            { label: "Best Call Time",   value: aiData.report.bestCallTime },
                            { label: "Client Interest",  value: aiData.report.clientInterest },
                          ].map(({ label, value }) => (
                            <div key={label} className="bg-gray-50 rounded-lg px-3 py-2">
                              <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide mb-0.5">{label}</p>
                              <p className="text-xs text-[#005476] font-medium">{value || "—"}</p>
                            </div>
                          ))}
                        </div>

                        {/* Recommended action */}
                        {aiData.report.recommendedNextAction && (
                          <div className="bg-[#3bcac4]/10 border border-[#3bcac4]/30 rounded-lg px-4 py-3">
                            <p className="text-xs font-semibold text-[#005476] mb-1 flex items-center gap-1">
                              <Target className="h-3.5 w-3.5" /> Recommended Next Action
                            </p>
                            <p className="text-sm text-[#005476]/80">{aiData.report.recommendedNextAction}</p>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="text-center text-muted-foreground text-sm py-6">
                        <Bot className="h-8 w-8 mx-auto mb-2 opacity-30" />
                        No report yet
                      </div>
                    )}

                    {/* Admin: Generate/Refresh Report button */}
                    {user?.isAdmin && (
                      <div className="flex justify-end pt-2 border-t">
                        <Button
                          size="sm"
                          className="bg-gradient-to-r from-[#3bcac4] to-[#005476] gap-1.5 text-xs"
                          disabled={generateReportMutation.isPending}
                          onClick={() => generateReportMutation.mutate()}
                        >
                          {generateReportMutation.isPending
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <RefreshCw className="h-3.5 w-3.5" />}
                          {aiData.report ? "Refresh AI Report" : "Generate AI Report"}
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
          )}
        </div>
      )}

      {/* ── WA Qualification Section ─────────────────────────────────────── */}
      {user?.isAdmin && (
        <div className="mt-6">
          <Card className="border-0 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#3bcac4]/20 to-[#005476]/20 flex items-center justify-center">
                    <SiWhatsapp className="h-4 w-4 text-[#005476]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#005476]">WhatsApp Qualification</p>
                    <p className="text-xs text-muted-foreground">AI-driven interactive lead scoring</p>
                  </div>
                </div>
                <div className="flex gap-2 items-center flex-wrap">
                  {qualData?.session && (qualData.conversationHistory?.length ?? 0) > 0 && (
                    <Button
                      size="sm" variant="outline"
                      className={`gap-1.5 text-xs h-7 ${qualConvOpen ? "border-[#005476] text-[#005476] bg-[#005476]/5" : "border-[#3bcac4]/50 text-[#005476] hover:bg-[#3bcac4]/10"}`}
                      onClick={() => { setQualConvOpen(v => !v); setQualOpen(false); }}
                    >
                      <MessageSquare className="h-3 w-3" />
                      {qualConvOpen ? "Hide Chat" : `Chat (${qualData.conversationHistory.length})`}
                    </Button>
                  )}
                  {qualData?.session && (
                    <Button
                      size="sm" variant="outline"
                      className="gap-1.5 text-xs h-7 border-[#3bcac4]/50 text-[#005476] hover:bg-[#3bcac4]/10"
                      onClick={() => { setQualOpen(v => !v); setQualConvOpen(false); }}
                    >
                      {qualOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {qualOpen ? "Hide" : "Details"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="gap-1.5 text-xs h-7 bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                    onClick={() => restartQualMutation.mutate()}
                    disabled={restartQualMutation.isPending}
                  >
                    {restartQualMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    {qualData?.session ? "Re-qualify" : "Start Flow"}
                  </Button>
                </div>
              </div>

              {/* Body */}
              <div className="px-5 py-4">
                {qualLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-[#3bcac4]" />
                  </div>
                ) : !qualData?.session ? (
                  <div className="text-center text-slate-400 text-sm py-4">
                    <SiWhatsapp className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p>No qualification flow started for this lead yet.</p>
                    {!lead.phone && <p className="text-xs mt-1 text-amber-600">⚠️ Lead has no phone number — flow requires WhatsApp.</p>}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Score + Status row */}
                    <div className="flex flex-wrap gap-3">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-muted-foreground">WA Score</span>
                        {qualData.session.qualified_score ? (
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                            qualData.session.qualified_score === "vip"  ? "bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white" :
                            qualData.session.qualified_score === "hot"  ? "bg-red-100 text-red-700" :
                            qualData.session.qualified_score === "warm" ? "bg-amber-100 text-amber-700" :
                                                                          "bg-sky-100 text-sky-700"
                          }`}>
                            <Crown className="h-3 w-3" />
                            {qualData.session.qualified_score.toUpperCase()}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="text-xs text-muted-foreground">State</span>
                        <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                          qualData.session.state === "completed"          ? "bg-green-100 text-green-700" :
                          qualData.session.state === "in_progress" || qualData.session.state.includes("_sent") ? "bg-[#3bcac4]/10 text-[#005476]" :
                          qualData.session.state === "timed_out"          ? "bg-amber-100 text-amber-700" :
                          qualData.session.state === "opt_out"            ? "bg-gray-100 text-gray-500" :
                                                                            "bg-slate-100 text-slate-500"
                        }`}>
                          {qualData.session.state.replace(/_/g, " ")}
                        </span>
                      </div>
                      {qualData.session.score !== null && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-muted-foreground">Points</span>
                          <span className="text-xs font-semibold text-[#005476]">{qualData.session.score}</span>
                        </div>
                      )}
                      {qualData.session.qualified_at && (
                        <div className="flex flex-col gap-0.5">
                          <span className="text-xs text-muted-foreground">Qualified</span>
                          <span className="text-xs text-[#005476]">{new Date(qualData.session.qualified_at).toLocaleDateString()}</span>
                        </div>
                      )}
                      {qualData.session.opt_out && (
                        <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                          <UserX className="h-3 w-3" /> Opted out
                        </span>
                      )}
                    </div>

                    {/* Preferred contact time badge */}
                    {(() => {
                      const ctAnswer = qualData.answers.find(a => a.question_key === "contact_time");
                      return ctAnswer ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground shrink-0">وقت التواصل</span>
                          <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-0.5 rounded-full bg-[#005476]/10 text-[#005476] border border-[#005476]/20">
                            🕐 {ctAnswer.answer_label}
                          </span>
                        </div>
                      ) : null;
                    })()}

                    {/* Qualification summary */}
                    {qualData.summary && (
                      <div className="rounded-lg bg-[#3bcac4]/5 border border-[#3bcac4]/20 px-4 py-3">
                        <p className="text-xs font-semibold text-[#005476] mb-1.5">ملخص التأهيل</p>
                        <p className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap" dir="rtl">{qualData.summary}</p>
                      </div>
                    )}

                    {/* Answers accordion */}
                    {qualOpen && qualData.answers.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-[#005476] mb-2">Q&A Breakdown</p>
                        <div className="space-y-1.5">
                          {qualData.answers.map((a, i) => (
                            <div key={i} className="flex items-start gap-2 text-xs">
                              <span className="shrink-0 mt-0.5 h-4 w-4 rounded-full bg-[#3bcac4]/20 text-[#005476] flex items-center justify-center text-[10px] font-bold">
                                {i + 1}
                              </span>
                              <div>
                                <p className="text-muted-foreground">{a.question_key.replace(/_/g, " ")}</p>
                                <p className="font-medium text-[#005476]">{a.answer_label}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* AI Conversation Transcript */}
                    {qualConvOpen && (qualData.conversationHistory?.length ?? 0) > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-[#005476] mb-2 flex items-center gap-1.5">
                          <MessageSquare className="h-3.5 w-3.5" />
                          AI Concierge Conversation ({qualData.conversationHistory.length} messages)
                        </p>
                        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1 rounded-lg border border-slate-100 bg-slate-50/40 p-3">
                          {qualData.conversationHistory.map((msg, i) => {
                            const isAssistant = msg.role === "assistant";
                            return (
                              <div key={i} className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}>
                                <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-xs whitespace-pre-wrap break-words leading-relaxed ${
                                  isAssistant
                                    ? "bg-gradient-to-br from-[#005476]/8 to-[#3bcac4]/8 text-[#005476] border border-[#3bcac4]/20"
                                    : "bg-[#005476] text-white"
                                }`}>
                                  <div className="flex items-center gap-1.5 mb-0.5 opacity-60">
                                    {isAssistant
                                      ? <><Bot className="h-2.5 w-2.5" /><span className="text-[9px] font-medium">Maha (AI)</span></>
                                      : <span className="text-[9px] font-medium">Lead</span>
                                    }
                                  </div>
                                  {msg.content}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Admin override */}
                    <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                      <p className="text-xs text-muted-foreground shrink-0">Override score:</p>
                      <Select value={qualScoreOverride} onValueChange={setQualScoreOverride}>
                        <SelectTrigger className="h-7 text-xs w-28">
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="vip">⭐ VIP</SelectItem>
                          <SelectItem value="hot">🔥 Hot</SelectItem>
                          <SelectItem value="warm">🌡️ Warm</SelectItem>
                          <SelectItem value="cold">❄️ Cold</SelectItem>
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        disabled={!qualScoreOverride || overrideQualScoreMutation.isPending}
                        onClick={() => qualScoreOverride && overrideQualScoreMutation.mutate(qualScoreOverride)}
                      >
                        {overrideQualScoreMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
                        Save
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Hot-Lead Escalation Banner (all CRM users) ───────────────────── */}
      {isCrmAuthorized && qualData?.latestEscalation && (
        <div className="mt-4">
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50/70 px-4 py-3">
            <div className="h-8 w-8 rounded-full bg-gradient-to-br from-red-400 to-orange-500 flex items-center justify-center shrink-0 mt-0.5">
              <Flame className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-red-700 flex items-center gap-2">
                🔥 Hot Lead Escalation
              </p>
              <p className="text-xs text-red-600 mt-0.5">
                AI concierge detected high intent — <span className="font-semibold">{qualData.latestEscalation.escalationLabel}</span>
              </p>
              <p className="text-[11px] text-red-400 mt-1">
                {new Date(qualData.latestEscalation.createdAt).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── WhatsApp AI Summary + Transcript for Advisors (sub-agents) ──────── */}
      {isSubAgent && (
        <div className="mt-6">
          <Card className="border-0 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              {/* Header */}
              <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
                <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#3bcac4]/20 to-[#005476]/20 flex items-center justify-center">
                  <SiWhatsapp className="h-4 w-4 text-[#005476]" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-[#005476]">WhatsApp AI Summary</p>
                  <p className="text-xs text-muted-foreground">Read-only · Assigned lead qualification data</p>
                </div>
              </div>

              <div className="px-5 py-4 space-y-4">
                {(qualLoading || aiLoading) ? (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-[#3bcac4]" />
                  </div>
                ) : !qualData?.session && !aiData?.conversation ? (
                  <div className="text-center text-slate-400 text-sm py-4">
                    <SiWhatsapp className="h-8 w-8 mx-auto mb-2 opacity-20" />
                    <p>No WhatsApp AI conversation found for this lead.</p>
                  </div>
                ) : (
                  <>
                    {/* ── System A: WA Qualification (wa_qual_sessions) ───────── */}
                    {qualData?.session && (
                      <div className="space-y-3">
                        {/* Score / State row */}
                        <div className="flex flex-wrap gap-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-muted-foreground">Status</span>
                            <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                              qualData.session.state === "completed"        ? "bg-green-100 text-green-700" :
                              qualData.session.state === "in_progress" || qualData.session.state.includes("_sent") ? "bg-[#3bcac4]/10 text-[#005476]" :
                              qualData.session.state === "timed_out"        ? "bg-amber-100 text-amber-700" :
                              qualData.session.state === "opt_out"          ? "bg-gray-100 text-gray-500" :
                                                                              "bg-slate-100 text-slate-500"
                            }`}>
                              {qualData.session.state.replace(/_/g, " ")}
                            </span>
                          </div>
                          {qualData.session.qualified_score && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-muted-foreground">Score</span>
                              <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-0.5 rounded-full ${
                                qualData.session.qualified_score === "vip"  ? "bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white" :
                                qualData.session.qualified_score === "hot"  ? "bg-red-100 text-red-700" :
                                qualData.session.qualified_score === "warm" ? "bg-amber-100 text-amber-700" :
                                                                              "bg-sky-100 text-sky-700"
                              }`}>
                                <Crown className="h-3 w-3" />
                                {qualData.session.qualified_score.toUpperCase()}
                              </span>
                            </div>
                          )}
                          {qualData.session.opt_out && (
                            <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                              <UserX className="h-3 w-3" /> Opted out
                            </span>
                          )}
                        </div>
                        {/* AI Summary */}
                        {qualData.summary && (
                          <div className="rounded-lg bg-[#005476]/5 border border-[#3bcac4]/20 px-4 py-3">
                            <p className="text-xs font-semibold text-[#005476] mb-1.5">AI Summary</p>
                            <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{qualData.summary}</p>
                          </div>
                        )}
                        {/* Qualification answers grid */}
                        {qualData.answers.length > 0 && (
                          <div className="grid grid-cols-2 gap-2">
                            {qualData.answers.map((a) => (
                              <div key={a.question_key} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                                <p className="text-[10px] text-muted-foreground capitalize">{a.question_key.replace(/_/g, " ")}</p>
                                <p className="text-xs font-medium text-[#005476] mt-0.5">{a.answer_label}</p>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* ── System B: WhatsApp AI Conversation (whatsapp_ai_conversations) ── */}
                    {aiData?.conversation && (
                      <div className="space-y-3">
                        <div className="flex flex-wrap gap-3">
                          <div className="flex flex-col gap-0.5">
                            <span className="text-xs text-muted-foreground">AI Status</span>
                            <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                              aiData.conversation.status === "completed"   ? "bg-green-100 text-green-700"    :
                              aiData.conversation.status === "active"      ? "bg-[#3bcac4]/10 text-[#005476]" :
                              aiData.conversation.status === "needs_human" ? "bg-amber-100 text-amber-700"    :
                              aiData.conversation.status === "stopped"     ? "bg-gray-100 text-gray-500"      :
                                                                             "bg-slate-100 text-slate-500"
                            }`}>
                              {aiData.conversation.status.replace(/_/g, " ")}
                            </span>
                          </div>
                          {aiData.report?.priorityScore && (
                            <div className="flex flex-col gap-0.5">
                              <span className="text-xs text-muted-foreground">Priority</span>
                              <span className={`inline-flex items-center text-xs font-medium px-2 py-0.5 rounded-full ${
                                aiData.report.priorityScore === "high"   ? "bg-red-100 text-red-700"     :
                                aiData.report.priorityScore === "medium" ? "bg-amber-100 text-amber-700" :
                                                                           "bg-sky-100 text-sky-700"
                              }`}>
                                {aiData.report.priorityScore.toUpperCase()} PRIORITY
                              </span>
                            </div>
                          )}
                        </div>
                        {aiData.report?.summaryText && (
                          <div className="rounded-lg bg-[#005476]/5 border border-[#3bcac4]/20 px-4 py-3">
                            <p className="text-xs font-semibold text-[#005476] mb-1.5">AI Summary</p>
                            <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">{aiData.report.summaryText}</p>
                          </div>
                        )}
                        {aiData.report && (() => {
                          const fields = [
                            { label: "Country",          value: aiData.report!.country },
                            { label: "City",             value: aiData.report!.city },
                            { label: "Budget",           value: aiData.report!.budget },
                            { label: "Investment Goal",  value: aiData.report!.investmentGoal },
                            { label: "Buying Timeframe", value: aiData.report!.buyingTimeframe },
                            { label: "Best Call Time",   value: aiData.report!.bestCallTime },
                            { label: "Property Type",    value: aiData.report!.propertyType },
                            { label: "Client Interest",  value: aiData.report!.clientInterest },
                          ].filter(f => f.value);
                          return fields.length > 0 ? (
                            <div className="grid grid-cols-2 gap-2">
                              {fields.map(f => (
                                <div key={f.label} className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2">
                                  <p className="text-[10px] text-muted-foreground">{f.label}</p>
                                  <p className="text-xs font-medium text-[#005476] mt-0.5">{f.value}</p>
                                </div>
                              ))}
                            </div>
                          ) : null;
                        })()}
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* System A — WA Qual Conversation Transcript */}
              {(qualData?.conversationHistory?.length ?? 0) > 0 && (
                <>
                  <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full uppercase tracking-wide">
                        <SiWhatsapp className="h-2.5 w-2.5" /> WhatsApp
                      </span>
                      <p className="text-xs font-medium text-[#005476]">
                        Conversation Transcript ({qualData!.conversationHistory.length} messages)
                      </p>
                    </div>
                    <Button
                      size="sm" variant="outline"
                      className="gap-1.5 text-xs h-7 border-[#3bcac4]/50 text-[#005476] hover:bg-[#3bcac4]/10"
                      onClick={() => setQualConvOpen(v => !v)}
                    >
                      {qualConvOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {qualConvOpen ? "Hide" : "Show"}
                    </Button>
                  </div>
                  {qualConvOpen && (
                    <div className="px-5 pb-4">
                      <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                        {qualData!.conversationHistory.map((msg, i) => {
                          const isAssistant = msg.role === "assistant";
                          return (
                            <div key={i} className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}>
                              <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-xs whitespace-pre-wrap break-words leading-relaxed ${
                                isAssistant
                                  ? "bg-gradient-to-br from-[#005476]/8 to-[#3bcac4]/8 text-[#005476] border border-[#3bcac4]/20"
                                  : "bg-[#005476] text-white"
                              }`}>
                                <div className="flex items-center gap-1.5 mb-0.5 opacity-60">
                                  {isAssistant
                                    ? <><Bot className="h-2.5 w-2.5" /><span className="text-[9px] font-medium">Maha (AI)</span></>
                                    : <span className="text-[9px] font-medium">Lead</span>
                                  }
                                </div>
                                {msg.content}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* System B — WhatsApp AI Conversation Transcript */}
              {(aiData?.messages?.length ?? 0) > 0 && (
                <>
                  <div className="border-t border-slate-100 px-5 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[#005476] bg-[#3bcac4]/10 border border-[#3bcac4]/30 px-2 py-0.5 rounded-full uppercase tracking-wide">
                        <Bot className="h-2.5 w-2.5" /> AI Chat
                      </span>
                      <p className="text-xs font-medium text-[#005476]">
                        AI Conversation Transcript ({aiData!.messages.length} messages)
                      </p>
                    </div>
                    <Button
                      size="sm" variant="outline"
                      className="gap-1.5 text-xs h-7 border-[#3bcac4]/50 text-[#005476] hover:bg-[#3bcac4]/10"
                      onClick={() => setAiConvOpen(v => !v)}
                    >
                      {aiConvOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {aiConvOpen ? "Hide" : "Show"}
                    </Button>
                  </div>
                  {aiConvOpen && (
                    <div className="px-5 pb-4">
                      <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                        {aiData!.messages.map((msg, i) => {
                          const isAssistant = msg.role === "assistant";
                          return (
                            <div key={i} className={`flex ${isAssistant ? "justify-start" : "justify-end"}`}>
                              <div className={`max-w-[82%] rounded-2xl px-3.5 py-2 text-xs whitespace-pre-wrap break-words leading-relaxed ${
                                isAssistant
                                  ? "bg-gradient-to-br from-[#005476]/8 to-[#3bcac4]/8 text-[#005476] border border-[#3bcac4]/20"
                                  : "bg-[#005476] text-white"
                              }`}>
                                <div className="flex items-center gap-1.5 mb-0.5 opacity-60">
                                  {isAssistant
                                    ? <><Bot className="h-2.5 w-2.5" /><span className="text-[9px] font-medium">Maha (AI)</span></>
                                    : <span className="text-[9px] font-medium">Lead</span>
                                  }
                                </div>
                                {msg.content}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Email Nurturing Section ────────────────────────────────────────── */}
      {user?.isAdmin && (
        <div className="mt-6">
          <Card className="border-0 shadow-sm overflow-hidden">
            <CardContent className="p-0">
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#3bcac4]/20 to-[#005476]/20 flex items-center justify-center">
                    <MailOpen className="h-4.5 w-4.5 text-[#005476]" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-[#005476]">Email Nurturing</p>
                    <p className="text-xs text-muted-foreground">Automated trust-building email sequence</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  {nurturingData?.status?.status === "active" && (
                    <>
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 border-amber-300 text-amber-700 hover:bg-amber-50" onClick={() => pauseNurturingMutation.mutate()} disabled={pauseNurturingMutation.isPending}>
                        {pauseNurturingMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />} Pause
                      </Button>
                      <Button size="sm" variant="outline" className="gap-1.5 text-xs h-7 border-red-300 text-red-600 hover:bg-red-50" onClick={() => stopNurturingMutation.mutate()} disabled={stopNurturingMutation.isPending}>
                        {stopNurturingMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <StopCircle className="h-3 w-3" />} Stop
                      </Button>
                    </>
                  )}
                  {nurturingData?.status?.status === "paused" && (
                    <Button size="sm" className="gap-1.5 text-xs h-7 bg-gradient-to-r from-[#3bcac4] to-[#005476]" onClick={() => resumeNurturingMutation.mutate()} disabled={resumeNurturingMutation.isPending}>
                      {resumeNurturingMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />} Resume
                    </Button>
                  )}
                  {(!nurturingData?.status || ["stopped", "completed"].includes(nurturingData.status.status)) && (
                    <Button size="sm" className="gap-1.5 text-xs h-7 bg-gradient-to-r from-[#3bcac4] to-[#005476]" onClick={() => startNurturingMutation.mutate()} disabled={startNurturingMutation.isPending}>
                      {startNurturingMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <MailOpen className="h-3 w-3" />} Start Sequence
                    </Button>
                  )}
                </div>
              </div>

              {/* Status info */}
              <div className="px-5 py-4">
                {!nurturingData?.status ? (
                  <div className="text-center text-slate-400 text-sm py-4">
                    <MailOpen className="h-8 w-8 mx-auto mb-2 opacity-25" />
                    <p>No email sequence started for this lead.</p>
                    {!lead.email && <p className="text-xs mt-1 text-amber-600">⚠️ Lead has no email address — sequence will be skipped until one is added.</p>}
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Status row */}
                    <div className="flex flex-wrap gap-3">
                      {[
                        {
                          label: "Status",
                          value: <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${
                            nurturingData.status.status === "active"      ? "bg-green-100 text-green-700" :
                            nurturingData.status.status === "paused"      ? "bg-amber-100 text-amber-700" :
                            nurturingData.status.status === "stopped"     ? "bg-red-100 text-red-600" :
                            nurturingData.status.status === "unsubscribed"? "bg-gray-100 text-gray-600" :
                            "bg-[#3bcac4]/10 text-[#005476]"
                          }`}>{nurturingData.status.status}</span>
                        },
                        { label: "Started",   value: nurturingData.status.started_at   ? new Date(nurturingData.status.started_at).toLocaleDateString()  : "—" },
                        { label: "Last Email", value: nurturingData.status.last_sent_at ? new Date(nurturingData.status.last_sent_at).toLocaleDateString() : "—" },
                        { label: "Next Email", value: nurturingData.status.next_send_at ? new Date(nurturingData.status.next_send_at).toLocaleDateString() : "—" },
                      ].map(item => (
                        <div key={item.label} className="bg-slate-50 rounded-lg px-3 py-2 min-w-[100px]">
                          <p className="text-[10px] font-medium text-slate-400 uppercase tracking-wide mb-1">{item.label}</p>
                          <div className="text-xs text-[#005476] font-medium">{item.value}</div>
                        </div>
                      ))}
                    </div>

                    {/* Engagement score */}
                    <div className="bg-gradient-to-r from-[#3bcac4]/5 to-[#005476]/5 rounded-lg px-4 py-3 flex items-center gap-4">
                      <TrendingUp className="h-5 w-5 text-[#3bcac4] flex-shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-[#005476]">Engagement Score: {nurturingData.status.engagement_score || 0}</p>
                        <p className={`text-xs mt-0.5 ${
                          nurturingData.status.engagement_label === "high"   ? "text-green-600" :
                          nurturingData.status.engagement_label === "medium" ? "text-amber-600" : "text-slate-400"
                        }`}>
                          {nurturingData.status.engagement_label === "high"   ? "🔥 High Interest" :
                           nurturingData.status.engagement_label === "medium" ? "📊 Medium Interest" : "❄️ Low Interest"}
                          {" — "}Email Opened +5 · Link Clicked +10 · Reply +20
                        </p>
                      </div>
                    </div>

                    {/* Events timeline */}
                    {nurturingData.events.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-[#005476] mb-2">Email History</p>
                        <div className="space-y-1.5 max-h-[220px] overflow-y-auto">
                          {nurturingData.events.slice(0, 20).map((ev: any) => (
                            <div key={ev.id} className="flex items-start gap-2.5 py-1.5 px-2.5 rounded-lg bg-slate-50 text-xs">
                              <span className={`flex-shrink-0 ${
                                ev.event_type === "email_sent"              ? "text-[#3bcac4]" :
                                ev.event_type === "email_opened"            ? "text-green-500" :
                                ev.event_type === "link_clicked"            ? "text-purple-500" :
                                ev.event_type === "email_bounced"           ? "text-red-400" :
                                ev.event_type === "email_unsubscribed"      ? "text-gray-400" :
                                ev.event_type === "sequence_started"        ? "text-[#005476]" :
                                ev.event_type === "email_skipped_disabled"  ? "text-amber-500" :
                                "text-slate-400"
                              }`}>
                                {ev.event_type === "email_sent"             ? <Send className="h-3.5 w-3.5" /> :
                                 ev.event_type === "email_opened"           ? <Eye className="h-3.5 w-3.5" /> :
                                 ev.event_type === "link_clicked"           ? <MousePointerClick className="h-3.5 w-3.5" /> :
                                 ev.event_type === "email_bounced"          ? <AlertCircle className="h-3.5 w-3.5" /> :
                                 ev.event_type === "email_skipped_disabled" ? <MailOpen className="h-3.5 w-3.5" /> :
                                 ev.event_type === "sequence_started"       ? <CheckCircle2 className="h-3.5 w-3.5" /> :
                                 <Mail className="h-3.5 w-3.5" />}
                              </span>
                              <div className="flex-1 min-w-0">
                                <span className="font-medium text-[#005476]">
                                  {ev.event_type === "email_sent"             ? "Email Sent" :
                                   ev.event_type === "email_opened"           ? "Email Opened" :
                                   ev.event_type === "link_clicked"           ? "Link Clicked" :
                                   ev.event_type === "email_bounced"          ? "Email Bounced" :
                                   ev.event_type === "email_unsubscribed"     ? "Unsubscribed" :
                                   ev.event_type === "sequence_started"       ? "Sequence Started" :
                                   ev.event_type === "email_skipped_disabled" ? "Skipped (disabled)" :
                                   ev.event_type}
                                </span>
                                {ev.subject && <span className="text-slate-400 ml-1 truncate">· {ev.subject}</span>}
                              </div>
                              <span className="text-slate-400 flex-shrink-0 whitespace-nowrap">
                                {new Date(ev.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Status Change Dialog — requires a note */}
      <Dialog open={!!statusDialog} onOpenChange={open => { if (!open) setStatusDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-[#005476] flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> Change Lead Status
            </DialogTitle>
          </DialogHeader>
          {statusDialog && (
            <div className="space-y-4 mt-1">
              {/* From → To */}
              <div className="flex items-center gap-3 p-3 rounded-lg bg-gray-50 border text-sm">
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_CONFIG[lead.status]?.color ?? ""}`}>
                  {STATUS_CONFIG[lead.status]?.label ?? lead.status}
                </span>
                <span className="text-muted-foreground">→</span>
                <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_CONFIG[statusDialog.newStatus]?.color ?? ""}`}>
                  {STATUS_CONFIG[statusDialog.newStatus]?.label ?? statusDialog.newStatus}
                </span>
              </div>

              {/* Required note */}
              <div>
                <Label className="text-sm font-medium">
                  Reason / Note <span className="text-red-500">*</span>
                </Label>
                <p className="text-xs text-muted-foreground mb-1.5">
                  Required — explain why the status is changing.
                </p>
                <Textarea
                  autoFocus
                  rows={3}
                  placeholder="e.g. Client paid reservation deposit. Confirmed by phone on 04/06/2026."
                  value={statusDialog.note}
                  onChange={e => setStatusDialog(d => d ? { ...d, note: e.target.value } : null)}
                  className={`resize-none ${!statusDialog.note.trim() ? "border-amber-300 focus:border-amber-400" : "border-[#3bcac4]/50"}`}
                />
                {!statusDialog.note.trim() && (
                  <p className="text-xs text-amber-600 mt-1">A note is required to save this status change.</p>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => setStatusDialog(null)}>
                  Cancel
                </Button>
                <Button
                  className="bg-gradient-to-r from-[#3bcac4] to-[#005476] gap-1.5"
                  disabled={!statusDialog.note.trim() || updateMutation.isPending}
                  onClick={confirmStatusChange}
                >
                  {updateMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Save className="h-4 w-4" />}
                  Save Status Change
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Sub-Agent Mandatory Comment Dialog */}
      {pendingFieldSave && (
        <Dialog open={true} onOpenChange={() => { setPendingFieldSave(null); setSubAgentComment(""); }}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="text-[#005476] flex items-center gap-2">
                <MessageSquare className="h-4 w-4" /> Required Comment
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground mt-1">
              Changing <strong className="text-[#005476]">{pendingFieldSave.label}</strong> requires a reason. It will be logged and sent to the admin.
            </p>
            <Textarea
              value={subAgentComment}
              onChange={e => setSubAgentComment(e.target.value)}
              placeholder="Enter your reason for this change..."
              rows={3}
              className="mt-2"
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <Button variant="outline" onClick={() => { setPendingFieldSave(null); setSubAgentComment(""); }}>
                Cancel
              </Button>
              <Button
                className="bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                disabled={!subAgentComment.trim() || updateMutation.isPending}
                onClick={submitFieldWithComment}
              >
                {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save Change
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Edit Task Dialog */}
      <Dialog open={editTaskOpen} onOpenChange={open => { if (!open) { setEditTaskOpen(false); setEditingTask(null); setEditTaskForm(EMPTY_TASK); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#005476] flex items-center gap-2">
              <Edit3 className="h-4 w-4" /> Edit Task
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label>Title <span className="text-red-500">*</span></Label>
              <Input
                placeholder="Call back, send brochure..."
                value={editTaskForm.title}
                onChange={e => setEditTaskForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                rows={2}
                placeholder="Optional details..."
                value={editTaskForm.description}
                onChange={e => setEditTaskForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={editTaskForm.dueDate}
                  onChange={e => setEditTaskForm(f => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
              <div>
                <Label>Due Time</Label>
                <Input
                  type="time"
                  value={editTaskForm.dueTime}
                  onChange={e => setEditTaskForm(f => ({ ...f, dueTime: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={editTaskForm.priority} onValueChange={v => setEditTaskForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => { setEditTaskOpen(false); setEditingTask(null); setEditTaskForm(EMPTY_TASK); }}>Cancel</Button>
              <Button
                className="bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                disabled={!editTaskForm.title.trim() || updateTaskMutation.isPending}
                onClick={() => editingTask && updateTaskMutation.mutate({ taskId: editingTask.id, data: editTaskForm })}
              >
                {updateTaskMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Save Changes
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* New Task Dialog */}
      <Dialog open={newTaskOpen} onOpenChange={setNewTaskOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#005476] flex items-center gap-2">
              <ListTodo className="h-4 w-4" /> New Task
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div>
              <Label>Title <span className="text-red-500">*</span></Label>
              <Input
                placeholder="Call back, send brochure..."
                value={taskForm.title}
                onChange={e => setTaskForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div>
              <Label>Description</Label>
              <Textarea
                rows={2}
                placeholder="Optional details..."
                value={taskForm.description}
                onChange={e => setTaskForm(f => ({ ...f, description: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Due Date</Label>
                <Input
                  type="date"
                  value={taskForm.dueDate}
                  onChange={e => setTaskForm(f => ({ ...f, dueDate: e.target.value }))}
                />
              </div>
              <div>
                <Label>Due Time</Label>
                <Input
                  type="time"
                  value={taskForm.dueTime}
                  onChange={e => setTaskForm(f => ({ ...f, dueTime: e.target.value }))}
                />
              </div>
            </div>
            <div>
              <Label>Priority</Label>
              <Select value={taskForm.priority} onValueChange={v => setTaskForm(f => ({ ...f, priority: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">High</SelectItem>
                  <SelectItem value="medium">Medium</SelectItem>
                  <SelectItem value="low">Low</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => setNewTaskOpen(false)}>Cancel</Button>
              <Button
                className="bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                disabled={!taskForm.title.trim() || createTaskMutation.isPending}
                onClick={() => createTaskMutation.mutate(taskForm)}
              >
                {createTaskMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
                Create Task
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
