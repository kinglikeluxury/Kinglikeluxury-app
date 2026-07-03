import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Swords, Search, Loader2, ShieldAlert, TrendingUp, Image as ImageIcon,
  Video, Link as LinkIcon, Sparkles, Target, AlertTriangle, History, ChevronDown, ChevronUp,
  Bell, Clock, Wand2, ThumbsUp, ThumbsDown, BarChart3, RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// ── Types ────────────────────────────────────────────────────────────────

interface Competitor {
  id: number;
  page_name: string;
  first_detected_at: string;
  last_detected_at: string;
  threat_score: number;
  threat_band: string;
  ad_count: string | number;
}

interface CompetitorAd {
  id: number;
  competitor_id: number;
  library_id: string | null;
  ad_text: string | null;
  status: string | null;
  start_date: string | null;
  end_date: string | null;
  platforms: string[] | null;
  has_image: boolean;
  has_video: boolean;
  landing_url: string | null;
  language: string | null;
  search_term: string | null;
  created_at: string;
  hook: string | null;
  offer: string | null;
  positioning: string | null;
  weakness: string | null;
  kinglike_suggestion: string | null;
}

interface SearchRun {
  id: number;
  search_term: string;
  country: string | null;
  success: boolean | null;
  blocked: boolean | null;
  attempts: number | null;
  result_count: number | null;
  http_status: number | null;
  error: string | null;
  started_at: string;
  finished_at: string | null;
}

interface WarRoom {
  topCompetitors: Competitor[];
  topKeywords: { word: string; count: number }[];
  strongestHooks: string[];
  opportunities: string[];
}

interface TimelineEvent {
  id: number;
  competitor_id: number;
  ad_id: number | null;
  event_type: string;
  detail_json: Record<string, any>;
  detected_at: string;
}

interface ThreatScoreV2 {
  id: number;
  competitor_id: number;
  score: number;
  band: string;
  factors_json: { name: string; raw: number; max: number; explanation: string }[];
  overall_explanation: string;
  computed_at: string;
}

interface CounterStrategy {
  id: number;
  competitor_id: number;
  version: number;
  strategy_json: Record<string, string>;
  expected_impact: string | null;
  confidence_percent: number;
  confidence_level: string;
  confidence_reason: string;
  generated_at: string;
}

interface Alert {
  id: number;
  competitor_id: number | null;
  alert_type: string;
  message: string;
  severity: string;
  created_at: string;
}

interface ChangeSummary {
  id: number;
  run_id: number | null;
  summary_json: {
    newCompetitors: string[];
    newCreatives: { competitor: string; adId: number }[];
    newOffers: any[];
    stoppedCampaigns: any[];
    threatIncreases: string[];
    opportunities: string[];
  };
  generated_at: string;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function severityColor(severity: string) {
  switch (severity) {
    case "high": return "bg-red-100 text-red-700 border-red-200";
    case "medium": return "bg-amber-100 text-amber-700 border-amber-200";
    default: return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function confidenceColor(level: string) {
  switch (level) {
    case "Very High": return "bg-[#3bcac4]/10 text-[#005476] border-[#3bcac4]/30";
    case "High": return "bg-green-50 text-green-700 border-green-200";
    case "Medium": return "bg-amber-50 text-amber-700 border-amber-200";
    default: return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

function bandColor(band: string) {
  switch (band) {
    case "Critical": return "bg-red-100 text-red-700 border-red-200";
    case "Strong": return "bg-amber-100 text-amber-700 border-amber-200";
    case "Medium": return "bg-[#3bcac4]/10 text-[#005476] border-[#3bcac4]/30";
    case "Weak": return "bg-slate-100 text-slate-600 border-slate-200";
    default: return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

// ── Page ─────────────────────────────────────────────────────────────────

export default function CompetitorIntelligencePage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchTerm, setSearchTerm] = useState("");
  const [country, setCountry] = useState("");
  const [expandedCompetitorId, setExpandedCompetitorId] = useState<number | null>(null);
  const [lastResult, setLastResult] = useState<any | null>(null);
  const [feedbackNotes, setFeedbackNotes] = useState<Record<number, string>>({});

  const competitorsQuery = useQuery<Competitor[]>({
    queryKey: ["/api/admin/competitor-intelligence/competitors"],
  });

  const warRoomQuery = useQuery<WarRoom>({
    queryKey: ["/api/admin/competitor-intelligence/war-room"],
  });

  const searchRunsQuery = useQuery<SearchRun[]>({
    queryKey: ["/api/admin/competitor-intelligence/search-runs"],
  });

  const adsQuery = useQuery<CompetitorAd[]>({
    queryKey: ["/api/admin/competitor-intelligence/competitors", expandedCompetitorId, "ads"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/competitor-intelligence/competitors/${expandedCompetitorId}/ads`);
      const json = await res.json();
      return json.data;
    },
    enabled: expandedCompetitorId != null,
  });

  const timelineQuery = useQuery<TimelineEvent[]>({
    queryKey: ["/api/admin/competitor-intelligence/timeline", expandedCompetitorId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/competitor-intelligence/timeline/${expandedCompetitorId}`);
      const json = await res.json();
      return json.data;
    },
    enabled: expandedCompetitorId != null,
  });

  const threatV2Query = useQuery<ThreatScoreV2[]>({
    queryKey: ["/api/admin/competitor-intelligence/threat-score-v2", expandedCompetitorId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/competitor-intelligence/threat-score-v2/${expandedCompetitorId}`);
      const json = await res.json();
      return json.data;
    },
    enabled: expandedCompetitorId != null,
  });

  const strategiesQuery = useQuery<CounterStrategy[]>({
    queryKey: ["/api/admin/competitor-intelligence/counter-strategy", expandedCompetitorId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/competitor-intelligence/counter-strategy/${expandedCompetitorId}`);
      const json = await res.json();
      return json.data;
    },
    enabled: expandedCompetitorId != null,
  });

  const alertsQuery = useQuery<Alert[]>({
    queryKey: ["/api/admin/competitor-intelligence/alerts"],
  });

  const changeSummaryQuery = useQuery<ChangeSummary | null>({
    queryKey: ["/api/admin/competitor-intelligence/change-summary/latest"],
  });

  const refreshIntelligenceMutation = useMutation({
    mutationFn: async ({ runId, adIds }: { runId: number; adIds: number[] }) => {
      const res = await apiRequest("POST", "/api/admin/competitor-intelligence/refresh-intelligence", { runId, adIds });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/threat-score-v2"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/alerts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/change-summary/latest"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/competitors"] });
      toast({ title: "Market intelligence refreshed", description: "Timeline, threat scores, and alerts have been updated." });
    },
    onError: (err: any) => {
      toast({ title: "Intelligence refresh failed", description: err.message, variant: "destructive" });
    },
  });

  const generateStrategyMutation = useMutation({
    mutationFn: async (competitorId: number) => {
      const res = await apiRequest("POST", `/api/admin/competitor-intelligence/counter-strategy/${competitorId}/generate`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/counter-strategy"] });
      toast({ title: "New counter strategy generated" });
    },
    onError: (err: any) => {
      toast({ title: "Strategy generation failed", description: err.message, variant: "destructive" });
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: async ({ strategyId, feedback, note }: { strategyId: number; feedback: "useful" | "not_useful"; note?: string }) => {
      const res = await apiRequest("POST", `/api/admin/competitor-intelligence/counter-strategy/${strategyId}/feedback`, { feedback, note });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Feedback recorded", description: "Future strategies will take this into account." });
    },
    onError: (err: any) => {
      toast({ title: "Failed to record feedback", description: err.message, variant: "destructive" });
    },
  });

  const searchMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/competitor-intelligence/search", {
        term: searchTerm.trim(),
        country: country.trim() || undefined,
      });
      return res.json();
    },
    onSuccess: (json) => {
      setLastResult(json.data);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/competitors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/war-room"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/search-runs"] });
      if (json.data?.blocked) {
        toast({ title: "Search blocked", description: "The Ad Library returned a shell/blocked page. Try again shortly.", variant: "destructive" });
      } else if (!json.data?.success) {
        toast({ title: "Search failed", description: json.data?.error || "Unknown error", variant: "destructive" });
      } else {
        toast({ title: "Search complete", description: `Found ${json.data.ads?.length ?? 0} ad(s) for "${json.data.term}".` });
        const adIds = (json.data?.ads ?? []).map((a: any) => a.adId).filter((id: any) => typeof id === "number");
        if (adIds.length > 0) {
          apiRequest("GET", "/api/admin/competitor-intelligence/search-runs")
            .then((r) => r.json())
            .then((runsJson) => {
              const runId = runsJson.data?.[0]?.id;
              if (runId) refreshIntelligenceMutation.mutate({ runId, adIds });
            })
            .catch(() => {});
        }
      }
    },
    onError: (err: any) => {
      toast({ title: "Search failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center">
          <Swords className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Competitor Intelligence</h1>
          <p className="text-sm text-slate-500">On-demand search of the public Meta Ad Library. Read-only, no scheduling.</p>
        </div>
        {refreshIntelligenceMutation.isPending && (
          <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Refreshing market intelligence...
          </div>
        )}
      </div>

      {/* Change summary banner */}
      {changeSummaryQuery.data && (
        (() => {
          const s = changeSummaryQuery.data.summary_json;
          const hasAny =
            s.newCompetitors.length + s.newCreatives.length + s.newOffers.length +
            s.stoppedCampaigns.length + s.threatIncreases.length + s.opportunities.length > 0;
          if (!hasAny) return null;
          return (
            <Card className="border-[#3bcac4]/30 bg-[#3bcac4]/5" data-testid="card-change-summary">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-[#005476]" /> Latest Change Summary
                </CardTitle>
              </CardHeader>
              <CardContent className="text-sm space-y-1.5">
                {s.newCompetitors.length > 0 && <div><span className="font-semibold">New competitors:</span> {s.newCompetitors.join(", ")}</div>}
                {s.newCreatives.length > 0 && <div><span className="font-semibold">New creatives:</span> {s.newCreatives.length} across tracked competitors</div>}
                {s.newOffers.length > 0 && <div><span className="font-semibold">Offer changes:</span> {s.newOffers.length}</div>}
                {s.stoppedCampaigns.length > 0 && <div><span className="font-semibold">Campaigns stopped:</span> {s.stoppedCampaigns.length}</div>}
                {s.threatIncreases.length > 0 && (
                  <div><span className="font-semibold">Threat increases:</span> {s.threatIncreases.join("; ")}</div>
                )}
                {s.opportunities.length > 0 && (
                  <div><span className="font-semibold">Opportunities:</span> {s.opportunities.join("; ")}</div>
                )}
              </CardContent>
            </Card>
          );
        })()
      )}

      {/* Alerts feed */}
      {(alertsQuery.data ?? []).length > 0 && (
        <Card data-testid="card-alerts">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Bell className="w-4 h-4 text-[#005476]" /> Alerts
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {(alertsQuery.data ?? []).slice(0, 10).map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm py-1 border-b last:border-0" data-testid={`row-alert-${a.id}`}>
                <span className="text-slate-700">{a.message}</span>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                  <Badge variant="outline" className={severityColor(a.severity)}>{a.severity}</Badge>
                  <span className="text-xs text-slate-400">{new Date(a.created_at).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Search bar */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Search className="w-4 h-4 text-[#3bcac4]" /> Run a Search
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            className="flex flex-col sm:flex-row gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!searchTerm.trim()) {
                toast({ title: "Enter a search term", variant: "destructive" });
                return;
              }
              searchMutation.mutate();
            }}
          >
            <Input
              placeholder='e.g. "جزيرة باتومي" or "Ambassadori"'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="flex-1"
              data-testid="input-search-term"
            />
            <Input
              placeholder="Country code (optional, e.g. GE)"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              className="sm:w-52"
              data-testid="input-country"
            />
            <Button
              type="submit"
              disabled={searchMutation.isPending}
              className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90"
              data-testid="button-run-search"
            >
              {searchMutation.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
              Search
            </Button>
          </form>

          {lastResult && (
            <div className="mt-4 text-sm p-3 rounded-lg border bg-slate-50">
              <span className="font-medium">Last run:</span> "{lastResult.term}" — {lastResult.success ? "success" : "failed"}
              {lastResult.blocked ? " (blocked page detected)" : ""}, {lastResult.attempts} attempt(s), {lastResult.ads?.length ?? 0} ad(s) found
              {lastResult.error ? `, error: ${lastResult.error}` : ""}.
            </div>
          )}
        </CardContent>
      </Card>

      {/* War room */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4 text-[#005476]" /> War Room
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {warRoomQuery.isLoading ? (
            <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
          ) : (
            <>
              <div>
                <div className="text-xs font-semibold text-slate-500 uppercase mb-2">Top Keywords</div>
                <div className="flex flex-wrap gap-2">
                  {(warRoomQuery.data?.topKeywords ?? []).map((k) => (
                    <Badge key={k.word} variant="outline" className="bg-slate-50">{k.word} ({k.count})</Badge>
                  ))}
                  {(!warRoomQuery.data?.topKeywords || warRoomQuery.data.topKeywords.length === 0) && (
                    <span className="text-sm text-slate-400">No data yet — run a search first.</span>
                  )}
                </div>
              </div>

              {warRoomQuery.data?.opportunities && warRoomQuery.data.opportunities.length > 0 && (
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" /> AI Opportunities
                  </div>
                  <ul className="space-y-1.5">
                    {warRoomQuery.data.opportunities.map((op, i) => (
                      <li key={i} className="text-sm text-slate-700 flex gap-2">
                        <span className="text-[#3bcac4]">•</span> {op}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Competitors table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-[#005476]" /> Competitors
          </CardTitle>
        </CardHeader>
        <CardContent>
          {competitorsQuery.isLoading ? (
            <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
          ) : (competitorsQuery.data ?? []).length === 0 ? (
            <div className="text-sm text-slate-400">No competitors detected yet. Run a search above.</div>
          ) : (
            <div className="space-y-2">
              {(competitorsQuery.data ?? []).map((c) => (
                <div key={c.id} className="border rounded-lg overflow-hidden" data-testid={`row-competitor-${c.id}`}>
                  <button
                    className="w-full flex items-center justify-between p-3 hover:bg-slate-50 transition-colors text-left"
                    onClick={() => setExpandedCompetitorId(expandedCompetitorId === c.id ? null : c.id)}
                  >
                    <div className="flex items-center gap-3">
                      <TrendingUp className="w-4 h-4 text-slate-400" />
                      <div>
                        <div className="font-medium text-slate-900">{c.page_name}</div>
                        <div className="text-xs text-slate-500">{c.ad_count} ad(s) tracked</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className={bandColor(c.threat_band)}>
                        {c.threat_band} · {c.threat_score}
                      </Badge>
                      {expandedCompetitorId === c.id ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </button>

                  {expandedCompetitorId === c.id && (
                    <div className="border-t bg-slate-50/50 p-3 space-y-3">
                      {adsQuery.isLoading ? (
                        <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading ads...</div>
                      ) : (adsQuery.data ?? []).length === 0 ? (
                        <div className="text-sm text-slate-400">No ads stored for this competitor.</div>
                      ) : (
                        (adsQuery.data ?? []).map((ad) => (
                          <div key={ad.id} className="bg-white rounded-lg border p-3 space-y-2" data-testid={`card-ad-${ad.id}`}>
                            <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
                              {ad.status && <Badge variant="outline">{ad.status}</Badge>}
                              {ad.language && <Badge variant="outline">{ad.language}</Badge>}
                              {ad.has_image && <ImageIcon className="w-3.5 h-3.5" />}
                              {ad.has_video && <Video className="w-3.5 h-3.5" />}
                              {ad.landing_url && (
                                <a href={ad.landing_url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[#005476] hover:underline">
                                  <LinkIcon className="w-3.5 h-3.5" /> Landing page
                                </a>
                              )}
                              {ad.start_date && <span>Since {ad.start_date}</span>}
                            </div>
                            {ad.ad_text && <p className="text-sm text-slate-700 whitespace-pre-wrap">{ad.ad_text}</p>}

                            {(ad.hook || ad.offer || ad.positioning || ad.weakness || ad.kinglike_suggestion) && (
                              <div className="grid sm:grid-cols-2 gap-2 pt-2 border-t text-xs">
                                {ad.hook && <div><span className="font-semibold text-slate-500">Hook:</span> {ad.hook}</div>}
                                {ad.offer && <div><span className="font-semibold text-slate-500">Offer:</span> {ad.offer}</div>}
                                {ad.positioning && <div><span className="font-semibold text-slate-500">Positioning:</span> {ad.positioning}</div>}
                                {ad.weakness && (
                                  <div className="flex gap-1">
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                                    <span><span className="font-semibold text-slate-500">Weakness:</span> {ad.weakness}</span>
                                  </div>
                                )}
                                {ad.kinglike_suggestion && (
                                  <div className="sm:col-span-2 bg-[#3bcac4]/10 rounded p-2 flex gap-1">
                                    <Sparkles className="w-3.5 h-3.5 text-[#005476] shrink-0 mt-0.5" />
                                    <span><span className="font-semibold text-[#005476]">Kinglike angle:</span> {ad.kinglike_suggestion}</span>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        ))
                      )}

                      {/* Timeline */}
                      <div className="bg-white rounded-lg border p-3" data-testid={`section-timeline-${c.id}`}>
                        <div className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
                          <Clock className="w-3.5 h-3.5" /> Timeline
                        </div>
                        {timelineQuery.isLoading ? (
                          <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
                        ) : (timelineQuery.data ?? []).length === 0 ? (
                          <div className="text-sm text-slate-400">No timeline events yet. Run a search to populate market memory.</div>
                        ) : (
                          <ul className="space-y-1.5">
                            {(timelineQuery.data ?? []).slice(0, 8).map((e) => (
                              <li key={e.id} className="text-sm text-slate-700 flex items-start gap-2" data-testid={`row-timeline-${e.id}`}>
                                <span className="text-[#3bcac4] mt-0.5">•</span>
                                <span>
                                  <span className="font-medium">{e.event_type.replace(/_/g, " ")}</span>
                                  <span className="text-xs text-slate-400 ml-2">{new Date(e.detected_at).toLocaleString()}</span>
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>

                      {/* Threat Score V2 */}
                      <div className="bg-white rounded-lg border p-3" data-testid={`section-threat-v2-${c.id}`}>
                        <div className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
                          <BarChart3 className="w-3.5 h-3.5" /> Threat Score V2
                        </div>
                        {threatV2Query.isLoading ? (
                          <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
                        ) : (threatV2Query.data ?? []).length === 0 ? (
                          <div className="text-sm text-slate-400">Not computed yet. Run a search to trigger scoring.</div>
                        ) : (
                          (() => {
                            const latest = (threatV2Query.data ?? [])[0];
                            return (
                              <div className="space-y-2">
                                <div className="flex items-center gap-2">
                                  <Badge variant="outline" className={bandColor(latest.band)}>{latest.band} · {latest.score}/100</Badge>
                                </div>
                                {latest.overall_explanation && (
                                  <p className="text-sm text-slate-700">{latest.overall_explanation}</p>
                                )}
                                <div className="grid sm:grid-cols-2 gap-1.5 pt-1">
                                  {(latest.factors_json ?? []).map((f) => (
                                    <div key={f.name} className="text-xs">
                                      <span className="font-semibold text-slate-500">{f.name}:</span> {f.raw}/{f.max} — {f.explanation}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            );
                          })()
                        )}
                      </div>

                      {/* Counter Strategy */}
                      <div className="bg-white rounded-lg border p-3" data-testid={`section-strategy-${c.id}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
                            <Wand2 className="w-3.5 h-3.5" /> Counter Strategy
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={generateStrategyMutation.isPending}
                            onClick={() => generateStrategyMutation.mutate(c.id)}
                            data-testid={`button-generate-strategy-${c.id}`}
                          >
                            {generateStrategyMutation.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5 mr-1.5" />}
                            Generate
                          </Button>
                        </div>
                        {strategiesQuery.isLoading ? (
                          <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
                        ) : (strategiesQuery.data ?? []).length === 0 ? (
                          <div className="text-sm text-slate-400">No strategy generated yet.</div>
                        ) : (
                          (() => {
                            const latest = (strategiesQuery.data ?? [])[0];
                            return (
                              <div className="space-y-2" data-testid={`card-strategy-${latest.id}`}>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline">v{latest.version}</Badge>
                                  <Badge variant="outline" className={confidenceColor(latest.confidence_level)}>
                                    {latest.confidence_level} confidence · {latest.confidence_percent}%
                                  </Badge>
                                </div>
                                {latest.strategy_json?.strategyText && (
                                  <p className="text-sm text-slate-700">{latest.strategy_json.strategyText}</p>
                                )}
                                <div className="grid sm:grid-cols-2 gap-1.5 text-xs">
                                  {latest.strategy_json?.audience && <div><span className="font-semibold text-slate-500">Audience:</span> {latest.strategy_json.audience}</div>}
                                  {latest.strategy_json?.age && <div><span className="font-semibold text-slate-500">Age:</span> {latest.strategy_json.age}</div>}
                                  {latest.strategy_json?.interests && <div><span className="font-semibold text-slate-500">Interests:</span> {latest.strategy_json.interests}</div>}
                                  {latest.strategy_json?.behaviours && <div><span className="font-semibold text-slate-500">Behaviours:</span> {latest.strategy_json.behaviours}</div>}
                                  {latest.strategy_json?.placements && <div><span className="font-semibold text-slate-500">Placements:</span> {latest.strategy_json.placements}</div>}
                                  {latest.strategy_json?.creatives && <div><span className="font-semibold text-slate-500">Creatives:</span> {latest.strategy_json.creatives}</div>}
                                  {latest.strategy_json?.budget && <div><span className="font-semibold text-slate-500">Budget:</span> {latest.strategy_json.budget}</div>}
                                  {latest.strategy_json?.cta && <div><span className="font-semibold text-slate-500">CTA:</span> {latest.strategy_json.cta}</div>}
                                </div>
                                {latest.expected_impact && (
                                  <div className="text-xs text-slate-500"><span className="font-semibold">Expected impact:</span> {latest.expected_impact}</div>
                                )}
                                {latest.confidence_reason && (
                                  <div className="text-xs text-slate-500"><span className="font-semibold">Why this confidence:</span> {latest.confidence_reason}</div>
                                )}
                                <div className="flex items-center gap-2 pt-1">
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-green-700 border-green-200 hover:bg-green-50"
                                    onClick={() => feedbackMutation.mutate({ strategyId: latest.id, feedback: "useful", note: feedbackNotes[latest.id] })}
                                    data-testid={`button-feedback-useful-${latest.id}`}
                                  >
                                    <ThumbsUp className="w-3.5 h-3.5 mr-1.5" /> Useful
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="text-red-700 border-red-200 hover:bg-red-50"
                                    onClick={() => feedbackMutation.mutate({ strategyId: latest.id, feedback: "not_useful", note: feedbackNotes[latest.id] })}
                                    data-testid={`button-feedback-not-useful-${latest.id}`}
                                  >
                                    <ThumbsDown className="w-3.5 h-3.5 mr-1.5" /> Not useful
                                  </Button>
                                </div>
                              </div>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search history */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <History className="w-4 h-4 text-slate-400" /> Search History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {searchRunsQuery.isLoading ? (
            <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading...</div>
          ) : (searchRunsQuery.data ?? []).length === 0 ? (
            <div className="text-sm text-slate-400">No searches run yet.</div>
          ) : (
            <div className="space-y-1.5">
              {(searchRunsQuery.data ?? []).map((r) => (
                <div key={r.id} className="flex items-center justify-between text-sm py-1.5 border-b last:border-0" data-testid={`row-run-${r.id}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{r.search_term}</span>
                    {r.country && <span className="text-xs text-slate-400">({r.country})</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-slate-400">{new Date(r.started_at).toLocaleString()}</span>
                    <Badge variant="outline" className={r.success ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}>
                      {r.success ? `${r.result_count ?? 0} ads` : "failed"}
                    </Badge>
                    {r.blocked && <Badge variant="outline" className="bg-amber-50 text-amber-700 border-amber-200">blocked</Badge>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
