import { useState } from "react";
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
  Calendar, Globe, FileText, Plus, Flag, CheckSquare, ListTodo,
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

function InfoRow({ icon: Icon, label, value }: { icon: any; label: string; value?: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-start gap-3 py-2 border-b last:border-0">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="text-sm font-medium text-[#005476]">{value}</p>
      </div>
    </div>
  );
}

const EMPTY_TASK = { title: "", description: "", dueDate: "", dueTime: "", priority: "medium" };

export default function CrmLeadDetailPage() {
  const [, navigate] = useLocation();
  const [, params] = useRoute("/admin/crm/:id");
  const { user } = useAuth();
  const { toast } = useToast();

  const leadId = Number(params?.id);
  const [editing, setEditing] = useState(false);
  const [editData, setEditData] = useState<Partial<CrmLead>>({});
  const [editErrors, setEditErrors] = useState<{ phone?: string; email?: string }>({});
  const [newNote, setNewNote] = useState("");
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [taskForm, setTaskForm] = useState(EMPTY_TASK);

  if (!user?.isAdmin) { navigate("/"); return null; }

  const { data: lead, isLoading } = useQuery<LeadDetail>({
    queryKey: ["/api/admin/crm/leads", leadId],
    queryFn: () => fetch(`/api/admin/crm/leads/${leadId}`).then(r => {
      if (!r.ok) throw new Error("Not found");
      return r.json();
    }),
    enabled: !!leadId,
  });

  const { data: adminUsers = [] } = useQuery<{ id: number; username: string }[]>({
    queryKey: ["/api/admin/users"],
    queryFn: () => fetch("/api/admin/users").then(r => r.json()),
  });

  const { data: projects = [] } = useQuery<CrmProject[]>({
    queryKey: ["/api/admin/crm/projects"],
    queryFn: () => fetch("/api/admin/crm/projects").then(r => r.json()),
  });

  const invalidateLead = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads", leadId] });
    queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads"] });
  };

  const updateMutation = useMutation({
    mutationFn: (data: Partial<CrmLead>) => apiRequest("PATCH", `/api/admin/crm/leads/${leadId}`, data),
    onSuccess: () => { invalidateLead(); toast({ title: "Lead updated" }); setEditing(false); setEditErrors({}); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handleEditPhoneChange(phone: string) {
    const result = validatePhone(phone);
    setEditData(d => ({
      ...d,
      phone,
      country: result.valid ? result.country : (phone.trim() ? "Country not detected" : (d.country ?? "")),
    }));
    setEditErrors(e => ({
      ...e,
      phone: phone.trim() ? (result.valid ? undefined : result.error) : undefined,
    }));
  }

  function handleEditEmailChange(email: string) {
    setEditData(d => ({ ...d, email }));
    if (email.trim()) {
      const result = validateEmail(email);
      setEditErrors(e => ({ ...e, email: result.valid ? undefined : result.error }));
    } else {
      setEditErrors(e => ({ ...e, email: undefined }));
    }
  }

  function handleSave() {
    const phoneResult = validatePhone((editData.phone as string) ?? "");
    const emailResult = validateEmail((editData.email as string) ?? "");
    const errors: { phone?: string; email?: string } = {};
    if (!phoneResult.valid) errors.phone = phoneResult.error;
    if (!emailResult.valid) errors.email = emailResult.error;
    if (Object.keys(errors).length > 0) {
      setEditErrors(errors);
      return;
    }
    updateMutation.mutate(editData);
  }

  const addNoteMutation = useMutation({
    mutationFn: (note: string) => apiRequest("POST", `/api/admin/crm/leads/${leadId}/notes`, { note }),
    onSuccess: () => { invalidateLead(); toast({ title: "Note added" }); setNewNote(""); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/admin/crm/leads/${leadId}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads"] });
      toast({ title: "Lead deleted" });
      navigate("/admin/crm");
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

  const startEdit = () => {
    if (!lead) return;
    setEditData({
      fullName:              lead.fullName ?? "",
      firstName:             lead.firstName ?? "",
      lastName:              lead.lastName ?? "",
      phone:                 lead.phone ?? "",
      email:                 lead.email ?? "",
      country:               lead.country ?? "",
      interestedCountry:     lead.interestedCountry ?? "",
      projectInterest:       lead.projectInterest ?? "",
      budget:                lead.budget ?? "",
      expectedPurchaseMonth: lead.expectedPurchaseMonth ?? "",
      description:           lead.description ?? "",
      campaignName:          lead.campaignName ?? "",
      adsetName:             lead.adsetName ?? "",
      adName:                lead.adName ?? "",
      formName:              lead.formName ?? "",
      leadSource:            lead.leadSource,
      notes:                 lead.notes ?? "",
    });
    setEditing(true);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-10 w-10 animate-spin text-[#3bcac4]" />
      </div>
    );
  }

  if (!lead) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <p className="text-muted-foreground">Lead not found.</p>
        <Button className="mt-4" onClick={() => navigate("/admin/crm")}>Back to CRM</Button>
      </div>
    );
  }

  const scoreCfg   = SCORE_CONFIG[lead.leadScore ?? "cold"] ?? SCORE_CONFIG.cold;
  const statusCfg  = STATUS_CONFIG[lead.status] ?? STATUS_CONFIG.new;
  const displayName = lead.fullName || `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || "Unnamed Lead";
  const tasks = lead.crmTasks ?? [];
  const pendingTasks = tasks.filter(t => !t.completedAt);
  const doneTasks    = tasks.filter(t =>  t.completedAt);

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/admin/crm")} className="gap-1.5 text-muted-foreground">
            <ArrowLeft className="h-4 w-4" /> Back to CRM
          </Button>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm font-medium text-[#005476]">{displayName}</span>
        </div>
        <div className="flex items-center gap-2">
          {!editing ? (
            <Button variant="outline" size="sm" onClick={startEdit} className="gap-1.5">
              <Edit3 className="h-3.5 w-3.5" /> Edit
            </Button>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={() => setEditing(false)} className="gap-1.5">
                <X className="h-3.5 w-3.5" /> Cancel
              </Button>
              <Button size="sm" className="bg-gradient-to-r from-[#3bcac4] to-[#005476] gap-1.5"
                onClick={handleSave} disabled={updateMutation.isPending}>
                {updateMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save
              </Button>
            </>
          )}
          <Button
            variant="outline" size="sm"
            className="gap-1.5 text-red-500 hover:text-red-600 hover:border-red-300"
            onClick={() => { if (confirm("Delete this lead?")) deleteMutation.mutate(); }}
            disabled={deleteMutation.isPending}
          >
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* LEFT: Lead Info */}
        <div className="lg:col-span-2 space-y-5">
          {/* Identity */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center text-white font-bold text-lg">
                    {displayName.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    {editing ? (
                      <Input className="text-lg font-bold h-8 mb-1"
                        value={editData.fullName ?? ""}
                        onChange={e => setEditData(d => ({ ...d, fullName: e.target.value }))}
                        placeholder="Full name"
                      />
                    ) : (
                      <h2 className="text-xl font-bold text-[#005476]">{displayName}</h2>
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
              {editing ? (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Phone</Label>
                    <Input
                      value={(editData.phone as string) ?? ""}
                      onChange={e => handleEditPhoneChange(e.target.value)}
                      placeholder="+971 50..."
                      className={`h-8 text-sm ${editErrors.phone ? "border-red-400" : ""}`}
                    />
                    {editErrors.phone && (
                      <p className="text-xs text-red-500 mt-0.5">{editErrors.phone}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs">Email</Label>
                    <Input
                      value={(editData.email as string) ?? ""}
                      onChange={e => handleEditEmailChange(e.target.value)}
                      placeholder="email@..."
                      className={`h-8 text-sm ${editErrors.email ? "border-red-400" : ""}`}
                    />
                    {editErrors.email && (
                      <p className="text-xs text-red-500 mt-0.5">{editErrors.email}</p>
                    )}
                  </div>
                  <div>
                    <Label className="text-xs">Origin Country <span className="text-muted-foreground font-normal">(auto-detected)</span></Label>
                    <Input
                      value={(editData.country as string) ?? ""}
                      readOnly
                      placeholder="Enter phone to detect"
                      className={`h-8 text-sm ${editData.country && editData.country !== "Country not detected" ? "border-[#3bcac4]/50 bg-[#3bcac4]/5" : ""}`}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Interested Country</Label>
                    <Select
                      value={(editData.interestedCountry as string) || "__none__"}
                      onValueChange={v => setEditData(d => ({ ...d, interestedCountry: v === "__none__" ? "" : v }))}
                    >
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not specified —</SelectItem>
                        {INTERESTED_COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Project Interest</Label>
                    <Select
                      value={(editData.projectInterest as string) || "__none__"}
                      onValueChange={v => setEditData(d => ({ ...d, projectInterest: v === "__none__" ? "" : v }))}
                    >
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— None —</SelectItem>
                        {projects.filter(p => p.isActive).map(p => (
                          <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Budget</Label>
                    <Select
                      value={(editData.budget as string) || "__none__"}
                      onValueChange={v => setEditData(d => ({ ...d, budget: v === "__none__" ? "" : v }))}
                    >
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not specified —</SelectItem>
                        {BUDGETS.map(n => (
                          <SelectItem key={n} value={String(n)}>{fmtBudget(n)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Expected Purchase Month</Label>
                    <Select
                      value={(editData.expectedPurchaseMonth as string) || "__none__"}
                      onValueChange={v => setEditData(d => ({ ...d, expectedPurchaseMonth: v === "__none__" ? "" : v }))}
                    >
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not specified —</SelectItem>
                        {PURCHASE_MONTHS.map(m => (
                          <SelectItem key={m} value={m}>{m}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs">Lead Source</Label>
                    <Select value={editData.leadSource ?? "manual"} onValueChange={v => setEditData(d => ({ ...d, leadSource: v }))}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {SOURCES.map(s => <SelectItem key={s} value={s}>{SOURCE_LABELS[s]}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  {[
                    { key: "campaignName" as const, label: "Campaign" },
                  ].map(({ key, label }) => (
                    <div key={key}>
                      <Label className="text-xs">{label}</Label>
                      <Input
                        value={(editData[key] as string) ?? ""}
                        onChange={e => setEditData(d => ({ ...d, [key]: e.target.value }))}
                        className="h-8 text-sm"
                      />
                    </div>
                  ))}
                  <div className="col-span-2">
                    <Label className="text-xs">Description</Label>
                    <Textarea rows={2} value={(editData.description as string) ?? ""}
                      onChange={e => setEditData(d => ({ ...d, description: e.target.value }))}
                      placeholder="Lead description..." className="text-sm" />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-xs">Internal Notes</Label>
                    <Textarea rows={3} value={editData.notes ?? ""}
                      onChange={e => setEditData(d => ({ ...d, notes: e.target.value }))}
                      placeholder="Internal notes..." />
                  </div>
                </div>
              ) : (
                <div className="space-y-0.5">
                  <InfoRow icon={Phone}        label="Phone"                    value={lead.phone} />
                  <InfoRow icon={Mail}         label="Email"                    value={lead.email} />
                  <InfoRow icon={MapPin}       label="Origin Country"           value={lead.country} />
                  <InfoRow icon={Globe}        label="Interested Country"       value={lead.interestedCountry} />
                  <InfoRow icon={Building2}    label="Project Interest"         value={lead.projectInterest} />
                  <InfoRow icon={DollarSign}   label="Budget"                   value={lead.budget ? fmtBudget(Number(lead.budget)) : null} />
                  <InfoRow icon={CalendarDays} label="Expected Purchase Month"  value={lead.expectedPurchaseMonth} />
                  <InfoRow icon={Target}       label="Source"                   value={SOURCE_LABELS[lead.leadSource] ?? lead.leadSource} />
                  <InfoRow icon={Globe}        label="Campaign"                 value={lead.campaignName} />
                  <InfoRow icon={FileText}     label="Ad Set"                   value={lead.adsetName} />
                  <InfoRow icon={FileText}     label="Ad Name"                  value={lead.adName} />
                  <InfoRow icon={FileText}     label="Form Name"                value={lead.formName} />
                  {lead.description && (
                    <div className="flex items-start gap-3 py-2 border-b last:border-0">
                      <FileText className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs text-muted-foreground">Description</p>
                        <p className="text-sm text-gray-700 mt-0.5">{lead.description}</p>
                      </div>
                    </div>
                  )}
                  {lead.notes && (
                    <div className="mt-3 p-3 rounded-lg bg-gray-50 border text-sm text-muted-foreground">
                      {lead.notes}
                    </div>
                  )}
                </div>
              )}
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

          {/* Notes Timeline */}
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
                  {[...lead.crmNotes].reverse().map((note, i) => (
                    <div key={note.id} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="h-7 w-7 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center text-white text-xs font-bold shrink-0">
                          {(note.authorName ?? "A").charAt(0).toUpperCase()}
                        </div>
                        {i < lead.crmNotes.length - 1 && <div className="w-px flex-1 bg-border mt-1" />}
                      </div>
                      <div className="flex-1 pb-3">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium text-[#005476]">{note.authorName ?? "Admin"}</span>
                          <span className="text-xs text-muted-foreground">
                            {new Date(note.createdAt).toLocaleDateString()} {new Date(note.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </div>
                        <p className="text-sm text-gray-700 bg-gray-50 rounded-lg px-3 py-2 border">{note.note}</p>
                      </div>
                    </div>
                  ))}
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
                  onClick={() => updateMutation.mutate({ status: s })}
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
                    onClick={() => updateMutation.mutate({ leadScore: score })}
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

          {/* Assignment */}
          <Card className="border-0 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-[#005476] flex items-center gap-1.5">
                <UserCheck className="h-4 w-4" /> Assign Agent
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <Select
                value={lead.assignedTo ? String(lead.assignedTo) : "unassigned"}
                onValueChange={v => updateMutation.mutate({ assignedTo: v === "unassigned" ? null : Number(v) })}
              >
                <SelectTrigger className="w-full text-sm">
                  <SelectValue placeholder="Unassigned" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {adminUsers.map((u: any) => (
                    <SelectItem key={u.id} value={String(u.id)}>{u.username}</SelectItem>
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

          {/* Mark Converted */}
          {lead.status !== "converted" && (
            <Button
              className="w-full bg-gradient-to-r from-green-500 to-green-700 hover:from-green-600 hover:to-green-800 gap-2"
              onClick={() => updateMutation.mutate({ status: "converted" })}
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
                  <SelectItem value="high">🔴 High</SelectItem>
                  <SelectItem value="medium">🟡 Medium</SelectItem>
                  <SelectItem value="low">🟢 Low</SelectItem>
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
