import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { BarChart3, Loader2, Sparkles, ChevronRight, TrendingUp, Globe, Languages, Tag, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface CountedTerm {
  term: string;
  count: number;
}

interface MarketInsights {
  mostAdvertisedProjects: CountedTerm[];
  mostAdvertisedDevelopers: CountedTerm[];
  mostActiveCompetitors: CountedTerm[];
  mostAdvertisedCities: CountedTerm[];
  mostTargetedCountries: CountedTerm[];
  mostUsedLanguages: CountedTerm[];
  mostCommonOffers: CountedTerm[];
  mostCommonCtas: CountedTerm[];
  mostCommonInvestmentAngles: CountedTerm[];
  mostCommonPaymentPlans: CountedTerm[];
  mostCommonPropertyTypes: CountedTerm[];
  mostCommonLuxuryKeywords: CountedTerm[];
  mostCommonBuyerMotivations: CountedTerm[];
  sampleSize: number;
}

interface MarketAnalystReport {
  risingCompetitors: string;
  projectFocus: string;
  commonOffers: string;
  overusedAngles: string;
  underusedAngles: string;
  unusedOpportunities: string;
  biggestThreat: string;
  dominantLanguage: string;
  dominantMarket: string;
  whatToLaunch: string;
  directorPlan: {
    campaignStrategy: string;
    creativeStrategy: string;
    audienceStrategy: string;
    offerStrategy: string;
    budgetSuggestion: string;
    expectedImpact: string;
    confidenceLevel: string;
  };
}

function unwrap<T>(json: any): T | null {
  if (!json) return null;
  if (json.data !== undefined) return json.data as T;
  return json as T;
}

const INSIGHT_CATEGORIES: Array<{ key: keyof MarketInsights; label: string; icon: any }> = [
  { key: "mostAdvertisedProjects", label: "Projects", icon: BarChart3 },
  { key: "mostAdvertisedDevelopers", label: "Developers", icon: TrendingUp },
  { key: "mostActiveCompetitors", label: "Competitors", icon: Users },
  { key: "mostTargetedCountries", label: "Countries", icon: Globe },
  { key: "mostUsedLanguages", label: "Languages", icon: Languages },
  { key: "mostCommonOffers", label: "Offers", icon: Tag },
  { key: "mostCommonCtas", label: "CTAs", icon: ChevronRight },
  { key: "mostCommonInvestmentAngles", label: "Investment Angles", icon: TrendingUp },
  { key: "mostCommonPaymentPlans", label: "Payment Plans", icon: Tag },
  { key: "mostCommonPropertyTypes", label: "Property Types", icon: BarChart3 },
  { key: "mostCommonLuxuryKeywords", label: "Luxury Keywords", icon: Sparkles },
  { key: "mostCommonBuyerMotivations", label: "Buyer Motivations", icon: Users },
  { key: "mostAdvertisedCities", label: "Cities", icon: Globe },
];

function TopBar({ items, max = 5 }: { items: CountedTerm[]; max?: number }) {
  if (!items || items.length === 0) return <p className="text-xs text-slate-400 italic">No data yet</p>;
  const topCount = items[0]?.count || 1;
  return (
    <div className="space-y-1.5">
      {items.slice(0, max).map((item, i) => (
        <div key={item.term} className="flex items-center gap-2">
          <span className="text-[10px] text-slate-400 w-4 shrink-0">{i + 1}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs text-slate-700 font-medium truncate">{item.term}</span>
              <span className="text-[10px] text-slate-400 ml-2 shrink-0">{item.count}</span>
            </div>
            <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#3bcac4] to-[#005476] transition-all"
                style={{ width: `${Math.max(8, Math.round((item.count / topCount) * 100))}%` }}
              />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportSection({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="space-y-1">
      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</div>
      <p className="text-sm text-slate-700 leading-relaxed">{value}</p>
    </div>
  );
}

export function MarketInsightsDashboard() {
  const { toast } = useToast();
  const [report, setReport] = useState<MarketAnalystReport | null>(null);

  const insightsQuery = useQuery<MarketInsights | null>({
    queryKey: ["/api/admin/competitor-intelligence/market-insights"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/competitor-intelligence/market-insights");
      const json = await res.json();
      return unwrap<MarketInsights>(json);
    },
  });

  const analystMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/competitor-intelligence/market-analyst", {});
      return res.json();
    },
    onSuccess: (json) => {
      const data = unwrap<MarketAnalystReport>(json);
      if (json?.ok === false || !data) {
        toast({ title: "AI Market Analyst failed", description: json?.error || "Unknown error", variant: "destructive" });
        return;
      }
      setReport(data);
      toast({ title: "Market analysis complete", description: "AI has generated a fresh strategic report." });
    },
    onError: (err: any) => {
      toast({ title: "Analysis failed", description: err.message, variant: "destructive" });
    },
  });

  const insights = insightsQuery.data;

  return (
    <div className="space-y-6">
      {/* KPI summary row */}
      {insights && insights.sampleSize > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Projects tracked", value: insights.mostAdvertisedProjects.length },
            { label: "Countries targeted", value: insights.mostTargetedCountries.length },
            { label: "Languages detected", value: insights.mostUsedLanguages.length },
            { label: "Ads analysed", value: insights.sampleSize },
          ].map((kpi) => (
            <div key={kpi.label} className="bg-gradient-to-br from-[#3bcac4]/5 to-[#005476]/5 border border-[#3bcac4]/20 rounded-xl p-3 text-center">
              <div className="text-2xl font-bold text-[#005476]">{kpi.value}</div>
              <div className="text-[10px] text-slate-500 mt-0.5">{kpi.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Insight categories grid */}
      {insightsQuery.isLoading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500 py-4">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading market insights…
        </div>
      ) : !insights || insights.sampleSize === 0 ? (
        <div className="text-sm text-slate-400 py-4 text-center">
          No market data yet — run a search to populate insights.
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {INSIGHT_CATEGORIES.map(({ key, label, icon: Icon }) => {
            const items = (insights[key] as CountedTerm[]) ?? [];
            if (items.length === 0) return null;
            return (
              <div key={key} className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-6 h-6 rounded-lg bg-[#3bcac4]/10 flex items-center justify-center">
                    <Icon className="w-3.5 h-3.5 text-[#005476]" />
                  </div>
                  <span className="text-xs font-semibold text-slate-600">{label}</span>
                  <Badge variant="outline" className="ml-auto text-[10px] px-1.5 py-0 text-slate-400 border-slate-200">
                    {items.length}
                  </Badge>
                </div>
                <TopBar items={items} max={5} />
              </div>
            );
          })}
        </div>
      )}

      {/* AI Market Analyst */}
      <div className="border border-dashed border-[#3bcac4]/40 rounded-xl p-5 bg-gradient-to-br from-[#3bcac4]/3 to-[#005476]/3">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-800">AI Market Analyst</div>
              <div className="text-[10px] text-slate-400">Full strategic intelligence report · One-click generation</div>
            </div>
          </div>
          <Button
            size="sm"
            disabled={analystMutation.isPending}
            onClick={() => analystMutation.mutate()}
            className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90 text-xs h-8"
            data-testid="button-generate-market-analyst"
          >
            {analystMutation.isPending ? (
              <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Analysing…</>
            ) : (
              <><Sparkles className="w-3.5 h-3.5 mr-1.5" /> Generate Report</>
            )}
          </Button>
        </div>

        {report && (
          <div className="space-y-5 pt-4 border-t border-[#3bcac4]/20">
            {/* Director plan highlights */}
            {report.directorPlan && (
              <div className="grid sm:grid-cols-2 gap-3">
                {[
                  { label: "Campaign Strategy", value: report.directorPlan.campaignStrategy },
                  { label: "Creative Strategy", value: report.directorPlan.creativeStrategy },
                  { label: "Audience Strategy", value: report.directorPlan.audienceStrategy },
                  { label: "Offer Strategy", value: report.directorPlan.offerStrategy },
                  { label: "Budget Suggestion", value: report.directorPlan.budgetSuggestion },
                  { label: "Expected Impact", value: report.directorPlan.expectedImpact },
                ].filter(item => item.value).map((item) => (
                  <div key={item.label} className="bg-white rounded-lg border border-slate-100 p-3">
                    <div className="text-[10px] font-semibold text-[#005476] uppercase tracking-wide mb-1">{item.label}</div>
                    <p className="text-xs text-slate-700 leading-relaxed">{item.value}</p>
                  </div>
                ))}
              </div>
            )}
            <div className="grid sm:grid-cols-2 gap-4">
              <ReportSection label="Rising Competitors" value={report.risingCompetitors} />
              <ReportSection label="Biggest Threat" value={report.biggestThreat} />
              <ReportSection label="Market Opportunities" value={report.unusedOpportunities} />
              <ReportSection label="What to Launch" value={report.whatToLaunch} />
              <ReportSection label="Overused Angles" value={report.overusedAngles} />
              <ReportSection label="Underused Angles" value={report.underusedAngles} />
            </div>
            {report.directorPlan?.confidenceLevel && (
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="bg-[#3bcac4]/10 text-[#005476] border-[#3bcac4]/30 text-xs">
                  AI Confidence: {report.directorPlan.confidenceLevel}
                </Badge>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
