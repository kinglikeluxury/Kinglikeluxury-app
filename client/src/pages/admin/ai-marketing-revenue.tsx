import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  TrendingUp, Link2, ShoppingCart, BookOpen, Lightbulb, Plus, Trash2,
  Pencil, DollarSign, Flame, Thermometer, Snowflake, PhoneOff,
  UserCheck, Calendar, Globe, Info, AlertTriangle, CheckCircle2,
  BarChart3, Target, Activity, Building2,
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

// ── Inner sub-tabs ─────────────────────────────────────────────────────────────

const SUB_TABS = [
  { key: "dashboard",   label: "Dashboard",          Icon: BarChart3 },
  { key: "attribution", label: "Lead Attribution",    Icon: Link2 },
  { key: "sales",       label: "Sales Outcomes",      Icon: ShoppingCart },
  { key: "learning",    label: "Learning History",    Icon: BookOpen },
  { key: "recrules",    label: "AI Recommendations",  Icon: Lightbulb },
] as const;
type SubTabKey = typeof SUB_TABS[number]["key"];

function fmt(v: number | null | undefined, prefix = "", suffix = "") {
  if (v == null || Number(v) === 0) return "—";
  return prefix + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) + suffix;
}

const SEV_CLS: Record<string, string> = {
  info:     "border-teal-200 bg-teal-50",
  warning:  "border-yellow-300 bg-yellow-50",
  critical: "border-red-300 bg-red-50",
};
const SEV_ICON: Record<string, typeof Info> = {
  info: Info, warning: AlertTriangle, critical: AlertTriangle,
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
                <p className="font-medium">No recommendations yet</p>
                <p className="text-sm mt-1">Add learning history records to generate AI insights</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {revRecs.map((r, i) => {
                const SIcon = SEV_ICON[r.severity] ?? Info;
                return (
                  <div key={i} className={`rounded-xl border-2 p-4 ${SEV_CLS[r.severity] || SEV_CLS.info}`}>
                    <div className="flex items-start gap-3">
                      <SIcon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${r.severity === "warning" ? "text-yellow-600" : "text-[#3bcac4]"}`} />
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
    </div>
  );
}
