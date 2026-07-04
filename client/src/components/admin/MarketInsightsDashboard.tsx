import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { BarChart3, Loader2, Sparkles, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

const CATEGORY_LABELS: Array<{ key: keyof MarketInsights; label: string }> = [
  { key: "mostAdvertisedProjects", label: "Most Advertised Projects" },
  { key: "mostAdvertisedDevelopers", label: "Most Advertised Developers" },
  { key: "mostActiveCompetitors", label: "Most Active Competitors" },
  { key: "mostAdvertisedCities", label: "Most Advertised Cities" },
  { key: "mostTargetedCountries", label: "Most Targeted Countries" },
  { key: "mostUsedLanguages", label: "Most Used Languages" },
  { key: "mostCommonOffers", label: "Most Common Offers" },
  { key: "mostCommonCtas", label: "Most Common CTAs" },
  { key: "mostCommonInvestmentAngles", label: "Most Common Investment Angles" },
  { key: "mostCommonPaymentPlans", label: "Most Common Payment Plans" },
  { key: "mostCommonPropertyTypes", label: "Most Common Property Types" },
  { key: "mostCommonLuxuryKeywords", label: "Most Common Luxury Keywords" },
  { key: "mostCommonBuyerMotivations", label: "Most Common Buyer Motivations" },
];

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
      toast({ title: "Market analysis complete", description: "The AI Market Analyst report is ready below." });
    },
    onError: (err: any) => {
      toast({ title: "AI Market Analyst failed", description: err.message, variant: "destructive" });
    },
  });

  const insights = insightsQuery.data;
  const hasAnyData = insights && insights.sampleSize > 0;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[#3bcac4]" /> Market Insights
          </CardTitle>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => insightsQuery.refetch()}
            disabled={insightsQuery.isFetching}
            data-testid="button-refresh-insights"
          >
            {insightsQuery.isFetching ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-2" />}
            Refresh
          </Button>
        </CardHeader>
        <CardContent>
          {insightsQuery.isLoading ? (
            <div className="text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading market insights...</div>
          ) : insightsQuery.isError ? (
            <div className="text-sm text-red-500">Failed to load market insights.</div>
          ) : !hasAnyData ? (
            <div className="text-sm text-slate-400">No stored competitor data yet. Run a search above to populate Market Insights.</div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {CATEGORY_LABELS.map(({ key, label }) => {
                const items = insights![key] as CountedTerm[];
                if (!items || items.length === 0) return null;
                return (
                  <div key={key} className="border rounded-lg p-3 bg-slate-50/50">
                    <div className="text-[11px] font-semibold text-slate-500 uppercase mb-2">{label}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {items.slice(0, 6).map((item) => (
                        <Badge key={item.term} variant="outline" className="bg-white text-slate-700 text-xs">
                          {item.term} <span className="ml-1 text-[#005476] font-semibold">{item.count}</span>
                        </Badge>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-[#3bcac4]/30">
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#005476]" /> AI Market Analyst
          </CardTitle>
          <Button
            type="button"
            size="sm"
            onClick={() => analystMutation.mutate()}
            disabled={analystMutation.isPending || !hasAnyData}
            className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90"
            data-testid="button-analyze-market"
          >
            {analystMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-2 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-2" />}
            Analyze Market
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {!hasAnyData && (
            <p className="text-sm text-slate-400">Run a search first so there is stored data for the analyst to read.</p>
          )}
          {hasAnyData && !report && !analystMutation.isPending && (
            <p className="text-sm text-slate-400">Click "Analyze Market" to generate a one-time AI report from already-stored competitor data.</p>
          )}
          {report && (
            <div className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <InsightLine label="Rising competitors" value={report.risingCompetitors} />
                <InsightLine label="Project focus" value={report.projectFocus} />
                <InsightLine label="Common offers" value={report.commonOffers} />
                <InsightLine label="Overused angles" value={report.overusedAngles} />
                <InsightLine label="Underused angles" value={report.underusedAngles} />
                <InsightLine label="Unused opportunities" value={report.unusedOpportunities} />
                <InsightLine label="Biggest threat" value={report.biggestThreat} />
                <InsightLine label="Dominant language" value={report.dominantLanguage} />
                <InsightLine label="Dominant market" value={report.dominantMarket} />
                <InsightLine label="What to launch next" value={report.whatToLaunch} />
              </div>
              <div className="rounded-lg border border-[#3bcac4]/30 bg-[#3bcac4]/5 p-4">
                <div className="text-sm font-semibold text-[#005476] mb-2">
                  If I were Kinglike Marketing Director, I would do the following this week:
                </div>
                <div className="space-y-1.5 text-sm">
                  <InsightLine label="Campaign strategy" value={report.directorPlan.campaignStrategy} />
                  <InsightLine label="Creative strategy" value={report.directorPlan.creativeStrategy} />
                  <InsightLine label="Audience strategy" value={report.directorPlan.audienceStrategy} />
                  <InsightLine label="Offer strategy" value={report.directorPlan.offerStrategy} />
                  <InsightLine label="Budget suggestion" value={report.directorPlan.budgetSuggestion} />
                  <InsightLine label="Expected impact" value={report.directorPlan.expectedImpact} />
                  <InsightLine label="Confidence level" value={report.directorPlan.confidenceLevel} />
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InsightLine({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div>
      <span className="font-semibold text-slate-600">{label}:</span>{" "}
      <span className="text-slate-600">{value}</span>
    </div>
  );
}
