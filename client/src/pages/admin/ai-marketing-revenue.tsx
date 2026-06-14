import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  TrendingUp, Link2, ShoppingCart, BookOpen, Lightbulb, Plus, Trash2,
  Pencil, DollarSign, Flame, Thermometer, Snowflake, PhoneOff,
  UserCheck, Calendar, Globe, Info, AlertTriangle, CheckCircle2,
  BarChart3, Target, Activity, Building2, Megaphone, TrendingDown,
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
    </div>
  );
}
