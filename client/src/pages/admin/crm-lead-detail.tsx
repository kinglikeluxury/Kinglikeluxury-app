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
  DollarSign, CalendarDays,
} from "lucide-react";
import type { CrmLead, CrmNote, CrmTask, CrmProject } from "@shared/schema";

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
  no_answer:             { label: "No Answer",  color: "bg-slate-100 text-slate-500 border border-slate-300" },
  interested:            { label: "Interested", color: "bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40" },
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

  // Back to CRM: restore previous CRM list state from ?from= param (encoded by crm-leads.tsx).
  // Always stays within /admin/crm — never navigates to / or any public page.
  const _fromQs = new URLSearchParams(window.location.search).get("from");
  const backToCrmUrl =
    _fromQs && _fromQs.startsWith("?")
      ? "/admin/crm" + _fromQs
      : "/admin/crm";
  const { toast } = useToast();

  const leadId = Number(params?.id);

  const [activeField, setActiveField] = useState<string | null>(null);
  const [fieldDraft, setFieldDraft] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [detectedCountry, setDetectedCountry] = useState("");

  const [newNote, setNewNote] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);
  const [statusDialog, setStatusDialog] = useState<{ newStatus: string; note: string } | null>(null);
  const [pendingFieldSave, setPendingFieldSave] = useState<{
    fieldKey: string; label: string; oldRaw: string; patch: Record<string, any>; draft: string;
  } | null>(null);
  const [subAgentComment, setSubAgentComment] = useState("");
  const [transferTargetId, setTransferTargetId] = useState<string>("");
  const [transferComment, setTransferComment] = useState<string>("");

  // Non-hook computations (safe before hooks)
  const isSubAgent = user?.role === "sub_agent";
  const isCrmAuthorized = !authLoading && !!user && (!!user.isAdmin || isSubAgent);

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
      navigate(backToCrmUrl);
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

  // ── Auth guard — effect-based redirect avoids "setState during render" ──
  useEffect(() => {
    if (!authLoading && !isCrmAuthorized) {
      navigate("/");
    }
  }, [authLoading, isCrmAuthorized, navigate]);

  if (authLoading || !isCrmAuthorized) return null;

  function openField(key: string, rawValue: string) {
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
    if (fieldKey === "phone" && detectedCountry) {
      patch.country = detectedCountry;
    }

    if (isSubAgent) {
      // Sub-agents must enter a comment/reason before any field save
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
        <Button className="mt-4" onClick={() => navigate(backToCrmUrl)}>Back to CRM</Button>
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
          <Button variant="ghost" size="sm" onClick={() => navigate(backToCrmUrl)} className="gap-1.5 text-muted-foreground">
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
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${statusCfg.color}`}>
                        {statusCfg.label}
                      </span>
                      <span className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full ${scoreCfg.bg} ${scoreCfg.color}`}>
                        <scoreCfg.Icon className="h-3 w-3" />
                        {scoreCfg.label}
                      </span>
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

              {/* Interested Country */}
              <InlineEditField
                {...sharedFieldProps}
                fieldKey="interestedCountry"
                label="Interested Country"
                icon={Globe}
                displayValue={lead.interestedCountry}
                editValue={lead.interestedCountry ?? ""}
                type="select"
                options={INTERESTED_COUNTRIES.map(c => ({ value: c, label: c }))}
                noneLabel="— Not specified —"
                onStart={() => openField("interestedCountry", lead.interestedCountry ?? "")}
                onSave={() => saveField("interestedCountry", "Interested Country", lead.interestedCountry ?? "")}
              />

              {/* City — optional, suggestions based on Interested Country */}
              {(() => {
                const citySuggestions = CITY_SUGGESTIONS[lead.interestedCountry ?? ""];
                return (
                  <InlineEditField
                    {...sharedFieldProps}
                    fieldKey="city"
                    label="City (Optional)"
                    icon={MapPin}
                    displayValue={lead.city}
                    editValue={lead.city ?? ""}
                    type={citySuggestions ? "select" : "text"}
                    options={citySuggestions ? citySuggestions.map(c => ({ value: c, label: c })) : undefined}
                    noneLabel="— Not specified —"
                    placeholder="Enter city..."
                    onStart={() => openField("city", lead.city ?? "")}
                    onSave={() => saveField("city", "City", lead.city ?? "")}
                  />
                );
              })()}

              {/* Project Interest */}
              <InlineEditField
                {...sharedFieldProps}
                fieldKey="projectInterest"
                label="Project Interest"
                icon={Building2}
                displayValue={lead.projectInterest}
                editValue={lead.projectInterest ?? ""}
                type="select"
                options={projects.filter(p => p.isActive).map(p => ({ value: p.name, label: p.name }))}
                noneLabel="— None —"
                onStart={() => openField("projectInterest", lead.projectInterest ?? "")}
                onSave={() => saveField("projectInterest", "Project Interest", lead.projectInterest ?? "")}
              />

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
