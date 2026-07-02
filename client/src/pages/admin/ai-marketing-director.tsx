import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Sparkles, RefreshCw, TrendingUp, TrendingDown, AlertTriangle, CheckCircle2,
  Target, Users, Palette, DollarSign, Building2, GitBranch, LineChart, Flame, Award,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

const DISPLAY_CURRENCIES = ["USD", "EUR", "GBP", "AED", "TRY"] as const;
type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

interface Kpis {
  healthScore: number;
  baseCurrency: string;
  displayRates: Record<string, number>;
  ratesStale: boolean;
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
  avgCpm: number | null;
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
  suggested_action: string;
  estimated_financial_impact: number | null;
  estimated_financial_impact_label: string;
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
  sales_json: any;
  kqs_json: any;
  base_currency: string;
  exchange_rates_json: Record<string, number>;
  rates_stale: boolean;
  generated_at: string;
  recommendations: Recommendation[];
}

// ── Currency helpers ─────────────────────────────────────────────────────────
// All monetary values are stored server-side in the Meta ad account's native
// (base) currency. `displayRates[selected]` gives "1 base unit = X selected
// units", so conversion is a single multiplication — no currency is ever
// hardcoded, and the selector works for any base currency Meta reports.

function useCurrencyFormatter(rates: Record<string, number> | undefined, selected: DisplayCurrency) {
  return useMemo(() => {
    const rate = rates?.[selected] ?? 1;
    const convert = (baseAmount: number | null | undefined): number | null => {
      if (baseAmount == null || !Number.isFinite(baseAmount)) return null;
      return baseAmount * rate;
    };
    const format = (baseAmount: number | null | undefined): string => {
      const converted = convert(baseAmount);
      if (converted == null) return "—";
      try {
        return new Intl.NumberFormat(undefined, { style: "currency", currency: selected, maximumFractionDigits: 2 }).format(converted);
      } catch {
        return `${selected} ${converted.toFixed(2)}`;
      }
    };
    return { convert, format };
  }, [rates, selected]);
}

// Renders text containing `{{money:VALUE}}` tokens (VALUE = base-currency
// number produced by the server) with the amount formatted in the currently
// selected display currency.
function MoneyText({ text, format }: { text: string; format: (v: number | null) => string }) {
  const parts = text.split(/(\{\{money:-?[\d.]+\}\})/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = part.match(/^\{\{money:(-?[\d.]+)\}\}$/);
        if (match) return <span key={i} className="font-semibold">{format(Number(match[1]))}</span>;
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

// ── Generic helpers ────────────────────────────────────────────────────────────

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
const ACTION_COLORS: Record<string, string> = {
  increase: "bg-green-100 text-green-700 border-green-200",
  decrease: "bg-amber-100 text-amber-700 border-amber-200",
  pause: "bg-red-100 text-red-700 border-red-200",
  maintain: "bg-slate-100 text-slate-600 border-slate-200",
};
function finalRecColorClass(rec: string | null | undefined) {
  if (!rec) return "bg-slate-100 text-slate-600 border-slate-200";
  if (rec.startsWith("Scale")) return "bg-green-100 text-green-700 border-green-200";
  if (rec.startsWith("Maintain")) return "bg-teal-100 text-teal-700 border-teal-200";
  if (rec.startsWith("Review")) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-red-100 text-red-700 border-red-200";
}
function scoreColorClass(score: number | null | undefined) {
  if (score == null) return "text-slate-400";
  if (score >= 70) return "text-green-600";
  if (score >= 40) return "text-amber-600";
  return "text-red-600";
}

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
  const [currency, setCurrency] = useState<DisplayCurrency>(() => {
    const saved = typeof window !== "undefined" ? localStorage.getItem("ai_director_currency") : null;
    return (DISPLAY_CURRENCIES as readonly string[]).includes(saved || "") ? (saved as DisplayCurrency) : "USD";
  });

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
  const rates = snapshot?.exchange_rates_json || kpis?.displayRates;
  const baseCurrency = snapshot?.base_currency || kpis?.baseCurrency || "USD";
  const { format } = useCurrencyFormatter(rates, currency);

  const handleCurrencyChange = (v: string) => {
    setCurrency(v as DisplayCurrency);
    if (typeof window !== "undefined") localStorage.setItem("ai_director_currency", v);
  };

  return (
    <div>
      {/* Safety banner */}
      <div className="flex flex-wrap gap-2 mb-4">
        {["📖 Read-Only Analysis", "🚫 No Meta Writes", "🚫 No CRM Changes", "🧠 Additive Intelligence Layer"].map((b) => (
          <span key={b} className="text-xs bg-slate-100 text-slate-600 font-medium px-3 py-1 rounded-full border border-slate-200">{b}</span>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-[#3bcac4]" /> AI Marketing Director
          </h2>
          <p className="text-sm text-slate-500">
            Thinks like a senior Meta Ads strategist. Analyzes synced Meta data + CRM outcomes to explain what happened, why, and what to do next.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {snapshot && (
            <Select value={currency} onValueChange={handleCurrencyChange}>
              <SelectTrigger className="w-[110px] bg-white">
                <SelectValue placeholder="Currency" />
              </SelectTrigger>
              <SelectContent>
                {DISPLAY_CURRENCIES.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            onClick={() => generateMutation.mutate()}
            disabled={generateMutation.isPending}
            className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white"
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${generateMutation.isPending ? "animate-spin" : ""}`} />
            {generateMutation.isPending ? "Analyzing…" : "Generate Report"}
          </Button>
        </div>
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
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              Last generated: {new Date(snapshot.generated_at).toLocaleString()}
            </p>
            <p className="text-xs text-slate-400">
              Meta account currency: <strong className="text-slate-600">{baseCurrency}</strong> · Displaying in <strong className="text-slate-600">{currency}</strong>
              {snapshot.rates_stale && (
                <span className="text-amber-600 ml-1">(exchange rates temporarily unavailable — using fallback rates)</span>
              )}
            </p>
          </div>

          {/* Section 1 — Executive Summary */}
          <SectionCard title="Executive Summary" icon={LineChart}>
            <div className="mb-4 flex items-center gap-3">
              <span className={`text-3xl font-extrabold ${healthColor(kpis.healthScore)}`}>{kpis.healthScore}</span>
              <span className="text-sm text-slate-500">/ 100 Marketing Health Score</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <KpiCard label="Total Spend" value={format(kpis.totalSpend)} icon={DollarSign} />
              <KpiCard label="Total Leads" value={fmt(kpis.totalLeads)} icon={Users} />
              <KpiCard label="Qualified Leads" value={fmt(kpis.qualifiedLeads)} icon={CheckCircle2} />
              <KpiCard label="Hot Leads" value={fmt(kpis.hotLeads)} icon={Flame} />
              <KpiCard label="Appointments" value={fmt(kpis.appointments)} icon={Target} />
              <KpiCard label="Site Visits" value={fmt(kpis.siteVisits)} icon={Building2} />
              <KpiCard label="Purchases" value={fmt(kpis.purchases)} icon={CheckCircle2} />
              <KpiCard label="Revenue" value={format(kpis.revenue)} icon={DollarSign} />
              <KpiCard label="Estimated ROI" value={kpis.estimatedRoi != null ? fmt(kpis.estimatedRoi * 100, "", "%") : "—"} icon={TrendingUp} />
              <KpiCard label="Avg CPL" value={format(kpis.avgCpl)} icon={DollarSign} />
              <KpiCard label="Avg CPC" value={format(kpis.avgCpc)} icon={DollarSign} />
              <KpiCard label="Avg CPM" value={format(kpis.avgCpm)} icon={DollarSign} />
              <KpiCard label="Avg CTR" value={fmt(kpis.avgCtr, "", "%")} icon={LineChart} />
              <KpiCard label="Cost / Purchase" value={format(kpis.costPerPurchase)} icon={DollarSign} />
              <KpiCard label="Revenue / Lead" value={format(kpis.revenuePerLead)} icon={DollarSign} />
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
            <p className="text-sm text-slate-700 leading-relaxed">
              <MoneyText text={snapshot.executive_report} format={format} />
            </p>
          </SectionCard>

          {/* Section 3 — Executive Intelligence / Recommendations */}
          <SectionCard title={`Executive Intelligence — Recommendations (${snapshot.recommendations?.length || 0})`} icon={AlertTriangle}>
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
                  <p className="text-sm text-slate-600 mb-1"><strong>Why:</strong> <MoneyText text={r.reason} format={format} /></p>
                  <p className="text-sm text-slate-600 mb-1"><strong>Expected Impact:</strong> {r.expected_impact}</p>
                  <p className="text-sm text-slate-600 mb-1"><strong>Suggested Action:</strong> {r.suggested_action}</p>
                  <p className="text-sm text-slate-600 mb-1">
                    <strong>Estimated Financial Impact:</strong>{" "}
                    {r.estimated_financial_impact != null ? format(r.estimated_financial_impact) : "Not directly quantifiable"} — {r.estimated_financial_impact_label}
                  </p>
                  <p className="text-sm text-slate-600"><strong>Business Impact:</strong> {r.business_impact}</p>
                </div>
              ))}
            </div>
          </SectionCard>

          {/* Section 4 — Sales Intelligence */}
          <SectionCard title="Sales Intelligence — Campaigns Ranked by Real Profit" icon={Target}>
            {!snapshot.sales_json?.hasOutcomeData && (
              <p className="text-sm text-amber-600 flex items-center gap-1 mb-3">
                <AlertTriangle className="h-3.5 w-3.5" /> No sales outcomes (appointments, site visits, purchases) recorded in the CRM yet — profit ranking will activate automatically once outcomes are logged.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3">Campaign</th>
                    <th className="py-2 pr-3">Spend</th>
                    <th className="py-2 pr-3">Leads</th>
                    <th className="py-2 pr-3">Appts</th>
                    <th className="py-2 pr-3">Site Visits</th>
                    <th className="py-2 pr-3">Purchases</th>
                    <th className="py-2 pr-3">Revenue</th>
                    <th className="py-2 pr-3">Profit</th>
                    <th className="py-2 pr-3">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot.sales_json?.rankedByProfit || []).slice(0, 15).map((c: any) => (
                    <tr key={c.metaCampaignId} className="border-b border-slate-100">
                      <td className="py-2 pr-3 text-slate-700 max-w-[220px] truncate">{c.name}</td>
                      <td className="py-2 pr-3 text-slate-600">{format(c.spend)}</td>
                      <td className="py-2 pr-3 text-slate-600">{c.leads}</td>
                      <td className="py-2 pr-3 text-slate-600">{c.appointments}</td>
                      <td className="py-2 pr-3 text-slate-600">{c.siteVisits}</td>
                      <td className="py-2 pr-3 text-slate-600">{c.purchases}</td>
                      <td className="py-2 pr-3 text-slate-600">{format(c.revenue)}</td>
                      <td className={`py-2 pr-3 font-semibold ${(c.profit ?? 0) >= 0 ? "text-green-600" : "text-red-600"}`}>{format(c.profit)}</td>
                      <td className="py-2 pr-3 text-slate-600">{c.roi != null ? `${(c.roi * 100).toFixed(0)}%` : "—"}</td>
                    </tr>
                  ))}
                  {!snapshot.sales_json?.rankedByProfit?.length && (
                    <tr><td colSpan={9} className="py-4 text-center text-slate-400">No campaign activity yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* Section 5 — Audience Intelligence */}
          <SectionCard title="Audience Intelligence" icon={Users}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              {[
                { label: "Countries", best: snapshot.audience_json?.countries?.best, worst: snapshot.audience_json?.countries?.worst },
                { label: "Ages", best: snapshot.audience_json?.ages?.best, worst: snapshot.audience_json?.ages?.worst },
                { label: "Genders", best: snapshot.audience_json?.genders?.best, worst: snapshot.audience_json?.genders?.worst },
                { label: "Devices", best: snapshot.audience_json?.devices?.best, worst: snapshot.audience_json?.devices?.worst },
                { label: "Cities (estimated)", best: snapshot.audience_json?.cities?.best, worst: snapshot.audience_json?.cities?.worst },
                { label: "Interests (estimated)", best: snapshot.audience_json?.interests?.best, worst: snapshot.audience_json?.interests?.worst },
              ].map((d) => (
                <div key={d.label}>
                  <p className="font-semibold text-slate-700 mb-1">{d.label}</p>
                  <p className="text-green-600">Best: {d.best ? `${d.best.value} — CPL ${format(d.best.cpl)}` : "No data yet"}</p>
                  <p className="text-red-500">Worst: {d.worst ? `${d.worst.value} — CPL ${format(d.worst.cpl)}` : "No data yet"}</p>
                </div>
              ))}
              <div>
                <p className="font-semibold text-slate-700 mb-1">Placements</p>
                <p className="text-slate-500">{snapshot.audience_json?.placements?.note || "No data yet"}</p>
              </div>
            </div>
          </SectionCard>

          {/* Section 6 — Creative Intelligence */}
          <SectionCard title="Creative Intelligence" icon={Palette}>
            <p className="text-sm text-slate-500 mb-3">Average CTR across {snapshot.creative_json?.totalAds ?? 0} ads: {fmt(snapshot.creative_json?.avgCtr, "", "%")} · Average CPL: {format(snapshot.creative_json?.avgCpl)}</p>
            <p className="font-semibold text-slate-700 text-sm mb-2">Winning Creatives</p>
            <div className="space-y-2 mb-4">
              {(snapshot.creative_json?.top10 || []).slice(0, 5).map((c: any) => (
                <div key={c.metaAdId} className="border-b border-slate-100 pb-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-700 truncate max-w-[60%]">{c.name || c.metaAdId}</span>
                    <span className="text-slate-500">CTR {fmt(c.ctr, "", "%")} · CPL {format(c.cpl)}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{c.why}</p>
                </div>
              ))}
              {!snapshot.creative_json?.top10?.length && <p className="text-sm text-slate-400">No creative performance data yet.</p>}
            </div>
            <p className="font-semibold text-slate-700 text-sm mb-2">Underperforming Creatives</p>
            <div className="space-y-2 mb-3">
              {(snapshot.creative_json?.bottom10 || []).slice(0, 5).map((c: any) => (
                <div key={c.metaAdId} className="border-b border-slate-100 pb-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-slate-700 truncate max-w-[60%]">{c.name || c.metaAdId}</span>
                    <span className="text-slate-500">CTR {fmt(c.ctr, "", "%")} · CPL {format(c.cpl)}</span>
                  </div>
                  <p className="text-xs text-slate-400 mt-0.5">{c.why}</p>
                </div>
              ))}
              {!snapshot.creative_json?.bottom10?.length && <p className="text-sm text-slate-400">No creative performance data yet.</p>}
            </div>
            {!!snapshot.creative_json?.fatigued?.length && (
              <p className="text-xs text-amber-600 flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> {snapshot.creative_json.fatigued.length} creative(s) showing fatigue signs — consider refreshing.
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
                <p className="text-slate-500">{snapshot.project_json?.bestRevenue?.revenue ? `${snapshot.project_json.bestRevenue.project} (${format(snapshot.project_json.bestRevenue.revenue)})` : "No data yet"}</p>
              </div>
            </div>
          </SectionCard>

          {/* Section 8 — Budget Intelligence */}
          <SectionCard title="Budget Intelligence" icon={DollarSign}>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
              <div>
                <p className="font-semibold text-slate-700 mb-1">Highest ROI Campaign</p>
                <p className="text-slate-500">{snapshot.budget_json?.highestRoiCampaign ? `${snapshot.budget_json.highestRoiCampaign.name} (${fmt((snapshot.budget_json.highestRoiCampaign.roi ?? 0) * 100)}%)` : "No data yet"}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Most Efficient Campaign (CPL)</p>
                <p className="text-slate-500">{snapshot.budget_json?.mostEfficientCampaign ? `${snapshot.budget_json.mostEfficientCampaign.name} (${format(snapshot.budget_json.mostEfficientCampaign.cpl)})` : "No data yet"}</p>
              </div>
              <div>
                <p className="font-semibold text-slate-700 mb-1">Budget Efficiency Score</p>
                <p className="text-slate-500">{snapshot.budget_json?.budgetEfficiencyScore ?? "—"} / 100</p>
              </div>
            </div>
            <p className="font-semibold text-slate-700 text-sm mb-2">Recommended Action per Campaign</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3">Campaign</th>
                    <th className="py-2 pr-3">Spend</th>
                    <th className="py-2 pr-3">CPL</th>
                    <th className="py-2 pr-3">ROI</th>
                    <th className="py-2 pr-3">Action</th>
                    <th className="py-2 pr-3">Estimated Impact</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot.budget_json?.actionTable || []).map((c: any) => (
                    <tr key={c.metaCampaignId} className="border-b border-slate-100">
                      <td className="py-2 pr-3 text-slate-700 max-w-[200px] truncate">{c.name}</td>
                      <td className="py-2 pr-3 text-slate-600">{format(c.spend)}</td>
                      <td className="py-2 pr-3 text-slate-600">{format(c.cpl)}</td>
                      <td className="py-2 pr-3 text-slate-600">{c.roi != null ? `${(c.roi * 100).toFixed(0)}%` : "—"}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={ACTION_COLORS[c.recommendedAction] || ""}>{c.recommendedAction}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-slate-600">
                        {c.estimatedImpact != null ? format(c.estimatedImpact) : "—"}
                        <span className="text-xs text-slate-400 block">{c.estimatedImpactLabel}</span>
                      </td>
                    </tr>
                  ))}
                  {!snapshot.budget_json?.actionTable?.length && (
                    <tr><td colSpan={6} className="py-4 text-center text-slate-400">No campaign data yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </SectionCard>

          {/* Section 8.5 — Kinglike Quality Score (KQS) */}
          <SectionCard title="Kinglike Quality Score (KQS) — Real Quality Beyond Meta Metrics" icon={Award}>
            <p className="text-sm text-slate-500 mb-3">
              Meta only tracks clicks and cost-per-lead — it has no idea which leads actually became sales. KQS learns from real CRM outcomes
              (replies, appointments, site visits, sales, commission) to score every lead and campaign on real quality, 0–100.
              <strong> The Final Recommendation always prioritizes KQS over raw Meta metrics.</strong>
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <KpiCard label="Leads Scored" value={fmt(snapshot.kqs_json?.learningStatus?.totalLeadsScored)} icon={Users} />
              <KpiCard label="Sales Observed" value={fmt(snapshot.kqs_json?.learningStatus?.totalSalesObserved)} icon={CheckCircle2} />
              <KpiCard label="Duplicate Leads" value={fmt(snapshot.kqs_json?.duplicateCount)} icon={AlertTriangle} />
              <KpiCard label="Fake-Risk Leads" value={fmt(snapshot.kqs_json?.highFakeRiskCount)} icon={AlertTriangle} />
            </div>
            <div className="flex items-center gap-2 mb-4">
              <Badge variant="outline" className={CONFIDENCE_COLORS[snapshot.kqs_json?.learningStatus?.confidence] || ""}>
                {snapshot.kqs_json?.learningStatus?.confidence || "Low"} Confidence
              </Badge>
              <span className="text-xs text-slate-400">{snapshot.kqs_json?.methodologyNote}</span>
            </div>
            <p className="font-semibold text-slate-700 text-sm mb-2">Meta Score vs. CRM Score vs. KQS — Per Campaign</p>
            <div className="overflow-x-auto mb-5">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
                    <th className="py-2 pr-3">Campaign</th>
                    <th className="py-2 pr-3">Leads</th>
                    <th className="py-2 pr-3">Meta Score</th>
                    <th className="py-2 pr-3">CRM Score</th>
                    <th className="py-2 pr-3">KQS</th>
                    <th className="py-2 pr-3">Final Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {(snapshot.kqs_json?.campaigns || []).map((c: any) => (
                    <tr key={c.entityId} className="border-b border-slate-100 align-top">
                      <td className="py-2 pr-3 text-slate-700 max-w-[200px] truncate">{c.name}</td>
                      <td className="py-2 pr-3 text-slate-600">{c.leads}</td>
                      <td className={`py-2 pr-3 font-semibold ${scoreColorClass(c.metaScore)}`}>{fmt(c.metaScore)}</td>
                      <td className={`py-2 pr-3 font-semibold ${scoreColorClass(c.crmScore)}`}>{fmt(c.crmScore)}</td>
                      <td className={`py-2 pr-3 font-bold ${scoreColorClass(c.kqs)}`}>{fmt(c.kqs)}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className={finalRecColorClass(c.finalRecommendation)}>
                          {(c.finalRecommendation || "").split(" — ")[0]}
                        </Badge>
                        {c.warning && (
                          <p className="text-xs text-amber-600 flex items-start gap-1 mt-1 max-w-[280px]">
                            <AlertTriangle className="h-3 w-3 mt-0.5 flex-shrink-0" /> {c.warning}
                          </p>
                        )}
                      </td>
                    </tr>
                  ))}
                  {!snapshot.kqs_json?.campaigns?.length && (
                    <tr><td colSpan={6} className="py-4 text-center text-slate-400">No campaign data yet.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <p className="font-semibold text-slate-700 text-sm mb-2">Top Quality Leads (Highest KQS)</p>
                <div className="space-y-1.5">
                  {(snapshot.kqs_json?.topLeads || []).slice(0, 8).map((l: any) => (
                    <div key={l.leadId} className="flex justify-between text-xs border-b border-slate-100 pb-1">
                      <span className="text-slate-600">Lead #{l.leadId}{l.isDuplicate ? " (dup)" : ""}</span>
                      <span className={`font-semibold ${scoreColorClass(l.kqs)}`}>{l.kqs}</span>
                    </div>
                  ))}
                  {!snapshot.kqs_json?.topLeads?.length && <p className="text-sm text-slate-400">No lead data yet.</p>}
                </div>
              </div>
              <div>
                <p className="font-semibold text-slate-700 text-sm mb-2">Lowest Quality Leads (Lowest KQS)</p>
                <div className="space-y-1.5">
                  {(snapshot.kqs_json?.bottomLeads || []).slice(0, 8).map((l: any) => (
                    <div key={l.leadId} className="flex justify-between text-xs border-b border-slate-100 pb-1">
                      <span className="text-slate-600">Lead #{l.leadId}{l.isDuplicate ? " (dup)" : ""}{l.fakeProbability >= 50 ? " (fake risk)" : ""}</span>
                      <span className={`font-semibold ${scoreColorClass(l.kqs)}`}>{l.kqs}</span>
                    </div>
                  ))}
                  {!snapshot.kqs_json?.bottomLeads?.length && <p className="text-sm text-slate-400">No lead data yet.</p>}
                </div>
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
              <KpiCard label="Projected Revenue" value={format(snapshot.predictions_json?.projectedRevenue)} icon={DollarSign} />
            </div>
            <Badge variant="outline" className={CONFIDENCE_COLORS[snapshot.predictions_json?.confidence] || ""}>{snapshot.predictions_json?.confidence} Confidence</Badge>
            <p className="text-xs text-slate-500 mt-2">{snapshot.predictions_json?.basis}</p>
          </SectionCard>
        </div>
      )}
    </div>
  );
}
