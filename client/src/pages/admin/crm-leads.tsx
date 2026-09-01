import { useState, useEffect, useRef } from "react";
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
  ChevronRight, ChevronDown, Crown, UserCheck, Building2, FolderOpen,
  Edit3, Trash2, Upload, Download, CheckCircle2, XCircle, AlertCircle,
  FileText, Bot,
} from "lucide-react";
import { SiWhatsapp } from "react-icons/si";
import type { CrmLead, CrmProject } from "@shared/schema";

interface CrmLeadWithAssignee extends CrmLead { assigneeName?: string | null }
interface CrmProjectOption extends CrmProject { source?: "property" | "legacy" }

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

const SCORE_CONFIG: Record<string, { label: string; Icon: any; color: string }> = {
  hot:  { label: "Hot",  Icon: Flame,       color: "text-red-500" },
  warm: { label: "Warm", Icon: Thermometer, color: "text-amber-500" },
  cold: { label: "Cold", Icon: Snowflake,   color: "text-sky-400" },
};

const WA_STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  new_lead:         { label: "New Lead",        color: "bg-slate-100 text-slate-500 border border-slate-200" },
  interested:       { label: "💬 Interested",    color: "bg-green-50 text-green-700 border border-green-200" },
  qualified:        { label: "✅ Qualified",      color: "bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40" },
  advisor_assigned: { label: "👤 Advisor Assigned", color: "bg-[#005476]/10 text-[#005476] border border-[#005476]/30" },
};

function WaStageBadge({ stage }: { stage?: string | null }) {
  if (!stage || stage === "new_lead") return null;
  const cfg = WA_STAGE_CONFIG[stage];
  if (!cfg) return null;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <SiWhatsapp className="h-2.5 w-2.5" />
      {cfg.label}
    </span>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  meta: "Meta", website: "Website", whatsapp: "WhatsApp",
  excel: "Excel", manual: "Manual",
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

// ── Multi-select filter dropdown ───────────────────────────────────────────────
interface MultiSelectOption { label: string; value: string }

function MultiSelectFilter({
  label, options, selected, onChange, width = "w-48",
}: {
  label: string;
  options: MultiSelectOption[];
  selected: string[];
  onChange: (vals: string[]) => void;
  width?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(x => x !== v) : [...selected, v]);

  const displayLabel = selected.length === 0
    ? `All ${label}`
    : `${label} (${selected.length})`;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`${width} flex items-center justify-between gap-1 h-9 px-3 rounded-md border border-input bg-background text-sm hover:bg-accent hover:text-accent-foreground transition-colors`}
      >
        <span className={`truncate ${selected.length > 0 ? "text-[#005476] font-medium" : "text-muted-foreground"}`}>
          {displayLabel}
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[200px] rounded-md border bg-popover shadow-md">
          <div className="max-h-60 overflow-y-auto p-1">
            {options.map(opt => (
              <label
                key={opt.value}
                className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-accent text-sm select-none"
              >
                <input
                  type="checkbox"
                  checked={selected.includes(opt.value)}
                  onChange={() => toggle(opt.value)}
                  className="h-3.5 w-3.5 accent-[#3bcac4] shrink-0"
                />
                <span className="truncate">{opt.label}</span>
              </label>
            ))}
          </div>
          {selected.length > 0 && (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => { onChange([]); setOpen(false); }}
                className="w-full text-xs text-muted-foreground hover:text-destructive px-2 py-1 rounded hover:bg-accent transition-colors"
              >
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const CRM_FIELD_LABELS: Record<string, string> = {
  "(skip)":               "— Skip Column —",
  firstName:              "First Name",
  lastName:               "Last Name",
  phone:                  "Phone",
  email:                  "Email",
  country:                "Country",
  city:                   "City",
  budget:                 "Budget",
  projectInterest:        "Project Interest",
  notes:                  "Notes / Comment",
  status:                 "Status",
  leadSource:             "Lead Source",
  assignedAgent:          "Assigned Agent (Lead Owner)",
  lastActivityTime:       "Last Activity Time",
  expectedPurchaseMonth:  "Expected Purchase Month",
};

export default function CrmLeadsPage() {
  const [, navigate] = useLocation();
  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();

  // Initialise filters from URL query params so they survive navigation
  const qs = new URLSearchParams(typeof window !== "undefined" ? window.location.search : "");
  const [search, setSearchRaw]   = useState(qs.get("search") ?? "");
  const [status,         setStatusRaw]         = useState<string[]>(qs.get("status")         ? qs.get("status")!.split(",").filter(Boolean) : []);
  const [source,         setSourceRaw]         = useState<string[]>(qs.get("source")         ? qs.get("source")!.split(",").filter(Boolean) : []);
  const [assigned,       setAssignedRaw]       = useState<string[]>(qs.get("assignedTo")     ? qs.get("assignedTo")!.split(",").filter(Boolean) : []);
  const [expectedMonth,  setExpectedMonthRaw]  = useState<string[]>(qs.get("expectedMonth")  ? qs.get("expectedMonth")!.split(",").filter(Boolean) : []);
  const [contactDate,    setContactDateRaw]    = useState(qs.get("contactDate") ?? "all");
  const [sortBy,         setSortByRaw]         = useState(qs.get("sortBy") ?? "newest");
  const [qualScore,      setQualScoreRaw]      = useState<string[]>(qs.get("qualScore")      ? qs.get("qualScore")!.split(",").filter(Boolean) : []);
  const [aiScore,        setAiScoreRaw]        = useState<string[]>(qs.get("aiScore")        ? qs.get("aiScore")!.split(",").filter(Boolean) : []);
  const [projectInterest, setProjectInterestRaw] = useState<string[]>(qs.get("projectInterest") ? qs.get("projectInterest")!.split(",").filter(Boolean) : []);
  const [page, setPage] = useState(1);

  // Wrapper setters — reset page whenever any filter changes
  const setSearch        = (v: string)    => { setSearchRaw(v);         setPage(1); };
  const setStatus        = (v: string[])  => { setStatusRaw(v);         setPage(1); };
  const setSource        = (v: string[])  => { setSourceRaw(v);         setPage(1); };
  const setAssigned      = (v: string[])  => { setAssignedRaw(v);       setPage(1); };
  const setExpectedMonth = (v: string[])  => { setExpectedMonthRaw(v);  setPage(1); };
  const setContactDate   = (v: string)    => { setContactDateRaw(v);    setPage(1); };
  const setSortBy        = (v: string)    => { setSortByRaw(v);         setPage(1); };
  const setQualScore     = (v: string[])  => { setQualScoreRaw(v);      setPage(1); };
  const setAiScore       = (v: string[])  => { setAiScoreRaw(v);        setPage(1); };
  const setProjectInterest = (v: string[]) => { setProjectInterestRaw(v); setPage(1); };

  const PAGE_SIZE = 50;

  // Keep URL in sync with filter state (replaceState — no new history entry)
  useEffect(() => {
    const p = new URLSearchParams();
    if (search)                     p.set("search",          search);
    if (status.length > 0)          p.set("status",          status.join(","));
    if (source.length > 0)          p.set("source",          source.join(","));
    if (assigned.length > 0)        p.set("assignedTo",      assigned.join(","));
    if (expectedMonth.length > 0)   p.set("expectedMonth",   expectedMonth.join(","));
    if (contactDate !== "all")      p.set("contactDate",     contactDate);
    if (sortBy !== "newest")        p.set("sortBy",          sortBy);
    if (qualScore.length > 0)       p.set("qualScore",       qualScore.join(","));
    if (aiScore.length > 0)         p.set("aiScore",         aiScore.join(","));
    if (projectInterest.length > 0) p.set("projectInterest", projectInterest.join(","));
    if (page > 1)                   p.set("page",            String(page));
    const qs = p.toString();
    window.history.replaceState(null, "", `/admin/crm${qs ? "?" + qs : ""}`);
  }, [search, status.join(","), source.join(","), assigned.join(","), expectedMonth.join(","), contactDate, sortBy, qualScore.join(","), aiScore.join(","), projectInterest.join(","), page]);
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editingProjectName, setEditingProjectName] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [formErrors, setFormErrors] = useState<{ phone?: string; email?: string }>({});
  const [subAgentsOpen, setSubAgentsOpen] = useState(false);
  const [subAgentForm, setSubAgentForm] = useState({ username: "", email: "", password: "" });

  // ── Import / Export state ──────────────────────────────────────────────────
  interface ImportPreviewRow {
    originalPhone: string; normalizedPhone: string;
    excelAgent: string; matchedAgent: string;
    excelStatus: string; mappedStatus: string;
    rawBudget: string; parsedBudget: string;
    projectInterest: string; expectedPurchaseMonth: string;
  }
  interface ImportPreviewData {
    headers: string[];
    detectedMapping: Record<string, string>;
    sampleRows: Record<string, string>[];
    previewRows: ImportPreviewRow[];
    stats: { total: number; withPhone: number; withEmail: number; withNeither: number; estimatedDuplicates: number };
    warnings: string[];
  }
  interface ImportResult {
    total: number; imported: number; duplicates: number; failed: number;
    failedRows: { row: number; reason: string }[];
  }
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [assigningUnassigned, setAssigningUnassigned] = useState(false);

  const [importWizardOpen, setImportWizardOpen] = useState(false);
  const [importStep, setImportStep] = useState<"upload" | "preview" | "done">("upload");
  const [importLoading, setImportLoading] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewData | null>(null);
  const [importMapping, setImportMapping] = useState<Record<string, string>>({});
  const [importSkipNurturing, setImportSkipNurturing] = useState(false);
  const [importAutoDistribute, setImportAutoDistribute] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  // ── Bulk selection state ───────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkAssignOpen, setBulkAssignOpen] = useState(false);
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkActionPending, setBulkActionPending] = useState(false);
  const [bulkAssignTarget, setBulkAssignTarget] = useState<string>("__unassign__");

  // Non-hook computations (safe before hooks)
  const isSubAgent = user?.role === "sub_agent";
  const isCrmAuthorized = !authLoading && !!user && (!!user.isAdmin || isSubAgent);

  const params = new URLSearchParams();
  if (search)                     params.set("search",          search);
  if (status.length > 0)          params.set("status",          status.join(","));
  if (source.length > 0)          params.set("source",          source.join(","));
  if (isSubAgent && user) {
    params.set("assignedTo", String(user.id));
  } else if (assigned.length > 0) {
    params.set("assignedTo", assigned.join(","));
  }
  if (expectedMonth.length > 0)   params.set("expectedMonth",   expectedMonth.join(","));
  if (contactDate !== "all")      params.set("contactDate",     contactDate);
  if (sortBy !== "newest")        params.set("sortOrder",       "oldest");
  if (qualScore.length > 0)       params.set("qualScore",       qualScore.join(","));
  if (aiScore.length > 0)         params.set("aiScore",         aiScore.join(","));
  if (projectInterest.length > 0) params.set("projectInterest", projectInterest.join(","));
  params.set("page", String(page));
  params.set("limit", String(PAGE_SIZE));

  // ── ALL hooks before any conditional return (Rules of Hooks) ────────────
  const { data: pageData, isLoading, refetch } = useQuery<{ leads: CrmLeadWithAssignee[]; total: number; page: number; limit: number }>({
    queryKey: ["/api/admin/crm/leads", search, status.join(","), source.join(","), assigned.join(","), expectedMonth.join(","), contactDate, sortBy, qualScore.join(","), aiScore.join(","), projectInterest.join(","), page],
    queryFn: () => fetch(`/api/admin/crm/leads?${params}`).then(r => {
      if (!r.ok) throw new Error("Forbidden");
      return r.json();
    }),
    enabled: isCrmAuthorized,
  });
  const leads = pageData?.leads ?? [];
  const total = pageData?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // ── CRM stats (scoped to user's own leads for agents, global for admin) ───
  const { data: crmStats } = useQuery<{ total: number; new: number; hot: number; qualified: number; converted: number; aiHot: number; aiWarm: number; aiCold: number }>({
    queryKey: ["/api/admin/crm/stats"],
    queryFn: () => fetch("/api/admin/crm/stats").then(r => r.json()),
    enabled: isCrmAuthorized,
  });

  // ── Selection computed values ──────────────────────────────────────────────
  const allVisibleSelected = leads.length > 0 && leads.every(l => selectedIds.has(l.id));
  const someVisibleSelected = leads.some(l => selectedIds.has(l.id));

  const { data: projects = [] } = useQuery<CrmProjectOption[]>({
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
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/stats"] });
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

  // ── Lock body scroll while import modal is open ────────────────────────
  useEffect(() => {
    if (importWizardOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [importWizardOpen]);

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

  // ── Bulk selection handlers ────────────────────────────────────────────────
  function toggleSelect(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allVisibleSelected) {
      setSelectedIds(prev => { const n = new Set(prev); leads.forEach(l => n.delete(l.id)); return n; });
    } else {
      setSelectedIds(prev => { const n = new Set(prev); leads.forEach(l => n.add(l.id)); return n; });
    }
  }

  function clearSelection() { setSelectedIds(new Set()); }

  function handleExportSelected() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    window.location.href = `/api/admin/crm/leads/export-selected?ids=${ids.join(",")}`;
  }

  async function handleBulkStatus(newStatus: string) {
    setBulkActionPending(true);
    try {
      const r = await fetch("/api/admin/crm/leads/bulk-update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), status: newStatus }),
      });
      if (!r.ok) throw new Error((await r.json()).message);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/stats"] });
      toast({ title: `${selectedIds.size} lead${selectedIds.size !== 1 ? "s" : ""} updated to "${STATUS_CONFIG[newStatus]?.label ?? newStatus}"` });
      clearSelection(); setBulkStatusOpen(false);
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setBulkActionPending(false); }
  }

  async function handleBulkAssign() {
    setBulkActionPending(true);
    try {
      const agentId = bulkAssignTarget === "__unassign__" ? null : Number(bulkAssignTarget);
      const r = await fetch("/api/admin/crm/leads/bulk-update", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds), assignedTo: agentId }),
      });
      if (!r.ok) throw new Error((await r.json()).message);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/stats"] });
      const agentName = agentId ? (subAgents.find(a => a.id === agentId)?.username ?? "agent") : "unassigned";
      toast({ title: `${selectedIds.size} lead${selectedIds.size !== 1 ? "s" : ""} assigned to ${agentName}` });
      clearSelection(); setBulkAssignOpen(false); setBulkAssignTarget("__unassign__");
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setBulkActionPending(false); }
  }

  async function handleBulkDelete() {
    setBulkActionPending(true);
    try {
      const r = await fetch("/api/admin/crm/leads/bulk-delete", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      if (!r.ok) throw new Error((await r.json()).message);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/stats"] });
      toast({ title: `${selectedIds.size} lead${selectedIds.size !== 1 ? "s" : ""} deleted` });
      clearSelection(); setBulkDeleteOpen(false);
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setBulkActionPending(false); }
  }

  async function handleAssignUnassigned() {
    setAssigningUnassigned(true);
    try {
      const r = await fetch("/api/admin/crm/leads/assign-unassigned", {
        method: "POST", headers: { "Content-Type": "application/json" },
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Assignment failed");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/stats"] });
      toast({ title: data.assigned > 0 ? `${data.assigned} lead${data.assigned !== 1 ? "s" : ""} assigned` : "No unassigned leads found", description: data.message });
    } catch (e: any) { toast({ title: "Error", description: e.message, variant: "destructive" }); }
    finally { setAssigningUnassigned(false); }
  }

  async function handleImportFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFile(file);
    setImportLoading(true);
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await fetch("/api/admin/crm/leads/import/preview", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Preview failed");
      setImportPreview(data);
      setImportMapping(data.detectedMapping);
      setImportStep("preview");
    } catch (err: any) {
      toast({ title: "File analysis failed", description: err.message, variant: "destructive" });
      setImportFile(null);
    } finally {
      setImportLoading(false);
      e.target.value = "";
    }
  }

  async function handleImportConfirm() {
    if (!importPreview || !importFile) return;
    setImportLoading(true);
    const fd = new FormData();
    fd.append("file", importFile);
    fd.append("columnMapping", JSON.stringify(importMapping));
    if (importSkipNurturing)  fd.append("skipNurturing",  "true");
    if (importAutoDistribute) fd.append("autoDistribute", "true");
    try {
      const r = await fetch("/api/admin/crm/leads/import", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || "Import failed");
      setImportResult(data);
      setImportStep("done");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/leads"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/crm/stats"] });
    } catch (err: any) {
      toast({ title: "Import failed", description: err.message, variant: "destructive" });
    } finally {
      setImportLoading(false);
    }
  }

  function handleExport() {
    const a = document.createElement("a");
    a.href = "/api/admin/crm/leads/export";
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
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

  const statsTotal     = crmStats?.total     ?? 0;
  const statsNew       = crmStats?.new       ?? 0;
  const statsHot       = crmStats?.hot       ?? 0;
  const statsQual      = crmStats?.qualified ?? 0;
  const statsConverted = crmStats?.converted ?? 0;
  const statsAiHot     = crmStats?.aiHot     ?? 0;
  const statsAiWarm    = crmStats?.aiWarm    ?? 0;
  const statsAiCold    = crmStats?.aiCold    ?? 0;

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
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => refetch()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>

          {/* Export Excel — admin only */}
          {user?.isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-[#3bcac4] text-[#005476] hover:bg-[#3bcac4]/10"
              onClick={handleExport}
            >
              <Download className="h-4 w-4" /> Export Excel
            </Button>
          )}

          {/* Import File — admin only */}
          {user?.isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-[#005476] text-[#005476] hover:bg-[#005476]/10"
              onClick={() => { setImportWizardOpen(true); setImportStep("upload"); }}
            >
              <FileText className="h-4 w-4" /> Import File
            </Button>
          )}

          {/* Assign Unassigned Leads — admin only */}
          {user?.isAdmin && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 border-[#3bcac4] text-[#005476] hover:bg-[#3bcac4]/10"
              onClick={handleAssignUnassigned}
              disabled={assigningUnassigned}
            >
              {assigningUnassigned
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <UserCheck className="h-4 w-4" />}
              Assign Unassigned
            </Button>
          )}

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
                            {p.source === "property" ? (
                              <span className="text-xs text-[#3bcac4]">synced</span>
                            ) : (
                              <>
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
          { label: isSubAgent ? "My Leads"     : "Total Leads", value: statsTotal,     icon: Users,     color: "from-[#3bcac4] to-[#005476]" },
          { label: isSubAgent ? "My New Leads" : "New Leads",   value: statsNew,       icon: Plus,      color: "from-blue-400 to-blue-600" },
          { label: isSubAgent ? "My Hot Leads" : "Hot Leads",   value: statsHot,       icon: Flame,     color: "from-red-400 to-red-600" },
          { label: isSubAgent ? "My Qualified" : "Converted",   value: isSubAgent ? statsQual : statsConverted, icon: UserCheck, color: "from-green-400 to-green-600" },
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

      {/* AI Score Stats */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        {[
          { label: "🔥 AI Hot",  value: statsAiHot,  cls: "from-orange-400 to-red-500",    filter: "HOT"  },
          { label: "🟡 AI Warm", value: statsAiWarm, cls: "from-amber-400 to-yellow-500",  filter: "WARM" },
          { label: "❄️ AI Cold", value: statsAiCold, cls: "from-sky-400 to-blue-500",      filter: "COLD" },
        ].map(({ label, value, cls, filter: f }) => (
          <button
            key={f}
            onClick={() => setAiScore(aiScore === f ? "all" : f)}
            className={`text-left transition-all rounded-xl border-2 ${aiScore === f ? "border-[#3bcac4] ring-2 ring-[#3bcac4]/20" : "border-transparent"}`}
          >
            <Card className="border-0 shadow-sm">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs text-muted-foreground">{label}</p>
                    <p className="text-xl font-bold text-[#005476]">{value}</p>
                  </div>
                  <div className={`p-2 rounded-lg bg-gradient-to-br ${cls}`}>
                    <Bot className="h-4 w-4 text-white" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </button>
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
            <MultiSelectFilter
              label="Status"
              options={STATUSES.map(s => ({ label: STATUS_CONFIG[s].label, value: s }))}
              selected={status}
              onChange={setStatus}
              width="w-44"
            />
            <MultiSelectFilter
              label="Source"
              options={SOURCES.map(s => ({ label: SOURCE_LABELS[s], value: s }))}
              selected={source}
              onChange={setSource}
              width="w-36"
            />
            {!isSubAgent && (
              <MultiSelectFilter
                label="Agent"
                options={[
                  { label: "Unassigned", value: "unassigned" },
                  ...subAgents.map(a => ({ label: a.username, value: String(a.id) })),
                ]}
                selected={assigned}
                onChange={setAssigned}
                width="w-44"
              />
            )}
            <MultiSelectFilter
              label="Month"
              options={[
                { label: "Not specified", value: "not_specified" },
                ...FILTER_MONTHS.map(m => ({ label: m, value: m })),
              ]}
              selected={expectedMonth}
              onChange={setExpectedMonth}
              width="w-44"
            />
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
            <MultiSelectFilter
              label="WA Score"
              options={[
                { label: "⭐ VIP", value: "vip" },
                { label: "🔥 Hot", value: "hot" },
                { label: "🌡️ Warm", value: "warm" },
                { label: "❄️ Cold", value: "cold" },
                { label: "⏳ In Progress", value: "in_progress" },
                { label: "— Not qualified", value: "none" },
              ]}
              selected={qualScore}
              onChange={setQualScore}
              width="w-44"
            />
            <MultiSelectFilter
              label="AI Score"
              options={[
                { label: "🔥 AI HOT", value: "HOT" },
                { label: "🟡 AI WARM", value: "WARM" },
                { label: "❄️ AI COLD", value: "COLD" },
                { label: "— Not scored", value: "none" },
              ]}
              selected={aiScore}
              onChange={setAiScore}
              width="w-40"
            />
            <MultiSelectFilter
              label="Projects"
              options={projects
                .filter(p => p.isActive)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(p => ({ label: p.name, value: p.name }))
              }
              selected={projectInterest}
              onChange={setProjectInterest}
              width="w-48"
            />
          </div>
        </CardContent>
      </Card>

      {/* Bulk Action Toolbar */}
      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-3 px-4 py-3 rounded-xl bg-[#005476] text-white shadow-md">
          <span className="text-sm font-semibold shrink-0">
            {selectedIds.size} lead{selectedIds.size !== 1 ? "s" : ""} selected
          </span>
          <div className="flex flex-wrap gap-2 ml-auto items-center">
            <button
              onClick={toggleSelectAll}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors font-medium"
            >
              {allVisibleSelected ? "Deselect Page" : "Select Page"}
            </button>
            <button
              onClick={clearSelection}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors font-medium"
            >
              Clear
            </button>
            <button
              onClick={handleExportSelected}
              className="text-xs px-3 py-1.5 rounded-lg bg-[#3bcac4] hover:bg-[#2db0aa] text-[#005476] font-semibold transition-colors flex items-center gap-1"
            >
              <Download className="h-3.5 w-3.5" /> Export
            </button>
            <button
              onClick={() => setBulkStatusOpen(true)}
              className="text-xs px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors font-medium"
            >
              Change Status
            </button>
            {user?.isAdmin && (
              <button
                onClick={() => setBulkAssignOpen(true)}
                className="text-xs px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 transition-colors font-medium"
              >
                Assign Agent
              </button>
            )}
            {user?.isAdmin && (
              <button
                onClick={() => setBulkDeleteOpen(true)}
                className="text-xs px-3 py-1.5 rounded-lg bg-red-500 hover:bg-red-600 transition-colors font-semibold flex items-center gap-1"
              >
                <Trash2 className="h-3.5 w-3.5" /> Delete
              </button>
            )}
          </div>
        </div>
      )}

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
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        ref={el => { if (el) el.indeterminate = someVisibleSelected && !allVisibleSelected; }}
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        className="h-4 w-4 cursor-pointer accent-[#005476] rounded"
                        aria-label="Select all visible leads"
                      />
                    </th>
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
                      className={`border-b last:border-0 hover:bg-[#3bcac4]/5 cursor-pointer transition-colors ${selectedIds.has(lead.id) ? "bg-[#3bcac4]/10" : ""}`}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("a")) return;
                        if ((e.target as HTMLElement).closest("[data-bulk-check]")) return;
                        navigate(leadHref);
                      }}
                    >
                      <td className="px-4 py-3 w-10" data-bulk-check onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(lead.id)}
                          onChange={() => toggleSelect(lead.id)}
                          className="h-4 w-4 cursor-pointer accent-[#005476] rounded"
                          aria-label={`Select ${lead.fullName ?? lead.firstName ?? "lead"}`}
                        />
                      </td>
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
                        <div className="flex flex-col gap-1">
                          <StatusBadge status={lead.status} />
                          <WaStageBadge stage={(lead as any).waStage} />
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <ScoreBadge score={lead.leadScore} />
                        {(() => {
                          const qs = (lead as any).qualification_score as string | null;
                          const qst = (lead as any).qualification_status as string | null;
                          if (!qs && qst !== "in_progress") return null;
                          const cfg: Record<string, { label: string; cls: string }> = {
                            vip:  { label: "VIP",  cls: "bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white" },
                            hot:  { label: "Hot",  cls: "bg-red-100 text-red-700 border border-red-200" },
                            warm: { label: "Warm", cls: "bg-amber-100 text-amber-700 border border-amber-200" },
                            cold: { label: "Cold", cls: "bg-sky-100 text-sky-700 border border-sky-200" },
                          };
                          if (qst === "in_progress") return (
                            <span className="mt-1 flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[#3bcac4]/10 text-[#005476] border border-[#3bcac4]/30 w-fit">
                              <SiWhatsapp className="h-2.5 w-2.5" /> Qual…
                            </span>
                          );
                          const c = cfg[qs ?? ""] ?? { label: qs ?? "", cls: "bg-gray-100 text-gray-600" };
                          return (
                            <span className={`mt-1 flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full w-fit font-medium ${c.cls}`}>
                              <SiWhatsapp className="h-2.5 w-2.5" /> {c.label}
                            </span>
                          );
                        })()}
                        {(() => {
                          const aiCat = (lead as any).ai_score_category as string | null;
                          const aiVal = (lead as any).ai_score as number | null;
                          if (!aiCat) return null;
                          const aiCfg: Record<string, { emoji: string; cls: string }> = {
                            HOT:  { emoji: "🔥", cls: "bg-orange-100 text-orange-700 border border-orange-200" },
                            WARM: { emoji: "🟡", cls: "bg-amber-100 text-amber-700 border border-amber-200"   },
                            COLD: { emoji: "❄️", cls: "bg-sky-100 text-sky-700 border border-sky-200"         },
                          };
                          const ac = aiCfg[aiCat] ?? { emoji: "🤖", cls: "bg-gray-100 text-gray-600" };
                          return (
                            <span className={`mt-1 flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full w-fit font-medium ${ac.cls}`}>
                              <Bot className="h-2.5 w-2.5" /> {ac.emoji} AI {aiCat}{aiVal != null ? ` ${aiVal}` : ""}
                            </span>
                          );
                        })()}
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

      {/* Bulk Status Modal */}
      <Dialog open={bulkStatusOpen} onOpenChange={v => { if (!bulkActionPending) setBulkStatusOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#005476]">Change Status</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-3">
            Select a new status for <span className="font-semibold text-[#005476]">{selectedIds.size} lead{selectedIds.size !== 1 ? "s" : ""}</span>:
          </p>
          <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
              <button
                key={key}
                disabled={bulkActionPending}
                onClick={() => handleBulkStatus(key)}
                className="w-full text-left px-4 py-2.5 hover:bg-[#3bcac4]/10 transition-colors flex items-center justify-between disabled:opacity-50"
              >
                <StatusBadge status={key} />
                {bulkActionPending && <Loader2 className="h-3.5 w-3.5 animate-spin text-[#3bcac4]" />}
              </button>
            ))}
          </div>
          <div className="flex justify-end pt-1">
            <Button variant="outline" size="sm" onClick={() => setBulkStatusOpen(false)} disabled={bulkActionPending}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Assign Modal */}
      <Dialog open={bulkAssignOpen} onOpenChange={v => { if (!bulkActionPending) setBulkAssignOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-[#005476]">Assign Agent</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-3">
            Assign <span className="font-semibold text-[#005476]">{selectedIds.size} lead{selectedIds.size !== 1 ? "s" : ""}</span> to:
          </p>
          <Select value={bulkAssignTarget} onValueChange={setBulkAssignTarget}>
            <SelectTrigger className="border-[#3bcac4]/50 focus:ring-[#3bcac4]">
              <SelectValue placeholder="Select agent..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassign__">— Unassign —</SelectItem>
              {subAgents.map(a => (
                <SelectItem key={a.id} value={String(a.id)}>{a.username}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={() => setBulkAssignOpen(false)} disabled={bulkActionPending}>Cancel</Button>
            <Button
              size="sm"
              className="bg-gradient-to-r from-[#3bcac4] to-[#005476]"
              onClick={handleBulkAssign}
              disabled={bulkActionPending}
            >
              {bulkActionPending && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Assign
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation Modal */}
      <Dialog open={bulkDeleteOpen} onOpenChange={v => { if (!bulkActionPending) setBulkDeleteOpen(v); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <Trash2 className="h-5 w-5" /> Delete Leads
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-1">
            <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-700">
              You are about to permanently delete{" "}
              <span className="font-bold">{selectedIds.size} lead{selectedIds.size !== 1 ? "s" : ""}</span>.
              This action <span className="font-bold">cannot be undone</span>.
            </div>
            <p className="text-sm text-muted-foreground">All associated notes and tasks for these leads will also be removed.</p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setBulkDeleteOpen(false)} disabled={bulkActionPending}>Cancel</Button>
              <Button
                size="sm"
                className="bg-red-600 hover:bg-red-700 text-white"
                onClick={handleBulkDelete}
                disabled={bulkActionPending}
              >
                {bulkActionPending ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Trash2 className="h-3.5 w-3.5 mr-1.5" />}
                Delete {selectedIds.size} Lead{selectedIds.size !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Import Wizard ─────────────────────────────────────────────────── */}
      <Dialog
        open={importWizardOpen}
        onOpenChange={v => {
          if (!v && !importLoading) {
            setImportWizardOpen(false);
            setImportStep("upload");
            setImportPreview(null);
            setImportFile(null);
            setImportResult(null);
            setImportMapping({});
            setImportSkipNurturing(false);
            setImportAutoDistribute(false);
          }
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 pt-6 pb-4 flex-shrink-0 border-b">
            <DialogTitle className="text-[#005476] flex items-center gap-2">
              {importStep === "upload"  && <><FileText className="h-5 w-5 text-[#3bcac4]" /> Import Leads</>}
              {importStep === "preview" && <><Upload className="h-5 w-5 text-[#3bcac4]" /> Column Mapping &amp; Preview</>}
              {importStep === "done"    && <><CheckCircle2 className="h-5 w-5 text-[#3bcac4]" /> Import Complete</>}
            </DialogTitle>
          </DialogHeader>

          {/* ── Scrollable content area ── */}
          <div className="flex-1 overflow-y-auto min-h-0 px-6 py-4">

          {/* ── Step 1: Upload ── */}
          {importStep === "upload" && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload an Excel (.xlsx, .xls) or CSV file. The system will auto-detect column names in English or Arabic.
              </p>
              {importLoading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-10 w-10 animate-spin text-[#3bcac4]" />
                  <p className="text-sm text-muted-foreground">Analysing file and mapping columns…</p>
                </div>
              ) : (
                <div
                  className="border-2 border-dashed border-[#3bcac4]/40 rounded-xl p-12 text-center cursor-pointer hover:border-[#3bcac4]/70 hover:bg-[#3bcac4]/5 transition-colors"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="h-10 w-10 text-[#3bcac4]/50 mx-auto mb-3" />
                  <p className="text-sm font-medium text-[#005476] mb-1">Click to choose a file</p>
                  <p className="text-xs text-muted-foreground">Supports .xlsx · .xls · .csv — max 10 MB</p>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={handleImportFileSelect}
              />
            </div>
          )}

          {/* ── Step 2: Preview + Mapping ── */}
          {importStep === "preview" && importPreview && (
            <div className="space-y-4">
              {/* Stats row */}
              <div className="grid grid-cols-5 gap-2">
                {[
                  { label: "Total",       value: importPreview.stats.total,               cls: "bg-gray-50 text-[#005476]" },
                  { label: "With Phone",  value: importPreview.stats.withPhone,            cls: "bg-[#3bcac4]/10 text-[#005476]" },
                  { label: "With Email",  value: importPreview.stats.withEmail,            cls: "bg-blue-50 text-blue-700" },
                  { label: "No Contact",  value: importPreview.stats.withNeither,          cls: "bg-red-50 text-red-700" },
                  { label: "Duplicates",  value: importPreview.stats.estimatedDuplicates,  cls: "bg-amber-50 text-amber-700" },
                ].map(({ label, value, cls }) => (
                  <div key={label} className={`rounded-lg border p-2 text-center ${cls}`}>
                    <p className="text-xs font-medium opacity-70">{label}</p>
                    <p className="text-xl font-bold mt-0.5">{value}</p>
                  </div>
                ))}
              </div>

              {/* Warnings */}
              {importPreview.warnings.length > 0 && (
                <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 space-y-1">
                  {importPreview.warnings.map((w, i) => (
                    <p key={i} className="text-xs text-amber-700 flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> {w}
                    </p>
                  ))}
                </div>
              )}

              {/* Column mapping */}
              <div>
                <p className="text-sm font-semibold text-[#005476] mb-2">Column Mapping</p>
                <div className="border rounded-lg overflow-hidden">
                  <div className="grid grid-cols-2 bg-[#005476]/5 border-b px-3 py-2">
                    <p className="text-xs font-semibold text-[#005476]">Excel / CSV Column</p>
                    <p className="text-xs font-semibold text-[#005476]">Maps To</p>
                  </div>
                  <div className="divide-y max-h-64 overflow-y-auto">
                    {importPreview.headers.map(header => (
                      <div key={header} className="grid grid-cols-2 items-center px-3 py-1.5 hover:bg-gray-50/60 gap-2">
                        <p className="text-xs font-mono text-gray-700 truncate" title={header}>{header}</p>
                        <Select
                          value={importMapping[header] ?? "(skip)"}
                          onValueChange={v => setImportMapping(m => ({ ...m, [header]: v }))}
                        >
                          <SelectTrigger className="h-7 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(CRM_FIELD_LABELS).map(([val, label]) => (
                              <SelectItem key={val} value={val} className="text-xs">{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Enriched preview rows */}
              {importPreview.previewRows && importPreview.previewRows.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-[#005476] mb-2">Data Preview (first {importPreview.previewRows.length} rows)</p>
                  <div className="border rounded-lg overflow-x-auto">
                    <table className="w-full text-xs min-w-[640px]">
                      <thead className="bg-[#005476]/5 border-b">
                        <tr>
                          {["Phone → Normalized","Lead Owner → Agent","Status → Mapped","Budget → Parsed","Project","Purchase Month"].map(h => (
                            <th key={h} className="px-2 py-1.5 text-left font-semibold text-[#005476] whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {importPreview.previewRows.map((pr, i) => (
                          <tr key={i} className="hover:bg-gray-50/60">
                            <td className="px-2 py-1.5 font-mono">
                              {pr.originalPhone && pr.normalizedPhone !== pr.originalPhone
                                ? <span>{pr.originalPhone} <span className="text-[#3bcac4] font-bold">→</span> {pr.normalizedPhone}</span>
                                : <span>{pr.normalizedPhone || <span className="text-gray-400">—</span>}</span>}
                            </td>
                            <td className="px-2 py-1.5">
                              {pr.excelAgent
                                ? <span>{pr.excelAgent} <span className="text-[#3bcac4] font-bold">→</span> <span className={pr.matchedAgent.startsWith("⚠") ? "text-amber-600" : "text-[#005476] font-medium"}>{pr.matchedAgent}</span></span>
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-2 py-1.5">
                              {pr.excelStatus
                                ? <span>{pr.excelStatus} <span className="text-[#3bcac4] font-bold">→</span> <span className="text-[#005476] font-medium">{pr.mappedStatus}</span></span>
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-2 py-1.5">
                              {pr.rawBudget
                                ? <span>{pr.rawBudget} <span className="text-[#3bcac4] font-bold">→</span> <span className="text-[#005476] font-medium">{pr.parsedBudget || pr.rawBudget}</span></span>
                                : <span className="text-gray-400">—</span>}
                            </td>
                            <td className="px-2 py-1.5 text-[#005476]">{pr.projectInterest || <span className="text-gray-400">—</span>}</td>
                            <td className="px-2 py-1.5 text-[#005476]">{pr.expectedPurchaseMonth || <span className="text-gray-400">—</span>}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Options */}
              <div className="space-y-2">
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-[#3bcac4]/5 border border-[#3bcac4]/20">
                  <input
                    type="checkbox"
                    id="autoDistribute"
                    className="h-4 w-4 accent-[#3bcac4]"
                    checked={importAutoDistribute}
                    onChange={e => setImportAutoDistribute(e.target.checked)}
                  />
                  <label htmlFor="autoDistribute" className="text-sm text-gray-700 cursor-pointer select-none">
                    Auto-distribute leads when no Lead Owner is set (round-robin)
                  </label>
                </div>
                <div className="flex items-center gap-2.5 p-3 rounded-lg bg-[#3bcac4]/5 border border-[#3bcac4]/20">
                  <input
                    type="checkbox"
                    id="skipNurturing"
                    className="h-4 w-4 accent-[#3bcac4]"
                    checked={importSkipNurturing}
                    onChange={e => setImportSkipNurturing(e.target.checked)}
                  />
                  <label htmlFor="skipNurturing" className="text-sm text-gray-700 cursor-pointer select-none">
                    Do not start Email Nurturing for imported leads
                  </label>
                </div>
              </div>

            </div>
          )}

          {/* ── Step 3: Result ── */}
          {importStep === "done" && importResult && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border p-3 bg-gray-50">
                  <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Rows</p>
                  <p className="text-2xl font-bold text-[#005476] mt-0.5">{importResult.total}</p>
                </div>
                <div className="rounded-lg border p-3 bg-[#3bcac4]/10 border-[#3bcac4]/40">
                  <p className="text-xs font-medium uppercase tracking-wide text-[#005476]">Imported</p>
                  <p className="text-2xl font-bold text-[#005476] mt-0.5 flex items-center gap-1.5">
                    <CheckCircle2 className="h-5 w-5 text-[#3bcac4]" /> {importResult.imported}
                  </p>
                </div>
                <div className="rounded-lg border p-3 bg-amber-50 border-amber-200">
                  <p className="text-xs text-amber-700 font-medium uppercase tracking-wide">Duplicates Skipped</p>
                  <p className="text-2xl font-bold text-amber-700 mt-0.5 flex items-center gap-1.5">
                    <AlertCircle className="h-5 w-5" /> {importResult.duplicates}
                  </p>
                </div>
                <div className="rounded-lg border p-3 bg-red-50 border-red-200">
                  <p className="text-xs text-red-700 font-medium uppercase tracking-wide">Failed / Skipped</p>
                  <p className="text-2xl font-bold text-red-700 mt-0.5 flex items-center gap-1.5">
                    <XCircle className="h-5 w-5" /> {importResult.failed}
                  </p>
                </div>
              </div>
              {importResult.failedRows.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-[#005476]">
                    Failed / Skipped Rows ({importResult.failedRows.length})
                  </p>
                  <div className="max-h-40 overflow-y-auto rounded-lg border bg-gray-50 divide-y text-xs">
                    {importResult.failedRows.map((fr, i) => (
                      <div key={i} className="flex items-start gap-2 px-3 py-2">
                        <span className="font-mono text-muted-foreground whitespace-nowrap">Row {fr.row}</span>
                        <span className="text-gray-700">{fr.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          </div>{/* ── end scrollable content ── */}

          {/* ── Fixed footer — always visible ── */}
          <div className="flex-shrink-0 px-6 py-4 border-t bg-background">
            {importStep === "preview" && importPreview && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1"
                  disabled={importLoading}
                  onClick={() => { setImportStep("upload"); setImportPreview(null); setImportFile(null); }}
                >
                  ← Back
                </Button>
                <Button
                  className="flex-1 bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                  disabled={importLoading}
                  onClick={handleImportConfirm}
                >
                  {importLoading
                    ? <><Loader2 className="h-4 w-4 animate-spin mr-2" /> Importing…</>
                    : <>Import {Math.max(0, importPreview.stats.total - importPreview.stats.withNeither - importPreview.stats.estimatedDuplicates)} Lead{importPreview.stats.total !== 1 ? "s" : ""} →</>
                  }
                </Button>
              </div>
            )}
            {importStep === "done" && (
              <Button
                className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476]"
                onClick={() => {
                  setImportWizardOpen(false);
                  setImportStep("upload");
                  setImportResult(null);
                  setImportPreview(null);
                  setImportFile(null);
                  setImportMapping({});
                  setImportSkipNurturing(false);
                  setImportAutoDistribute(false);
                }}
              >
                Done
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
