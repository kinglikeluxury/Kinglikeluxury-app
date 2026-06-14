import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Rocket, Target, Palette, Users, BarChart3, Lightbulb, ShieldCheck,
  Plus, Pencil, Trash2, X, CheckCircle2, AlertTriangle, Info,
  DollarSign, Globe, Languages, Calendar, FileText, ChevronDown,
  TrendingUp, Flame, Thermometer, Snowflake, PhoneOff, UserCheck, Wifi,
} from "lucide-react";
import RevenueIntelligence from "./ai-marketing-revenue";
import MetaConnection from "./ai-marketing-meta";
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

interface CampaignPlan {
  id: number; name: string; related_project_id: number | null; related_property_id: number | null;
  target_country: string | null; language: string | null; daily_budget: number | null;
  objective: string; status: string; notes: string | null; created_at: string; updated_at: string;
}
interface Creative {
  id: number; campaign_plan_id: number | null; primary_text: string | null;
  headline: string | null; description: string | null;
  image_notes: string | null; video_notes: string | null; created_at: string;
}
interface Audience {
  id: number; campaign_plan_id: number | null; country: string | null; city_region: string | null;
  language: string | null; age_min: number; age_max: number;
  interests: string | null; exclusions: string | null; notes: string | null; created_at: string;
}
interface PerfSnap {
  id: number; campaign_plan_id: number | null; meta_campaign_id: string | null;
  campaign_name: string | null; ad_name: string | null; spend: number; leads_count: number;
  cpl: number; ctr: number; cpc: number; hot_leads: number; warm_leads: number; cold_leads: number;
  no_answer_count: number; appointments_count: number; sales_count: number;
  cost_per_hot_lead: number; cost_per_appointment: number; cost_per_sale: number;
  snapshot_date: string | null; created_at: string;
}
interface Recommendation {
  id: number; type: string; title: string; message: string; severity: string; created_at: string;
}
interface SafetySettings {
  manual_approval_required: boolean; auto_launch: boolean; auto_pause: boolean;
  auto_budget_increase: boolean; max_daily_budget_limit: number; require_admin_confirmation: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const TABS = [
  { key: "plans",          label: "Campaign Plans",          Icon: Target },
  { key: "creatives",      label: "Creative Studio",         Icon: Palette },
  { key: "audiences",      label: "Audience Strategy",       Icon: Users },
  { key: "performance",    label: "Performance Intelligence", Icon: BarChart3 },
  { key: "recommendations",label: "AI Recommendations",      Icon: Lightbulb },
  { key: "safety",         label: "Safety Settings",         Icon: ShieldCheck },
  { key: "revenue",        label: "Revenue Intelligence",    Icon: TrendingUp },
  { key: "meta",           label: "Meta Connection",         Icon: Wifi },
] as const;

type TabKey = typeof TABS[number]["key"];

const STATUS_COLORS: Record<string, string> = {
  draft:            "bg-slate-100 text-slate-600",
  ready_for_review: "bg-yellow-100 text-yellow-700",
  approved:         "bg-green-100 text-green-700",
  archived:         "bg-gray-100 text-gray-500",
};
const SEV_COLORS: Record<string, string> = {
  critical: "border-red-300 bg-red-50",
  warning:  "border-yellow-300 bg-yellow-50",
  info:     "border-teal-200 bg-teal-50",
};
const SEV_ICONS: Record<string, typeof AlertTriangle> = {
  critical: AlertTriangle, warning: AlertTriangle, info: Info,
};

function fmt(v: number | null | undefined, prefix = ""): string {
  if (v == null || v === 0) return "—";
  return prefix + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function AiMarketingCenter() {
  const [tab, setTab] = useState<TabKey>("plans");
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Campaign Plans ──────────────────────────────────────────────────────────
  const [planDialog, setPlanDialog] = useState(false);
  const [editPlan, setEditPlan] = useState<CampaignPlan | null>(null);
  const [planForm, setPlanForm] = useState({
    name: "", target_country: "", language: "", daily_budget: "",
    objective: "Lead Form", status: "draft", notes: "",
  });

  const { data: plans = [], isLoading: plansLoading } = useQuery<CampaignPlan[]>({
    queryKey: ["/api/admin/ai-marketing/campaign-plans"],
    enabled: tab === "plans",
  });

  const savePlanMutation = useMutation({
    mutationFn: (body: object) => editPlan
      ? apiRequest("PATCH", `/api/admin/ai-marketing/campaign-plans/${editPlan.id}`, body)
      : apiRequest("POST", "/api/admin/ai-marketing/campaign-plans", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/campaign-plans"] });
      setPlanDialog(false); setEditPlan(null);
      toast({ title: editPlan ? "Campaign plan updated" : "Campaign plan created" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deletePlanMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/ai-marketing/campaign-plans/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/campaign-plans"] });
      toast({ title: "Deleted" });
    },
  });

  function openNewPlan() {
    setEditPlan(null);
    setPlanForm({ name: "", target_country: "", language: "", daily_budget: "", objective: "Lead Form", status: "draft", notes: "" });
    setPlanDialog(true);
  }
  function openEditPlan(p: CampaignPlan) {
    setEditPlan(p);
    setPlanForm({
      name: p.name, target_country: p.target_country || "", language: p.language || "",
      daily_budget: p.daily_budget ? String(p.daily_budget) : "",
      objective: p.objective, status: p.status, notes: p.notes || "",
    });
    setPlanDialog(true);
  }

  // ── Creatives ───────────────────────────────────────────────────────────────
  const [creativeDialog, setCreativeDialog] = useState(false);
  const [editCreative, setEditCreative] = useState<Creative | null>(null);
  const [creativeForm, setCreativeForm] = useState({
    campaign_plan_id: "", primary_text: "", headline: "", description: "", image_notes: "", video_notes: "",
  });

  const { data: creatives = [], isLoading: creativesLoading } = useQuery<Creative[]>({
    queryKey: ["/api/admin/ai-marketing/creatives"],
    enabled: tab === "creatives",
  });

  const saveCreativeMutation = useMutation({
    mutationFn: (body: object) => editCreative
      ? apiRequest("PATCH", `/api/admin/ai-marketing/creatives/${editCreative.id}`, body)
      : apiRequest("POST", "/api/admin/ai-marketing/creatives", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/creatives"] });
      setCreativeDialog(false); setEditCreative(null);
      toast({ title: editCreative ? "Creative updated" : "Creative added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteCreativeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/ai-marketing/creatives/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/creatives"] }),
  });

  function openNewCreative() {
    setEditCreative(null);
    setCreativeForm({ campaign_plan_id: "", primary_text: "", headline: "", description: "", image_notes: "", video_notes: "" });
    setCreativeDialog(true);
  }
  function openEditCreative(c: Creative) {
    setEditCreative(c);
    setCreativeForm({
      campaign_plan_id: c.campaign_plan_id ? String(c.campaign_plan_id) : "",
      primary_text: c.primary_text || "", headline: c.headline || "",
      description: c.description || "", image_notes: c.image_notes || "", video_notes: c.video_notes || "",
    });
    setCreativeDialog(true);
  }

  // ── Audiences ───────────────────────────────────────────────────────────────
  const [audienceDialog, setAudienceDialog] = useState(false);
  const [editAudience, setEditAudience] = useState<Audience | null>(null);
  const [audienceForm, setAudienceForm] = useState({
    campaign_plan_id: "", country: "", city_region: "", language: "",
    age_min: "18", age_max: "65", interests: "", exclusions: "", notes: "",
  });

  const { data: audiences = [], isLoading: audiencesLoading } = useQuery<Audience[]>({
    queryKey: ["/api/admin/ai-marketing/audiences"],
    enabled: tab === "audiences",
  });

  const saveAudienceMutation = useMutation({
    mutationFn: (body: object) => editAudience
      ? apiRequest("PATCH", `/api/admin/ai-marketing/audiences/${editAudience.id}`, body)
      : apiRequest("POST", "/api/admin/ai-marketing/audiences", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/audiences"] });
      setAudienceDialog(false); setEditAudience(null);
      toast({ title: editAudience ? "Audience updated" : "Audience added" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteAudienceMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/ai-marketing/audiences/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/audiences"] }),
  });

  function openNewAudience() {
    setEditAudience(null);
    setAudienceForm({ campaign_plan_id: "", country: "", city_region: "", language: "", age_min: "18", age_max: "65", interests: "", exclusions: "", notes: "" });
    setAudienceDialog(true);
  }
  function openEditAudience(a: Audience) {
    setEditAudience(a);
    setAudienceForm({
      campaign_plan_id: a.campaign_plan_id ? String(a.campaign_plan_id) : "",
      country: a.country || "", city_region: a.city_region || "", language: a.language || "",
      age_min: String(a.age_min || 18), age_max: String(a.age_max || 65),
      interests: a.interests || "", exclusions: a.exclusions || "", notes: a.notes || "",
    });
    setAudienceDialog(true);
  }

  // ── Performance ─────────────────────────────────────────────────────────────
  const [perfDialog, setPerfDialog] = useState(false);
  const [perfForm, setPerfForm] = useState({
    campaign_plan_id: "", campaign_name: "", ad_name: "",
    spend: "", leads_count: "", cpl: "", ctr: "", cpc: "",
    hot_leads: "", warm_leads: "", cold_leads: "", no_answer_count: "",
    appointments_count: "", sales_count: "",
    cost_per_hot_lead: "", cost_per_appointment: "", cost_per_sale: "",
    snapshot_date: "",
  });

  const { data: perfs = [], isLoading: perfsLoading } = useQuery<PerfSnap[]>({
    queryKey: ["/api/admin/ai-marketing/performance"],
    enabled: tab === "performance",
  });

  const savePerfMutation = useMutation({
    mutationFn: (body: object) => apiRequest("POST", "/api/admin/ai-marketing/performance", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/performance"] });
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/recommendations"] });
      setPerfDialog(false);
      toast({ title: "Performance snapshot saved — AI recommendations generated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deletePerfMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/ai-marketing/performance/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/performance"] }),
  });

  // ── Recommendations ─────────────────────────────────────────────────────────
  const { data: recs = [], isLoading: recsLoading } = useQuery<Recommendation[]>({
    queryKey: ["/api/admin/ai-marketing/recommendations"],
    enabled: tab === "recommendations",
  });

  const dismissMutation = useMutation({
    mutationFn: (id: number) => apiRequest("PATCH", `/api/admin/ai-marketing/recommendations/${id}/dismiss`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/recommendations"] });
      toast({ title: "Recommendation dismissed" });
    },
  });

  // ── Safety Settings ─────────────────────────────────────────────────────────
  const { data: safety } = useQuery<SafetySettings>({
    queryKey: ["/api/admin/ai-marketing/safety-settings"],
    enabled: tab === "safety",
  });

  const saveSafetyMutation = useMutation({
    mutationFn: (body: object) => apiRequest("PATCH", "/api/admin/ai-marketing/safety-settings", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing/safety-settings"] });
      toast({ title: "Safety settings saved" });
    },
  });

  const [safetyLocal, setSafetyLocal] = useState<SafetySettings | null>(null);
  const s = safetyLocal ?? safety ?? {
    manual_approval_required: true, auto_launch: false, auto_pause: false,
    auto_budget_increase: false, max_daily_budget_limit: 100, require_admin_confirmation: true,
  };

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#005476] to-[#3bcac4] px-6 py-6 text-white">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-1">
            <div className="p-2 bg-white/20 rounded-xl">
              <Rocket className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">AI Marketing Center</h1>
              <p className="text-sm text-white/70">Phase 1 — Planning & Intelligence Foundation</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <span className="bg-white/20 text-white text-xs font-semibold px-3 py-1 rounded-full">
              🛡 Safe Mode — No real Meta actions active
            </span>
            <span className="bg-white/20 text-white text-xs px-3 py-1 rounded-full">
              Phase 1 of 3
            </span>
          </div>
        </div>
      </div>

      {/* Tab Bar */}
      <div className="bg-white border-b sticky top-0 z-10 shadow-sm">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex overflow-x-auto gap-1 py-1">
            {TABS.map(({ key, label, Icon }) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium rounded-lg whitespace-nowrap transition-all ${
                  tab === key
                    ? "bg-[#3bcac4]/10 text-[#005476] border border-[#3bcac4]/30"
                    : "text-slate-500 hover:text-slate-700 hover:bg-slate-50"
                }`}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* ── Campaign Plans ─────────────────────────────────────────────── */}
        {tab === "plans" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Campaign Plans</h2>
                <p className="text-sm text-slate-500">Draft marketing plans for internal review — no Meta campaigns created.</p>
              </div>
              <Button onClick={openNewPlan} className="bg-[#3bcac4] hover:bg-[#005476] text-white">
                <Plus className="h-4 w-4 mr-1" /> New Plan
              </Button>
            </div>

            {plansLoading ? (
              <div className="text-center py-12 text-slate-400">Loading…</div>
            ) : plans.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center text-slate-400">
                  <Target className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No campaign plans yet</p>
                  <p className="text-sm mt-1">Create your first internal draft plan</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {plans.map(p => (
                  <Card key={p.id} className="shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[p.status] || STATUS_COLORS.draft}`}>
                          {p.status.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())}
                        </span>
                        <div className="flex gap-1">
                          <button onClick={() => openEditPlan(p)} className="p-1.5 text-slate-400 hover:text-[#3bcac4]"><Pencil className="h-3.5 w-3.5" /></button>
                          <button onClick={() => confirm("Delete this plan?") && deletePlanMutation.mutate(p.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                        </div>
                      </div>
                      <h3 className="font-bold text-slate-800 text-base mb-2">{p.name}</h3>
                      <div className="space-y-1 text-xs text-slate-500">
                        {p.target_country && <div className="flex items-center gap-1"><Globe className="h-3 w-3" /> {p.target_country}</div>}
                        {p.language && <div className="flex items-center gap-1"><Languages className="h-3 w-3" /> {p.language}</div>}
                        {p.daily_budget && <div className="flex items-center gap-1"><DollarSign className="h-3 w-3" /> ${Number(p.daily_budget).toLocaleString()} / day</div>}
                        {p.objective && <div className="flex items-center gap-1"><Target className="h-3 w-3" /> {p.objective}</div>}
                      </div>
                      {p.notes && <p className="text-xs text-slate-400 mt-3 line-clamp-2">{p.notes}</p>}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Plan Dialog */}
            <Dialog open={planDialog} onOpenChange={v => { setPlanDialog(v); if (!v) setEditPlan(null); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>{editPlan ? "Edit Campaign Plan" : "New Campaign Plan"}</DialogTitle>
                </DialogHeader>
                <div className="space-y-3 mt-2">
                  <div><Label>Campaign Name *</Label>
                    <Input value={planForm.name} onChange={e => setPlanForm(f => ({...f, name: e.target.value}))} placeholder="e.g. Silk Tower — Russia Q3" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Target Country</Label>
                      <Input value={planForm.target_country} onChange={e => setPlanForm(f => ({...f, target_country: e.target.value}))} placeholder="e.g. Russia" /></div>
                    <div><Label>Language</Label>
                      <Input value={planForm.language} onChange={e => setPlanForm(f => ({...f, language: e.target.value}))} placeholder="e.g. Russian" /></div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Daily Budget ($)</Label>
                      <Input type="number" value={planForm.daily_budget} onChange={e => setPlanForm(f => ({...f, daily_budget: e.target.value}))} placeholder="e.g. 50" /></div>
                    <div><Label>Objective</Label>
                      <Select value={planForm.objective} onValueChange={v => setPlanForm(f => ({...f, objective: v}))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent><SelectItem value="Lead Form">Lead Form</SelectItem></SelectContent>
                      </Select></div>
                  </div>
                  <div><Label>Status</Label>
                    <Select value={planForm.status} onValueChange={v => setPlanForm(f => ({...f, status: v}))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="ready_for_review">Ready for Review</SelectItem>
                        <SelectItem value="approved">Approved</SelectItem>
                        <SelectItem value="archived">Archived</SelectItem>
                      </SelectContent>
                    </Select></div>
                  <div><Label>Notes</Label>
                    <Textarea value={planForm.notes} onChange={e => setPlanForm(f => ({...f, notes: e.target.value}))} rows={3} placeholder="Internal notes…" /></div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setPlanDialog(false)}>Cancel</Button>
                    <Button
                      className="bg-[#3bcac4] hover:bg-[#005476] text-white"
                      disabled={savePlanMutation.isPending || !planForm.name}
                      onClick={() => savePlanMutation.mutate({
                        ...planForm,
                        daily_budget: planForm.daily_budget ? Number(planForm.daily_budget) : null,
                      })}
                    >
                      {savePlanMutation.isPending ? "Saving…" : "Save Plan"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* ── Creative Studio ────────────────────────────────────────────── */}
        {tab === "creatives" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Creative Studio</h2>
                <p className="text-sm text-slate-500">Draft ad copy and creative notes — no real ads are created.</p>
              </div>
              <Button onClick={openNewCreative} className="bg-[#3bcac4] hover:bg-[#005476] text-white">
                <Plus className="h-4 w-4 mr-1" /> New Creative
              </Button>
            </div>

            {creativesLoading ? (
              <div className="text-center py-12 text-slate-400">Loading…</div>
            ) : creatives.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center text-slate-400">
                  <Palette className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No creatives yet</p>
                  <p className="text-sm mt-1">Add your first draft creative</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {creatives.map(c => (
                  <Card key={c.id} className="shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-5">
                      <div className="flex justify-end gap-1 mb-2">
                        <button onClick={() => openEditCreative(c)} className="p-1.5 text-slate-400 hover:text-[#3bcac4]"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => confirm("Delete?") && deleteCreativeMutation.mutate(c.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      {c.headline && <h3 className="font-bold text-slate-800 mb-1">{c.headline}</h3>}
                      {c.primary_text && <p className="text-sm text-slate-600 mb-2 line-clamp-3">{c.primary_text}</p>}
                      {c.description && <p className="text-xs text-slate-500 mb-2 italic">{c.description}</p>}
                      <div className="flex flex-wrap gap-2 mt-2 text-xs">
                        {c.image_notes && <Badge variant="outline" className="text-[#3bcac4] border-[#3bcac4]/30">🖼 {c.image_notes}</Badge>}
                        {c.video_notes && <Badge variant="outline" className="text-[#005476] border-[#005476]/30">🎬 {c.video_notes}</Badge>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <Dialog open={creativeDialog} onOpenChange={v => { setCreativeDialog(v); if (!v) setEditCreative(null); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{editCreative ? "Edit Creative" : "New Creative"}</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div><Label>Linked Campaign Plan</Label>
                    <Select value={creativeForm.campaign_plan_id || "none"} onValueChange={v => setCreativeForm(f => ({...f, campaign_plan_id: v === "none" ? "" : v}))}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No campaign</SelectItem>
                        {plans.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select></div>
                  <div><Label>Headline</Label>
                    <Input value={creativeForm.headline} onChange={e => setCreativeForm(f => ({...f, headline: e.target.value}))} placeholder="e.g. Own Your Dream Villa in Georgia" /></div>
                  <div><Label>Primary Text</Label>
                    <Textarea value={creativeForm.primary_text} onChange={e => setCreativeForm(f => ({...f, primary_text: e.target.value}))} rows={3} placeholder="Main ad copy text…" /></div>
                  <div><Label>Description</Label>
                    <Input value={creativeForm.description} onChange={e => setCreativeForm(f => ({...f, description: e.target.value}))} placeholder="Short description line" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Image Notes</Label>
                      <Input value={creativeForm.image_notes} onChange={e => setCreativeForm(f => ({...f, image_notes: e.target.value}))} placeholder="e.g. Aerial view of pool" /></div>
                    <div><Label>Video Notes</Label>
                      <Input value={creativeForm.video_notes} onChange={e => setCreativeForm(f => ({...f, video_notes: e.target.value}))} placeholder="e.g. 15s walkthrough" /></div>
                  </div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setCreativeDialog(false)}>Cancel</Button>
                    <Button className="bg-[#3bcac4] hover:bg-[#005476] text-white" disabled={saveCreativeMutation.isPending}
                      onClick={() => saveCreativeMutation.mutate({ ...creativeForm, campaign_plan_id: creativeForm.campaign_plan_id || null })}>
                      {saveCreativeMutation.isPending ? "Saving…" : "Save Creative"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* ── Audience Strategy ──────────────────────────────────────────── */}
        {tab === "audiences" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Audience Strategy</h2>
                <p className="text-sm text-slate-500">Define draft audience ideas — no data is sent to Meta.</p>
              </div>
              <Button onClick={openNewAudience} className="bg-[#3bcac4] hover:bg-[#005476] text-white">
                <Plus className="h-4 w-4 mr-1" /> New Audience
              </Button>
            </div>

            {audiencesLoading ? (
              <div className="text-center py-12 text-slate-400">Loading…</div>
            ) : audiences.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center text-slate-400">
                  <Users className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No audiences yet</p>
                  <p className="text-sm mt-1">Define your first target audience</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {audiences.map(a => (
                  <Card key={a.id} className="shadow-sm hover:shadow-md transition-shadow">
                    <CardContent className="p-5">
                      <div className="flex justify-end gap-1 mb-2">
                        <button onClick={() => openEditAudience(a)} className="p-1.5 text-slate-400 hover:text-[#3bcac4]"><Pencil className="h-3.5 w-3.5" /></button>
                        <button onClick={() => confirm("Delete?") && deleteAudienceMutation.mutate(a.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className="space-y-1.5 text-sm text-slate-600">
                        {a.country && <div className="flex items-center gap-1.5"><Globe className="h-3.5 w-3.5 text-[#3bcac4]" /> {a.country}{a.city_region && ` — ${a.city_region}`}</div>}
                        {a.language && <div className="flex items-center gap-1.5"><Languages className="h-3.5 w-3.5 text-[#3bcac4]" /> {a.language}</div>}
                        <div className="flex items-center gap-1.5"><Users className="h-3.5 w-3.5 text-[#3bcac4]" /> Age {a.age_min}–{a.age_max}</div>
                        {a.interests && <div className="text-xs text-slate-500 bg-slate-50 rounded px-2 py-1"><span className="font-medium">Interests:</span> {a.interests}</div>}
                        {a.exclusions && <div className="text-xs text-slate-500 bg-red-50 rounded px-2 py-1"><span className="font-medium">Exclude:</span> {a.exclusions}</div>}
                        {a.notes && <div className="text-xs text-slate-400 mt-1">{a.notes}</div>}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            <Dialog open={audienceDialog} onOpenChange={v => { setAudienceDialog(v); if (!v) setEditAudience(null); }}>
              <DialogContent className="max-w-lg">
                <DialogHeader><DialogTitle>{editAudience ? "Edit Audience" : "New Audience"}</DialogTitle></DialogHeader>
                <div className="space-y-3 mt-2">
                  <div><Label>Linked Campaign Plan</Label>
                    <Select value={audienceForm.campaign_plan_id || "none"} onValueChange={v => setAudienceForm(f => ({...f, campaign_plan_id: v === "none" ? "" : v}))}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No campaign</SelectItem>
                        {plans.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div><Label>Country</Label><Input value={audienceForm.country} onChange={e => setAudienceForm(f => ({...f, country: e.target.value}))} placeholder="e.g. Russia" /></div>
                    <div><Label>City / Region</Label><Input value={audienceForm.city_region} onChange={e => setAudienceForm(f => ({...f, city_region: e.target.value}))} placeholder="e.g. Moscow" /></div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div><Label>Language</Label><Input value={audienceForm.language} onChange={e => setAudienceForm(f => ({...f, language: e.target.value}))} placeholder="Russian" /></div>
                    <div><Label>Age Min</Label><Input type="number" value={audienceForm.age_min} onChange={e => setAudienceForm(f => ({...f, age_min: e.target.value}))} /></div>
                    <div><Label>Age Max</Label><Input type="number" value={audienceForm.age_max} onChange={e => setAudienceForm(f => ({...f, age_max: e.target.value}))} /></div>
                  </div>
                  <div><Label>Interests</Label><Input value={audienceForm.interests} onChange={e => setAudienceForm(f => ({...f, interests: e.target.value}))} placeholder="e.g. Luxury real estate, Investment" /></div>
                  <div><Label>Exclusions</Label><Input value={audienceForm.exclusions} onChange={e => setAudienceForm(f => ({...f, exclusions: e.target.value}))} placeholder="e.g. Renters, Under 25" /></div>
                  <div><Label>Notes</Label><Textarea value={audienceForm.notes} onChange={e => setAudienceForm(f => ({...f, notes: e.target.value}))} rows={2} /></div>
                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="outline" onClick={() => setAudienceDialog(false)}>Cancel</Button>
                    <Button className="bg-[#3bcac4] hover:bg-[#005476] text-white" disabled={saveAudienceMutation.isPending}
                      onClick={() => saveAudienceMutation.mutate({ ...audienceForm, campaign_plan_id: audienceForm.campaign_plan_id || null, age_min: Number(audienceForm.age_min), age_max: Number(audienceForm.age_max) })}>
                      {saveAudienceMutation.isPending ? "Saving…" : "Save Audience"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* ── Performance Intelligence ───────────────────────────────────── */}
        {tab === "performance" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Performance Intelligence</h2>
                <p className="text-sm text-slate-500">Manually log campaign performance data. AI recommendations are auto-generated on save.</p>
              </div>
              <Button onClick={() => { setPerfForm({ campaign_plan_id:"", campaign_name:"", ad_name:"", spend:"", leads_count:"", cpl:"", ctr:"", cpc:"", hot_leads:"", warm_leads:"", cold_leads:"", no_answer_count:"", appointments_count:"", sales_count:"", cost_per_hot_lead:"", cost_per_appointment:"", cost_per_sale:"", snapshot_date:"" }); setPerfDialog(true); }} className="bg-[#3bcac4] hover:bg-[#005476] text-white">
                <Plus className="h-4 w-4 mr-1" /> Log Snapshot
              </Button>
            </div>

            {perfsLoading ? (
              <div className="text-center py-12 text-slate-400">Loading…</div>
            ) : perfs.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center text-slate-400">
                  <BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No performance snapshots yet</p>
                  <p className="text-sm mt-1">Log your first data point to generate AI recommendations</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-4">
                {perfs.map(p => (
                  <Card key={p.id} className="shadow-sm">
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <h3 className="font-bold text-slate-800">{p.campaign_name || "Unnamed Campaign"}</h3>
                          {p.ad_name && <p className="text-xs text-slate-500">Ad: {p.ad_name}</p>}
                          {p.snapshot_date && <p className="text-xs text-slate-400">{p.snapshot_date}</p>}
                        </div>
                        <button onClick={() => confirm("Delete snapshot?") && deletePerfMutation.mutate(p.id)} className="p-1.5 text-slate-400 hover:text-red-500"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-3">
                        {[
                          { label: "Spend", value: fmt(p.spend, "$"), Icon: DollarSign, color: "text-slate-600" },
                          { label: "Leads", value: p.leads_count || "—", Icon: Users, color: "text-blue-600" },
                          { label: "CPL", value: fmt(p.cpl, "$"), Icon: TrendingUp, color: "text-slate-600" },
                          { label: "CTR", value: p.ctr ? `${p.ctr}%` : "—", Icon: BarChart3, color: "text-slate-600" },
                          { label: "HOT 🔥", value: p.hot_leads || "—", Icon: Flame, color: "text-red-500" },
                          { label: "WARM 🟡", value: p.warm_leads || "—", Icon: Thermometer, color: "text-amber-500" },
                          { label: "COLD ❄️", value: p.cold_leads || "—", Icon: Snowflake, color: "text-blue-400" },
                          { label: "No Ans", value: p.no_answer_count || "—", Icon: PhoneOff, color: "text-slate-400" },
                          { label: "Appts", value: p.appointments_count || "—", Icon: Calendar, color: "text-green-600" },
                          { label: "Sales", value: p.sales_count || "—", Icon: UserCheck, color: "text-[#3bcac4]" },
                          { label: "$/HOT", value: fmt(p.cost_per_hot_lead, "$"), Icon: DollarSign, color: "text-purple-600" },
                          { label: "$/Sale", value: fmt(p.cost_per_sale, "$"), Icon: DollarSign, color: "text-purple-600" },
                        ].map(({ label, value, Icon: I, color }) => (
                          <div key={label} className="bg-slate-50 rounded-lg p-2.5 text-center">
                            <I className={`h-3.5 w-3.5 mx-auto mb-1 ${color}`} />
                            <div className={`text-sm font-bold ${color}`}>{value}</div>
                            <div className="text-xs text-slate-400">{label}</div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {/* Performance Dialog */}
            <Dialog open={perfDialog} onOpenChange={setPerfDialog}>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
                <DialogHeader><DialogTitle>Log Performance Snapshot</DialogTitle></DialogHeader>
                <div className="grid grid-cols-2 gap-3 mt-2">
                  <div className="col-span-2"><Label>Linked Campaign Plan</Label>
                    <Select value={perfForm.campaign_plan_id || "none"} onValueChange={v => setPerfForm(f => ({...f, campaign_plan_id: v === "none" ? "" : v}))}>
                      <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No campaign</SelectItem>
                        {plans.map(p => <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>)}
                      </SelectContent>
                    </Select></div>
                  <div><Label>Campaign Name</Label><Input value={perfForm.campaign_name} onChange={e => setPerfForm(f => ({...f, campaign_name: e.target.value}))} /></div>
                  <div><Label>Ad Name</Label><Input value={perfForm.ad_name} onChange={e => setPerfForm(f => ({...f, ad_name: e.target.value}))} /></div>
                  <div><Label>Snapshot Date</Label><Input type="date" value={perfForm.snapshot_date} onChange={e => setPerfForm(f => ({...f, snapshot_date: e.target.value}))} /></div>
                  <div><Label>Spend ($)</Label><Input type="number" value={perfForm.spend} onChange={e => setPerfForm(f => ({...f, spend: e.target.value}))} /></div>
                  <div><Label>Leads Count</Label><Input type="number" value={perfForm.leads_count} onChange={e => setPerfForm(f => ({...f, leads_count: e.target.value}))} /></div>
                  <div><Label>CPL ($)</Label><Input type="number" value={perfForm.cpl} onChange={e => setPerfForm(f => ({...f, cpl: e.target.value}))} /></div>
                  <div><Label>CTR (%)</Label><Input type="number" value={perfForm.ctr} onChange={e => setPerfForm(f => ({...f, ctr: e.target.value}))} /></div>
                  <div><Label>CPC ($)</Label><Input type="number" value={perfForm.cpc} onChange={e => setPerfForm(f => ({...f, cpc: e.target.value}))} /></div>
                  <div><Label>HOT Leads 🔥</Label><Input type="number" value={perfForm.hot_leads} onChange={e => setPerfForm(f => ({...f, hot_leads: e.target.value}))} /></div>
                  <div><Label>WARM Leads 🟡</Label><Input type="number" value={perfForm.warm_leads} onChange={e => setPerfForm(f => ({...f, warm_leads: e.target.value}))} /></div>
                  <div><Label>COLD Leads ❄️</Label><Input type="number" value={perfForm.cold_leads} onChange={e => setPerfForm(f => ({...f, cold_leads: e.target.value}))} /></div>
                  <div><Label>No Answer</Label><Input type="number" value={perfForm.no_answer_count} onChange={e => setPerfForm(f => ({...f, no_answer_count: e.target.value}))} /></div>
                  <div><Label>Appointments</Label><Input type="number" value={perfForm.appointments_count} onChange={e => setPerfForm(f => ({...f, appointments_count: e.target.value}))} /></div>
                  <div><Label>Sales</Label><Input type="number" value={perfForm.sales_count} onChange={e => setPerfForm(f => ({...f, sales_count: e.target.value}))} /></div>
                  <div><Label>Cost / HOT Lead ($)</Label><Input type="number" value={perfForm.cost_per_hot_lead} onChange={e => setPerfForm(f => ({...f, cost_per_hot_lead: e.target.value}))} /></div>
                  <div><Label>Cost / Appointment ($)</Label><Input type="number" value={perfForm.cost_per_appointment} onChange={e => setPerfForm(f => ({...f, cost_per_appointment: e.target.value}))} /></div>
                  <div><Label>Cost / Sale ($)</Label><Input type="number" value={perfForm.cost_per_sale} onChange={e => setPerfForm(f => ({...f, cost_per_sale: e.target.value}))} /></div>
                </div>
                <p className="text-xs text-slate-400 mt-2">💡 AI recommendations will be auto-generated from this data on save.</p>
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="outline" onClick={() => setPerfDialog(false)}>Cancel</Button>
                  <Button className="bg-[#3bcac4] hover:bg-[#005476] text-white" disabled={savePerfMutation.isPending}
                    onClick={() => {
                      const n = (v: string) => v ? Number(v) : 0;
                      savePerfMutation.mutate({ ...perfForm, campaign_plan_id: perfForm.campaign_plan_id || null, spend: n(perfForm.spend), leads_count: n(perfForm.leads_count), cpl: n(perfForm.cpl), ctr: n(perfForm.ctr), cpc: n(perfForm.cpc), hot_leads: n(perfForm.hot_leads), warm_leads: n(perfForm.warm_leads), cold_leads: n(perfForm.cold_leads), no_answer_count: n(perfForm.no_answer_count), appointments_count: n(perfForm.appointments_count), sales_count: n(perfForm.sales_count), cost_per_hot_lead: n(perfForm.cost_per_hot_lead), cost_per_appointment: n(perfForm.cost_per_appointment), cost_per_sale: n(perfForm.cost_per_sale) });
                    }}>
                    {savePerfMutation.isPending ? "Saving…" : "Save Snapshot"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}

        {/* ── AI Recommendations ─────────────────────────────────────────── */}
        {tab === "recommendations" && (
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-bold text-slate-800">AI Recommendations</h2>
              <p className="text-sm text-slate-500">Rule-based insights generated from your performance data. No automatic actions are taken.</p>
            </div>

            {recsLoading ? (
              <div className="text-center py-12 text-slate-400">Loading…</div>
            ) : recs.length === 0 ? (
              <Card className="border-dashed">
                <CardContent className="py-12 text-center text-slate-400">
                  <Lightbulb className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No active recommendations</p>
                  <p className="text-sm mt-1">Log performance snapshots to generate AI insights</p>
                </CardContent>
              </Card>
            ) : (
              <div className="space-y-3">
                {recs.map(r => {
                  const SevIcon = SEV_ICONS[r.severity] ?? Info;
                  return (
                    <div key={r.id} className={`rounded-xl border-2 p-4 ${SEV_COLORS[r.severity] || SEV_COLORS.info}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <SevIcon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${r.severity === "critical" ? "text-red-500" : r.severity === "warning" ? "text-yellow-600" : "text-[#3bcac4]"}`} />
                          <div>
                            <p className="font-semibold text-slate-800">{r.title}</p>
                            <p className="text-sm text-slate-600 mt-0.5">{r.message}</p>
                            <p className="text-xs text-slate-400 mt-1">{new Date(r.created_at).toLocaleDateString()}</p>
                          </div>
                        </div>
                        <Button size="sm" variant="ghost" className="text-slate-400 hover:text-slate-600 flex-shrink-0"
                          onClick={() => dismissMutation.mutate(r.id)} disabled={dismissMutation.isPending}>
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {recs.length > 0 && (
              <div className="mt-4 p-3 bg-slate-100 rounded-lg text-xs text-slate-500 flex items-start gap-2">
                <ShieldCheck className="h-4 w-4 mt-0.5 text-[#3bcac4] flex-shrink-0" />
                <span>These are suggestions only. No campaign changes are made automatically. All Meta actions require manual approval.</span>
              </div>
            )}
          </div>
        )}

        {/* ── Safety Settings ────────────────────────────────────────────── */}
        {tab === "safety" && (
          <div className="max-w-2xl">
            <div className="mb-4">
              <h2 className="text-lg font-bold text-slate-800">Safety Settings</h2>
              <p className="text-sm text-slate-500">Control guardrails for future Meta actions. All automation is currently OFF.</p>
            </div>

            <Card className="shadow-sm border-2 border-[#3bcac4]/20">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2 text-[#005476]">
                  <ShieldCheck className="h-5 w-5 text-[#3bcac4]" />
                  Campaign Safety Controls
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {[
                  {
                    key: "manual_approval_required" as const,
                    label: "Manual Approval Before Launch",
                    desc: "Require admin approval before any campaign is published to Meta",
                    locked: true,
                  },
                  {
                    key: "require_admin_confirmation" as const,
                    label: "Require Admin Confirmation for Meta Actions",
                    desc: "Every Meta API action needs an explicit admin confirmation",
                    locked: true,
                  },
                  {
                    key: "auto_launch" as const,
                    label: "Automatic Campaign Launch",
                    desc: "Allow system to launch campaigns without manual step",
                    locked: false,
                  },
                  {
                    key: "auto_pause" as const,
                    label: "Automatic Ad Pause",
                    desc: "Allow system to pause underperforming ads automatically",
                    locked: false,
                  },
                  {
                    key: "auto_budget_increase" as const,
                    label: "Automatic Budget Increase",
                    desc: "Allow system to increase budget on well-performing ads",
                    locked: false,
                  },
                ].map(({ key, label, desc, locked }) => (
                  <div key={key} className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-slate-800 text-sm">{label}</p>
                      <p className="text-xs text-slate-500">{desc}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {locked && <span className="text-xs text-slate-400">🔒</span>}
                      <Switch
                        checked={!!s[key]}
                        disabled={locked}
                        onCheckedChange={val => setSafetyLocal({ ...s, [key]: val })}
                      />
                      <span className={`text-xs font-semibold ${s[key] ? "text-green-600" : "text-slate-400"}`}>
                        {s[key] ? "ON" : "OFF"}
                      </span>
                    </div>
                  </div>
                ))}

                <div className="pt-2 border-t">
                  <Label>Maximum Daily Budget Limit ($)</Label>
                  <p className="text-xs text-slate-500 mb-2">AI cannot suggest budgets above this amount</p>
                  <Input
                    type="number"
                    value={s.max_daily_budget_limit}
                    onChange={e => setSafetyLocal({ ...s, max_daily_budget_limit: Number(e.target.value) })}
                    className="max-w-xs"
                  />
                </div>

                <div className="flex justify-end pt-2">
                  <Button
                    className="bg-[#3bcac4] hover:bg-[#005476] text-white"
                    disabled={saveSafetyMutation.isPending}
                    onClick={() => saveSafetyMutation.mutate(s)}
                  >
                    {saveSafetyMutation.isPending ? "Saving…" : "Save Settings"}
                  </Button>
                </div>
              </CardContent>
            </Card>

            <div className="mt-4 p-4 bg-amber-50 border border-amber-200 rounded-xl">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-semibold text-amber-800 text-sm">Phase 1 — Planning Mode Only</p>
                  <p className="text-xs text-amber-700 mt-1">
                    This is Phase 1 of the AI Marketing Center. No real Meta campaigns are created or modified.
                    No money is spent. Automation features will be introduced in Phase 2 after full safety review.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Revenue Intelligence ───────────────────────────────────────── */}
        {tab === "revenue" && (
          <div>
            <div className="mb-5">
              <h2 className="text-lg font-bold text-slate-800">Revenue Intelligence Engine</h2>
              <p className="text-sm text-slate-500">Phase 2 — Attribution, sales tracking, and AI-powered revenue insights.</p>
            </div>
            <RevenueIntelligence />
          </div>
        )}

        {/* ── Meta Connection ────────────────────────────────────────────── */}
        {tab === "meta" && (
          <div>
            <div className="mb-5">
              <h2 className="text-lg font-bold text-slate-800">Meta Marketing API Connection</h2>
              <p className="text-sm text-slate-500">Phase 3 — Read-only verification of campaigns, ad sets, ads and insights. No write actions.</p>
            </div>
            <MetaConnection />
          </div>
        )}
      </div>
    </div>
  );
}
