import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Sparkles, RefreshCw, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Target, Users, Palette, DollarSign, Building2, GitBranch, LineChart, Flame,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Kpis {
  healthScore: number;
  totalSpend: number | null;
  totalLeads: number;
  qualifiedLeads: number;
  hotLeads: number;
  appointments: number;
  siteVisits: number;
  purchases: number;
  revenue: number | null;
  estimatedRoi: number | null;
  avgCpl: number | null;
  avgCpc: number | null;
  avgCtr: number | null;
  costPerPurchase: number | null;
  revenuePerLead: number | null;
  bestCampaign: { name: string; roi: number | null } | null;
  worstCampaign: { name: string; roi: number | null } | null;
  hasOutcomeData: boolean;
}

interface Recommendation {
  id: number;
  category: string;
  action: string;
  title: string;
  reason: string;
  supporting_metrics_json: Record<string, any>;
  expected_impact: string;
  business_impact: string;
  confidence: string;
  priority: string;
  entity_name: string | null;
}

interface Snapshot {
  id: number;
  health_score: number;
  kpis_json: Kpis;
  executive_report: string;
  audience_json: any;
  creative_json: any;
  project_json: any;
  budget_json: any;
  funnel_json: any;
  predictions_json: any;
  generated_at: string;
  recommendations: Recommendation[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function fmt(v: number | null | undefined, prefix = "", suffix = ""): string {
  if (v == null) return "—";
  return prefix + Number(v).toLocaleString(undefined, { maximumFractionDigits: 2 }) + suffix;
}

function healthColor(score: number) {
  if (score >= 80) return "text-green-600";
  if (score >= 60) return "text-teal-600";
  if (score >= 40) return "text-amber-600";
  return "text-red-600";
}

const CONFIDENCE_COLORS: Record<string, string> = {
  "Very High": "bg-green-100 text-green-700 border-green-200",
  "High": "bg-teal-100 text-teal-700 border-teal-200",
  "Medium": "bg-amber-100 text-amber-700 border-amber-200",
  "Low": "bg-slate-100 text-slate-600 border-slate-200",
};
const PRIORITY_COLORS: Record<string, string> = {
  High: "bg-red-100 text-red-700 border-red-200",
  Medium: "bg-amber-100 text-amber-700 border-amber-200",
  Low: "bg-slate-100 text-slate-600 border-slate-200",
};

function KpiCard({ label, value, icon: Icon }: { label: string; value: string; icon: any }) {
  return (
    <Card className="border-slate-200">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-slate-500">{label}</span>
          <Icon className="h-4 w-4 text-[#3bcac4]" />
        </div>
        <div className="text-xl font-bold text-slate-800">{value}</div>
      </CardContent>
    </Card>
  );
}

function SectionCard({ title, icon: Icon, children }: { title: string; icon: any; children: React.ReactNode }) {
  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base text-slate-800">
          <Icon className="h-5 w-5 text-[#005476]" /> {title}
        </CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function AiMarketingDirector() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ ok: boolean; data: Snapshot | null }>({
    queryKey: ["/api/admin/ai-marketing-director/latest"],
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/ai-marketing-director/generate");
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/ai-marketing-director/latest"] });
      toast({ title: "✅ Analysis complete", description: "New AI Marketing Director report generated." });
    },
    onError: (e: any) => toast({ title: "Generation failed", description: e.message, variant: "destructive" }),
  });

  const snapshot = data?.data || null;
  const kpis = snapshot?.kpis_json;

  return (
    <div>
      {/* Safety banner */}
      <div className="flex flex-wrap gap-2 mb-4">
        {["📖 Read-Only Analysis", "🚫 No Meta Writes", "🚫 No CRM Changes", "🧠 Additive Intelligence Layer"].map((b) => (
          <span key={b} className="text-xs bg-slate-100 text-slate-600 font-medium px-3 py-1 rounded-full border border-slate-200">{b}</span>
        ))}
      </div>

      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#3bcac4]" /> AI Marketing Director
          </h2>
          <p className="text-sm text-slate-500">
            Phase 4 — thinks like a senior Meta Ads strategist. Analyzes synced Meta data + CRM outcomes to explain what happened, why, and what to do next.
          </p>
        </div>
        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending}
          className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white"
        >
          <RefreshCw className={`h-4 w-4 mr-2 ${generateMutation.isPending ? "animate-spin" : ""}`} />
          {generateMutation.isPending ? "Analyzing…" : "Generate Report"}
        </Button>
      </div>

      {isLoading && <p className="text-sm text-slate-400">Loading latest report…</p>}

      {!isLoading && !snapshot && (
        <Card className="border-dashed border-slate-300">
          <CardContent className="p-8 text-center text-slate-500">
            No report generated yet. Click <strong>Generate Report</strong> to run the AI Marketing Director analysis.
          </CardContent>
        </Card>
      )}

      {snapshot && kpis && (
        <div className="space-y-6">
          <p className="text-xs text-slate-400">
            Last generated: {new Date(snapshot.generated_at).toLocaleString()}
          </p>

          {/* Section 1 — Executive Summary */}
          <SectionCard title="Executive Summary" icon={LineChart}>
            <div className="mb-4 flex items-center gap-3">
              <span className={`text-3xl font-extrabold ${healthColor(kpis.healthScore)}`}>{kpis.healthScore}</span>
              <span className="text-sm text-slate-500">/ 100 Marketing Health Score</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Total Spend" value={fmt(kpis.totalSpend, "$")} icon={DollarSign} />
              <KpiCard label="Total Leads" value={fmt(kpis.totalLeads)} icon={Users} />
              <KpiCard label="Qualified Leads" value={fmt(kpis.qualifiedLeads)} icon={CheckCircle2} />
              <KpiCard label="Hot Leads" value={fmt(kpis.hotLeads)} icon={Flame} />
              <KpiCard label="Appointments" value={fmt(kpis.appointments)} icon={Target} />
              <KpiCard label="Site Visits" value={fmt(kpis.siteVisits)} icon={Building2} />
              <KpiCard label="Purchases" value={fmt(kpis.purchases)} icon={CheckCircle2} />
              <KpiCard label="Revenue" value={fmt(kpis.revenue, "$")} icon={DollarSign} />
              <KpiCard label="Estimated ROI" value={kpis.estimatedRoi != null ? fmt(kpis.estimatedRoi * 100, "", "%") : "—"} icon={TrendingUp} />
              <KpiCard label="Avg CPL" value={fmt(kpis.avgCpl, "$")} icon={DollarSign} />
              <KpiCard label="Avg CPC" value={fmt(kpis.avgCpc, "$")} icon={DollarSign} />
              <KpiCard label="Avg CTR" value={fmt(kpis.avgCtr, "", "%")} icon={LineChart} />
              <KpiCard label="Cost / Purchase" value={fmt(kpis.costPerPurchase, "$")} icon={DollarSign} />
              <KpiCard label="Revenue / Lead" value={fmt(kpis.revenuePerLead, "$")} icon={DollarSign} />
              <KpiCard label="Best Campaign" value={kpis.bestCampaign?.name || "—"} icon={TrendingUp} />
              <KpiCard label="Worst Campaign" value={kpis.worstCampaign?.name || "—"} icon={TrendingDown} />
            </div>
            {!kpis.hasOutcomeData && (
              <p className="text-xs text-amber-600 mt-3 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> No CRM sales outcomes recorded yet — ROI/revenue metrics will populate once appointments, site visits and purchases are logged against Meta-attributed leads.
              </p>
            )}
          </SectionCard>

          {/* Section 2 — AI Executive Report */}
          <SectionCard title="AI Executive Report" icon={Sparkles}>
            <p className="text-sm text-slate-700 leading-relaxed">{snapshot.executive_report}</p>
          </SectionCard>

          {/* Section 3 — AI Recommendations */}
          <SectionCard title={`AI Recommendations (${snapshot.recommendations?.length || 0})`} icon={AlertTriangle}>
            {!snapshot.recommendations?.length && <p className="text-sm text-slate-400">No recommendations generated from the current data set.</p>}
            <div className="space-y-3">
              {snapshot.recommendations?.map((r) => (
                <div key={r.id} className="border border-slate-200 rounded-xl p-4">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="font-semibold text-slate-800 text-sm">{r.title}</span>
                    <Badge variant="outline" className={PRIORITY_COLORS[r.priority] || ""}>{r.priority} Priority</Badge>
                    <Badge variant="outline" className={CONFIDENCE_COLORS[r.confidence] || ""}>{r.confidence} Confidence</Badge>
                    <Badge variant="outline" className="bg-slate-50 text-slate-500 border-slate-200">{r.category}</Badge>
                  </div>
                  <p className="text-sm text-slate-600 mb-1"><strong>Why:</strong> {r.reason}</p>
                  <p className="text-sm text-slate-600 mb-1"><strong>Expected Result:</strong> {r.expected_impact}</p>
                  <p className="text-sm text-slate-600"><strong>Business Impact:</strong> {r.business_impact}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Section 5 — Audience Intelligence */}
          <SectionCard title="Audience Intelligence" icon={Users}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-semibold text-slate-700 mb-1">Best Country</p>
                <p className="text-slate-500">{snapshot.audience_json?.bestCountry ? `${snapshot.audience_json.bestCountry.value} — CPL $${snapshot.audience_json.bestCountry.cpl?.toFixed(2)}` : "No data yet"}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Worst Country</p>
                <p className="text-slate-500">{snapshot.audience_json?.worstCountry ? `${snapshot.audience_json.worstCountry.value} — CPL $${snapshot.audience_json.worstCountry.cpl?.toFixed(2)}` : "No data yet"}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Best Age Group</p>
                <p className="text-slate-500">{snapshot.audience_json?.bestAgeGroup ? `${snapshot.audience_json.bestAgeGroup.value} — CPL $${snapshot.audience_json.bestAgeGroup.cpl?.toFixed(2)}` : "No data yet"}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Best Gender</p>
                <p className="text-slate-500">{snapshot.audience_json?.bestGender ? `${snapshot.audience_json.bestGender.value} — CPL $${snapshot.audience_json.bestGender.cpl?.toFixed(2)}` : "No data yet"}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Best Device</p>
                <p className="text-slate-500">{snapshot.audience_json?.bestDevice ? `${snapshot.audience_json.bestDevice.value} — CPL $${snapshot.audience_json.bestDevice.cpl?.toFixed(2)}` : "No data yet"}</p>
              </div>
            </div>
          </SectionCard>

          {/* Section 6 — Creative Intelligence */}
          <SectionCard title="Creative Intelligence" icon={Palette}>
            <p className="text-sm text-slate-500 mb-3">Average CTR across {snapshot.creative_json?.totalAds ?? 0} ads: {fmt(snapshot.creative_json?.avgCtr, "", "%")}</p>
            <p className="font-semibold text-slate-700 text-sm mb-2">Top Performing Creatives</p>
            <div className="space-y-1 mb-3">
              {(snapshot.creative_json?.top10 || []).slice(0, 5).map((c: any) => (
                <div key={c.metaAdId} className="flex justify-between text-sm border-b border-slate-100 py-1">
                  <span className="text-slate-700 truncate max-w-[60%]">{c.name || c.metaAdId}</span>
                  <span className="text-slate-500">CTR {fmt(c.ctr, "", "%")} · CPL {fmt(c.cpl, "$")}</span>
                </div>
              ))}
              {!snapshot.creative_json?.top10?.length && <p className="text-sm text-slate-400">No creative performance data yet.</p>}
            </div>
            {!!snapshot.creative_json?.fatigued?.length && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> {snapshot.creative_json.fatigued.length} creative(s) showing fatigue signs.
              </p>
            )}
          </SectionCard>

          {/* Section 7 — Project Intelligence */}
          <SectionCard title="Project Intelligence" icon={Building2}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-semibold text-slate-700 mb-1">Best Lead-Generating Project</p>
                <p className="text-slate-500">{snapshot.project_json?.bestLead ? `${snapshot.project_json.bestLead.project} (${snapshot.project_json.bestLead.leads} leads)` : "No data yet"}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Best Revenue Project</p>
                <p className="text-slate-500">{snapshot.project_json?.bestRevenue?.revenue ? `${snapshot.project_json.bestRevenue.project} ($${snapshot.project_json.bestRevenue.revenue})` : "No data yet"}</p>
              </div>
            </div>
          </SectionCard>

          {/* Section 8 — Budget Intelligence */}
          <SectionCard title="Budget Intelligence" icon={DollarSign}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="font-semibold text-slate-700 mb-1">Highest ROI Campaign</p>
                <p className="text-slate-500">{snapshot.budget_json?.highestRoiCampaign ? `${snapshot.budget_json.highestRoiCampaign.name} (${fmt((snapshot.budget_json.highestRoiCampaign.roi ?? 0) * 100)}%)` : "No data yet"}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Most Efficient Campaign (CPL)</p>
                <p className="text-slate-500">{snapshot.budget_json?.mostEfficientCampaign ? `${snapshot.budget_json.mostEfficientCampaign.name} ($${snapshot.budget_json.mostEfficientCampaign.cpl})` : "No data yet"}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Budget Efficiency Score</p>
                <p className="text-slate-500">{snapshot.budget_json?.budgetEfficiencyScore ?? "—"} / 100</p>
              </div>
            </div>
          </SectionCard>

          {/* Section 9 — Sales Funnel Intelligence */}
          <SectionCard title="Sales Funnel Intelligence" icon={GitBranch}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {(snapshot.funnel_json?.stages || []).map((s: any, i: number) => (
                <div key={s.stage} className="flex items-center gap-2">
                  <div className="text-center px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg">
                    <p className="text-xs text-slate-500">{s.stage}</p>
                    <p className="font-bold text-slate-800">{s.count}</p>
                  </div>
                  {i < (snapshot.funnel_json?.stages?.length || 0) - 1 && <span className="text-slate-300">→</span>}
                </div>
              ))}
            </div>
            {snapshot.funnel_json?.biggestDropoff && (
              <p className="text-sm text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-4 w-4" /> Biggest drop-off: {snapshot.funnel_json.biggestDropoff.from} → {snapshot.funnel_json.biggestDropoff.to} ({snapshot.funnel_json.biggestDropoff.dropRate}% loss)
              </p>
            )}
          </SectionCard>

          {/* Section 10 — Predictions */}
          <SectionCard title="Predictions" icon={TrendingUp}>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-2">
              <KpiCard label="Projected Leads" value={fmt(snapshot.predictions_json?.projectedLeads)} icon={Users} />
              <KpiCard label="Projected Qualified" value={fmt(snapshot.predictions_json?.projectedQualifiedLeads)} icon={CheckCircle2} />
              <KpiCard label="Projected Purchases" value={fmt(snapshot.predictions_json?.projectedPurchases)} icon={CheckCircle2} />
              <KpiCard label="Projected Revenue" value={fmt(snapshot.predictions_json?.projectedRevenue, "$")} icon={DollarSign} />
            </div>
            <Badge variant="outline" className={CONFIDENCE_COLORS[snapshot.predictions_json?.confidence] || ""}>{snapshot.predictions_json?.confidence} Confidence</Badge>
            <p className="text-xs text-slate-500 mt-2">{snapshot.predictions_json?.basis}</p>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
