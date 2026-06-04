import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Users, Search, Plus, Flame, Thermometer, Snowflake,
  Phone, Mail, MapPin, RefreshCw, Loader2,
  ChevronRight, Crown, UserCheck, Building2, FolderOpen,
  Edit3, Trash2,
} from "lucide-react";
import type { CrmLead, CrmProject } from "@shared/schema";

interface CrmLeadWithAssignee extends CrmLead { assigneeName?: string | null }

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

const SCORE_CONFIG: Record<string, { label: string; Icon: any; color: string }> = {
  hot:  { label: "Hot",  Icon: Flame,       color: "text-red-500" },
  warm: { label: "Warm", Icon: Thermometer, color: "text-amber-500" },
  cold: { label: "Cold", Icon: Snowflake,   color: "text-sky-400" },
};

const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta", website: "Website", whatsapp: "WhatsApp",
  excel: "Excel", manual: "Manual",
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

function detectCountryFromPhone(phone: string): string {
  const clean = phone.replace(/[\s\-()]/g, "");
  if (clean.startsWith("+995")) return "Georgia";
  if (clean.startsWith("+971")) return "United Arab Emirates";
  if (clean.startsWith("+90")) return "Turkey";
  return "";
}

function ScoreBadge({ score }: { score: string | null }) {
  const cfg = SCORE_CONFIG[score ?? "cold"] ?? SCORE_CONFIG.cold;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${cfg.color}`}>
      <cfg.Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? STATUS_CONFIG.new;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      {cfg.label}
    </span>
  );
}

const EMPTY_FORM = {
  fullName: "", phone: "", email: "",
  country: "",
  interestedCountry: "", projectInterest: "",
  budget: "", expectedPurchaseMonth: "", description: "",
  leadSource: "manual", leadScore: "cold", status: "new",
};

export default function CrmLeadsPage() {
  const [, navigate] = useLocation();
  const { user } = useAuth();
  const { toast } = useToast();

  const [search, setSearch]   = useState("");
  const [status, setStatus]   = useState("all");
  const [source, setSource]   = useState("all");
  const [assigned, setAssigned] = useState("all");
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);

  if (!user?.isAdmin) { navigate("/"); return null; }

  const params = new URLSearchParams();
  if (search)            params.set("search", search);
  if (status !== "all")  params.set("status", status);
  if (source !== "all")  params.set("source", source);
  if (assigned !== "all") params.set("assignedTo", assigned);

  const { data: leads = [], isLoading, refetch } = useQuery<CrmLeadWithAssignee[]>({
    queryKey: ["/api/admin/crm/leads", search, status, source, assigned],
    queryFn: () => fetch(`/api/admin/crm/leads?${params}`).then(r => {
      if (!r.ok) throw new Error("Forbidden");
      return r.json();
    }),
  });

  const { data: projects = [] } = useQuery<CrmProject[]>({
    queryKey: ["/api/admin/crm/projects"],
    queryFn: () => fetch("/api/admin/crm/projects").then(r => r.json()),
  });

  const createMutation = useMutation({
    mutationFn: (data: typeof form) => apiRequest("POST", "/api/admin/crm/leads", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads"] });
      toast({ title: "Lead created successfully" });
      setNewLeadOpen(false);
      setForm(EMPTY_FORM);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const createProjectMutation = useMutation({
    mutationFn: (name: string) => apiRequest("POST", "/api/admin/crm/projects", { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/projects"] });
      toast({ title: "Project added" });
      setNewProjectName("");
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateProjectMutation = useMutation({
    mutationFn: ({ id, name }: { id: number; name: string }) =>
      apiRequest("PATCH", `/api/admin/crm/projects/${id}`, { name }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/projects"] });
      toast({ title: "Project updated" });
      setEditingProjectId(null);
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteProjectMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/crm/projects/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/projects"] });
      toast({ title: "Project removed" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  function handlePhoneChange(phone: string) {
    const detected = detectCountryFromPhone(phone);
    setForm(f => ({
      ...f,
      phone,
      ...(detected ? { country: detected } : {}),
    }));
  }

  const total     = leads.length;
  const newCount  = leads.filter(l => l.status === "new").length;
  const hotCount  = leads.filter(l => l.leadScore === "hot").length;
  const converted = leads.filter(l => l.status === "converted").length;

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-br from-[#3bcac4] to-[#005476]">
            <Crown className="h-6 w-6 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#005476]">Kinglike CRM</h1>
            <p className="text-sm text-muted-foreground">Lead Management System</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>

          {/* Manage Projects */}
          <Dialog open={projectsOpen} onOpenChange={setProjectsOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <FolderOpen className="h-4 w-4" /> Projects
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle className="text-[#005476] flex items-center gap-2">
                  <FolderOpen className="h-4 w-4" /> Manage Project List
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-3 mt-2">
                {projects.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No projects yet. Add one below.
                  </p>
                ) : (
                  <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
                    {projects.map(p => (
                      <div key={p.id} className="flex items-center gap-2 p-2 rounded-lg border bg-gray-50/60">
                        {editingProjectId === p.id ? (
                          <>
                            <Input
                              className="flex-1 h-7 text-sm"
                              value={editingProjectName}
                              onChange={e => setEditingProjectName(e.target.value)}
                              onKeyDown={e => {
                                if (e.key === "Enter") updateProjectMutation.mutate({ id: p.id, name: editingProjectName });
                                if (e.key === "Escape") setEditingProjectId(null);
                              }}
                              autoFocus
                            />
                            <Button size="sm" className="h-7 px-2 text-xs bg-[#005476]"
                              disabled={updateProjectMutation.isPending}
                              onClick={() => updateProjectMutation.mutate({ id: p.id, name: editingProjectName })}
                            >Save</Button>
                            <Button size="sm" variant="ghost" className="h-7 px-2"
                              onClick={() => setEditingProjectId(null)}>✕</Button>
                          </>
                        ) : (
                          <>
                            <span className="flex-1 text-sm font-medium text-[#005476]">{p.name}</span>
                            {!p.isActive && <span className="text-xs text-muted-foreground">(inactive)</span>}
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0"
                              onClick={() => { setEditingProjectId(p.id); setEditingProjectName(p.name); }}>
                              <Edit3 className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-400 hover:text-red-600"
                              onClick={() => { if (confirm(`Remove project "${p.name}"?`)) deleteProjectMutation.mutate(p.id); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex gap-2 pt-2 border-t">
                  <Input
                    placeholder="New project name..."
                    value={newProjectName}
                    onChange={e => setNewProjectName(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === "Enter" && newProjectName.trim())
                        createProjectMutation.mutate(newProjectName.trim());
                    }}
                    className="flex-1"
                  />
                  <Button
                    className="bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                    disabled={!newProjectName.trim() || createProjectMutation.isPending}
                    onClick={() => createProjectMutation.mutate(newProjectName.trim())}
                  >
                    {createProjectMutation.isPending
                      ? <Loader2 className="h-4 w-4 animate-spin" />
                      : <Plus className="h-4 w-4" />}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          {/* New Lead */}
          <Dialog open={newLeadOpen} onOpenChange={setNewLeadOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4] gap-1.5">
                <Plus className="h-4 w-4" /> New Lead
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-[#005476]">Add New Lead</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div className="col-span-2">
                  <Label>Full Name <span className="text-red-500">*</span></Label>
                  <Input
                    value={form.fullName}
                    onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                    placeholder="Ahmed Al Mansouri"
                  />
                </div>
                <div>
                  <Label>Phone <span className="text-red-500">*</span></Label>
                  <Input
                    value={form.phone}
                    onChange={e => handlePhoneChange(e.target.value)}
                    placeholder="+971 50 123 4567"
                  />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    value={form.email}
                    onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                    placeholder="email@example.com"
                  />
                </div>
                <div>
                  <Label className="flex items-center gap-1">
                    Origin Country
                    <span className="text-xs text-muted-foreground font-normal">(auto-detected)</span>
                  </Label>
                  <Input
                    value={form.country}
                    onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                    placeholder="Detected from phone prefix"
                    className={form.country ? "border-[#3bcac4]/50 bg-[#3bcac4]/5" : ""}
                  />
                </div>
                <div>
                  <Label className="flex items-center gap-1">
                    Interested Country
                    {form.leadSource === "meta" && (
                      <span className="text-xs text-[#3bcac4] font-normal">(from Meta data)</span>
                    )}
                  </Label>
                  <Select
                    value={form.interestedCountry || "__none__"}
                    onValueChange={v => setForm(f => ({ ...f, interestedCountry: v === "__none__" ? "" : v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select country..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not specified —</SelectItem>
                      {INTERESTED_COUNTRIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {form.leadSource === "meta" && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      For Meta leads, this is set automatically from the campaign / ad / form mapping.
                    </p>
                  )}
                </div>
                <div>
                  <Label>Project Interest</Label>
                  <Select
                    value={form.projectInterest || "__none__"}
                    onValueChange={v => setForm(f => ({ ...f, projectInterest: v === "__none__" ? "" : v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select project..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— None —</SelectItem>
                      {projects.filter(p => p.isActive).map(p => (
                        <SelectItem key={p.id} value={p.name}>{p.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Budget</Label>
                  <Select
                    value={form.budget || "__none__"}
                    onValueChange={v => setForm(f => ({ ...f, budget: v === "__none__" ? "" : v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select budget..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not specified —</SelectItem>
                      {BUDGETS.map(n => (
                        <SelectItem key={n} value={String(n)}>{fmtBudget(n)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Expected Purchase Month</Label>
                  <Select
                    value={form.expectedPurchaseMonth || "__none__"}
                    onValueChange={v => setForm(f => ({ ...f, expectedPurchaseMonth: v === "__none__" ? "" : v }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select month..." /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not specified —</SelectItem>
                      {PURCHASE_MONTHS.map(m => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Source</Label>
                  <Select value={form.leadSource} onValueChange={v => setForm(f => ({ ...f, leadSource: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {SOURCES.map(s => <SelectItem key={s} value={s}>{SOURCE_LABELS[s]}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Lead Score</Label>
                  <Select value={form.leadScore} onValueChange={v => setForm(f => ({ ...f, leadScore: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hot">🔥 Hot</SelectItem>
                      <SelectItem value="warm">🌡️ Warm</SelectItem>
                      <SelectItem value="cold">❄️ Cold</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2">
                  <Label>Description</Label>
                  <Textarea
                    rows={3}
                    value={form.description}
                    onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                    placeholder="Additional information about this lead..."
                  />
                </div>
                <div className="col-span-2 flex justify-end gap-2 pt-1">
                  <Button variant="outline" onClick={() => setNewLeadOpen(false)}>Cancel</Button>
                  <Button
                    className="bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                    disabled={createMutation.isPending || !form.fullName || !form.phone}
                    onClick={() => createMutation.mutate(form)}
                  >
                    {createMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                    Create Lead
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[
          { label: "Total Leads",  value: total,     icon: Users,     color: "from-[#3bcac4] to-[#005476]" },
          { label: "New Leads",    value: newCount,  icon: Plus,      color: "from-blue-400 to-blue-600" },
          { label: "Hot Leads",    value: hotCount,  icon: Flame,     color: "from-red-400 to-red-600" },
          { label: "Converted",    value: converted, icon: UserCheck, color: "from-green-400 to-green-600" },
        ].map(({ label, value, icon: Icon, color }) => (
          <Card key={label} className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{label}</p>
                  <p className="text-2xl font-bold text-[#005476]">{value}</p>
                </div>
                <div className={`p-2.5 rounded-xl bg-gradient-to-br ${color}`}>
                  <Icon className="h-5 w-5 text-white" />
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="mb-4 border-0 shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-wrap gap-3">
            <div className="flex-1 min-w-48 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search name, phone, email..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-40"><SelectValue placeholder="All Statuses" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                {STATUSES.map(s => <SelectItem key={s} value={s}>{STATUS_CONFIG[s].label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={source} onValueChange={setSource}>
              <SelectTrigger className="w-36"><SelectValue placeholder="All Sources" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {SOURCES.map(s => <SelectItem key={s} value={s}>{SOURCE_LABELS[s]}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={assigned} onValueChange={setAssigned}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All Agents" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Agents</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card className="border-0 shadow-sm">
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="h-8 w-8 animate-spin text-[#3bcac4]" />
            </div>
          ) : leads.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="font-medium">No leads found</p>
              <p className="text-sm">Try adjusting your filters or add a new lead.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-gray-50/60">
                    {["Lead", "Contact", "Source", "Project / Country", "Budget", "Status", "Score", "Assigned", "Added", ""].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-muted-foreground uppercase tracking-wide whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {leads.map(lead => (
                    <tr
                      key={lead.id}
                      className="border-b last:border-0 hover:bg-[#3bcac4]/5 cursor-pointer transition-colors"
                      onClick={() => navigate(`/admin/crm/${lead.id}`)}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-[#005476]">
                          {lead.fullName || `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || "—"}
                        </div>
                        {lead.interestedCountry && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <MapPin className="h-3 w-3" />
                            {lead.interestedCountry}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {lead.phone && (
                          <div className="flex items-center gap-1 text-xs">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            {lead.phone}
                          </div>
                        )}
                        {lead.email && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <Mail className="h-3 w-3" />
                            <span className="truncate max-w-[140px]">{lead.email}</span>
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-gray-100 px-2 py-0.5 rounded-full font-medium">
                          {SOURCE_LABELS[lead.leadSource] ?? lead.leadSource}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {lead.projectInterest ? (
                          <div className="flex items-center gap-1 text-xs">
                            <Building2 className="h-3 w-3 text-muted-foreground" />
                            <span className="truncate max-w-[120px]">{lead.projectInterest}</span>
                          </div>
                        ) : <span className="text-muted-foreground text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {lead.budget ? fmtBudget(Number(lead.budget)) : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={lead.status} />
                      </td>
                      <td className="px-4 py-3">
                        <ScoreBadge score={lead.leadScore} />
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">
                        {lead.assigneeName ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(lead.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-3">
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
