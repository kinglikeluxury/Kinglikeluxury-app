import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { validatePhone, validateEmail } from "@shared/crmValidation";
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
import { Badge } from "@/components/ui/badge";
import {
  Users, Search, Plus, Flame, Thermometer, Snowflake,
  Phone, Mail, MapPin, Globe, RefreshCw, Loader2,
  ChevronRight, Crown, UserCheck, Building2, FolderOpen,
  Edit3, Trash2,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
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
// Filter dropdown ends at 12.2028 per spec (indices 0-30 of PURCHASE_MONTHS)
const FILTER_MONTHS = PURCHASE_MONTHS.slice(0, 31);
const BUDGETS = Array.from({ length: (2000000 - 40000) / 5000 + 1 }, (_, i) => 40000 + i * 5000);

function fmtBudget(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `$${(n / 1000).toFixed(0)}K`;
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
  interestedCountry: "", city: "", projectInterest: "",
  budget: "", expectedPurchaseMonth: "", description: "",
  leadSource: "manual", leadScore: "cold", status: "new",
};

export default function CrmLeadsPage() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  // Initialise filters from URL query params so they survive navigation
  const qs = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const [search, setSearchRaw]         = useState(qs.get("search") ?? "");
  const [status, setStatusRaw]         = useState(qs.get("status") ?? "all");
  const [source, setSourceRaw]         = useState(qs.get("source") ?? "all");
  const [assigned, setAssignedRaw]     = useState(qs.get("assignedTo") ?? "all");
  const [expectedMonth, setExpectedMonthRaw] = useState(qs.get("expectedMonth") ?? "all");
  const [contactDate, setContactDateRaw]     = useState(qs.get("contactDate") ?? "all");
  const [sortBy, setSortByRaw]               = useState(qs.get("sortBy") ?? "newest");
  const [page, setPage] = useState(1);

  // Wrapper setters — reset page whenever any filter changes
  const setSearch        = (v: string) => { setSearchRaw(v);        setPage(1); };
  const setStatus        = (v: string) => { setStatusRaw(v);        setPage(1); };
  const setSource        = (v: string) => { setSourceRaw(v);        setPage(1); };
  const setAssigned      = (v: string) => { setAssignedRaw(v);      setPage(1); };
  const setExpectedMonth = (v: string) => { setExpectedMonthRaw(v); setPage(1); };
  const setContactDate   = (v: string) => { setContactDateRaw(v);   setPage(1); };
  const setSortBy        = (v: string) => { setSortByRaw(v);        setPage(1); };

  const PAGE_SIZE = 50;

  // Keep URL in sync with filter state (replaceState — no new history entry)
  useEffect(() => {
    const p = new URLSearchParams();
    if (search)                   p.set("search", search);
    if (status !== "all")         p.set("status", status);
    if (source !== "all")         p.set("source", source);
    if (assigned !== "all")       p.set("assignedTo", assigned);
    if (expectedMonth !== "all")  p.set("expectedMonth", expectedMonth);
    if (contactDate !== "all")    p.set("contactDate", contactDate);
    if (sortBy !== "newest")      p.set("sortBy", sortBy);
    if (page > 1)                 p.set("page", String(page));
    const qs = p.toString();
    window.history.replaceState(null, "", `/admin/crm${qs ? "?" + qs : ""}`);
  }, [search, status, source, assigned, expectedMonth, contactDate, sortBy, page]);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<{ phone?: string; email?: string }>({});
  const [subAgentsOpen, setSubAgentsOpen] = useState(false);
  const [subAgentForm, setSubAgentForm] = useState({ username: "", email: "", password: "" });

  // Non-hook computations (safe before hooks)
  const isSubAgent = user?.role === "sub_agent";
  const isCrmAuthorized = !authLoading && !!user && (!!user.isAdmin || isSubAgent);

  const params = new URLSearchParams();
  if (search)                  params.set("search", search);
  if (status !== "all")        params.set("status", status);
  if (source !== "all")        params.set("source", source);
  if (isSubAgent && user) {
    params.set("assignedTo", String(user.id));
  } else if (assigned !== "all") {
    params.set("assignedTo", assigned);
  }
  if (expectedMonth !== "all") params.set("expectedMonth", expectedMonth);
  if (contactDate !== "all")   params.set("contactDate", contactDate);
  if (sortBy !== "newest")     params.set("sortOrder", "oldest");
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));

  // ── ALL hooks before any conditional return (Rules of Hooks) ────────────
  const { data: pageData, isLoading, refetch } = useQuery<{ leads: CrmLeadWithAssignee[]; total: number; page: number; limit: number }>({
    queryKey: ["/api/admin/crm/leads", search, status, source, assigned, expectedMonth, contactDate, sortBy, page],
    queryFn: () => fetch(`/api/admin/crm/leads?${params}`).then(r => {
      if (!r.ok) throw new Error("Forbidden");
      return r.json();
    }),
    enabled: isCrmAuthorized,
  });
  const leads = pageData?.leads ?? [];
  const total = pageData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const { data: projects = [] } = useQuery<CrmProject[]>({
    queryKey: ["/api/admin/crm/projects"],
    queryFn: () => fetch("/api/admin/crm/projects").then(r => {
      if (!r.ok) return [];
      return r.json();
    }),
    enabled: isCrmAuthorized,
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

  const { data: subAgents = [] } = useQuery<{ id: number; username: string; email: string | null }[]>({
    queryKey: ["/api/admin/crm/sub-agents"],
    queryFn: () => fetch("/api/admin/crm/sub-agents").then(r => r.json()),
    enabled: !!user?.isAdmin,
  });

  const createSubAgentMutation = useMutation({
    mutationFn: (data: typeof subAgentForm) => apiRequest("POST", "/api/admin/crm/sub-agents", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/sub-agents"] });
      toast({ title: "Sub-agent created successfully" });
      setSubAgentForm({ username: "", email: "", password: "" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteSubAgentMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/crm/sub-agents/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/sub-agents"] });
      toast({ title: "Sub-agent removed" });
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

  function handlePhoneChange(phone: string) {
    const result = validatePhone(phone);
    setForm(f => ({
      ...f,
      phone,
      country: result.valid ? result.country : (phone.trim() ? "Country not detected" : ""),
    }));
    setFormErrors(e => ({
      ...e,
      phone: phone.trim() ? (result.valid ? undefined : result.error) : undefined,
    }));
  }

  function handleEmailChange(email: string) {
    setForm(f => ({ ...f, email }));
    if (email.trim()) {
      const result = validateEmail(email);
      setFormErrors(e => ({ ...e, email: result.valid ? undefined : result.error }));
    } else {
      setFormErrors(e => ({ ...e, email: undefined }));
    }
  }

  function handleCreateLead() {
    const phoneResult = validatePhone(form.phone);
    const emailResult = validateEmail(form.email);
    const errors: { phone?: string; email?: string } = {};
    if (!phoneResult.valid) errors.phone = phoneResult.error;
    if (!emailResult.valid) errors.email = emailResult.error;
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }
    createMutation.mutate(form);
  }

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

          {/* Manage Projects — admin only */}
          {user?.isAdmin && <Dialog open={projectsOpen} onOpenChange={setProjectsOpen}>
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
          </Dialog>}

          {/* Manage Sub-Agents — admin only */}
          {user?.isAdmin && (
            <Dialog open={subAgentsOpen} onOpenChange={setSubAgentsOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <Users className="h-4 w-4" /> Sub-Agents
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-[#005476] flex items-center gap-2">
                    <Users className="h-4 w-4" /> Manage Sub-Agents
                  </DialogTitle>
                </DialogHeader>
                <div className="space-y-3 mt-2">
                  {subAgents.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">No sub-agents yet.</p>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {subAgents.map(a => (
                        <div key={a.id} className="flex items-center gap-2 p-2 rounded-lg border bg-gray-50/60">
                          <div className="flex-1">
                            <p className="text-sm font-medium text-[#005476]">{a.username}</p>
                            {a.email && <p className="text-xs text-muted-foreground">{a.email}</p>}
                          </div>
                          <Badge variant="outline" className="text-xs border-[#3bcac4] text-[#3bcac4]">Sub-Agent</Badge>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50"
                            disabled={deleteSubAgentMutation.isPending}
                            onClick={() => {
                              if (confirm(`Remove sub-agent "${a.username}"? This cannot be undone.`)) {
                                deleteSubAgentMutation.mutate(a.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="pt-2 border-t space-y-2">
                    <p className="text-xs font-semibold text-[#005476] uppercase tracking-wide">Add New Sub-Agent</p>
                    <Input
                      placeholder="Username"
                      value={subAgentForm.username}
                      onChange={e => setSubAgentForm(f => ({ ...f, username: e.target.value }))}
                    />
                    <Input
                      placeholder="Email (optional)"
                      type="email"
                      value={subAgentForm.email}
                      onChange={e => setSubAgentForm(f => ({ ...f, email: e.target.value }))}
                    />
                    <Input
                      placeholder="Password (min 6 chars)"
                      type="password"
                      value={subAgentForm.password}
                      onChange={e => setSubAgentForm(f => ({ ...f, password: e.target.value }))}
                    />
                    <Button
                      className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                      disabled={!subAgentForm.username.trim() || !subAgentForm.password || createSubAgentMutation.isPending}
                      onClick={() => createSubAgentMutation.mutate(subAgentForm)}
                    >
                      {createSubAgentMutation.isPending
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : "Create Sub-Agent"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}

          {/* New Lead — admin only */}
          <Dialog open={newLeadOpen} onOpenChange={v => { setNewLeadOpen(v); if (!v) { setForm(EMPTY_FORM); setFormErrors({}); } }}>
            {!isSubAgent && (
              <DialogTrigger asChild>
                <Button className="bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4] gap-1.5">
                  <Plus className="h-4 w-4" /> New Lead
                </Button>
              </DialogTrigger>
            )}
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
                    className={formErrors.phone ? "border-red-400" : ""}
                  />
                  {formErrors.phone && (
                    <p className="text-xs text-red-500 mt-0.5">{formErrors.phone}</p>
                  )}
                </div>
                <div>
                  <Label>Email</Label>
                  <Input
                    value={form.email}
                    onChange={e => handleEmailChange(e.target.value)}
                    placeholder="email@example.com"
                    className={formErrors.email ? "border-red-400" : ""}
                  />
                  {formErrors.email && (
                    <p className="text-xs text-red-500 mt-0.5">{formErrors.email}</p>
                  )}
                </div>
                <div>
                  <Label className="flex items-center gap-1">
                    Origin Country
                    <span className="text-xs text-muted-foreground font-normal">(auto-detected)</span>
                  </Label>
                  <Input
                    value={form.country}
                    onChange={e => setForm(f => ({ ...f, country: e.target.value }))}
                    placeholder="Enter phone number to detect"
                    className={form.country && form.country !== "Country not detected" ? "border-[#3bcac4]/50 bg-[#3bcac4]/5" : ""}
                    readOnly
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
                    onValueChange={v => setForm(f => ({ ...f, interestedCountry: v === "__none__" ? "" : v, city: "" }))}
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
                {/* City — optional, suggestions depend on Interested Country */}
                <div>
                  <Label className="flex items-center gap-1">
                    City
                    <span className="text-xs text-muted-foreground font-normal">(Optional)</span>
                  </Label>
                  {CITY_SUGGESTIONS[form.interestedCountry] ? (
                    <Select
                      value={form.city || "__none__"}
                      onValueChange={v => setForm(f => ({ ...f, city: v === "__none__" ? "" : v }))}
                    >
                      <SelectTrigger><SelectValue placeholder="Select city..." /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">— Not specified —</SelectItem>
                        {CITY_SUGGESTIONS[form.interestedCountry].map(c => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <Input
                      placeholder="Enter city..."
                      value={form.city}
                      onChange={e => setForm(f => ({ ...f, city: e.target.value }))}
                    />
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
                    disabled={createMutation.isPending || !form.fullName.trim()}
                    onClick={handleCreateLead}
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
            {!isSubAgent && (
              <Select value={assigned} onValueChange={setAssigned}>
                <SelectTrigger className="w-44"><SelectValue placeholder="All Agents" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Agents</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {subAgents.map(a => (
                    <SelectItem key={a.id} value={String(a.id)}>{a.username}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={expectedMonth} onValueChange={setExpectedMonth}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All Months" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Months</SelectItem>
                <SelectItem value="not_specified">Not specified</SelectItem>
                {FILTER_MONTHS.map(m => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={contactDate} onValueChange={setContactDate}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Contact Date" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Dates</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="yesterday">Yesterday</SelectItem>
                <SelectItem value="last7">Last 7 days</SelectItem>
                <SelectItem value="last30">Last 30 days</SelectItem>
                <SelectItem value="thisMonth">This month</SelectItem>
                <SelectItem value="prevMonth">Previous month</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-44"><SelectValue placeholder="Sort by date" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest first</SelectItem>
                <SelectItem value="oldest">Oldest first</SelectItem>
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
                  {leads.map(lead => {
                    // Build href once — used by both the <a> and the row onClick.
                    // Encodes current filter state so "Back to CRM" can restore it.
                    const backParams = new URLSearchParams();
                    if (search)            backParams.set("search", search);
                    if (status !== "all")  backParams.set("status", status);
                    if (source !== "all")  backParams.set("source", source);
                    if (assigned !== "all") backParams.set("assignedTo", assigned);
                    const backQs = backParams.toString();
                    const leadHref = `/admin/crm/${lead.id}${backQs ? "?from=" + encodeURIComponent("?" + backQs) : ""}`;

                    return (
                    <tr
                      key={lead.id}
                      className="border-b last:border-0 hover:bg-[#3bcac4]/5 cursor-pointer transition-colors"
                      onClick={(e) => {
                        // If the click originated inside an <a>, let the <a> handle it
                        // (covers right-click → open in new tab, Ctrl+click, middle-click).
                        if ((e.target as HTMLElement).closest("a")) return;
                        navigate(leadHref);
                      }}
                    >
                      <td className="px-4 py-3">
                        {/* Real anchor so the browser exposes its full link menu
                            (right-click → Open in New Tab, Ctrl+click, middle-click).
                            Normal left-click is intercepted for SPA navigation;
                            modifier clicks fall through to the browser. */}
                        <a
                          href={leadHref}
                          className="font-medium text-[#005476] hover:underline focus-visible:outline-none focus-visible:underline"
                          onClick={(e) => {
                            // Modifier keys or non-left-button: let browser open new tab/window
                            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
                            e.preventDefault();
                            navigate(leadHref);
                          }}
                        >
                          {lead.fullName || `${lead.firstName ?? ""} ${lead.lastName ?? ""}`.trim() || "—"}
                        </a>
                        {lead.country && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <MapPin className="h-3 w-3" />
                            {lead.country}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {lead.phone && (
                          <div className="flex items-center gap-1 text-xs">
                            <Phone className="h-3 w-3 text-muted-foreground" />
                            {lead.phone}
                            <a
                              href={`https://wa.me/${lead.phone.replace(/[\s+\-()[\]]/g, "")}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="ml-0.5 text-green-600 hover:text-green-700 shrink-0"
                              title="Open in WhatsApp"
                            >
                              <SiWhatsapp className="h-3 w-3" />
                            </a>
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
                        ) : null}
                        {lead.interestedCountry ? (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                            <Globe className="h-3 w-3" />
                            <span className="truncate max-w-[120px]">{lead.interestedCountry}</span>
                          </div>
                        ) : null}
                        {!lead.projectInterest && !lead.interestedCountry && (
                          <span className="text-muted-foreground text-xs">—</span>
                        )}
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
                  ); })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-1 py-2">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total.toLocaleString()} leads
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              disabled={page <= 1}
              onClick={() => setPage(p => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span className="text-sm font-medium px-2">
              Page {page} / {totalPages}
            </span>
            <Button
              variant="outline" size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
      {totalPages === 1 && total > 0 && (
        <p className="text-xs text-muted-foreground px-1 py-2">
          {total.toLocaleString()} lead{total !== 1 ? "s" : ""}
        </p>
      )}
    </div>
  );
}
