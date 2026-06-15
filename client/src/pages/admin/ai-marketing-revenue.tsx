import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  TrendingUp, Link2, ShoppingCart, BookOpen, Lightbulb, Plus, Trash2,
  Pencil, DollarSign, Flame, Thermometer, Snowflake, PhoneOff,
  UserCheck, Calendar, Globe, Info, AlertTriangle, CheckCircle2,
  BarChart3, Target, Activity, Building2, Megaphone, TrendingDown, Layers, RefreshCw,
  Sparkles, ArrowUpRight, ArrowDownRight, Minus, Wand2, FileText, Save, X,
  LayoutTemplate, Shield, Users, ClipboardList, ChevronDown, ChevronRight, BadgeCheck, XCircle,
  Library, Tag, Ban, ToggleLeft, ToggleRight,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Attribution {
  id: number; lead_id: number; source_type: string;
  meta_campaign_name: string | null; meta_adset_name: string | null; meta_ad_name: string | null;
  creative_name: string | null; audience_name: string | null;
  language: string | null; country: string | null; city: string | null;
  notes: string | null; created_at: string;
}
interface SalesOutcome {
  id: number; lead_id: number; appointment_scheduled: boolean; appointment_date: string | null;
  site_visit_completed: boolean; sale_closed: boolean; sale_amount: number;
  sale_currency: string; sale_date: string | null; notes: string | null; updated_at: string;
}
interface LearningHistory {
  id: number; entity_type: string; entity_name: string; entity_id: string | null;
  leads_count: number; hot_count: number; warm_count: number; cold_count: number;
  no_answer_count: number; appointments_count: number; sales_count: number;
  revenue_total: number; spend: number; cpl: number; cost_per_hot_lead: number;
  cost_per_appointment: number; cost_per_sale: number; quality_score: number;
  period_start: string | null; period_end: string | null; updated_at: string;
}
interface RevDashboard {
  attribution_by_source: { source_type: string; cnt: number }[];
  totals: { total_leads_attributed: number; appointments: number; site_visits: number; sales: number; revenue: number };
  learning_history: LearningHistory[];
}
interface RevRec {
  type: string; title: string; message: string; severity: string; entity: string;
}
interface CampaignRow {
  name: string; entityId: string | null;
  leadsCount: number; hotLeads: number; warmLeads: number; coldLeads: number;
  noAnswerCount: number; appointmentsCount: number; salesCount: number; revenueTotal: number;
}
interface CampaignAttribution {
  byCampaign: CampaignRow[]; byAdset: CampaignRow[]; byAd: CampaignRow[];
  revenueEnabled: boolean;
}
interface CostRow {
  entityType: string; entityName: string;
  leadsCount: number; hotCount: number; warmCount: number; coldCount: number; noAnswerCount: number;
  spend: number;
  cpl: number | null; costPerHotLead: number | null; costPerWarmLead: number | null;
  costPerColdLead: number | null; costPerNoAnswer: number | null; qualityScore: number | null;
}
interface CostIntelligence {
  insufficient: boolean; allRows: CostRow[];
  bestCphl: CostRow | null; worstCphl: CostRow | null; bestCpl: CostRow | null;
  highestNoAnswerCost: CostRow | null; bestQuality: CostRow | null; worstQuality: CostRow | null;
}
interface StrategyInsight {
  type: string; title: string; description: string; evidence: string;
  confidence: "low" | "medium" | "high"; dataPoints: number;
}
interface StrategyTrend { hotRate: number; leadsCount: number; trend: "improving" | "declining" | "stable"; }
interface StrategyData {
  insufficient: boolean; insights: StrategyInsight[];
  trends: { last7d: StrategyTrend; last30d: StrategyTrend; last90d: StrategyTrend } | null;
}
interface CreativeRow {
  id: number; creativeId: string | null; creativeName: string | null;
  adId: string; adName: string | null;
  adsetId: string | null; adsetName: string | null;
  campaignId: string | null; campaignName: string | null;
  thumbnailUrl: string | null; status: string | null; lastSyncedAt: string | null;
  totalLeads: number; hotLeads: number; warmLeads: number; coldLeads: number;
}
interface CreativeData {
  rows: CreativeRow[];
  summary: { totalAds: number; uniqueCreatives: number; campaigns: number; attributionCount: number };
}
interface BackfillResult {
  ok: boolean; scanned: number; inserted: number; skipped: number; error?: string;
}
interface CreativeIntelRow {
  id: number; creativeId: string | null; creativeName: string | null;
  adId: string; adName: string | null; adsetName: string | null; campaignName: string | null;
  thumbnailUrl: string | null; status: string | null;
  totalLeads: number; hotLeads: number; warmLeads: number; coldLeads: number; noAnswerLeads: number;
  qualityScore: number; qualityScoreNorm: number; hotRate: number; noAnswerRate: number;
  confidence: "low" | "medium" | "high";
  leads7d: number; hot7d: number; leads30d: number; hot30d: number; leads90d: number; hot90d: number;
  trend7d: "improving" | "declining" | "stable";
  trend30d: "improving" | "declining" | "stable";
  trend90d: "improving" | "declining" | "stable";
}
interface CreativeInsight {
  type: string; title: string; metricLabel: string; metricValue: string;
  creativeName: string; campaignName: string;
  totalLeads: number; hotLeads: number; warmLeads: number; coldLeads: number; noAnswerLeads: number;
  qualityScore: number; qualityScoreNorm: number; hotRate: number; noAnswerRate: number;
  confidence: "low" | "medium" | "high"; evidence: string;
}
interface CreativeIntelData {
  insufficient: boolean;
  creatives: CreativeIntelRow[];
  insights: CreativeInsight[];
  formula: { hot: number; warm: number; cold: number; noAnswer: number; description: string; normalized: string; confidence: string };
  headline: null; copy: null; cta: null;
}
interface DraftInput {
  project_name: string; target_market: string; language: string; goal: string; draft_types: string[];
}
interface GeneratedDraft {
  draft_type: string; draft_text: string; inspiration_source: string;
  quality_reason: string; confidence_level: string;
  project_name: string; target_market: string; language: string; goal: string;
}
interface SavedDraft {
  id: number; draft_type: string; project_name: string | null; target_market: string | null;
  language: string | null; draft_text: string; inspiration_source: string | null;
  quality_reason: string | null; goal: string | null; confidence_level: string;
  status: string; created_by: string; created_at: string; updated_at: string;
}
interface CampaignDraftInput {
  project_name: string; target_market: string; language: string; goal: string;
  daily_budget_amount: string; daily_budget_currency: string;
  country: string; city_region: string; age_min: string; age_max: string; audience_notes: string;
}
interface GeneratedCampaignDraft {
  campaign_name: string; strategy_reason: string; confidence_level: string;
  safety_warnings: string[];
  adset: { adset_name: string; interests: string[]; exclusions: string[]; placement_notes: string; budget_notes: string };
  audience: { audience_name: string; age_range: string; interests: string[]; exclusions: string[]; quality_reason: string };
  lead_form: { form_name: string; intro_text: string; questions: { text: string; type: string }[]; privacy_note: string; qualification_goal: string };
  project_name: string; target_market: string; language: string; goal: string;
  daily_budget_amount: string; daily_budget_currency: string;
  country: string; city_region: string; age_min: string; age_max: string;
}
interface SafetyChecks {
  no_roi_promise: boolean; no_guaranteed_return: boolean; no_fake_price: boolean;
  no_discriminatory: boolean; no_sensitive_data: boolean; draft_only: boolean;
}
interface SavedCampaignDraft {
  id: number; campaign_name: string; project_name: string | null; target_market: string | null;
  language: string | null; objective: string; daily_budget_amount: string | null;
  daily_budget_currency: string | null; goal: string | null; status: string;
  strategy_reason: string | null; confidence_level: string; created_by: string;
  created_at: string; updated_at: string;
}
interface MarketingProfile {
  id: number; project_id: number | null; internal_project_name: string;
  marketing_alias: string | null; use_real_project_name: boolean;
  project_type: string | null; location: string | null;
  short_marketing_description: string | null; long_marketing_description: string | null;
  luxury_level: string | null; target_investor_type: string | null;
  target_buyer_type: string | null; confidence_notes: string | null;
  status: string; created_at: string; updated_at: string;
  angles_count?: number; markets_count?: number; claims_count?: number;
}
interface MarketingAngle {
  id: number; profile_id: number; angle_name: string;
  angle_description: string | null; priority: number; enabled: boolean;
}
interface TargetMarket {
  id: number; profile_id: number; market_name: string;
  language: string | null; notes: string | null;
}
interface ForbiddenClaim { id: number; profile_id: number; claim_text: string; }
interface ProfileDetail {
  ok: boolean; profile: MarketingProfile;
  angles: MarketingAngle[]; markets: TargetMarket[]; claims: ForbiddenClaim[];
}

// ── Inner sub-tabs ─────────────────────────────────────────────────────────────

const SUB_TABS = [
  { key: "dashboard",   label: "Dashboard",           Icon: BarChart3 },
  { key: "campaign",    label: "Campaign Attribution", Icon: Megaphone },
  { key: "attribution", label: "Lead Attribution",     Icon: Link2 },
  { key: "sales",       label: "Sales Outcomes",       Icon: ShoppingCart },
  { key: "learning",    label: "Learning History",     Icon: BookOpen },
  { key: "recrules",    label: "AI Recommendations",   Icon: Lightbulb },
  { key: "costintel",   label: "Cost Intelligence",    Icon: Target },
  { key: "strategy",    label: "AI Strategy",          Icon: TrendingUp },
  { key: "creative",    label: "Creative Attribution",  Icon: Layers },
  { key: "creativeint",  label: "Creative Intelligence", Icon: Sparkles },
  { key: "creativedraft",  label: "AI Draft Generator",    Icon: Wand2          },
  { key: "campaigndraft",  label: "Campaign Draft Builder",   Icon: LayoutTemplate },
  { key: "knowledgebase",  label: "Marketing Knowledge",      Icon: Library        },
] as const;
type SubTabKey = typeof SUB_TABS[number]["key"];

function fmt(v: number | null | undefined, prefix = "", suffix = "") {
  if (v == null || Number(v) === 0) return "—";
  return prefix + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) + suffix;
}

const SEV_CLS: Record<string, string> = {
  positive: "border-green-300 bg-green-50",
  info:     "border-teal-200 bg-teal-50",
  warning:  "border-yellow-300 bg-yellow-50",
  critical: "border-red-300 bg-red-50",
};
const SEV_ICON: Record<string, typeof Info> = {
  positive: CheckCircle2, info: Info, warning: AlertTriangle, critical: AlertTriangle,
};
const SEV_ICON_CLS: Record<string, string> = {
  positive: "text-green-600", info: "text-[#3bcac4]", warning: "text-yellow-600", critical: "text-red-500",
};

const ENTITY_TYPES = ["campaign", "adset", "ad", "creative", "audience", "country", "language", "project"];
const SOURCE_TYPES  = ["meta_lead", "manual", "excel_import", "website", "whatsapp", "other"];

// ── Component ─────────────────────────────────────────────────────────────────

export default function RevenueIntelligence() {
  const [sub, setSub] = useState<SubTabKey>("dashboard");
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Dashboard ───────────────────────────────────────────────────────────────
  const { data: dash, isLoading: dashLoading } = useQuery<RevDashboard>({
    queryKey: ["/api/admin/ai-marketing/revenue-dashboard"],
    enabled: sub === "dashboard",
  });

  // ── Campaign Attribution ─────────────────────────────────────────────────
  const [campView, setCampView] = useState<"campaign" | "adset" | "ad">("campaign");
  const { data: campAttrib, isLoading: campLoading } = useQuery<CampaignAttribution>({
    queryKey: ["/api/admin/ai-marketing/campaign-attribution"],
    enabled: sub === "campaign",
  });

  // ── Attribution ─────────────────────────────────────────────────────────────
  const [attribDialog, setAttribDialog] = useState(false);
  const [editAttrib, setEditAttrib] = useState<Attribution | null>(null);
  const [attribForm, setAttribForm] = useState({
    lead_id: "", source_type: "meta_lead", meta_campaign_name: "", meta_adset_name: "",
    meta_ad_name: "", creative_name: "", audience_name: "", language: "", country: "", city: "", notes: "",
  });

  const { data: attribs = [], isLoading: attribLoading } = useQuery<Attribution[]>({
    queryKey: ["/api/admin/ai-marketing/attribution"],
    enabled: sub === "attribution",
  });

  const saveAttribMutation = useMutation({
    mutationFn: (body: object) => editAttrib
      ? apiRequest("PATCH", `/api/admin/ai-marketing/attribution/${editAttrib.id}`, body)
      : apiRequest("POST", "/api/admin/ai-marketing/attribution", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/attribution"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/revenue-dashboard"] });
      setAttribDialog(false); setEditAttrib(null);
      toast({ title: editAttrib ? "Attribution updated" : "Attribution logged" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteAttribMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/ai-marketing/attribution/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/attribution"] }),
  });

  function openNewAttrib() {
    setEditAttrib(null);
    setAttribForm({ lead_id: "", source_type: "meta_lead", meta_campaign_name: "", meta_adset_name: "", meta_ad_name: "", creative_name: "", audience_name: "", language: "", country: "", city: "", notes: "" });
    setAttribDialog(true);
  }
  function openEditAttrib(a: Attribution) {
    setEditAttrib(a);
    setAttribForm({
      lead_id: String(a.lead_id), source_type: a.source_type, meta_campaign_name: a.meta_campaign_name || "",
      meta_adset_name: a.meta_adset_name || "", meta_ad_name: a.meta_ad_name || "",
      creative_name: a.creative_name || "", audience_name: a.audience_name || "",
      language: a.language || "", country: a.country || "", city: a.city || "", notes: a.notes || "",
    });
    setAttribDialog(true);
  }

  // ── Sales Outcomes ──────────────────────────────────────────────────────────
  const [salesDialog, setSalesDialog] = useState(false);
  const [salesForm, setSalesForm] = useState({
    lead_id: "", appointment_scheduled: false, appointment_date: "", site_visit_completed: false,
    sale_closed: false, sale_amount: "", sale_currency: "USD", sale_date: "", notes: "",
  });

  const { data: sales = [], isLoading: salesLoading } = useQuery<SalesOutcome[]>({
    queryKey: ["/api/admin/ai-marketing/sales-outcomes"],
    enabled: sub === "sales",
  });

  const saveSalesMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/admin/ai-marketing/sales-outcomes", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/sales-outcomes"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/revenue-dashboard"] });
      setSalesDialog(false);
      toast({ title: "Sales outcome saved" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteSalesMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/ai-marketing/sales-outcomes/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/sales-outcomes"] }),
  });

  // ── Learning History ────────────────────────────────────────────────────────
  const [learningDialog, setLearningDialog] = useState(false);
  const [editLearning, setEditLearning] = useState<LearningHistory | null>(null);
  const [learningForm, setLearningForm] = useState({
    entity_type: "campaign", entity_name: "", entity_id: "",
    leads_count: "", hot_count: "", warm_count: "", cold_count: "", no_answer_count: "",
    appointments_count: "", sales_count: "", revenue_total: "", spend: "", cpl: "",
    cost_per_hot_lead: "", cost_per_appointment: "", cost_per_sale: "", quality_score: "",
    period_start: "", period_end: "",
  });
  const [entityTypeFilter, setEntityTypeFilter] = useState("all");

  const { data: learning = [], isLoading: learningLoading } = useQuery<LearningHistory[]>({
    queryKey: ["/api/admin/ai-marketing/learning-history", entityTypeFilter],
    queryFn: () => {
      const url = entityTypeFilter !== "all"
        ? `/api/admin/ai-marketing/learning-history?entity_type=${entityTypeFilter}`
        : "/api/admin/ai-marketing/learning-history";
      return fetch(url, { credentials: "include" }).then(r => r.json());
    },
    enabled: sub === "learning",
  });

  const saveLearningMutation = useMutation({
    mutationFn: (body: object) => editLearning
      ? apiRequest("PATCH", `/api/admin/ai-marketing/learning-history/${editLearning.id}`, body)
      : apiRequest("POST", "/api/admin/ai-marketing/learning-history", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/learning-history"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/revenue-recommendations"] });
      setLearningDialog(false); setEditLearning(null);
      toast({ title: editLearning ? "Record updated" : "Learning data logged" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteLearningMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/ai-marketing/learning-history/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/learning-history"] }),
  });

  function openNewLearning() {
    setEditLearning(null);
    setLearningForm({ entity_type: "campaign", entity_name: "", entity_id: "", leads_count: "", hot_count: "", warm_count: "", cold_count: "", no_answer_count: "", appointments_count: "", sales_count: "", revenue_total: "", spend: "", cpl: "", cost_per_hot_lead: "", cost_per_appointment: "", cost_per_sale: "", quality_score: "", period_start: "", period_end: "" });
    setLearningDialog(true);
  }
  function openEditLearning(l: LearningHistory) {
    setEditLearning(l);
    setLearningForm({
      entity_type: l.entity_type, entity_name: l.entity_name, entity_id: l.entity_id || "",
      leads_count: String(l.leads_count || ""), hot_count: String(l.hot_count || ""),
      warm_count: String(l.warm_count || ""), cold_count: String(l.cold_count || ""),
      no_answer_count: String(l.no_answer_count || ""), appointments_count: String(l.appointments_count || ""),
      sales_count: String(l.sales_count || ""), revenue_total: String(l.revenue_total || ""),
      spend: String(l.spend || ""), cpl: String(l.cpl || ""),
      cost_per_hot_lead: String(l.cost_per_hot_lead || ""),
      cost_per_appointment: String(l.cost_per_appointment || ""),
      cost_per_sale: String(l.cost_per_sale || ""), quality_score: String(l.quality_score || ""),
      period_start: l.period_start ? l.period_start.slice(0,10) : "",
      period_end: l.period_end ? l.period_end.slice(0,10) : "",
    });
    setLearningDialog(true);
  }

  // ── Revenue Recommendations ─────────────────────────────────────────────────
  const { data: revRecs = [], isLoading: recsLoading } = useQuery<RevRec[]>({
    queryKey: ["/api/admin/ai-marketing/revenue-recommendations"],
    enabled: sub === "recrules",
  });

  // ── Cost Intelligence ────────────────────────────────────────────────────────
  const { data: costIntel, isLoading: costLoading } = useQuery<CostIntelligence>({
    queryKey: ["/api/admin/ai-marketing/cost-intelligence"],
    enabled: sub === "costintel",
  });

  // ── AI Strategy ──────────────────────────────────────────────────────────────
  const { data: strategy, isLoading: stratLoading } = useQuery<StrategyData>({
    queryKey: ["/api/admin/ai-marketing/strategy-insights"],
    enabled: sub === "strategy",
  });

  // ── Creative Attribution ──────────────────────────────────────────────────────
  const queryClient = useQueryClient();
  const { data: creativeData, isLoading: creativeLoading } = useQuery<CreativeData>({
    queryKey: ["/api/admin/ai-marketing/creative-attribution"],
    enabled: sub === "creative",
  });
  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [backfillStatus, setBackfillStatus] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);

  async function runCreativeSync() {
    setSyncing(true); setSyncStatus(null);
    try {
      const r = await fetch("/api/admin/ai-marketing/creative-attribution/sync", { credentials: "include" });
      const d = await r.json();
      if (d.ok) {
        setSyncStatus(`Sync complete — ${d.adsFound} ads found, ${d.inserted} new, ${d.updated} updated.`);
        queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/creative-attribution"] });
      } else {
        setSyncStatus(`Sync failed: ${d.error ?? "Unknown error"}`);
      }
    } catch (e: any) {
      setSyncStatus(`Sync error: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }

  async function runAttributionBackfill() {
    setBackfilling(true); setBackfillStatus(null);
    try {
      const r = await fetch("/api/admin/ai-marketing/attribution-backfill", { credentials: "include" });
      const d: BackfillResult = await r.json();
      if (d.ok) {
        setBackfillStatus(`Backfill complete — ${d.scanned} scanned, ${d.inserted} inserted, ${d.skipped} skipped.`);
        queryClient.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/creative-attribution"] });
      } else {
        setBackfillStatus(`Backfill failed: ${d.error ?? "Unknown error"}`);
      }
    } catch (e: any) {
      setBackfillStatus(`Backfill error: ${e.message}`);
    } finally {
      setBackfilling(false);
    }
  }

  const { data: creativeIntData, isLoading: creativeIntLoading } = useQuery<CreativeIntelData>({
    queryKey: ["/api/admin/ai-marketing/creative-intelligence"],
    enabled: sub === "creativeint",
  });

  // ── AI Creative Draft Generator ───────────────────────────────────────────
  const [draftInput, setDraftInput] = useState<DraftInput>({
    project_name: "", target_market: "", language: "Arabic", goal: "more_hot_leads", draft_types: [],
  });
  const [generatedDrafts, setGeneratedDrafts] = useState<GeneratedDraft[]>([]);
  const [generating, setGenerating] = useState(false);

  const { data: savedDraftsData, isLoading: savedDraftsLoading } = useQuery<{ ok: boolean; drafts: SavedDraft[] }>({
    queryKey: ["/api/admin/ai-marketing/creative-drafts"],
    enabled: sub === "creativedraft",
  });

  const saveDraftMutation = useMutation({
    mutationFn: (draft: GeneratedDraft) => apiRequest("POST", "/api/admin/ai-marketing/creative-drafts", draft),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/creative-drafts"] });
      toast({ title: "Draft saved to library" });
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const updateDraftStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/admin/ai-marketing/creative-drafts/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/creative-drafts"] }),
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteDraftMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/ai-marketing/creative-drafts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/creative-drafts"] }),
  });

  async function generateDrafts() {
    setGenerating(true); setGeneratedDrafts([]);
    try {
      const r = await fetch("/api/admin/ai-marketing/creative-drafts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(draftInput),
      });
      const d = await r.json();
      if (d.ok) {
        setGeneratedDrafts(d.drafts || []);
        if ((d.drafts || []).length === 0)
          toast({ title: "No drafts generated", description: "Try adjusting your inputs." });
      } else {
        toast({ title: "Generation failed", description: d.error ?? "Unknown error", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  function toggleDraftType(t: string) {
    setDraftInput(prev => ({
      ...prev,
      draft_types: prev.draft_types.includes(t)
        ? prev.draft_types.filter(x => x !== t)
        : [...prev.draft_types, t],
    }));
  }

  // ── Campaign Draft Builder ────────────────────────────────────────────────
  const [campInput, setCampInput] = useState<CampaignDraftInput>({
    project_name: "", target_market: "", language: "Arabic", goal: "more_hot_leads",
    daily_budget_amount: "", daily_budget_currency: "USD",
    country: "", city_region: "", age_min: "25", age_max: "55", audience_notes: "",
  });
  const [generatedCampaign, setGeneratedCampaign] = useState<GeneratedCampaignDraft | null>(null);
  const [campaignSafetyChecks, setCampaignSafetyChecks] = useState<SafetyChecks | null>(null);
  const [generatingCampaign, setGeneratingCampaign] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    campaign: true, adset: true, audience: true, lead_form: true, safety: true,
  });

  const { data: savedCampaignDraftsData, isLoading: savedCampaignDraftsLoading } = useQuery<{ ok: boolean; drafts: SavedCampaignDraft[] }>({
    queryKey: ["/api/admin/ai-marketing/campaign-drafts"],
    enabled: sub === "campaigndraft",
  });

  const saveCampaignDraftMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/admin/ai-marketing/campaign-drafts", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/campaign-drafts"] });
      toast({ title: "Campaign draft saved" });
      setGeneratedCampaign(null);
      setCampaignSafetyChecks(null);
    },
    onError: (e: any) => toast({ title: "Save failed", description: e.message, variant: "destructive" }),
  });

  const updateCampaignDraftStatusMutation = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) =>
      apiRequest("PATCH", `/api/admin/ai-marketing/campaign-drafts/${id}`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/campaign-drafts"] }),
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });

  const deleteCampaignDraftMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/ai-marketing/campaign-drafts/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/campaign-drafts"] }),
  });

  // ── Phase 12 — Marketing Knowledge Base state & queries ──────────────────────
  const [kbView, setKbView] = useState<"list" | "create" | "detail">("list");
  const [activeKbId, setActiveKbId] = useState<number | null>(null);
  const [kbForm, setKbForm] = useState<Partial<MarketingProfile>>({ use_real_project_name: false, status: "active" });
  const [kbAngleInput, setKbAngleInput] = useState({ angle_name: "", angle_description: "" });
  const [kbMarketInput, setKbMarketInput] = useState({ market_name: "", language: "" });
  const [kbClaimInput, setKbClaimInput] = useState("");

  const { data: kbProfilesData, isLoading: kbProfilesLoading } = useQuery<{ ok: boolean; profiles: MarketingProfile[] }>({
    queryKey: ["/api/admin/ai-marketing/marketing-knowledge"],
    enabled: sub === "knowledgebase",
  });
  const { data: kbDetailData } = useQuery<ProfileDetail>({
    queryKey: ["/api/admin/ai-marketing/marketing-knowledge", activeKbId],
    enabled: !!activeKbId && sub === "knowledgebase",
  });

  const createProfileMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/admin/ai-marketing/marketing-knowledge", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/marketing-knowledge"] });
      toast({ title: "Profile created" });
      setKbView("list");
      setKbForm({ use_real_project_name: false, status: "active" });
    },
    onError: (e: any) => toast({ title: "Create failed", description: e.message, variant: "destructive" }),
  });
  const updateProfileMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiRequest("PUT", `/api/admin/ai-marketing/marketing-knowledge/${id}`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/marketing-knowledge"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/marketing-knowledge", activeKbId] });
      toast({ title: "Profile updated" });
    },
    onError: (e: any) => toast({ title: "Update failed", description: e.message, variant: "destructive" }),
  });
  const deleteProfileMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/ai-marketing/marketing-knowledge/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/marketing-knowledge"] });
      setActiveKbId(null); setKbView("list");
      toast({ title: "Profile deleted" });
    },
  });
  const addAngleMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiRequest("POST", `/api/admin/ai-marketing/marketing-knowledge/${id}/angles`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/marketing-knowledge", activeKbId] });
      setKbAngleInput({ angle_name: "", angle_description: "" });
    },
  });
  const toggleAngleMutation = useMutation({
    mutationFn: ({ profileId, angleId, enabled }: { profileId: number; angleId: number; enabled: boolean }) =>
      apiRequest("PATCH", `/api/admin/ai-marketing/marketing-knowledge/${profileId}/angles/${angleId}`, { enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/marketing-knowledge", activeKbId] }),
  });
  const deleteAngleMutation = useMutation({
    mutationFn: ({ profileId, angleId }: { profileId: number; angleId: number }) =>
      apiRequest("DELETE", `/api/admin/ai-marketing/marketing-knowledge/${profileId}/angles/${angleId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/marketing-knowledge", activeKbId] }),
  });
  const addMarketMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiRequest("POST", `/api/admin/ai-marketing/marketing-knowledge/${id}/markets`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/marketing-knowledge", activeKbId] });
      setKbMarketInput({ market_name: "", language: "" });
    },
  });
  const deleteMarketMutation = useMutation({
    mutationFn: ({ profileId, marketId }: { profileId: number; marketId: number }) =>
      apiRequest("DELETE", `/api/admin/ai-marketing/marketing-knowledge/${profileId}/markets/${marketId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/marketing-knowledge", activeKbId] }),
  });
  const addClaimMutation = useMutation({
    mutationFn: ({ id, body }: { id: number; body: object }) =>
      apiRequest("POST", `/api/admin/ai-marketing/marketing-knowledge/${id}/claims`, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/marketing-knowledge", activeKbId] });
      setKbClaimInput("");
    },
  });
  const deleteClaimMutation = useMutation({
    mutationFn: ({ profileId, claimId }: { profileId: number; claimId: number }) =>
      apiRequest("DELETE", `/api/admin/ai-marketing/marketing-knowledge/${profileId}/claims/${claimId}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/marketing-knowledge", activeKbId] }),
  });

  async function generateCampaignDraft() {
    setGeneratingCampaign(true); setGeneratedCampaign(null); setCampaignSafetyChecks(null);
    try {
      const r = await fetch("/api/admin/ai-marketing/campaign-drafts/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(campInput),
      });
      const d = await r.json();
      if (d.ok) {
        setGeneratedCampaign(d.result);
        setCampaignSafetyChecks(d.safety_checks);
        setExpandedSections({ campaign: true, adset: true, audience: true, lead_form: true, safety: true });
      } else {
        toast({ title: "Generation failed", description: d.error ?? "Unknown error", variant: "destructive" });
      }
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    } finally {
      setGeneratingCampaign(false);
    }
  }

  function saveCampaignDraft() {
    if (!generatedCampaign) return;
    saveCampaignDraftMutation.mutate({
      campaign: {
        campaign_name: generatedCampaign.campaign_name,
        project_name: generatedCampaign.project_name,
        target_market: generatedCampaign.target_market,
        language: generatedCampaign.language,
        goal: generatedCampaign.goal,
        daily_budget_amount: generatedCampaign.daily_budget_amount,
        daily_budget_currency: generatedCampaign.daily_budget_currency,
        strategy_reason: generatedCampaign.strategy_reason,
        confidence_level: generatedCampaign.confidence_level,
        safety_warnings: generatedCampaign.safety_warnings,
      },
      adset: { ...generatedCampaign.adset, country: generatedCampaign.country, city_region: generatedCampaign.city_region, language: generatedCampaign.language, age_min: generatedCampaign.age_min, age_max: generatedCampaign.age_max },
      audience: { ...generatedCampaign.audience, market: generatedCampaign.target_market, country: generatedCampaign.country, language: generatedCampaign.language },
      lead_form: generatedCampaign.lead_form,
      creatives: [],
    });
  }

  function toggleSection(key: string) {
    setExpandedSections(p => ({ ...p, [key]: !p[key] }));
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Safety banner */}
      <div className="flex flex-wrap gap-2 mb-4">
        {["📊 Analytics Only", "🔒 Read-only", "🚫 No Meta Actions", "💳 No Ad Spend"].map(b => (
          <span key={b} className="text-xs bg-slate-100 text-slate-600 font-medium px-3 py-1 rounded-full border border-slate-200">{b}</span>
        ))}
      </div>

      {/* Sub-tab bar */}
      <div className="flex flex-wrap gap-1 mb-5 bg-slate-100 p-1 rounded-xl">
        {SUB_TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setSub(key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              sub === key ? "bg-white text-[#005476] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {/* ── Dashboard ─────────────────────────────────────────────────────── */}
      {sub === "dashboard" && (
        <div>
          <h3 className="font-bold text-slate-800 text-base mb-4">Revenue Dashboard</h3>
          {dashLoading ? (
            <div className="text-center py-12 text-slate-400">Loading…</div>
          ) : (
            <>
              {/* KPI row */}
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
                {[
                  { label: "Leads Attributed", value: dash?.totals.total_leads_attributed ?? 0, Icon: Target, color: "text-[#005476]", bg: "bg-[#005476]/10" },
                  { label: "Appointments", value: dash?.totals.appointments ?? 0, Icon: Calendar, color: "text-blue-600", bg: "bg-blue-50" },
                  { label: "Site Visits", value: dash?.totals.site_visits ?? 0, Icon: Building2, color: "text-purple-600", bg: "bg-purple-50" },
                  { label: "Sales Closed", value: dash?.totals.sales ?? 0, Icon: CheckCircle2, color: "text-green-600", bg: "bg-green-50" },
                  { label: "Total Revenue", value: `$${Number(dash?.totals.revenue ?? 0).toLocaleString()}`, Icon: DollarSign, color: "text-[#3bcac4]", bg: "bg-[#3bcac4]/10", raw: true },
                ].map(({ label, value, Icon: I, color, bg, raw }) => (
                  <Card key={label} className="shadow-sm">
                    <CardContent className="p-4 flex items-center gap-3">
                      <div className={`p-2 rounded-xl ${bg}`}><I className={`h-5 w-5 ${color}`} /></div>
                      <div>
                        <p className={`text-xl font-extrabold ${color}`}>{raw ? value : Number(value).toLocaleString()}</p>
                        <p className="text-xs text-slate-500">{label}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Attribution by source */}
              {(dash?.attribution_by_source?.length ?? 0) > 0 && (
                <div className="mb-6">
                  <h4 className="text-sm font-bold text-slate-700 mb-2">Attribution by Source</h4>
                  <div className="flex flex-wrap gap-2">
                    {dash!.attribution_by_source.map(s => (
                      <div key={s.source_type} className="bg-white border rounded-lg px-3 py-2 flex items-center gap-2">
                        <span className="text-xs font-medium text-slate-700 capitalize">{s.source_type.replace(/_/g," ")}</span>
                        <Badge className="bg-[#3bcac4]/10 text-[#005476]">{s.cnt}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Learning history top performers */}
              {(dash?.learning_history?.length ?? 0) > 0 ? (
                <div>
                  <h4 className="text-sm font-bold text-slate-700 mb-3">Top Performers (Learning History)</h4>
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                        <tr>
                          {["Entity","Type","Leads","HOT","WARM","COLD","No Ans","Appts","Sales","Revenue","Spend","$/HOT"].map(h => (
                            <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {dash!.learning_history.map(l => (
                          <tr key={l.id} className="hover:bg-slate-50">
                            <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[140px] truncate">{l.entity_name}</td>
                            <td className="px-3 py-2.5"><Badge variant="outline" className="text-[#3bcac4] border-[#3bcac4]/30 text-xs capitalize">{l.entity_type}</Badge></td>
                            <td className="px-3 py-2.5 text-slate-600">{l.leads_count || "—"}</td>
                            <td className="px-3 py-2.5 text-red-500 font-medium">{l.hot_count || "—"}</td>
                            <td className="px-3 py-2.5 text-amber-500">{l.warm_count || "—"}</td>
                            <td className="px-3 py-2.5 text-blue-400">{l.cold_count || "—"}</td>
                            <td className="px-3 py-2.5 text-slate-400">{l.no_answer_count || "—"}</td>
                            <td className="px-3 py-2.5 text-green-600">{l.appointments_count || "—"}</td>
                            <td className="px-3 py-2.5 text-[#3bcac4] font-semibold">{l.sales_count || "—"}</td>
                            <td className="px-3 py-2.5 text-green-700 font-semibold">{fmt(l.revenue_total,"$")}</td>
                            <td className="px-3 py-2.5 text-slate-500">{fmt(l.spend,"$")}</td>
                            <td className="px-3 py-2.5 text-purple-600">{fmt(l.cost_per_hot_lead,"$")}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <Card className="border-dashed">
                  <CardContent className="py-12 text-center text-slate-400">
                    <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                    <p className="font-medium">No data yet</p>
                    <p className="text-sm mt-1">Log lead attributions and learning history to populate this dashboard</p>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}

      {/* ── Campaign Attribution ───────────────────────────────────────────── */}
      {sub === "campaign" && (
        <div>
          <div className="flex items-center justify-between mb-1">
            <div>
              <h3 className="font-bold text-slate-800 text-base">Campaign Attribution</h3>
              <p className="text-sm text-slate-500">
                Which campaigns generate HOT leads, appointments, and sales — sourced directly from CRM data. Read-only.
              </p>
            </div>
          </div>

          {/* Safety badges */}
          <div className="flex flex-wrap gap-2 mb-4 mt-2">
            {["📊 Read-Only", "🚫 No Meta Writes", "🔒 CRM Data Only", "✅ Live Counts"].map(b => (
              <span key={b} className="text-xs bg-slate-100 text-slate-600 font-medium px-3 py-1 rounded-full border border-slate-200">{b}</span>
            ))}
          </div>

          {/* View switcher */}
          <div className="flex gap-1 mb-4 bg-slate-100 p-1 rounded-lg w-fit">
            {(["campaign", "adset", "ad"] as const).map(v => (
              <button key={v} onClick={() => setCampView(v)}
                className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all capitalize ${
                  campView === v ? "bg-white text-[#005476] shadow-sm" : "text-slate-500 hover:text-slate-700"
                }`}>
                {v === "campaign" ? "By Campaign" : v === "adset" ? "By Ad Set" : "By Ad"}
              </button>
            ))}
          </div>

          {campLoading ? (
            <div className="text-center py-12 text-slate-400">Loading attribution data…</div>
          ) : (() => {
            const rows: CampaignRow[] =
              campView === "campaign" ? (campAttrib?.byCampaign ?? [])
              : campView === "adset"  ? (campAttrib?.byAdset   ?? [])
              :                         (campAttrib?.byAd       ?? []);

            const totalLeads  = rows.reduce((s, r) => s + r.leadsCount, 0);
            const totalHot    = rows.reduce((s, r) => s + r.hotLeads, 0);
            const totalSales  = rows.reduce((s, r) => s + r.salesCount, 0);
            const totalAppts  = rows.reduce((s, r) => s + r.appointmentsCount, 0);

            return (
              <>
                {/* KPI row */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                  {[
                    { label: "Total Leads",   value: totalLeads, Icon: Target,      color: "text-[#005476]",  bg: "bg-[#005476]/10" },
                    { label: "HOT Leads",     value: totalHot,   Icon: Flame,       color: "text-red-500",    bg: "bg-red-50" },
                    { label: "Appointments",  value: totalAppts, Icon: Calendar,    color: "text-blue-600",   bg: "bg-blue-50" },
                    { label: "Sales",         value: totalSales, Icon: CheckCircle2,color: "text-green-600",  bg: "bg-green-50" },
                  ].map(({ label, value, Icon: I, color, bg }) => (
                    <Card key={label} className="shadow-sm">
                      <CardContent className="p-4 flex items-center gap-3">
                        <div className={`p-2 rounded-xl ${bg}`}><I className={`h-5 w-5 ${color}`} /></div>
                        <div>
                          <p className={`text-xl font-extrabold ${color}`}>{value.toLocaleString()}</p>
                          <p className="text-xs text-slate-500">{label}</p>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {rows.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-12 text-center text-slate-400">
                      <Megaphone className="h-10 w-10 mx-auto mb-3 opacity-30" />
                      <p className="font-medium">No campaign data found</p>
                      <p className="text-sm mt-1">
                        {campView === "campaign"
                          ? "No CRM leads have a campaign name set yet. Leads from Meta ads will populate this automatically."
                          : campView === "adset"
                          ? "No CRM leads have an ad set name set yet."
                          : "No CRM leads have an ad name set yet."}
                      </p>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="overflow-x-auto rounded-xl border">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                        <tr>
                          <th className="px-3 py-2.5 text-left font-semibold">
                            {campView === "campaign" ? "Campaign" : campView === "adset" ? "Ad Set" : "Ad"}
                          </th>
                          <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">Leads</th>
                          <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                            <span className="text-red-500">HOT</span>
                          </th>
                          <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                            <span className="text-amber-500">WARM</span>
                          </th>
                          <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">
                            <span className="text-blue-400">COLD</span>
                          </th>
                          <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">No Ans</th>
                          <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">Appts</th>
                          <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">Sales</th>
                          {campAttrib?.revenueEnabled && (
                            <th className="px-3 py-2.5 text-right font-semibold whitespace-nowrap">Revenue</th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {rows.map((r, i) => {
                          const hotPct = r.leadsCount > 0 ? Math.round((r.hotLeads / r.leadsCount) * 100) : 0;
                          return (
                            <tr key={i} className="hover:bg-slate-50">
                              <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[200px]">
                                <div className="truncate">{r.name}</div>
                                {hotPct >= 20 && (
                                  <Badge className="mt-0.5 text-[10px] bg-red-50 text-red-600 border-red-200">
                                    {hotPct}% HOT
                                  </Badge>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right text-slate-700 font-semibold">{r.leadsCount}</td>
                              <td className="px-3 py-2.5 text-right">
                                <span className={r.hotLeads > 0 ? "text-red-500 font-semibold" : "text-slate-300"}>
                                  {r.hotLeads || "—"}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <span className={r.warmLeads > 0 ? "text-amber-500" : "text-slate-300"}>
                                  {r.warmLeads || "—"}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <span className={r.coldLeads > 0 ? "text-blue-400" : "text-slate-300"}>
                                  {r.coldLeads || "—"}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right text-slate-400">{r.noAnswerCount || "—"}</td>
                              <td className="px-3 py-2.5 text-right">
                                <span className={r.appointmentsCount > 0 ? "text-blue-600 font-medium" : "text-slate-300"}>
                                  {r.appointmentsCount || "—"}
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right">
                                <span className={r.salesCount > 0 ? "text-green-600 font-semibold" : "text-slate-300"}>
                                  {r.salesCount || "—"}
                                </span>
                              </td>
                              {campAttrib?.revenueEnabled && (
                                <td className="px-3 py-2.5 text-right text-green-700 font-semibold">
                                  {r.revenueTotal > 0 ? `$${Number(r.revenueTotal).toLocaleString()}` : "—"}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Revenue disabled notice */}
                {!campAttrib?.revenueEnabled && (
                  <Card className="mt-4 border-slate-200 bg-slate-50">
                    <CardContent className="p-4 flex items-start gap-3">
                      <TrendingDown className="h-5 w-5 text-slate-400 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold text-slate-600">Revenue tracking not yet active</p>
                        <p className="text-xs text-slate-400 mt-0.5">
                          No closed sales with a sale amount have been recorded in Sales Outcomes. Revenue by campaign will appear here once sales data is entered.
                        </p>
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Status mapping legend */}
                <div className="mt-4 p-3 bg-slate-50 rounded-xl border border-slate-200">
                  <p className="text-xs font-semibold text-slate-500 mb-2">HOW THESE COUNTS ARE CALCULATED</p>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-xs text-slate-500">
                    <span><span className="font-medium text-red-500">HOT</span> = lead_score is 'hot'</span>
                    <span><span className="font-medium text-amber-500">WARM</span> = lead_score is 'warm'</span>
                    <span><span className="font-medium text-blue-400">COLD</span> = lead_score is 'cold'</span>
                    <span><span className="font-medium text-slate-600">No Answer</span> = no_answer_1–4 or after_3_no_answer statuses</span>
                    <span><span className="font-medium text-blue-600">Appts</span> = status is 'qualified'</span>
                    <span><span className="font-medium text-green-600">Sales</span> = purchased / deposited / reserved</span>
                  </div>
                </div>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Lead Attribution ───────────────────────────────────────────────── */}
      {sub === "attribution" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-base">Lead Attribution</h3>
              <p className="text-sm text-slate-500">Manually tag leads with their campaign/ad source. No Meta API connection.</p>
            </div>
            <Button onClick={openNewAttrib} className="bg-[#3bcac4] hover:bg-[#005476] text-white">
              <Plus className="h-4 w-4 mr-1" /> Log Attribution
            </Button>
          </div>

          {attribLoading ? <div className="text-center py-12 text-slate-400">Loading…</div>
          : attribs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-slate-400">
                <Link2 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No attributions logged yet</p>
                <p className="text-sm mt-1">Tag leads with their source to build attribution data</p>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr>
                    {["Lead ID","Source","Campaign","Ad Set","Ad","Country","Created",""].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {attribs.map(a => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-mono text-[#005476] font-bold">#{a.lead_id}</td>
                      <td className="px-3 py-2.5"><Badge variant="outline" className="text-xs capitalize">{a.source_type.replace(/_/g," ")}</Badge></td>
                      <td className="px-3 py-2.5 text-slate-700">{a.meta_campaign_name || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-500">{a.meta_adset_name || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-500">{a.meta_ad_name || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-500">{a.country || "—"}</td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs">{new Date(a.created_at).toLocaleDateString()}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex gap-1">
                          <button onClick={() => openEditAttrib(a)} className="p-1.5 text-slate-400 hover:text-[#3bcac4]"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => confirm("Delete?") && deleteAttribMutation.mutate(a.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Dialog open={attribDialog} onOpenChange={v => { setAttribDialog(v); if (!v) setEditAttrib(null); }}>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editAttrib ? "Edit Attribution" : "Log Lead Attribution"}</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Lead ID *</Label><Input type="number" value={attribForm.lead_id} onChange={e => setAttribForm(f => ({...f, lead_id: e.target.value}))} placeholder="e.g. 142" disabled={!!editAttrib} /></div>
                  <div><Label>Source Type</Label>
                    <Select value={attribForm.source_type} onValueChange={v => setAttribForm(f => ({...f, source_type: v}))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>{SOURCE_TYPES.map(s => <SelectItem key={s} value={s}>{s.replace(/_/g," ")}</SelectItem>)}</SelectContent>
                    </Select></div>
                </div>
                <div><Label>Campaign Name</Label><Input value={attribForm.meta_campaign_name} onChange={e => setAttribForm(f => ({...f, meta_campaign_name: e.target.value}))} placeholder="e.g. Russia Luxury Q3" /></div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Ad Set Name</Label><Input value={attribForm.meta_adset_name} onChange={e => setAttribForm(f => ({...f, meta_adset_name: e.target.value}))} placeholder="e.g. Moscow 35-55" /></div>
                  <div><Label>Ad Name</Label><Input value={attribForm.meta_ad_name} onChange={e => setAttribForm(f => ({...f, meta_ad_name: e.target.value}))} placeholder="e.g. Video v3" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><Label>Creative Name</Label><Input value={attribForm.creative_name} onChange={e => setAttribForm(f => ({...f, creative_name: e.target.value}))} /></div>
                  <div><Label>Audience Name</Label><Input value={attribForm.audience_name} onChange={e => setAttribForm(f => ({...f, audience_name: e.target.value}))} /></div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div><Label>Language</Label><Input value={attribForm.language} onChange={e => setAttribForm(f => ({...f, language: e.target.value}))} placeholder="Russian" /></div>
                  <div><Label>Country</Label><Input value={attribForm.country} onChange={e => setAttribForm(f => ({...f, country: e.target.value}))} placeholder="Russia" /></div>
                  <div><Label>City</Label><Input value={attribForm.city} onChange={e => setAttribForm(f => ({...f, city: e.target.value}))} placeholder="Moscow" /></div>
                </div>
                <div><Label>Notes</Label><Textarea value={attribForm.notes} onChange={e => setAttribForm(f => ({...f, notes: e.target.value}))} rows={2} /></div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setAttribDialog(false)}>Cancel</Button>
                  <Button className="bg-[#3bcac4] hover:bg-[#005476] text-white" disabled={saveAttribMutation.isPending || (!editAttrib && !attribForm.lead_id)}
                    onClick={() => saveAttribMutation.mutate({ ...attribForm, lead_id: Number(attribForm.lead_id) })}>
                    {saveAttribMutation.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* ── Sales Outcomes ─────────────────────────────────────────────────── */}
      {sub === "sales" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-base">Sales Outcomes</h3>
              <p className="text-sm text-slate-500">Track appointments, site visits, and closed sales per lead.</p>
            </div>
            <Button onClick={() => { setSalesForm({ lead_id: "", appointment_scheduled: false, appointment_date: "", site_visit_completed: false, sale_closed: false, sale_amount: "", sale_currency: "USD", sale_date: "", notes: "" }); setSalesDialog(true); }} className="bg-[#3bcac4] hover:bg-[#005476] text-white">
              <Plus className="h-4 w-4 mr-1" /> Log Outcome
            </Button>
          </div>

          {salesLoading ? <div className="text-center py-12 text-slate-400">Loading…</div>
          : sales.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-slate-400">
                <ShoppingCart className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No sales outcomes yet</p>
                <p className="text-sm mt-1">Log sales milestones for leads</p>
              </CardContent>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr>
                    {["Lead ID","Appointment","Site Visit","Sale Closed","Amount","Date",""].map(h => (
                      <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sales.map(s => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-mono text-[#005476] font-bold">#{s.lead_id}</td>
                      <td className="px-3 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.appointment_scheduled ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>{s.appointment_scheduled ? "✓ Yes" : "No"}</span></td>
                      <td className="px-3 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.site_visit_completed ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-500"}`}>{s.site_visit_completed ? "✓ Yes" : "No"}</span></td>
                      <td className="px-3 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.sale_closed ? "bg-[#3bcac4]/20 text-[#005476]" : "bg-slate-100 text-slate-500"}`}>{s.sale_closed ? "✓ SOLD" : "No"}</span></td>
                      <td className="px-3 py-2.5 font-semibold text-green-700">{s.sale_closed ? `${s.sale_currency} ${Number(s.sale_amount).toLocaleString()}` : "—"}</td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs">{s.sale_date ? new Date(s.sale_date).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2.5"><button onClick={() => confirm("Delete?") && deleteSalesMutation.mutate(s.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <Dialog open={salesDialog} onOpenChange={setSalesDialog}>
            <DialogContent className="max-w-md">
              <DialogHeader><DialogTitle>Log Sales Outcome</DialogTitle></DialogHeader>
              <div className="space-y-3 mt-2">
                <div><Label>Lead ID *</Label><Input type="number" value={salesForm.lead_id} onChange={e => setSalesForm(f => ({...f, lead_id: e.target.value}))} placeholder="CRM lead ID" /></div>
                <div className="space-y-2.5">
                  {[
                    { key: "appointment_scheduled" as const, label: "Appointment Scheduled" },
                    { key: "site_visit_completed" as const, label: "Site Visit Completed" },
                    { key: "sale_closed" as const, label: "Sale Closed" },
                  ].map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between p-2.5 rounded-lg bg-slate-50">
                      <Label className="font-medium">{label}</Label>
                      <Switch checked={salesForm[key]} onCheckedChange={v => setSalesForm(f => ({...f, [key]: v}))} />
                    </div>
                  ))}
                </div>
                {salesForm.appointment_scheduled && (
                  <div><Label>Appointment Date</Label><Input type="date" value={salesForm.appointment_date} onChange={e => setSalesForm(f => ({...f, appointment_date: e.target.value}))} /></div>
                )}
                {salesForm.sale_closed && (
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Sale Amount</Label><Input type="number" value={salesForm.sale_amount} onChange={e => setSalesForm(f => ({...f, sale_amount: e.target.value}))} /></div>
                    <div><Label>Currency</Label>
                      <Select value={salesForm.sale_currency} onValueChange={v => setSalesForm(f => ({...f, sale_currency: v}))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["USD","EUR","AED","GBP","GEL","RUB"].map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                        </SelectContent>
                      </Select></div>
                    <div className="col-span-2"><Label>Sale Date</Label><Input type="date" value={salesForm.sale_date} onChange={e => setSalesForm(f => ({...f, sale_date: e.target.value}))} /></div>
                  </div>
                )}
                <div><Label>Notes</Label><Textarea value={salesForm.notes} onChange={e => setSalesForm(f => ({...f, notes: e.target.value}))} rows={2} /></div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => setSalesDialog(false)}>Cancel</Button>
                  <Button className="bg-[#3bcac4] hover:bg-[#005476] text-white" disabled={saveSalesMutation.isPending || !salesForm.lead_id}
                    onClick={() => saveSalesMutation.mutate({ ...salesForm, lead_id: Number(salesForm.lead_id), sale_amount: salesForm.sale_amount ? Number(salesForm.sale_amount) : 0, appointment_date: salesForm.appointment_date || null, sale_date: salesForm.sale_date || null })}>
                    {saveSalesMutation.isPending ? "Saving…" : "Save Outcome"}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* ── Learning History ───────────────────────────────────────────────── */}
      {sub === "learning" && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="font-bold text-slate-800 text-base">Learning History</h3>
              <p className="text-sm text-slate-500">Aggregate performance data per campaign, ad set, ad, creative, audience, or country.</p>
            </div>
            <Button onClick={openNewLearning} className="bg-[#3bcac4] hover:bg-[#005476] text-white">
              <Plus className="h-4 w-4 mr-1" /> Add Record
            </Button>
          </div>

          {/* Filter */}
          <div className="mb-3 flex items-center gap-2">
            <span className="text-xs text-slate-500">Filter:</span>
            <Select value={entityTypeFilter} onValueChange={setEntityTypeFilter}>
              <SelectTrigger className="w-36 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {ENTITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {learningLoading ? <div className="text-center py-12 text-slate-400">Loading…</div>
          : learning.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-slate-400">
                <BookOpen className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No learning history yet</p>
                <p className="text-sm mt-1">Add performance aggregates to build AI intelligence over time</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {learning.map(l => (
                <Card key={l.id} className="shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800">{l.entity_name}</span>
                          <Badge variant="outline" className="text-xs text-[#3bcac4] border-[#3bcac4]/30 capitalize">{l.entity_type}</Badge>
                        </div>
                        {(l.period_start || l.period_end) && (
                          <p className="text-xs text-slate-400 mt-0.5">
                            {l.period_start ? new Date(l.period_start).toLocaleDateString() : "?"}
                            {" → "}
                            {l.period_end ? new Date(l.period_end).toLocaleDateString() : "now"}
                          </p>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <button onClick={() => openEditLearning(l)} className="p-1.5 text-slate-400 hover:text-[#3bcac4]"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => confirm("Delete?") && deleteLearningMutation.mutate(l.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    </div>
                    <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2">
                      {[
                        { label: "Leads", v: l.leads_count, icon: Target, cls: "text-slate-600" },
                        { label: "HOT 🔥", v: l.hot_count, icon: Flame, cls: "text-red-500" },
                        { label: "WARM", v: l.warm_count, icon: Thermometer, cls: "text-amber-500" },
                        { label: "COLD", v: l.cold_count, icon: Snowflake, cls: "text-blue-400" },
                        { label: "No Ans", v: l.no_answer_count, icon: PhoneOff, cls: "text-slate-400" },
                        { label: "Sales", v: l.sales_count, icon: UserCheck, cls: "text-[#3bcac4]" },
                        { label: "Revenue", v: fmt(l.revenue_total, "$"), icon: DollarSign, cls: "text-green-600" },
                        { label: "$/HOT", v: fmt(l.cost_per_hot_lead, "$"), icon: DollarSign, cls: "text-purple-600" },
                      ].map(({ label, v, icon: I, cls }) => (
                        <div key={label} className="bg-slate-50 rounded-lg p-2 text-center">
                          <I className={`h-3 w-3 mx-auto mb-1 ${cls}`} />
                          <div className={`text-sm font-bold ${cls}`}>{typeof v === "number" ? (v || "—") : v}</div>
                          <div className="text-[10px] text-slate-400">{label}</div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Learning History Dialog */}
          <Dialog open={learningDialog} onOpenChange={v => { setLearningDialog(v); if (!v) setEditLearning(null); }}>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{editLearning ? "Edit Learning Record" : "Add Learning Record"}</DialogTitle></DialogHeader>
              <div className="grid grid-cols-2 gap-3 mt-2">
                <div><Label>Entity Type *</Label>
                  <Select value={learningForm.entity_type} onValueChange={v => setLearningForm(f => ({...f, entity_type: v}))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{ENTITY_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div><Label>Entity Name *</Label><Input value={learningForm.entity_name} onChange={e => setLearningForm(f => ({...f, entity_name: e.target.value}))} placeholder="e.g. Russia Q3 Campaign" /></div>
                <div><Label>Period Start</Label><Input type="date" value={learningForm.period_start} onChange={e => setLearningForm(f => ({...f, period_start: e.target.value}))} /></div>
                <div><Label>Period End</Label><Input type="date" value={learningForm.period_end} onChange={e => setLearningForm(f => ({...f, period_end: e.target.value}))} /></div>
                {[
                  ["leads_count","Leads"],["hot_count","HOT Leads"],["warm_count","WARM Leads"],
                  ["cold_count","COLD Leads"],["no_answer_count","No Answer"],
                  ["appointments_count","Appointments"],["sales_count","Sales"],
                  ["revenue_total","Revenue ($)"],["spend","Spend ($)"],["cpl","CPL ($)"],
                  ["cost_per_hot_lead","Cost/HOT ($)"],["cost_per_appointment","Cost/Appt ($)"],
                  ["cost_per_sale","Cost/Sale ($)"],["quality_score","Quality Score"],
                ].map(([key, label]) => (
                  <div key={key}><Label>{label}</Label>
                    <Input type="number" value={(learningForm as any)[key]} onChange={e => setLearningForm(f => ({...f, [key]: e.target.value}))} placeholder="0" /></div>
                ))}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setLearningDialog(false)}>Cancel</Button>
                <Button className="bg-[#3bcac4] hover:bg-[#005476] text-white" disabled={saveLearningMutation.isPending || !learningForm.entity_name}
                  onClick={() => {
                    const n = (v: string) => v ? Number(v) : 0;
                    saveLearningMutation.mutate({ ...learningForm, leads_count: n(learningForm.leads_count), hot_count: n(learningForm.hot_count), warm_count: n(learningForm.warm_count), cold_count: n(learningForm.cold_count), no_answer_count: n(learningForm.no_answer_count), appointments_count: n(learningForm.appointments_count), sales_count: n(learningForm.sales_count), revenue_total: n(learningForm.revenue_total), spend: n(learningForm.spend), cpl: n(learningForm.cpl), cost_per_hot_lead: n(learningForm.cost_per_hot_lead), cost_per_appointment: n(learningForm.cost_per_appointment), cost_per_sale: n(learningForm.cost_per_sale), quality_score: n(learningForm.quality_score), period_start: learningForm.period_start || null, period_end: learningForm.period_end || null });
                  }}>
                  {saveLearningMutation.isPending ? "Saving…" : "Save Record"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      )}

      {/* ── Revenue Recommendations ────────────────────────────────────────── */}
      {sub === "recrules" && (
        <div>
          <div className="mb-4">
            <h3 className="font-bold text-slate-800 text-base">Revenue Intelligence Recommendations</h3>
            <p className="text-sm text-slate-500">Rule-based insights generated from your learning history data. No automatic actions.</p>
          </div>

          {recsLoading ? <div className="text-center py-12 text-slate-400">Loading…</div>
          : revRecs.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-slate-400">
                <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Not enough attribution data yet.</p>
                <p className="text-sm mt-1">Recommendations will appear once leads with campaign attribution data are recorded.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {revRecs.map((r, i) => {
                const SIcon = SEV_ICON[r.severity] ?? Info;
                const iconCls = SEV_ICON_CLS[r.severity] ?? "text-[#3bcac4]";
                return (
                  <div key={i} className={`rounded-xl border-2 p-4 ${SEV_CLS[r.severity] || SEV_CLS.info}`}>
                    <div className="flex items-start gap-3">
                      <SIcon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${iconCls}`} />
                      <div>
                        <p className="font-semibold text-slate-800">{r.title}</p>
                        <p className="text-sm text-slate-600 mt-0.5">{r.message}</p>
                        <p className="text-xs text-slate-400 mt-1 italic">{r.entity}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
              <div className="mt-4 p-3 bg-slate-100 rounded-lg text-xs text-slate-500 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-[#3bcac4] flex-shrink-0" />
                <span>These are suggestions only. No campaign changes are made automatically. All Meta actions require manual approval.</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Cost Intelligence ────────────────────────────────────────────────── */}
      {sub === "costintel" && (
        <div>
          <div className="mb-4">
            <h3 className="font-bold text-slate-800 text-base">Cost Intelligence</h3>
            <p className="text-sm text-slate-500">Read-only cost rankings from your Learning History. No data is modified.</p>
          </div>

          {costLoading ? (
            <div className="text-center py-12 text-slate-400">Loading…</div>
          ) : !costIntel || costIntel.insufficient ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-slate-400">
                <Target className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Insufficient data.</p>
                <p className="text-sm mt-1">Add Learning History records with spend data to unlock Cost Intelligence rankings.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* ── 5 KPI spotlight cards ───────────────────────────────────── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                {[
                  {
                    label: "Best: Cheapest HOT Lead",
                    row: costIntel.bestCphl,
                    metric: (r: CostRow) => r.costPerHotLead,
                    prefix: "$", suffix: " / HOT",
                    cls: "text-green-700", bg: "bg-green-50 border-green-200",
                    Icon: Flame, tip: "Lowest Cost per HOT Lead",
                  },
                  {
                    label: "Worst: Most Expensive HOT Lead",
                    row: costIntel.worstCphl,
                    metric: (r: CostRow) => r.costPerHotLead,
                    prefix: "$", suffix: " / HOT",
                    cls: "text-red-700", bg: "bg-red-50 border-red-200",
                    Icon: TrendingDown, tip: "Highest Cost per HOT Lead — budget may be wasted",
                  },
                  {
                    label: "Cheapest Cost Per Lead",
                    row: costIntel.bestCpl,
                    metric: (r: CostRow) => r.cpl,
                    prefix: "$", suffix: " / lead",
                    cls: "text-[#005476]", bg: "bg-[#005476]/5 border-[#005476]/20",
                    Icon: DollarSign, tip: "Lowest CPL overall",
                  },
                  {
                    label: "Highest No-Answer Cost",
                    row: costIntel.highestNoAnswerCost,
                    metric: (r: CostRow) => r.costPerNoAnswer,
                    prefix: "$", suffix: " / no-answer",
                    cls: "text-yellow-700", bg: "bg-yellow-50 border-yellow-200",
                    Icon: PhoneOff, tip: "Most budget wasted on no-answer leads",
                  },
                  {
                    label: "Best Quality Score",
                    row: costIntel.bestQuality,
                    metric: (r: CostRow) => r.qualityScore,
                    prefix: "", suffix: " pts",
                    cls: "text-[#3bcac4]", bg: "bg-[#3bcac4]/10 border-[#3bcac4]/30",
                    Icon: CheckCircle2, tip: "Highest quality score",
                  },
                  {
                    label: "Lowest Quality Score",
                    row: costIntel.worstQuality,
                    metric: (r: CostRow) => r.qualityScore,
                    prefix: "", suffix: " pts",
                    cls: "text-slate-500", bg: "bg-slate-50 border-slate-200",
                    Icon: Activity, tip: "Needs improvement",
                  },
                ].map(({ label, row, metric, prefix, suffix, cls, bg, Icon: I, tip }) => (
                  <Card key={label} className={`border ${bg}`}>
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <I className={`h-4 w-4 ${cls}`} />
                        <span className="text-xs font-semibold text-slate-600">{label}</span>
                      </div>
                      {row ? (
                        <>
                          <p className={`text-lg font-extrabold ${cls}`}>
                            {metric(row) != null ? `${prefix}${Number(metric(row)!).toFixed(2)}${suffix}` : "Insufficient data"}
                          </p>
                          <p className="text-xs text-slate-500 mt-1 truncate">{row.entityType}: {row.entityName}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">{row.leadsCount} leads · {row.hotCount} HOT · Spent ${row.spend.toFixed(2)}</p>
                          <p className="text-[10px] text-slate-400 italic mt-0.5">{tip}</p>
                        </>
                      ) : (
                        <p className="text-sm text-slate-400">Insufficient data</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* ── Full cost breakdown table ─────────────────────────────── */}
              <div className="mb-3">
                <h4 className="font-semibold text-slate-700 text-sm">All Entities — Full Cost Breakdown</h4>
                <p className="text-xs text-slate-400">Formula: CPL = Spend ÷ Leads · CPHL = Spend ÷ HOT Leads · Quality Score from Learning History</p>
              </div>
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                    <tr>
                      {["Entity","Type","Leads","HOT","Spend","CPL","Cost/HOT","Cost/WARM","Cost/COLD","Cost/No-Ans","Quality"].map(h => (
                        <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {costIntel.allRows.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[180px] truncate">{r.entityName}</td>
                        <td className="px-3 py-2.5 text-xs text-slate-500">{r.entityType}</td>
                        <td className="px-3 py-2.5 text-slate-600">{r.leadsCount}</td>
                        <td className="px-3 py-2.5">
                          <span className={`font-semibold ${r.hotCount > 0 ? "text-red-600" : "text-slate-300"}`}>{r.hotCount}</span>
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">{r.spend > 0 ? `$${r.spend.toFixed(2)}` : "—"}</td>
                        <td className="px-3 py-2.5 text-slate-600">{r.cpl != null ? `$${r.cpl.toFixed(2)}` : "—"}</td>
                        <td className="px-3 py-2.5">
                          {r.costPerHotLead != null ? (
                            <span className={`font-semibold ${r.costPerHotLead < 30 ? "text-green-700" : r.costPerHotLead < 80 ? "text-yellow-700" : "text-red-700"}`}>
                              ${r.costPerHotLead.toFixed(2)}
                            </span>
                          ) : "—"}
                        </td>
                        <td className="px-3 py-2.5 text-slate-500">{r.costPerWarmLead != null ? `$${r.costPerWarmLead.toFixed(2)}` : "—"}</td>
                        <td className="px-3 py-2.5 text-slate-500">{r.costPerColdLead != null ? `$${r.costPerColdLead.toFixed(2)}` : "—"}</td>
                        <td className="px-3 py-2.5 text-slate-500">{r.costPerNoAnswer != null ? `$${r.costPerNoAnswer.toFixed(2)}` : "—"}</td>
                        <td className="px-3 py-2.5">
                          {r.qualityScore != null ? (
                            <span className={`font-semibold ${r.qualityScore >= 7 ? "text-green-700" : r.qualityScore >= 4 ? "text-yellow-700" : "text-red-700"}`}>
                              {r.qualityScore.toFixed(1)}
                            </span>
                          ) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 p-3 bg-slate-100 rounded-lg text-xs text-slate-500 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-[#3bcac4] flex-shrink-0" />
                <span>Read-only calculations. No CRM records, Meta ads, or budget values are modified. All figures are computed from Learning History data you entered.</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── AI Strategy ─────────────────────────────────────────────────────────── */}
      {sub === "strategy" && (
        <div>
          <div className="mb-4">
            <h3 className="font-bold text-slate-800 text-base">AI Strategy Engine</h3>
            <p className="text-sm text-slate-500">Pattern analysis from historical data. Read-only — no actions are taken automatically.</p>
          </div>

          {stratLoading ? (
            <div className="text-center py-12 text-slate-400">Analyzing historical data…</div>
          ) : !strategy || strategy.insufficient ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-slate-400">
                <TrendingUp className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Not enough historical data.</p>
                <p className="text-sm mt-1">Strategy insights appear once campaign attribution data with at least 3 leads per campaign is available.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* ── Trend cards ─────────────────────────────────────────────── */}
              {strategy.trends && (
                <div className="mb-6">
                  <h4 className="font-semibold text-slate-700 text-sm mb-2">HOT Lead Rate Trend</h4>
                  <div className="grid grid-cols-3 gap-3">
                    {([
                      { label: "Last 7 Days",  t: strategy.trends.last7d  },
                      { label: "Last 30 Days", t: strategy.trends.last30d },
                      { label: "Last 90 Days", t: strategy.trends.last90d },
                    ] as const).map(({ label, t }) => {
                      const trendCls = t.trend === "improving" ? "text-green-700 bg-green-50 border-green-200"
                                     : t.trend === "declining" ? "text-red-700 bg-red-50 border-red-200"
                                     : "text-slate-600 bg-slate-50 border-slate-200";
                      const TIcon = t.trend === "improving" ? TrendingUp : t.trend === "declining" ? TrendingDown : Activity;
                      const trendLabel = t.trend === "improving" ? "Improving ↑" : t.trend === "declining" ? "Declining ↓" : "Stable →";
                      return (
                        <Card key={label} className={`border ${trendCls}`}>
                          <CardContent className="p-4">
                            <div className="flex items-center gap-2 mb-1">
                              <TIcon className={`h-4 w-4 ${trendCls.split(" ")[0]}`} />
                              <span className="text-xs font-semibold text-slate-600">{label}</span>
                            </div>
                            {t.leadsCount > 0 ? (
                              <>
                                <p className={`text-xl font-extrabold ${trendCls.split(" ")[0]}`}>{Math.round(t.hotRate * 100)}%</p>
                                <p className="text-[10px] text-slate-500 mt-0.5">{t.leadsCount} attributed leads</p>
                                <p className={`text-xs font-medium mt-1 ${trendCls.split(" ")[0]}`}>{trendLabel}</p>
                              </>
                            ) : (
                              <p className="text-sm text-slate-400 mt-1">No data</p>
                            )}
                          </CardContent>
                        </Card>
                      );
                    })}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1.5">Trend direction: 7d vs 30d baseline · 30d vs 90d baseline. ±5% threshold for Improving/Declining.</p>
                </div>
              )}

              {/* ── Insight cards ────────────────────────────────────────────── */}
              <h4 className="font-semibold text-slate-700 text-sm mb-3">Strategic Insights</h4>
              <div className="space-y-3">
                {strategy.insights.map((ins, i) => {
                  const confCls = ins.confidence === "high"   ? "bg-green-100 text-green-800"
                                : ins.confidence === "medium" ? "bg-yellow-100 text-yellow-800"
                                : "bg-slate-100 text-slate-600";
                  const confLabel = ins.confidence === "high" ? "High Confidence"
                                  : ins.confidence === "medium" ? "Medium Confidence" : "Low Confidence";
                  return (
                    <Card key={i} className="border border-[#3bcac4]/20 bg-gradient-to-r from-white to-[#3bcac4]/5">
                      <CardContent className="p-4">
                        <div className="flex items-start justify-between gap-3 mb-2">
                          <div className="flex items-center gap-2">
                            <Target className="h-4 w-4 text-[#005476] flex-shrink-0" />
                            <p className="font-semibold text-slate-800">{ins.title}</p>
                          </div>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${confCls}`}>
                            {confLabel}
                          </span>
                        </div>
                        <p className="text-sm text-slate-700 mb-1.5">{ins.description}</p>
                        <div className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                          <p className="text-xs text-slate-500 font-medium mb-0.5">Evidence</p>
                          <p className="text-xs text-slate-700">{ins.evidence}</p>
                        </div>
                        <p className="text-[10px] text-slate-400 mt-1.5">{ins.dataPoints} data points · No actions taken automatically</p>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              <div className="mt-4 p-3 bg-slate-100 rounded-lg text-xs text-slate-500 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-[#3bcac4] flex-shrink-0" />
                <span>Strategy intelligence only. No Meta campaigns, budgets, creatives, or audiences are modified. All insights are based on existing historical data.</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Creative Attribution ─────────────────────────────────────────────────── */}
      {sub === "creative" && (
        <div>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-base">Creative Attribution</h3>
              <p className="text-sm text-slate-500">Maps Meta ad creatives to campaigns and lead outcomes. Read-only — no Meta actions.</p>
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <div className="flex flex-col items-end gap-0.5">
                <Button size="sm" variant="outline" onClick={runAttributionBackfill} disabled={backfilling}
                  className="flex items-center gap-1.5 border-slate-300 text-slate-700 hover:bg-slate-50">
                  <RefreshCw className={`h-3.5 w-3.5 ${backfilling ? "animate-spin" : ""}`} />
                  {backfilling ? "Backfilling…" : "Run Attribution Backfill"}
                </Button>
                {backfillStatus && (
                  <p className={`text-xs ${backfillStatus.startsWith("Backfill complete") ? "text-green-700" : "text-red-600"}`}>
                    {backfillStatus}
                  </p>
                )}
              </div>
              <div className="flex flex-col items-end gap-0.5">
                <Button size="sm" variant="outline" onClick={runCreativeSync} disabled={syncing}
                  className="flex items-center gap-1.5 border-[#3bcac4] text-[#005476] hover:bg-[#3bcac4]/10">
                  <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
                  {syncing ? "Syncing…" : "Sync from Meta"}
                </Button>
                {syncStatus && (
                  <p className={`text-xs ${syncStatus.startsWith("Sync complete") ? "text-green-700" : "text-red-600"}`}>
                    {syncStatus}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Summary KPI cards */}
          {creativeData && (
            <div className="grid grid-cols-4 gap-3 mb-5">
              {[
                { label: "Ads Tracked",          value: creativeData.summary.totalAds,           icon: Layers,    color: "text-[#005476]" },
                { label: "Unique Creatives",      value: creativeData.summary.uniqueCreatives,    icon: Globe,     color: "text-[#3bcac4]" },
                { label: "Campaigns Covered",     value: creativeData.summary.campaigns,          icon: Megaphone, color: "text-slate-600" },
                { label: "Attribution Records",   value: creativeData.summary.attributionCount,   icon: Link2,     color: creativeData.summary.attributionCount > 0 ? "text-green-700" : "text-slate-400" },
              ].map(({ label, value, icon: Icon, color }) => (
                <Card key={label}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`h-4 w-4 ${color}`} />
                      <span className="text-xs font-medium text-slate-500">{label}</span>
                    </div>
                    <p className={`text-2xl font-extrabold ${color}`}>{value > 0 ? value : "—"}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Attribution pipeline status notice */}
          {creativeData && creativeData.summary.attributionCount === 0 && (
            <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <div className="text-xs text-amber-800">
                <p className="font-semibold">Campaign attribution is not populated yet.</p>
                <p className="mt-0.5">Click <strong>Run Attribution Backfill</strong> to import attribution data from the lead import queue into the attribution chain. This connects creatives → ads → campaigns → leads.</p>
              </div>
            </div>
          )}

          {creativeLoading ? (
            <div className="text-center py-12 text-slate-400">Loading creative data…</div>
          ) : !creativeData || creativeData.rows.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-12 text-center text-slate-400">
                <Layers className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No creative attribution data yet. Run Creative Sync after Meta read-only connection is active.</p>
                <p className="text-sm mt-2 text-slate-500">Also run <strong>Attribution Backfill</strong> to connect leads already in the queue to the attribution chain.</p>
                <p className="text-xs mt-2 text-slate-400">Requires META_ACCESS_TOKEN and META_AD_ACCOUNT_ID to be configured for creative sync.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gradient-to-r from-[#005476] to-[#3bcac4] text-white">
                      <th className="px-3 py-2 text-left font-semibold">Ad Name</th>
                      <th className="px-3 py-2 text-left font-semibold">Creative</th>
                      <th className="px-3 py-2 text-left font-semibold">Ad Set</th>
                      <th className="px-3 py-2 text-left font-semibold">Campaign</th>
                      <th className="px-3 py-2 text-center font-semibold">Status</th>
                      <th className="px-3 py-2 text-center font-semibold">Total</th>
                      <th className="px-3 py-2 text-center font-semibold text-orange-200">HOT</th>
                      <th className="px-3 py-2 text-center font-semibold text-yellow-200">WARM</th>
                      <th className="px-3 py-2 text-center font-semibold text-blue-200">COLD</th>
                    </tr>
                  </thead>
                  <tbody>
                    {creativeData.rows.map((row, i) => (
                      <tr key={row.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                        <td className="px-3 py-2 font-medium text-slate-800 max-w-[160px] truncate">
                          {row.thumbnailUrl
                            ? <a href={row.thumbnailUrl} target="_blank" rel="noopener noreferrer" className="underline text-[#005476]">{row.adName ?? row.adId}</a>
                            : (row.adName ?? row.adId)
                          }
                        </td>
                        <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate">
                          {row.creativeName ?? (row.creativeId ? `ID: ${row.creativeId.slice(0,10)}…` : "—")}
                        </td>
                        <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate">{row.adsetName ?? "—"}</td>
                        <td className="px-3 py-2 text-slate-600 max-w-[140px] truncate">{row.campaignName ?? "—"}</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            row.status === "ACTIVE" ? "bg-green-100 text-green-800"
                            : row.status === "PAUSED" ? "bg-yellow-100 text-yellow-800"
                            : "bg-slate-100 text-slate-600"
                          }`}>{row.status ?? "—"}</span>
                        </td>
                        <td className="px-3 py-2 text-center font-semibold text-slate-700">{row.totalLeads > 0 ? row.totalLeads : "—"}</td>
                        <td className="px-3 py-2 text-center font-bold text-orange-600">{row.hotLeads > 0 ? row.hotLeads : "—"}</td>
                        <td className="px-3 py-2 text-center font-bold text-yellow-600">{row.warmLeads > 0 ? row.warmLeads : "—"}</td>
                        <td className="px-3 py-2 text-center font-bold text-blue-600">{row.coldLeads > 0 ? row.coldLeads : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-3 p-3 bg-slate-100 rounded-lg text-xs text-slate-500 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-[#3bcac4] flex-shrink-0" />
                <span>Read-only. No Meta creatives, campaigns, or budgets are modified. Lead counts are matched via ad_id from CRM data. Sync fetches up to 50 ads per request.</span>
              </div>
            </>
          )}
        </div>
      )}
      {/* ── Creative Intelligence ─────────────────────────────────────────────── */}
      {sub === "creativeint" && (
        <div>
          <div className="mb-4">
            <h3 className="font-bold text-slate-800 text-base flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-[#3bcac4]" />
              Creative Intelligence Engine
            </h3>
            <p className="text-sm text-slate-500 mt-0.5">Read-only quality analysis of creative performance. No Meta actions. No automation. No fabricated data.</p>
          </div>

          {/* Transparent Formula Card */}
          <Card className="mb-5 border-[#3bcac4]/40 bg-gradient-to-r from-[#005476]/5 to-[#3bcac4]/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="h-4 w-4 text-[#3bcac4]" />
                <span className="font-semibold text-[#005476] text-sm">Quality Score Formula</span>
                <Badge variant="outline" className="text-[10px] ml-1">Transparent</Badge>
              </div>
              <p className="text-sm font-mono text-slate-700 mb-2">
                {creativeIntData?.formula.description ?? "Quality Score = (HOT × 3) + (WARM × 1) + (COLD × −1) + (No Answer × −2)"}
              </p>
              <p className="text-xs text-slate-500 mb-1">{creativeIntData?.formula.normalized ?? "Normalized Score = Raw Score ÷ Total Leads"}</p>
              <p className="text-xs text-slate-500 mb-3">{creativeIntData?.formula.confidence ?? "Low: < 5 leads | Medium: 5–20 leads | High: 20+ leads"}</p>
              <div className="flex flex-wrap gap-2 text-xs">
                {([
                  { label: "HOT Lead",  weight: "+3", cls: "bg-orange-100 text-orange-800" },
                  { label: "WARM Lead", weight: "+1", cls: "bg-yellow-100 text-yellow-800" },
                  { label: "COLD Lead", weight: "−1", cls: "bg-blue-100   text-blue-800"   },
                  { label: "No Answer", weight: "−2", cls: "bg-red-100    text-red-800"    },
                ] as const).map(({ label, weight, cls }) => (
                  <span key={label} className={`px-2 py-1 rounded-full font-semibold ${cls}`}>{label}: {weight}</span>
                ))}
              </div>
            </CardContent>
          </Card>

          {creativeIntLoading ? (
            <div className="text-center py-12 text-slate-400">Analyzing creatives…</div>
          ) : !creativeIntData || creativeIntData.insufficient ? (
            <Card className="border-dashed mb-4">
              <CardContent className="py-10 text-center text-slate-400">
                <Sparkles className="h-10 w-10 mx-auto mb-3 opacity-30" />
                <p className="font-medium">No creative data to analyze yet.</p>
                <p className="text-sm mt-1">Run <strong>Creative Sync</strong> and <strong>Attribution Backfill</strong> first (Creative Attribution tab), then return here.</p>
              </CardContent>
            </Card>
          ) : (
            <>
              {/* Insight cards */}
              {creativeIntData.insights.length > 0 && (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6">
                  {creativeIntData.insights.map((ins) => {
                    const isBest  = ["best_quality","highest_hot_rate","most_consistent"].includes(ins.type);
                    const isWorst = ["worst_quality","lowest_hot_rate","highest_no_answer"].includes(ins.type);
                    const borderCls = isBest  ? "border-green-200 bg-green-50"
                                    : isWorst ? "border-red-200   bg-red-50"
                                    : "border-slate-200 bg-white";
                    const confBadge = ins.confidence === "high"   ? "bg-green-100  text-green-800"
                                    : ins.confidence === "medium" ? "bg-blue-100   text-blue-800"
                                    : "bg-yellow-100 text-yellow-800";
                    const valCls = isBest  ? "text-green-700"
                                 : isWorst ? "text-red-700"
                                 : "text-[#005476]";
                    return (
                      <Card key={ins.type} className={`border ${borderCls}`}>
                        <CardContent className="p-4">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <p className={`text-[11px] font-bold uppercase tracking-wide ${isBest ? "text-green-700" : isWorst ? "text-red-700" : "text-slate-600"}`}>{ins.title}</p>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 ${confBadge}`}>{ins.confidence}</span>
                          </div>
                          <p className="text-sm font-semibold text-slate-800 truncate mb-0.5">{ins.creativeName}</p>
                          <p className="text-xs text-slate-500 truncate mb-3">{ins.campaignName}</p>
                          <div className="flex items-center justify-between border-t border-slate-100 pt-2">
                            <span className="text-xs text-slate-500">{ins.metricLabel}</span>
                            <span className={`text-base font-extrabold ${valCls}`}>{ins.metricValue}</span>
                          </div>
                          <p className="text-[10px] text-slate-400 mt-2">{ins.evidence}</p>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}

              {/* Ranked creative table */}
              <div className="mb-5">
                <h4 className="text-sm font-semibold text-slate-700 mb-2">All Creatives — Ranked by Quality Score</h4>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gradient-to-r from-[#005476] to-[#3bcac4] text-white">
                        <th className="px-2 py-2 text-left font-semibold">#</th>
                        <th className="px-3 py-2 text-left font-semibold">Creative / Ad</th>
                        <th className="px-3 py-2 text-center font-semibold">Score/Lead</th>
                        <th className="px-3 py-2 text-center font-semibold">Raw</th>
                        <th className="px-3 py-2 text-center font-semibold text-orange-200">HOT%</th>
                        <th className="px-3 py-2 text-center font-semibold">Total</th>
                        <th className="px-3 py-2 text-center font-semibold text-orange-200">HOT</th>
                        <th className="px-3 py-2 text-center font-semibold text-yellow-200">WARM</th>
                        <th className="px-3 py-2 text-center font-semibold text-blue-200">COLD</th>
                        <th className="px-3 py-2 text-center font-semibold">No Ans.</th>
                        <th className="px-3 py-2 text-center font-semibold">Conf.</th>
                        <th className="px-3 py-2 text-center font-semibold">7d</th>
                        <th className="px-3 py-2 text-center font-semibold">30d</th>
                        <th className="px-3 py-2 text-center font-semibold">90d</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...creativeIntData.creatives]
                        .sort((a, b) => b.qualityScoreNorm - a.qualityScoreNorm)
                        .map((row, i) => {
                          const scoreColor = row.qualityScoreNorm >= 1.5 ? "text-green-700 font-extrabold"
                            : row.qualityScoreNorm >= 0.5  ? "text-[#3bcac4] font-bold"
                            : row.qualityScoreNorm >= -0.5 ? "text-yellow-600 font-semibold"
                            : "text-red-600 font-bold";
                          const TI = ({ t }: { t: "improving" | "declining" | "stable" }) =>
                            t === "improving" ? <ArrowUpRight   className="h-3.5 w-3.5 text-green-600 mx-auto" />
                            : t === "declining" ? <ArrowDownRight className="h-3.5 w-3.5 text-red-500   mx-auto" />
                            : <Minus className="h-3.5 w-3.5 text-slate-300 mx-auto" />;
                          const confCls = row.confidence === "high"   ? "text-green-700 font-bold capitalize"
                            : row.confidence === "medium" ? "text-blue-600 capitalize"
                            : "text-yellow-600 capitalize";
                          return (
                            <tr key={row.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50"}>
                              <td className="px-2 py-2 text-slate-400 font-medium">{i + 1}</td>
                              <td className="px-3 py-2 max-w-[180px]">
                                <p className="font-medium text-slate-800 truncate">{row.creativeName ?? row.adName ?? row.adId}</p>
                                <p className="text-[10px] text-slate-400 truncate">{row.campaignName ?? "—"}</p>
                              </td>
                              <td className={`px-3 py-2 text-center text-sm ${scoreColor}`}>{row.qualityScoreNorm}</td>
                              <td className="px-3 py-2 text-center text-slate-500">({row.qualityScore})</td>
                              <td className="px-3 py-2 text-center font-semibold text-orange-600">{row.hotRate > 0 ? `${row.hotRate}%` : "—"}</td>
                              <td className="px-3 py-2 text-center text-slate-700">{row.totalLeads > 0 ? row.totalLeads : "—"}</td>
                              <td className="px-3 py-2 text-center font-bold text-orange-600">{row.hotLeads > 0 ? row.hotLeads : "—"}</td>
                              <td className="px-3 py-2 text-center text-yellow-600">{row.warmLeads > 0 ? row.warmLeads : "—"}</td>
                              <td className="px-3 py-2 text-center text-blue-600">{row.coldLeads > 0 ? row.coldLeads : "—"}</td>
                              <td className="px-3 py-2 text-center text-slate-500">{row.noAnswerLeads > 0 ? row.noAnswerLeads : "—"}</td>
                              <td className={`px-3 py-2 text-center text-[11px] ${confCls}`}>{row.confidence}</td>
                              <td className="px-3 py-2"><TI t={row.trend7d}  /></td>
                              <td className="px-3 py-2"><TI t={row.trend30d} /></td>
                              <td className="px-3 py-2"><TI t={row.trend90d} /></td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
                <p className="text-[10px] text-slate-400 mt-1.5 pl-1">Trend arrows: <ArrowUpRight className="inline h-3 w-3 text-green-600" /> Improving &nbsp; <Minus className="inline h-3 w-3 text-slate-400" /> Stable &nbsp; <ArrowDownRight className="inline h-3 w-3 text-red-500" /> Declining &nbsp;— based on hot-lead rate shift between comparison periods.</p>
              </div>

              {/* Headline / Copy / CTA Intelligence */}
              <div className="mb-5">
                <h4 className="text-sm font-semibold text-slate-700 mb-2">Headline / Copy / CTA Intelligence</h4>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {[
                    { title: "Headline Intelligence",  msg: "Headline data unavailable."  },
                    { title: "Copy Intelligence",       msg: "Copy data unavailable."       },
                    { title: "CTA Intelligence",        msg: "CTA data unavailable."        },
                  ].map(({ title, msg }) => (
                    <Card key={title} className="border-dashed">
                      <CardContent className="p-4 text-center">
                        <p className="text-xs font-semibold text-slate-600 mb-1.5">{title}</p>
                        <p className="text-xs text-slate-400">{msg}</p>
                        <p className="text-[10px] text-slate-300 mt-1">Not included in Meta creative API response.</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>

              <div className="p-3 bg-slate-100 rounded-lg text-xs text-slate-500 flex items-start gap-2">
                <CheckCircle2 className="h-4 w-4 mt-0.5 text-[#3bcac4] flex-shrink-0" />
                <span>Read-only intelligence engine. No Meta write actions. No automation. All scores computed from real attribution data only. No fabricated conclusions.</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── AI Creative Draft Generator ──────────────────────────────────── */}
      {sub === "creativedraft" && (
        <div className="space-y-6">

          {/* Safety banner */}
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
            <span><strong>Internal Drafts Only.</strong> Generated content is saved as internal drafts. No publishing to Meta. No campaign creation. No ad spend. Admin review required before any use.</span>
          </div>

          {/* Generator form */}
          <Card className="border-[#3bcac4]/30">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2 text-[#005476]">
                <Wand2 className="h-4 w-4 text-[#3bcac4]" />
                Generate Creative Drafts
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs text-slate-600 mb-1 block">Project / Property Name</Label>
                  <Input
                    placeholder="e.g. Panorama Batumi, Alanya Villa..."
                    value={draftInput.project_name}
                    onChange={e => setDraftInput(p => ({ ...p, project_name: e.target.value }))}
                    className="text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-600 mb-1 block">Target Market</Label>
                  <Input
                    placeholder="e.g. Arab 48, Gulf investors, Israeli buyers..."
                    value={draftInput.target_market}
                    onChange={e => setDraftInput(p => ({ ...p, target_market: e.target.value }))}
                    className="text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-slate-600 mb-1 block">Language</Label>
                  <Select value={draftInput.language} onValueChange={v => setDraftInput(p => ({ ...p, language: v }))}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Arabic">Arabic (عربي)</SelectItem>
                      <SelectItem value="Hebrew">Hebrew (עברית)</SelectItem>
                      <SelectItem value="English">English</SelectItem>
                      <SelectItem value="Turkish">Turkish (Türkçe)</SelectItem>
                      <SelectItem value="Russian">Russian (Русский)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-xs text-slate-600 mb-1 block">Goal</Label>
                  <Select value={draftInput.goal} onValueChange={v => setDraftInput(p => ({ ...p, goal: v }))}>
                    <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="more_hot_leads">More HOT Leads</SelectItem>
                      <SelectItem value="lower_no_answer">Lower No Answer Rate</SelectItem>
                      <SelectItem value="more_appointments">More Appointments</SelectItem>
                      <SelectItem value="test_new_angle">Test New Creative Angle</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="text-xs text-slate-600 mb-2 block">Draft Types to Generate <span className="text-slate-400">(leave empty for all)</span></Label>
                <div className="flex flex-wrap gap-2">
                  {["headline","primary_text","cta","hook","image_concept","video_concept"].map(t => {
                    const active = draftInput.draft_types.includes(t);
                    return (
                      <button key={t} onClick={() => toggleDraftType(t)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-all font-medium ${
                          active
                            ? "bg-[#005476] text-white border-[#005476]"
                            : "border-slate-300 text-slate-600 hover:border-[#3bcac4] hover:text-[#005476]"
                        }`}>
                        {t.replace(/_/g, " ")}
                      </button>
                    );
                  })}
                </div>
              </div>

              <Button
                onClick={generateDrafts}
                disabled={generating}
                className="w-full sm:w-auto bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90"
              >
                {generating
                  ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Generating…</>
                  : <><Wand2 className="h-4 w-4 mr-2" />Generate Drafts</>}
              </Button>
            </CardContent>
          </Card>

          {/* Generated draft cards */}
          {generatedDrafts.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#3bcac4]" />
                  Generated Drafts <span className="text-slate-400 font-normal">({generatedDrafts.length})</span>
                </h4>
                <Button variant="outline" size="sm" className="text-xs"
                  onClick={() => generatedDrafts.forEach(d => saveDraftMutation.mutate(d))}>
                  <Save className="h-3.5 w-3.5 mr-1.5" />Save All
                </Button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {generatedDrafts.map((d, i) => {
                  const confCls = d.confidence_level === "high"
                    ? "bg-green-100 text-green-700"
                    : d.confidence_level === "medium"
                    ? "bg-yellow-100 text-yellow-700"
                    : "bg-slate-100 text-slate-500";
                  const typeCls: Record<string, string> = {
                    headline: "bg-[#005476]/10 text-[#005476]",
                    primary_text: "bg-teal-50 text-teal-700",
                    cta: "bg-indigo-50 text-indigo-700",
                    hook: "bg-purple-50 text-purple-700",
                    image_concept: "bg-orange-50 text-orange-700",
                    video_concept: "bg-pink-50 text-pink-700",
                  };
                  return (
                    <Card key={i} className="border flex flex-col">
                      <CardContent className="p-4 flex flex-col gap-2 flex-1">
                        <div className="flex items-center justify-between gap-2 flex-wrap">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${typeCls[d.draft_type] || "bg-slate-100 text-slate-600"}`}>
                            {d.draft_type.replace(/_/g," ")}
                          </span>
                          <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${confCls}`}>
                            {d.confidence_level} confidence
                          </span>
                        </div>
                        <p className="text-sm text-slate-800 leading-relaxed flex-1">{d.draft_text}</p>
                        {d.quality_reason && (
                          <p className="text-[10px] text-slate-400 italic border-t pt-1.5">{d.quality_reason}</p>
                        )}
                        {d.inspiration_source && (
                          <p className="text-[10px] text-slate-400">Source: {d.inspiration_source}</p>
                        )}
                        <Button size="sm" variant="outline"
                          className="mt-1 text-xs text-[#005476] border-[#3bcac4]/50 hover:bg-[#3bcac4]/10"
                          onClick={() => saveDraftMutation.mutate(d)}
                          disabled={saveDraftMutation.isPending}>
                          <Save className="h-3 w-3 mr-1.5" />Save Draft
                        </Button>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </div>
          )}

          {/* Saved drafts library */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
              <FileText className="h-4 w-4 text-[#3bcac4]" />
              Saved Draft Library
            </h4>
            {savedDraftsLoading ? (
              <p className="text-xs text-slate-400 py-4 text-center">Loading drafts…</p>
            ) : !savedDraftsData?.drafts?.length ? (
              <div className="p-8 text-center border border-dashed rounded-lg">
                <Wand2 className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                <p className="text-sm text-slate-400">No saved drafts yet. Generate and save drafts above.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500 border-b">
                      <th className="px-3 py-2 font-medium">Type</th>
                      <th className="px-3 py-2 font-medium">Draft Text</th>
                      <th className="px-3 py-2 font-medium">Language</th>
                      <th className="px-3 py-2 font-medium">Target Market</th>
                      <th className="px-3 py-2 font-medium">Confidence</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {savedDraftsData.drafts.map(d => {
                      const statusCls: Record<string, string> = {
                        draft:               "bg-slate-100 text-slate-600",
                        reviewed:            "bg-blue-100 text-blue-700",
                        approved_internally: "bg-green-100 text-green-700",
                        archived:            "bg-red-50 text-red-400",
                      };
                      return (
                        <tr key={d.id} className="hover:bg-slate-50/50">
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className="bg-[#005476]/10 text-[#005476] px-1.5 py-0.5 rounded text-[10px] font-medium">
                              {d.draft_type.replace(/_/g," ")}
                            </span>
                          </td>
                          <td className="px-3 py-2 max-w-[220px]">
                            <p className="line-clamp-2 text-slate-700">{d.draft_text}</p>
                          </td>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{d.language || "—"}</td>
                          <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">{d.target_market || "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              d.confidence_level === "high" ? "bg-green-100 text-green-700"
                              : d.confidence_level === "medium" ? "bg-yellow-100 text-yellow-700"
                              : "bg-slate-100 text-slate-500"
                            }`}>{d.confidence_level}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <Select
                              value={d.status}
                              onValueChange={v => updateDraftStatusMutation.mutate({ id: d.id, status: v })}>
                              <SelectTrigger className={`h-6 text-[10px] w-32 border-0 px-1.5 rounded-full font-medium ${statusCls[d.status] || "bg-slate-100 text-slate-600"}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="draft">Draft</SelectItem>
                                <SelectItem value="reviewed">Reviewed</SelectItem>
                                <SelectItem value="approved_internally">Approved Internally</SelectItem>
                                <SelectItem value="archived">Archived</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-400">
                            {new Date(d.created_at).toLocaleDateString()}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => deleteDraftMutation.mutate(d.id)}
                              className="text-slate-300 hover:text-red-500 transition-colors"
                              title="Delete draft">
                              <X className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="p-3 bg-slate-100 rounded-lg text-xs text-slate-500 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 text-[#3bcac4] shrink-0" />
            <span>Internal draft tool only. Approved Internally does not mean published to Meta. No campaign creation. No ad spend. No Meta write actions. Drafts are for internal review and planning only.</span>
          </div>
        </div>
      )}

      {/* ── Campaign Draft Builder ──────────────────────────────────────────── */}
      {sub === "campaigndraft" && (
        <div className="space-y-6">

          {/* Safety banner */}
          <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-500" />
            <span><strong>Internal Drafts Only.</strong> This builder creates internal campaign planning documents. No Meta publishing. No real campaign creation. No ad spend. No budget changes. Admin review required before any use.</span>
          </div>

          {/* ── Input form ── */}
          {!generatedCampaign && (
            <Card className="border-[#3bcac4]/30">
              <CardHeader className="pb-3">
                <CardTitle className="text-base flex items-center gap-2 text-[#005476]">
                  <LayoutTemplate className="h-4 w-4 text-[#3bcac4]" />
                  Campaign Draft Configuration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div>
                    <Label className="text-xs text-slate-600 mb-1 block">Project / Property Name</Label>
                    <Input placeholder="e.g. Panorama Batumi, Alanya Villa…" value={campInput.project_name}
                      onChange={e => setCampInput(p => ({ ...p, project_name: e.target.value }))} className="text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-600 mb-1 block">Target Market</Label>
                    <Input placeholder="e.g. Arab 48, Gulf investors…" value={campInput.target_market}
                      onChange={e => setCampInput(p => ({ ...p, target_market: e.target.value }))} className="text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-600 mb-1 block">Language</Label>
                    <Select value={campInput.language} onValueChange={v => setCampInput(p => ({ ...p, language: v }))}>
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Arabic">Arabic (عربي)</SelectItem>
                        <SelectItem value="Hebrew">Hebrew (עברית)</SelectItem>
                        <SelectItem value="English">English</SelectItem>
                        <SelectItem value="Turkish">Turkish (Türkçe)</SelectItem>
                        <SelectItem value="Russian">Russian (Русский)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-600 mb-1 block">Campaign Goal</Label>
                    <Select value={campInput.goal} onValueChange={v => setCampInput(p => ({ ...p, goal: v }))}>
                      <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="more_hot_leads">More HOT Leads</SelectItem>
                        <SelectItem value="lower_no_answer">Lower No Answer Rate</SelectItem>
                        <SelectItem value="more_appointments">More Appointments</SelectItem>
                        <SelectItem value="test_new_angle">Test New Creative Angle</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-600 mb-1 block">Daily Budget</Label>
                    <div className="flex gap-1">
                      <Input placeholder="e.g. 150" value={campInput.daily_budget_amount}
                        onChange={e => setCampInput(p => ({ ...p, daily_budget_amount: e.target.value }))} className="text-sm" />
                      <Select value={campInput.daily_budget_currency} onValueChange={v => setCampInput(p => ({ ...p, daily_budget_currency: v }))}>
                        <SelectTrigger className="text-sm w-20"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="USD">USD</SelectItem>
                          <SelectItem value="ILS">ILS</SelectItem>
                          <SelectItem value="EUR">EUR</SelectItem>
                          <SelectItem value="AED">AED</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-600 mb-1 block">Target Country</Label>
                    <Input placeholder="e.g. Israel, UAE, Egypt…" value={campInput.country}
                      onChange={e => setCampInput(p => ({ ...p, country: e.target.value }))} className="text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-600 mb-1 block">City / Region</Label>
                    <Input placeholder="e.g. Tel Aviv, Dubai, Cairo…" value={campInput.city_region}
                      onChange={e => setCampInput(p => ({ ...p, city_region: e.target.value }))} className="text-sm" />
                  </div>
                  <div>
                    <Label className="text-xs text-slate-600 mb-1 block">Age Range</Label>
                    <div className="flex gap-1 items-center">
                      <Input placeholder="25" value={campInput.age_min}
                        onChange={e => setCampInput(p => ({ ...p, age_min: e.target.value }))} className="text-sm w-20" />
                      <span className="text-xs text-slate-400">–</span>
                      <Input placeholder="55" value={campInput.age_max}
                        onChange={e => setCampInput(p => ({ ...p, age_max: e.target.value }))} className="text-sm w-20" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-slate-600 mb-1 block">Audience Notes <span className="text-slate-400">(optional)</span></Label>
                    <Input placeholder="e.g. interested in investment properties…" value={campInput.audience_notes}
                      onChange={e => setCampInput(p => ({ ...p, audience_notes: e.target.value }))} className="text-sm" />
                  </div>
                </div>
                <Button onClick={generateCampaignDraft} disabled={generatingCampaign}
                  className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90">
                  {generatingCampaign
                    ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Generating Campaign Draft…</>
                    : <><LayoutTemplate className="h-4 w-4 mr-2" />Generate Campaign Draft</>}
                </Button>
              </CardContent>
            </Card>
          )}

          {/* ── Generated campaign draft preview ── */}
          {generatedCampaign && (() => {
            const g = generatedCampaign;
            const confCls = g.confidence_level === "high" ? "bg-green-100 text-green-700"
              : g.confidence_level === "medium" ? "bg-yellow-100 text-yellow-700"
              : "bg-slate-100 text-slate-500";

            const SectionHeader = ({ icon: Icon, title, skey }: { icon: any; title: string; skey: string }) => (
              <button onClick={() => toggleSection(skey)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 transition-colors">
                <span className="flex items-center gap-2 text-sm font-semibold text-[#005476]">
                  <Icon className="h-4 w-4 text-[#3bcac4]" />{title}
                </span>
                {expandedSections[skey] ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
              </button>
            );

            return (
              <div className="space-y-3">
                {/* Action bar */}
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-[#3bcac4]" />Generated Campaign Draft
                  </h4>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="text-xs"
                      onClick={() => { setGeneratedCampaign(null); setCampaignSafetyChecks(null); }}>
                      <X className="h-3.5 w-3.5 mr-1.5" />Discard
                    </Button>
                    <Button size="sm" onClick={saveCampaignDraft} disabled={saveCampaignDraftMutation.isPending}
                      className="text-xs bg-[#005476] text-white hover:bg-[#005476]/90">
                      <Save className="h-3.5 w-3.5 mr-1.5" />Save Campaign Draft
                    </Button>
                  </div>
                </div>

                {/* Campaign overview */}
                <Card className="border overflow-hidden">
                  <SectionHeader icon={LayoutTemplate} title="Campaign Overview" skey="campaign" />
                  {expandedSections.campaign && (
                    <CardContent className="pt-0 pb-4 px-4 space-y-2">
                      <div className="flex items-start justify-between flex-wrap gap-2">
                        <div>
                          <p className="text-base font-semibold text-slate-800">{g.campaign_name}</p>
                          <p className="text-xs text-slate-500 mt-0.5">{g.project_name} · {g.target_market} · {g.language}</p>
                        </div>
                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${confCls}`}>{g.confidence_level} confidence</span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                        <div className="bg-slate-50 rounded p-2"><span className="text-slate-400 block">Goal</span><span className="font-medium text-slate-700">{g.goal.replace(/_/g," ")}</span></div>
                        <div className="bg-slate-50 rounded p-2"><span className="text-slate-400 block">Daily Budget</span><span className="font-medium text-slate-700">{g.daily_budget_amount || "TBD"} {g.daily_budget_currency}</span></div>
                        <div className="bg-slate-50 rounded p-2"><span className="text-slate-400 block">Country</span><span className="font-medium text-slate-700">{g.country || "—"}</span></div>
                        <div className="bg-slate-50 rounded p-2"><span className="text-slate-400 block">Objective</span><span className="font-medium text-slate-700">Lead Form</span></div>
                      </div>
                      <p className="text-xs text-slate-600 italic border-t pt-2">{g.strategy_reason}</p>
                      {g.safety_warnings?.length > 0 && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded p-2 space-y-0.5">
                          {g.safety_warnings.map((w, i) => (
                            <p key={i} className="text-[10px] text-yellow-800 flex items-start gap-1"><AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />{w}</p>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  )}
                </Card>

                {/* Ad Set draft */}
                <Card className="border overflow-hidden">
                  <SectionHeader icon={Target} title="Ad Set Draft" skey="adset" />
                  {expandedSections.adset && g.adset && (
                    <CardContent className="pt-0 pb-4 px-4 space-y-2 text-xs">
                      <p className="font-semibold text-slate-700">{g.adset.adset_name}</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div><span className="text-slate-400 block mb-1">Interests</span>
                          <div className="flex flex-wrap gap-1">{(g.adset.interests||[]).map((x,i) => <span key={i} className="bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded text-[10px]">{x}</span>)}</div>
                        </div>
                        <div><span className="text-slate-400 block mb-1">Exclusions</span>
                          <div className="flex flex-wrap gap-1">{(g.adset.exclusions||[]).map((x,i) => <span key={i} className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-[10px]">{x}</span>)}</div>
                        </div>
                      </div>
                      {g.adset.placement_notes && <p className="text-slate-600"><span className="text-slate-400">Placements: </span>{g.adset.placement_notes}</p>}
                      {g.adset.budget_notes && <p className="text-slate-600"><span className="text-slate-400">Budget: </span>{g.adset.budget_notes}</p>}
                    </CardContent>
                  )}
                </Card>

                {/* Audience draft */}
                <Card className="border overflow-hidden">
                  <SectionHeader icon={Users} title="Audience Draft" skey="audience" />
                  {expandedSections.audience && g.audience && (
                    <CardContent className="pt-0 pb-4 px-4 space-y-2 text-xs">
                      <p className="font-semibold text-slate-700">{g.audience.audience_name}</p>
                      <div className="grid grid-cols-3 gap-2">
                        <div className="bg-slate-50 rounded p-2"><span className="text-slate-400 block">Age Range</span><span className="font-medium text-slate-700">{g.audience.age_range}</span></div>
                        <div className="bg-slate-50 rounded p-2 col-span-2"><span className="text-slate-400 block">Quality Reason</span><span className="font-medium text-slate-700">{g.audience.quality_reason}</span></div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div><span className="text-slate-400 block mb-1">Interests</span>
                          <div className="flex flex-wrap gap-1">{(g.audience.interests||[]).map((x,i) => <span key={i} className="bg-teal-50 text-teal-700 px-1.5 py-0.5 rounded text-[10px]">{x}</span>)}</div>
                        </div>
                        <div><span className="text-slate-400 block mb-1">Exclusions</span>
                          <div className="flex flex-wrap gap-1">{(g.audience.exclusions||[]).map((x,i) => <span key={i} className="bg-red-50 text-red-600 px-1.5 py-0.5 rounded text-[10px]">{x}</span>)}</div>
                        </div>
                      </div>
                    </CardContent>
                  )}
                </Card>

                {/* Lead Form draft */}
                <Card className="border overflow-hidden">
                  <SectionHeader icon={ClipboardList} title="Lead Form Draft" skey="lead_form" />
                  {expandedSections.lead_form && g.lead_form && (
                    <CardContent className="pt-0 pb-4 px-4 space-y-3 text-xs">
                      <p className="font-semibold text-slate-700">{g.lead_form.form_name}</p>
                      {g.lead_form.intro_text && (
                        <div className="bg-[#005476]/5 border border-[#005476]/15 rounded p-2">
                          <p className="text-[10px] text-slate-400 mb-0.5">Intro Text</p>
                          <p className="text-slate-700">{g.lead_form.intro_text}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-slate-400 mb-1.5">Questions ({g.lead_form.questions?.length || 0})</p>
                        <div className="space-y-1.5">
                          {(g.lead_form.questions||[]).map((q, i) => (
                            <div key={i} className="flex items-start gap-2 bg-slate-50 rounded px-2 py-1.5">
                              <span className="text-[10px] font-bold text-[#3bcac4] mt-0.5 shrink-0">Q{i+1}</span>
                              <span className="text-slate-700 flex-1">{q.text}</span>
                              <span className="text-[10px] text-slate-400 shrink-0">{q.type}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {g.lead_form.privacy_note && (
                        <p className="text-slate-500 italic border-t pt-2">{g.lead_form.privacy_note}</p>
                      )}
                      {g.lead_form.qualification_goal && (
                        <p className="text-slate-500"><span className="text-slate-400">Qualification goal: </span>{g.lead_form.qualification_goal}</p>
                      )}
                    </CardContent>
                  )}
                </Card>

                {/* Safety Review */}
                <Card className="border overflow-hidden">
                  <SectionHeader icon={Shield} title="Safety Review" skey="safety" />
                  {expandedSections.safety && campaignSafetyChecks && (
                    <CardContent className="pt-0 pb-4 px-4">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {([
                          ["no_roi_promise",       "No ROI Promise"],
                          ["no_guaranteed_return", "No Guaranteed Return Claim"],
                          ["no_fake_price",        "No Fake Price Claim"],
                          ["no_discriminatory",    "No Discriminatory Targeting"],
                          ["no_sensitive_data",    "No Sensitive Personal Data"],
                          ["draft_only",           "Draft Only — Not Published"],
                        ] as [keyof SafetyChecks, string][]).map(([key, label]) => {
                          const passed = campaignSafetyChecks[key];
                          return (
                            <div key={key} className={`flex items-center gap-2 px-2 py-1.5 rounded text-xs ${passed ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                              {passed
                                ? <BadgeCheck className="h-3.5 w-3.5 shrink-0" />
                                : <XCircle className="h-3.5 w-3.5 shrink-0" />}
                              {label}
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  )}
                </Card>

                {/* Bottom save */}
                <div className="flex justify-end gap-2 pt-1">
                  <Button variant="outline" size="sm" className="text-xs"
                    onClick={() => { setGeneratedCampaign(null); setCampaignSafetyChecks(null); }}>
                    <X className="h-3.5 w-3.5 mr-1.5" />Discard & Start Over
                  </Button>
                  <Button size="sm" onClick={saveCampaignDraft} disabled={saveCampaignDraftMutation.isPending}
                    className="text-xs bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90">
                    <Save className="h-3.5 w-3.5 mr-1.5" />Save Full Campaign Draft
                  </Button>
                </div>
              </div>
            );
          })()}

          {/* ── Saved campaign drafts ── */}
          <div>
            <h4 className="text-sm font-semibold text-slate-700 flex items-center gap-2 mb-3">
              <FileText className="h-4 w-4 text-[#3bcac4]" />
              Saved Campaign Drafts
            </h4>
            {savedCampaignDraftsLoading ? (
              <p className="text-xs text-slate-400 py-4 text-center">Loading drafts…</p>
            ) : !savedCampaignDraftsData?.drafts?.length ? (
              <div className="p-8 text-center border border-dashed rounded-lg">
                <LayoutTemplate className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                <p className="text-sm text-slate-400">No saved campaign drafts yet. Generate and save a draft above.</p>
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-left text-slate-500 border-b">
                      <th className="px-3 py-2 font-medium">Campaign Name</th>
                      <th className="px-3 py-2 font-medium">Project</th>
                      <th className="px-3 py-2 font-medium">Market / Language</th>
                      <th className="px-3 py-2 font-medium">Budget</th>
                      <th className="px-3 py-2 font-medium">Confidence</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">Date</th>
                      <th className="px-3 py-2 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {savedCampaignDraftsData.drafts.map(d => {
                      const statusCls: Record<string, string> = {
                        draft:               "bg-slate-100 text-slate-600",
                        reviewed:            "bg-blue-100 text-blue-700",
                        approved_internally: "bg-green-100 text-green-700",
                        archived:            "bg-red-50 text-red-400",
                      };
                      return (
                        <tr key={d.id} className="hover:bg-slate-50/50">
                          <td className="px-3 py-2 font-medium text-slate-800 max-w-[180px] truncate">{d.campaign_name}</td>
                          <td className="px-3 py-2 text-slate-500 max-w-[120px] truncate">{d.project_name || "—"}</td>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{d.target_market || "—"} · {d.language || "—"}</td>
                          <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{d.daily_budget_amount ? `${d.daily_budget_amount} ${d.daily_budget_currency}` : "—"}</td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${
                              d.confidence_level === "high" ? "bg-green-100 text-green-700"
                              : d.confidence_level === "medium" ? "bg-yellow-100 text-yellow-700"
                              : "bg-slate-100 text-slate-500"}`}>{d.confidence_level}</span>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap">
                            <Select value={d.status}
                              onValueChange={v => updateCampaignDraftStatusMutation.mutate({ id: d.id, status: v })}>
                              <SelectTrigger className={`h-6 text-[10px] w-32 border-0 px-1.5 rounded-full font-medium ${statusCls[d.status] || "bg-slate-100 text-slate-600"}`}>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="draft">Draft</SelectItem>
                                <SelectItem value="reviewed">Reviewed</SelectItem>
                                <SelectItem value="approved_internally">Approved Internally</SelectItem>
                                <SelectItem value="archived">Archived</SelectItem>
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-3 py-2 whitespace-nowrap text-slate-400">{new Date(d.created_at).toLocaleDateString()}</td>
                          <td className="px-3 py-2">
                            <button onClick={() => deleteCampaignDraftMutation.mutate(d.id)}
                              className="text-slate-300 hover:text-red-500 transition-colors" title="Delete draft">
                              <X className="h-4 w-4" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="p-3 bg-slate-100 rounded-lg text-xs text-slate-500 flex items-start gap-2">
            <CheckCircle2 className="h-4 w-4 mt-0.5 text-[#3bcac4] shrink-0" />
            <span>Internal campaign draft builder only. Approved Internally does NOT mean published to Meta. No real campaign creation. No ad spend. No Meta write actions of any kind. All drafts require human review before use.</span>
          </div>
        </div>
      )}

      {/* ── Marketing Knowledge Base ──────────────────────────────────────────── */}
      {sub === "knowledgebase" && (
        <div className="space-y-5">

          {/* List view */}
          {kbView === "list" && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-[#005476] flex items-center gap-2">
                    <Library className="h-4 w-4 text-[#3bcac4]" />Marketing Knowledge Base
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">Teach AI about each project — alias, angles, markets, and forbidden claims</p>
                </div>
                <Button size="sm"
                  onClick={() => { setKbForm({ use_real_project_name: false, status: "active" }); setKbView("create"); }}
                  className="text-xs bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90">
                  <Plus className="h-3.5 w-3.5 mr-1.5" />New Profile
                </Button>
              </div>

              {kbProfilesLoading ? (
                <p className="text-xs text-slate-400 py-8 text-center">Loading profiles…</p>
              ) : !kbProfilesData?.profiles?.length ? (
                <div className="p-10 text-center border border-dashed rounded-xl">
                  <Library className="h-10 w-10 mx-auto mb-3 text-slate-200" />
                  <p className="text-sm font-medium text-slate-400">No marketing profiles yet</p>
                  <p className="text-xs text-slate-300 mt-1">Create a profile to give AI project-specific context for draft generation</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {kbProfilesData.profiles.map(p => (
                    <div key={p.id}
                      className="border rounded-xl p-4 bg-white hover:border-[#3bcac4]/50 hover:shadow-sm transition-all cursor-pointer"
                      onClick={() => { setActiveKbId(p.id); setKbView("detail"); setKbForm({ ...p }); }}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-slate-800 truncate">
                            {p.marketing_alias || p.internal_project_name}
                          </p>
                          {p.marketing_alias && (
                            <p className="text-[10px] text-slate-400 truncate">internal: {p.internal_project_name}</p>
                          )}
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${
                          p.status === "active" ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500"}`}>
                          {p.status}
                        </span>
                      </div>
                      <div className="space-y-1 text-xs text-slate-500">
                        {p.project_type && <p className="flex items-center gap-1"><Building2 className="h-3 w-3" />{p.project_type}</p>}
                        {p.location    && <p className="flex items-center gap-1"><Globe    className="h-3 w-3" />{p.location}</p>}
                      </div>
                      <div className="flex items-center flex-wrap gap-1.5 mt-3 pt-2 border-t border-slate-50">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-1 ${p.use_real_project_name ? "bg-blue-50 text-blue-600" : "bg-[#3bcac4]/10 text-[#005476]"}`}>
                          <Tag className="h-2.5 w-2.5" />{p.use_real_project_name ? "Real Name" : "Alias Only"}
                        </span>
                        {Number(p.angles_count)  > 0 && <span className="text-[10px] bg-teal-50  text-teal-700 px-1.5 py-0.5 rounded">{p.angles_count} angles</span>}
                        {Number(p.markets_count) > 0 && <span className="text-[10px] bg-blue-50  text-blue-700 px-1.5 py-0.5 rounded">{p.markets_count} markets</span>}
                        {Number(p.claims_count)  > 0 && <span className="text-[10px] bg-red-50   text-red-600  px-1.5 py-0.5 rounded">{p.claims_count} forbidden</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Create / Detail view */}
          {(kbView === "create" || kbView === "detail") && (
            <>
              <div className="flex items-center gap-3">
                <button onClick={() => { setKbView("list"); setActiveKbId(null); }}
                  className="text-xs text-[#3bcac4] hover:underline flex items-center gap-1">
                  <ChevronRight className="h-3.5 w-3.5 rotate-180" />Back to list
                </button>
                <span className="text-slate-300">|</span>
                <h3 className="text-sm font-semibold text-[#005476]">
                  {kbView === "create" ? "New Marketing Profile" : (kbForm.marketing_alias || kbForm.internal_project_name || "Edit Profile")}
                </h3>
              </div>

              {/* Profile form */}
              <Card className="border-[#3bcac4]/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2 text-[#005476]">
                    <Building2 className="h-3.5 w-3.5 text-[#3bcac4]" />Project Profile
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs text-slate-600 mb-1 block">Internal Project Name <span className="text-red-400">*</span></Label>
                      <Input placeholder="e.g. Panorama Batumi Phase 2" value={kbForm.internal_project_name || ""}
                        onChange={e => setKbForm(p => ({ ...p, internal_project_name: e.target.value }))} className="text-sm" />
                      <p className="text-[10px] text-slate-400 mt-0.5">Used for lookup only — hidden from AI if alias is set</p>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-600 mb-1 block">Marketing Alias</Label>
                      <Input placeholder="e.g. Swiss Alps Residences Batumi" value={kbForm.marketing_alias || ""}
                        onChange={e => setKbForm(p => ({ ...p, marketing_alias: e.target.value }))} className="text-sm" />
                      <p className="text-[10px] text-slate-400 mt-0.5">AI will use this name by default</p>
                    </div>
                    <div className="sm:col-span-2">
                      <div className="flex items-center gap-3 bg-slate-50 rounded-lg px-3 py-2 cursor-pointer"
                        onClick={() => setKbForm(p => ({ ...p, use_real_project_name: !p.use_real_project_name }))}>
                        {kbForm.use_real_project_name
                          ? <ToggleRight className="h-5 w-5 text-[#3bcac4]" />
                          : <ToggleLeft  className="h-5 w-5 text-slate-400" />}
                        <span className={`text-xs font-medium ${kbForm.use_real_project_name ? "text-[#005476]" : "text-slate-500"}`}>
                          {kbForm.use_real_project_name ? "AI uses the real project name" : "AI uses marketing alias only (recommended)"}
                        </span>
                        {!kbForm.use_real_project_name && kbForm.marketing_alias && (
                          <span className="text-[10px] text-teal-600 bg-teal-50 px-2 py-0.5 rounded-full ml-auto">
                            AI sees: "{kbForm.marketing_alias}"
                          </span>
                        )}
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-600 mb-1 block">Project Type</Label>
                      <Select value={kbForm.project_type || ""} onValueChange={v => setKbForm(p => ({ ...p, project_type: v || null }))}>
                        <SelectTrigger className="text-sm"><SelectValue placeholder="Select type…" /></SelectTrigger>
                        <SelectContent>
                          {["Apartment Complex","Villa","Hotel Residence","Branded Residence","Land","Mixed Use","Commercial","Resort"].map(t =>
                            <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-600 mb-1 block">Location</Label>
                      <Input placeholder="e.g. Batumi, Georgia" value={kbForm.location || ""}
                        onChange={e => setKbForm(p => ({ ...p, location: e.target.value }))} className="text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-600 mb-1 block">Luxury Level</Label>
                      <Select value={kbForm.luxury_level || ""} onValueChange={v => setKbForm(p => ({ ...p, luxury_level: v || null }))}>
                        <SelectTrigger className="text-sm"><SelectValue placeholder="Select level…" /></SelectTrigger>
                        <SelectContent>
                          {["Ultra Luxury","Luxury","Premium","Upper Mid"].map(l =>
                            <SelectItem key={l} value={l}>{l}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-600 mb-1 block">Status</Label>
                      <Select value={kbForm.status || "active"} onValueChange={v => setKbForm(p => ({ ...p, status: v }))}>
                        <SelectTrigger className="text-sm"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="archived">Archived</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs text-slate-600 mb-1 block">Target Investor Type</Label>
                      <Input placeholder="e.g. Arab high-net-worth investors" value={kbForm.target_investor_type || ""}
                        onChange={e => setKbForm(p => ({ ...p, target_investor_type: e.target.value }))} className="text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs text-slate-600 mb-1 block">Target Buyer Type</Label>
                      <Input placeholder="e.g. Families, retirees, investors" value={kbForm.target_buyer_type || ""}
                        onChange={e => setKbForm(p => ({ ...p, target_buyer_type: e.target.value }))} className="text-sm" />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs text-slate-600 mb-1 block">Short Marketing Description</Label>
                      <Input placeholder="1–2 sentence description AI uses as project context" value={kbForm.short_marketing_description || ""}
                        onChange={e => setKbForm(p => ({ ...p, short_marketing_description: e.target.value }))} className="text-sm" />
                    </div>
                    <div className="sm:col-span-2">
                      <Label className="text-xs text-slate-600 mb-1 block">Internal Notes</Label>
                      <Input placeholder="Team notes — not sent to AI" value={kbForm.confidence_notes || ""}
                        onChange={e => setKbForm(p => ({ ...p, confidence_notes: e.target.value }))} className="text-sm" />
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    {kbView === "create" ? (
                      <Button size="sm"
                        onClick={() => createProfileMutation.mutate(kbForm)}
                        disabled={!kbForm.internal_project_name || createProfileMutation.isPending}
                        className="text-xs bg-[#005476] text-white hover:bg-[#005476]/90">
                        <Save className="h-3.5 w-3.5 mr-1.5" />
                        {createProfileMutation.isPending ? "Creating…" : "Create Profile"}
                      </Button>
                    ) : (
                      <>
                        <Button size="sm"
                          onClick={() => updateProfileMutation.mutate({ id: activeKbId!, body: kbForm })}
                          disabled={!kbForm.internal_project_name || updateProfileMutation.isPending}
                          className="text-xs bg-[#005476] text-white hover:bg-[#005476]/90">
                          <Save className="h-3.5 w-3.5 mr-1.5" />
                          {updateProfileMutation.isPending ? "Saving…" : "Save Changes"}
                        </Button>
                        <Button variant="outline" size="sm"
                          onClick={() => { if (confirm("Delete this profile and all its angles, markets and claims?")) deleteProfileMutation.mutate(activeKbId!); }}
                          className="text-xs text-red-500 border-red-200 hover:border-red-400 hover:bg-red-50">
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" />Delete
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Sub-records — only in detail mode */}
              {kbView === "detail" && kbDetailData && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

                  {/* Marketing Angles */}
                  <Card className="border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-[#005476]">
                        <Layers className="h-3.5 w-3.5 text-[#3bcac4]" />Marketing Angles
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {kbDetailData.angles.length === 0 && (
                        <p className="text-xs text-slate-300 text-center py-2">No angles yet</p>
                      )}
                      {kbDetailData.angles.map(a => (
                        <div key={a.id}
                          className={`flex items-center justify-between px-2 py-1.5 rounded text-xs ${a.enabled ? "bg-teal-50" : "bg-slate-50 opacity-60"}`}>
                          <span className={`font-medium ${a.enabled ? "text-teal-700" : "text-slate-400"}`}>{a.angle_name}</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => toggleAngleMutation.mutate({ profileId: activeKbId!, angleId: a.id, enabled: !a.enabled })}
                              title={a.enabled ? "Disable" : "Enable"}>
                              {a.enabled
                                ? <ToggleRight className="h-4 w-4 text-[#3bcac4]" />
                                : <ToggleLeft  className="h-4 w-4 text-slate-400" />}
                            </button>
                            <button onClick={() => deleteAngleMutation.mutate({ profileId: activeKbId!, angleId: a.id })}
                              className="text-slate-300 hover:text-red-400"><X className="h-3 w-3" /></button>
                          </div>
                        </div>
                      ))}
                      <div className="pt-1 border-t flex gap-1">
                        <Input placeholder="New angle (e.g. Sea View)" value={kbAngleInput.angle_name}
                          onChange={e => setKbAngleInput(p => ({ ...p, angle_name: e.target.value }))}
                          onKeyDown={e => e.key === "Enter" && kbAngleInput.angle_name && addAngleMutation.mutate({ id: activeKbId!, body: kbAngleInput })}
                          className="text-xs h-7" />
                        <Button size="sm" className="h-7 text-xs px-2 bg-[#3bcac4] text-white hover:bg-[#3bcac4]/90"
                          onClick={() => kbAngleInput.angle_name && addAngleMutation.mutate({ id: activeKbId!, body: kbAngleInput })}
                          disabled={!kbAngleInput.angle_name || addAngleMutation.isPending}>
                          <Plus className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-[10px] text-slate-400">e.g. Branded Residence, Sea View, Investment, Family Living</p>
                    </CardContent>
                  </Card>

                  {/* Target Markets */}
                  <Card className="border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-[#005476]">
                        <Globe className="h-3.5 w-3.5 text-[#3bcac4]" />Target Markets
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {kbDetailData.markets.length === 0 && (
                        <p className="text-xs text-slate-300 text-center py-2">No markets yet</p>
                      )}
                      {kbDetailData.markets.map(m => (
                        <div key={m.id}
                          className="flex items-center justify-between bg-blue-50 px-2 py-1.5 rounded text-xs">
                          <div>
                            <span className="font-medium text-blue-700">{m.market_name}</span>
                            {m.language && <span className="text-blue-400 ml-1">· {m.language}</span>}
                          </div>
                          <button onClick={() => deleteMarketMutation.mutate({ profileId: activeKbId!, marketId: m.id })}
                            className="text-slate-300 hover:text-red-400"><X className="h-3 w-3" /></button>
                        </div>
                      ))}
                      <div className="pt-1 border-t space-y-1">
                        <Input placeholder="Market name (e.g. Arab 48)" value={kbMarketInput.market_name}
                          onChange={e => setKbMarketInput(p => ({ ...p, market_name: e.target.value }))}
                          className="text-xs h-7" />
                        <div className="flex gap-1">
                          <Input placeholder="Language (e.g. Arabic)" value={kbMarketInput.language}
                            onChange={e => setKbMarketInput(p => ({ ...p, language: e.target.value }))}
                            className="text-xs h-7 flex-1" />
                          <Button size="sm" className="h-7 text-xs px-2 bg-[#3bcac4] text-white hover:bg-[#3bcac4]/90"
                            onClick={() => kbMarketInput.market_name && addMarketMutation.mutate({ id: activeKbId!, body: kbMarketInput })}
                            disabled={!kbMarketInput.market_name || addMarketMutation.isPending}>
                            <Plus className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Forbidden Claims */}
                  <Card className="border">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2 text-[#005476]">
                        <Ban className="h-3.5 w-3.5 text-red-400" />Forbidden Claims
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2">
                      {kbDetailData.claims.length === 0 && (
                        <p className="text-xs text-slate-300 text-center py-2">No restrictions yet</p>
                      )}
                      {kbDetailData.claims.map(c => (
                        <div key={c.id}
                          className="flex items-start justify-between bg-red-50 px-2 py-1.5 rounded text-xs">
                          <span className="text-red-700 flex-1 mr-2 leading-snug">• {c.claim_text}</span>
                          <button onClick={() => deleteClaimMutation.mutate({ profileId: activeKbId!, claimId: c.id })}
                            className="text-slate-300 hover:text-red-400 mt-0.5 shrink-0"><X className="h-3 w-3" /></button>
                        </div>
                      ))}
                      <div className="pt-1 border-t flex gap-1">
                        <Input placeholder="e.g. No guaranteed ROI" value={kbClaimInput}
                          onChange={e => setKbClaimInput(e.target.value)}
                          onKeyDown={e => e.key === "Enter" && kbClaimInput && addClaimMutation.mutate({ id: activeKbId!, body: { claim_text: kbClaimInput } })}
                          className="text-xs h-7 flex-1" />
                        <Button size="sm" className="h-7 text-xs px-2 bg-red-400 text-white hover:bg-red-500"
                          onClick={() => kbClaimInput && addClaimMutation.mutate({ id: activeKbId!, body: { claim_text: kbClaimInput } })}
                          disabled={!kbClaimInput || addClaimMutation.isPending}>
                          <Ban className="h-3 w-3" />
                        </Button>
                      </div>
                      <p className="text-[10px] text-slate-400">Injected as hard rules into every AI generation</p>
                    </CardContent>
                  </Card>

                </div>
              )}
            </>
          )}

          <div className="p-3 bg-slate-100 rounded-lg text-xs text-slate-500 flex items-start gap-2">
            <Library className="h-4 w-4 mt-0.5 text-[#3bcac4] shrink-0" />
            <span>Knowledge Base is read-only for AI. No Meta publishing. No campaign creation. No automation. Used only to improve AI draft quality with project-specific context and alias rules.</span>
          </div>
        </div>
      )}

    </div>
  );
}
