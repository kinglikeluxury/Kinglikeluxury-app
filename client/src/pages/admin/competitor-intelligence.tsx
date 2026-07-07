import { useState, Component, ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Brain, Loader2, ShieldAlert, TrendingUp, Image as ImageIcon,
  Video, Link as LinkIcon, Sparkles, AlertTriangle, History,
  ChevronDown, ChevronUp, Bell, Clock, Wand2, ThumbsUp, ThumbsDown,
  BarChart3, RefreshCw, Filter, Users, Globe, Target, Building2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { CompetitorCreativeGallery } from "@/components/admin/CompetitorCreativeGallery";
import { MarketIntelligenceSearch, type AiSearchResult } from "@/components/admin/MarketIntelligenceSearch";
import { MarketInsightsDashboard } from "@/components/admin/MarketInsightsDashboard";

// ── Types ─────────────────────────────────────────────────────────────────

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

// ── Helpers ───────────────────────────────────────────────────────────────

function toSafeDisplayString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map((v) => toSafeDisplayString(v)).filter(Boolean).join("; ");
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: ${toSafeDisplayString(v)}`)
      .filter(Boolean)
      .join(" | ");
  }
  return String(value);
}

function toSafeArray<T = any>(raw: unknown, altKey?: string): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    if (Array.isArray(obj.data)) return obj.data as T[];
    if (altKey && Array.isArray(obj[altKey])) return obj[altKey] as T[];
    if (Array.isArray(obj.competitors)) return obj.competitors as T[];
    if (Array.isArray(obj.items)) return obj.items as T[];
    if (Array.isArray(obj.results)) return obj.results as T[];
  }
  return [];
}

function unwrapObject<T = any>(raw: unknown): T | null | undefined {
  if (raw && typeof raw === "object" && !Array.isArray(raw) && "data" in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>).data as T;
  }
  return raw as T;
}

function bandColor(band: string) {
  switch (band) {
    case "Critical": return "bg-red-50 text-red-700 border-red-200";
    case "Strong": return "bg-amber-50 text-amber-700 border-amber-200";
    case "Medium": return "bg-[#3bcac4]/10 text-[#005476] border-[#3bcac4]/30";
    case "Weak": return "bg-slate-100 text-slate-600 border-slate-200";
    default: return "bg-slate-100 text-slate-500 border-slate-200";
  }
}

function threatBarColor(band: string) {
  switch (band) {
    case "Critical": return "from-red-500 to-red-600";
    case "Strong": return "from-amber-500 to-amber-600";
    case "Medium": return "from-[#3bcac4] to-[#005476]";
    default: return "from-slate-300 to-slate-400";
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

function severityColor(severity: string) {
  switch (severity) {
    case "high": return "bg-red-50 text-red-700 border-red-200";
    case "medium": return "bg-amber-50 text-amber-700 border-amber-200";
    default: return "bg-slate-100 text-slate-600 border-slate-200";
  }
}

// ── Small UI pieces ───────────────────────────────────────────────────────

function KpiStat({ icon: Icon, label, value, accent }: { icon: any; label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 text-center ${accent ? "bg-gradient-to-br from-[#3bcac4]/8 to-[#005476]/8 border-[#3bcac4]/20" : "bg-white border-slate-100"}`}>
      <div className="flex items-center justify-center gap-1.5 mb-1">
        <Icon className="w-3.5 h-3.5 text-[#005476]" />
        <span className="text-[10px] text-slate-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-xl font-bold text-slate-800 truncate">{value}</div>
    </div>
  );
}

function QueryErrorCard({ label, error }: { label: string; error: unknown }) {
  const message = error instanceof Error ? error.message : "Unknown error";
  return (
    <div className="text-sm text-red-600 flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3">
      <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
      <span>Failed to load {label}: {message}</span>
    </div>
  );
}

// ── Error Boundary ────────────────────────────────────────────────────────

class CompetitorIntelligenceErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error: Error) { return { hasError: true, error }; }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[CompetitorIntelligence] Render error:", error, info.componentStack);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="max-w-6xl mx-auto px-4 py-8">
          <div className="border border-red-200 bg-red-50 rounded-xl p-6 space-y-3">
            <div className="flex items-center gap-2 text-red-700 font-medium">
              <AlertTriangle className="w-4 h-4" /> Something went wrong
            </div>
            {this.state.error?.message && (
              <p className="text-xs text-red-500 font-mono break-all">{this.state.error.message}</p>
            )}
            <Button size="sm" variant="outline" className="border-red-300 text-red-700"
              onClick={() => this.setState({ hasError: false, error: null })}>
              Try again
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Expanded Competitor Detail ────────────────────────────────────────────

function CompetitorDetail({
  competitor,
  adsQuery,
  timelineQuery,
  threatV2Query,
  strategiesQuery,
  generateStrategyMutation,
  feedbackMutation,
  feedbackNotes,
  setFeedbackNotes,
}: {
  competitor: Competitor;
  adsQuery: any;
  timelineQuery: any;
  threatV2Query: any;
  strategiesQuery: any;
  generateStrategyMutation: any;
  feedbackMutation: any;
  feedbackNotes: Record<number, string>;
  setFeedbackNotes: (fn: (prev: Record<number, string>) => Record<number, string>) => void;
}) {
  const [detailTab, setDetailTab] = useState("ads");

  return (
    <div className="border-t border-slate-100 bg-slate-50/60 rounded-b-2xl p-4 space-y-4">
      <Tabs value={detailTab} onValueChange={setDetailTab}>
        <TabsList className="bg-white border border-slate-200 h-8">
          <TabsTrigger value="ads" className="text-xs h-7 data-[state=active]:bg-[#005476] data-[state=active]:text-white">Ads</TabsTrigger>
          <TabsTrigger value="intel" className="text-xs h-7 data-[state=active]:bg-[#005476] data-[state=active]:text-white">Intelligence</TabsTrigger>
          <TabsTrigger value="strategy" className="text-xs h-7 data-[state=active]:bg-[#005476] data-[state=active]:text-white">Counter Strategy</TabsTrigger>
        </TabsList>

        {/* Ads tab */}
        <TabsContent value="ads" className="mt-3 space-y-3" data-testid={`section-ads-${competitor.id}`}>
          {adsQuery.isLoading ? (
            <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading ads…</div>
          ) : adsQuery.isError ? (
            <QueryErrorCard label="ads" error={adsQuery.error} />
          ) : toSafeArray<CompetitorAd>(adsQuery.data).length === 0 ? (
            <div className="text-sm text-slate-400">No ads stored for this competitor.</div>
          ) : (
            toSafeArray<CompetitorAd>(adsQuery.data).map((ad) => (
              <div key={ad.id} className="bg-white rounded-xl border border-slate-100 p-4 space-y-3" data-testid={`card-ad-${ad.id}`}>
                <div className="flex items-center gap-2 flex-wrap text-xs text-slate-500">
                  {ad.status && <Badge variant="outline" className="text-xs">{ad.status}</Badge>}
                  {ad.language && <Badge variant="outline" className="text-xs">{ad.language}</Badge>}
                  {ad.has_image && <span className="flex items-center gap-1"><ImageIcon className="w-3.5 h-3.5" /> Image</span>}
                  {ad.has_video && <span className="flex items-center gap-1"><Video className="w-3.5 h-3.5" /> Video</span>}
                  {ad.landing_url && (
                    <a href={ad.landing_url} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-[#005476] hover:underline">
                      <LinkIcon className="w-3.5 h-3.5" /> Landing page
                    </a>
                  )}
                  {ad.start_date && <span className="text-slate-400">Since {ad.start_date}</span>}
                </div>
                {ad.ad_text && (
                  <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{ad.ad_text}</p>
                )}
                {(ad.hook || ad.offer || ad.positioning || ad.weakness || ad.kinglike_suggestion) && (
                  <div className="grid sm:grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
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
                      <div className="sm:col-span-2 bg-[#3bcac4]/8 rounded-lg p-2 flex gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-[#005476] shrink-0 mt-0.5" />
                        <span><span className="font-semibold text-[#005476]">Kinglike angle:</span> {ad.kinglike_suggestion}</span>
                      </div>
                    )}
                  </div>
                )}
                {(ad.has_image || ad.has_video) && <CompetitorCreativeGallery adId={ad.id} />}
              </div>
            ))
          )}
        </TabsContent>

        {/* Intelligence tab — Timeline + Threat V2 */}
        <TabsContent value="intel" className="mt-3 space-y-3" data-testid={`section-intel-${competitor.id}`}>
          {/* Timeline */}
          <div className="bg-white rounded-xl border border-slate-100 p-4" data-testid={`section-timeline-${competitor.id}`}>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#005476]" /> Activity Timeline
            </div>
            {timelineQuery.isLoading ? (
              <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : timelineQuery.isError ? (
              <QueryErrorCard label="timeline" error={timelineQuery.error} />
            ) : toSafeArray<TimelineEvent>(timelineQuery.data).length === 0 ? (
              <div className="text-sm text-slate-400">No timeline events yet. Run a search to populate market memory.</div>
            ) : (
              <ul className="space-y-2">
                {toSafeArray<TimelineEvent>(timelineQuery.data).slice(0, 8).map((e) => (
                  <li key={e.id} className="flex items-start gap-2 text-sm" data-testid={`row-timeline-${e.id}`}>
                    <span className="w-1.5 h-1.5 rounded-full bg-[#3bcac4] mt-2 shrink-0" />
                    <div>
                      <span className="font-medium text-slate-700">{toSafeDisplayString(e.event_type).replace(/_/g, " ")}</span>
                      <span className="text-xs text-slate-400 ml-2">{new Date(e.detected_at).toLocaleString()}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Threat Score V2 */}
          <div className="bg-white rounded-xl border border-slate-100 p-4" data-testid={`section-threat-v2-${competitor.id}`}>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 text-[#005476]" /> Threat Score Analysis
            </div>
            {threatV2Query.isLoading ? (
              <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : threatV2Query.isError ? (
              <QueryErrorCard label="threat score" error={threatV2Query.error} />
            ) : toSafeArray<ThreatScoreV2>(threatV2Query.data).length === 0 ? (
              <div className="text-sm text-slate-400">Not computed yet. Run a search to trigger scoring.</div>
            ) : (() => {
              const latest = toSafeArray<ThreatScoreV2>(threatV2Query.data)[0];
              return (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className={bandColor(latest.band)}>
                      {latest.band} · {latest.score}/100
                    </Badge>
                  </div>
                  {latest.overall_explanation && (
                    <p className="text-sm text-slate-700">{toSafeDisplayString(latest.overall_explanation)}</p>
                  )}
                  <div className="grid sm:grid-cols-2 gap-2">
                    {toSafeArray<{ name: string; raw: number; max: number; explanation: string }>(latest.factors_json).map((f, i) => (
                      <div key={f?.name ?? i} className="bg-slate-50 rounded-lg p-2 text-xs">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-semibold text-slate-600">{toSafeDisplayString(f?.name)}</span>
                          <span className="text-slate-400">{f?.raw}/{f?.max}</span>
                        </div>
                        <div className="h-1 bg-slate-200 rounded-full overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-[#3bcac4] to-[#005476] rounded-full"
                            style={{ width: `${Math.round(((f?.raw || 0) / (f?.max || 1)) * 100)}%` }} />
                        </div>
                        {f?.explanation && <p className="text-slate-500 mt-1">{f.explanation}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}
          </div>
        </TabsContent>

        {/* Counter Strategy tab */}
        <TabsContent value="strategy" className="mt-3" data-testid={`section-strategy-${competitor.id}`}>
          <div className="bg-white rounded-xl border border-slate-100 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide flex items-center gap-1.5">
                <Wand2 className="w-3.5 h-3.5 text-[#005476]" /> AI Counter Strategy
              </div>
              <Button size="sm" variant="outline" disabled={generateStrategyMutation.isPending}
                onClick={() => generateStrategyMutation.mutate(competitor.id)}
                data-testid={`button-generate-strategy-${competitor.id}`}
                className="h-7 text-xs">
                {generateStrategyMutation.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Generating…</>
                  : <><Sparkles className="w-3.5 h-3.5 mr-1.5" /> Generate</>}
              </Button>
            </div>
            {strategiesQuery.isLoading ? (
              <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
            ) : strategiesQuery.isError ? (
              <QueryErrorCard label="counter strategy" error={strategiesQuery.error} />
            ) : toSafeArray<CounterStrategy>(strategiesQuery.data).length === 0 ? (
              <div className="text-sm text-slate-400">No strategy generated yet.</div>
            ) : (() => {
              const latest = toSafeArray<CounterStrategy>(strategiesQuery.data)[0];
              return (
                <div className="space-y-3" data-testid={`card-strategy-${latest.id}`}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline">v{latest.version}</Badge>
                    <Badge variant="outline" className={confidenceColor(latest.confidence_level)}>
                      {latest.confidence_level} · {latest.confidence_percent}%
                    </Badge>
                  </div>
                  {latest.strategy_json?.strategyText && (
                    <p className="text-sm text-slate-700 leading-relaxed">{toSafeDisplayString(latest.strategy_json.strategyText)}</p>
                  )}
                  <div className="grid sm:grid-cols-2 gap-2 text-xs">
                    {["audience", "age", "interests", "behaviours", "placements", "creatives", "budget", "cta"].map((field) => (
                      toSafeDisplayString(latest.strategy_json?.[field]) ? (
                        <div key={field} className="bg-slate-50 rounded-lg p-2">
                          <span className="font-semibold text-slate-500 capitalize">{field}:</span>{" "}
                          {toSafeDisplayString(latest.strategy_json[field])}
                        </div>
                      ) : null
                    ))}
                  </div>
                  {latest.expected_impact && (
                    <div className="text-xs text-slate-500">
                      <span className="font-semibold">Expected impact:</span> {latest.expected_impact}
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-1">
                    <Button size="sm" variant="outline" className="text-green-700 border-green-200 hover:bg-green-50 h-7 text-xs"
                      onClick={() => feedbackMutation.mutate({ strategyId: latest.id, feedback: "useful", note: feedbackNotes[latest.id] })}
                      data-testid={`button-feedback-useful-${latest.id}`}>
                      <ThumbsUp className="w-3.5 h-3.5 mr-1.5" /> Useful
                    </Button>
                    <Button size="sm" variant="outline" className="text-red-700 border-red-200 hover:bg-red-50 h-7 text-xs"
                      onClick={() => feedbackMutation.mutate({ strategyId: latest.id, feedback: "not_useful", note: feedbackNotes[latest.id] })}
                      data-testid={`button-feedback-not-useful-${latest.id}`}>
                      <ThumbsDown className="w-3.5 h-3.5 mr-1.5" /> Not useful
                    </Button>
                  </div>
                </div>
              );
            })()}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────

function CompetitorIntelligencePageInner() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [expandedCompetitorId, setExpandedCompetitorId] = useState<number | null>(null);
  const [lastAiResult, setLastAiResult] = useState<AiSearchResult | null>(null);
  const [feedbackNotes, setFeedbackNotes] = useState<Record<number, string>>({});
  const [activeTab, setActiveTab] = useState("overview");
  const [threatFilter, setThreatFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"threat" | "ads" | "name">("threat");

  // ── Queries ──────────────────────────────────────────────────────────────

  const competitorsQuery = useQuery<Competitor[]>({
    queryKey: ["/api/admin/competitor-intelligence/competitors"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/competitor-intelligence/competitors");
      const json = await res.json();
      return toSafeArray<Competitor>(json, "competitors");
    },
  });

  const searchRunsQuery = useQuery<SearchRun[]>({
    queryKey: ["/api/admin/competitor-intelligence/search-runs"],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/competitor-intelligence/search-runs");
      return toSafeArray<SearchRun>(await res.json());
    },
  });

  const adsQuery = useQuery<CompetitorAd[]>({
    queryKey: ["/api/admin/competitor-intelligence/competitors", expandedCompetitorId, "ads"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/competitor-intelligence/competitors/${expandedCompetitorId}/ads`);
      return toSafeArray<CompetitorAd>(await res.json());
    },
    enabled: expandedCompetitorId != null,
  });

  const timelineQuery = useQuery<TimelineEvent[]>({
    queryKey: ["/api/admin/competitor-intelligence/timeline", expandedCompetitorId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/competitor-intelligence/timeline/${expandedCompetitorId}`);
      return toSafeArray<TimelineEvent>(await res.json());
    },
    enabled: expandedCompetitorId != null,
  });

  const threatV2Query = useQuery<ThreatScoreV2[]>({
    queryKey: ["/api/admin/competitor-intelligence/threat-score-v2", expandedCompetitorId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/competitor-intelligence/threat-score-v2/${expandedCompetitorId}`);
      return toSafeArray<ThreatScoreV2>(await res.json());
    },
    enabled: expandedCompetitorId != null,
  });

  const strategiesQuery = useQuery<CounterStrategy[]>({
    queryKey: ["/api/admin/competitor-intelligence/counter-strategy", expandedCompetitorId],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/competitor-intelligence/counter-strategy/${expandedCompetitorId}`);
      return toSafeArray<CounterStrategy>(await res.json());
    },
    enabled: expandedCompetitorId != null,
  });

  const alertsQuery = useQuery<Alert[]>({
    queryKey: ["/api/admin/competitor-intelligence/alerts"],
    queryFn: async () => toSafeArray<Alert>(await (await apiRequest("GET", "/api/admin/competitor-intelligence/alerts")).json()),
  });

  const changeSummaryQuery = useQuery<ChangeSummary | null>({
    queryKey: ["/api/admin/competitor-intelligence/change-summary/latest"],
    queryFn: async () => {
      const json = await (await apiRequest("GET", "/api/admin/competitor-intelligence/change-summary/latest")).json();
      return unwrapObject<ChangeSummary>(json) ?? null;
    },
  });

  // ── Mutations ─────────────────────────────────────────────────────────────

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
    onError: (err: any) => toast({ title: "Strategy generation failed", description: err.message, variant: "destructive" }),
  });

  const feedbackMutation = useMutation({
    mutationFn: async ({ strategyId, feedback, note }: { strategyId: number; feedback: "useful" | "not_useful"; note?: string }) => {
      const res = await apiRequest("POST", `/api/admin/competitor-intelligence/counter-strategy/${strategyId}/feedback`, { feedback, note });
      return res.json();
    },
    onSuccess: () => toast({ title: "Feedback recorded" }),
    onError: (err: any) => toast({ title: "Failed to record feedback", description: err.message, variant: "destructive" }),
  });

  // ── Derived data ──────────────────────────────────────────────────────────

  const allCompetitors = toSafeArray<Competitor>(competitorsQuery.data);
  const filteredCompetitors = allCompetitors
    .filter((c) => threatFilter === "all" || c.threat_band === threatFilter)
    .sort((a, b) => {
      if (sortBy === "threat") return b.threat_score - a.threat_score;
      if (sortBy === "ads") return Number(b.ad_count) - Number(a.ad_count);
      return a.page_name.localeCompare(b.page_name);
    });

  // ── Search complete handler ───────────────────────────────────────────────

  function handleSearchComplete(result: AiSearchResult) {
    setLastAiResult(result);
    setActiveTab("competitors");
    if (result.searchResult?.blocked) {
      toast({ title: "Search blocked", description: "Ad Library returned a blocked page. Try again shortly.", variant: "destructive" });
    } else if (!result.searchResult?.success) {
      toast({ title: "Search issue", description: result.searchResult?.error || "Partial results may have been captured." });
    } else {
      toast({ title: "Search complete", description: `Found ${result.searchResult?.ads?.length ?? 0} ad(s) for "${result.parsedTerm}"` });
    }
    const adIds = (result.searchResult?.ads ?? []).map((a: any) => a.adId).filter((id: any) => typeof id === "number");
    if (adIds.length > 0) {
      apiRequest("GET", "/api/admin/competitor-intelligence/search-runs")
        .then((r) => r.json())
        .then((runsJson) => {
          const runData = Array.isArray(runsJson) ? runsJson : (runsJson.data ?? []);
          const runId = runData[0]?.id;
          if (runId) refreshIntelligenceMutation.mutate({ runId, adIds });
        })
        .catch(() => {});
    }
  }

  // ── Change summary helper ─────────────────────────────────────────────────

  const changeSummary = changeSummaryQuery.data;
  const cs = changeSummary ? {
    newCompetitors: Array.isArray(changeSummary.summary_json?.newCompetitors) ? changeSummary.summary_json.newCompetitors : [],
    newCreatives: Array.isArray(changeSummary.summary_json?.newCreatives) ? changeSummary.summary_json.newCreatives : [],
    newOffers: Array.isArray(changeSummary.summary_json?.newOffers) ? changeSummary.summary_json.newOffers : [],
    stoppedCampaigns: Array.isArray(changeSummary.summary_json?.stoppedCampaigns) ? changeSummary.summary_json.stoppedCampaigns : [],
    threatIncreases: Array.isArray(changeSummary.summary_json?.threatIncreases) ? changeSummary.summary_json.threatIncreases : [],
    opportunities: Array.isArray(changeSummary.summary_json?.opportunities) ? changeSummary.summary_json.opportunities : [],
  } : null;
  const hasChangeSummary = cs && (cs.newCompetitors.length + cs.newCreatives.length + cs.newOffers.length + cs.stoppedCampaigns.length + cs.threatIncreases.length + cs.opportunities.length) > 0;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto px-4 py-8 space-y-5">

      {/* ── Hero — AI Search ───────────────────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-b from-slate-950 via-[#001628] to-slate-900 p-7 md:p-10 relative overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-96 h-24 bg-[#3bcac4]/6 blur-3xl rounded-full" />
        </div>

        <div className="relative flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-8">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center shadow-lg shadow-[#3bcac4]/25">
              <Brain className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="text-[#3bcac4] text-[10px] font-bold tracking-widest uppercase">AI Intelligence Platform</div>
              <h1 className="text-xl md:text-2xl font-bold text-white">Real Estate Market Intelligence</h1>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {refreshIntelligenceMutation.isPending && (
              <span className="flex items-center gap-1.5 text-[#3bcac4]">
                <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Refreshing intelligence…
              </span>
            )}
            <span>{allCompetitors.length} competitors tracked</span>
          </div>
        </div>

        <MarketIntelligenceSearch onSearchComplete={handleSearchComplete} />
      </div>

      {/* ── AI Intent Banner (after search) ───────────────────────────── */}
      {lastAiResult && (
        <div className="bg-gradient-to-r from-[#3bcac4]/8 to-[#005476]/8 border border-[#3bcac4]/25 rounded-xl px-5 py-3.5 flex items-start gap-3" data-testid="banner-ai-intent">
          <Brain className="w-4 h-4 text-[#3bcac4] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800">{lastAiResult.intentSummary}</p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-1.5 text-xs text-slate-500">
              <span>Term: <strong className="text-slate-700">{lastAiResult.parsedTerm}</strong></span>
              {lastAiResult.parsedCountry && <span>Country: <strong className="text-slate-700">{lastAiResult.parsedCountry}</strong></span>}
              <span>AI Confidence: <strong className="text-slate-700 capitalize">{lastAiResult.confidence}</strong></span>
              {lastAiResult.isRealEstateQuery && (
                <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 border-green-200 py-0">Real Estate ✓</Badge>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── KPI stats row (after search) ──────────────────────────────── */}
      {lastAiResult && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiStat icon={BarChart3} label="Ads Found" value={lastAiResult.searchResult?.ads?.length ?? 0} accent />
          <KpiStat icon={Users} label="Competitors" value={allCompetitors.length} accent />
          <KpiStat icon={Building2} label="Search Term" value={lastAiResult.parsedTerm} />
          <KpiStat icon={Target} label="Status" value={lastAiResult.searchResult?.blocked ? "Blocked" : lastAiResult.searchResult?.success ? "Success ✓" : "Failed"} />
        </div>
      )}

      {/* ── Change summary ─────────────────────────────────────────────── */}
      {hasChangeSummary && cs && (
        <div className="bg-[#3bcac4]/5 border border-[#3bcac4]/25 rounded-xl p-4 text-sm space-y-1.5" data-testid="card-change-summary">
          <div className="flex items-center gap-2 font-semibold text-[#005476] mb-2">
            <Wand2 className="w-4 h-4" /> Latest Change Summary
          </div>
          {cs.newCompetitors.length > 0 && <div><span className="font-medium">New competitors:</span> {cs.newCompetitors.map((v) => toSafeDisplayString(v)).join(", ")}</div>}
          {cs.newCreatives.length > 0 && <div><span className="font-medium">New creatives:</span> {cs.newCreatives.length} tracked</div>}
          {cs.stoppedCampaigns.length > 0 && <div><span className="font-medium">Campaigns stopped:</span> {cs.stoppedCampaigns.length}</div>}
          {cs.threatIncreases.length > 0 && <div><span className="font-medium">Threat increases:</span> {cs.threatIncreases.map((v) => toSafeDisplayString(v)).join("; ")}</div>}
          {cs.opportunities.length > 0 && <div><span className="font-medium">Opportunities:</span> {cs.opportunities.map((v) => toSafeDisplayString(v)).join("; ")}</div>}
        </div>
      )}

      {/* ── Alerts ─────────────────────────────────────────────────────── */}
      {toSafeArray<Alert>(alertsQuery.data).length > 0 && (
        <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-sm" data-testid="card-alerts">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-3">
            <Bell className="w-4 h-4 text-[#005476]" /> Alerts
          </div>
          <div className="space-y-2">
            {toSafeArray<Alert>(alertsQuery.data).slice(0, 8).map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm py-1.5 border-b border-slate-50 last:border-0" data-testid={`row-alert-${a.id}`}>
                <span className="text-slate-700">{toSafeDisplayString(a.message)}</span>
                <div className="flex items-center gap-2 shrink-0 ml-3">
                  <Badge variant="outline" className={`text-[10px] ${severityColor(a.severity)}`}>{a.severity}</Badge>
                  <span className="text-xs text-slate-400">{new Date(a.created_at).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Main Tabs ──────────────────────────────────────────────────── */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="bg-white border border-slate-200 h-9 rounded-xl">
          <TabsTrigger value="overview" className="text-xs rounded-lg data-[state=active]:bg-[#005476] data-[state=active]:text-white">
            <BarChart3 className="w-3.5 h-3.5 mr-1.5" /> Market Overview
          </TabsTrigger>
          <TabsTrigger value="competitors" className="text-xs rounded-lg data-[state=active]:bg-[#005476] data-[state=active]:text-white">
            <ShieldAlert className="w-3.5 h-3.5 mr-1.5" /> Competitors {allCompetitors.length > 0 ? `(${allCompetitors.length})` : ""}
          </TabsTrigger>
          <TabsTrigger value="history" className="text-xs rounded-lg data-[state=active]:bg-[#005476] data-[state=active]:text-white">
            <History className="w-3.5 h-3.5 mr-1.5" /> Search History
          </TabsTrigger>
        </TabsList>

        {/* Overview tab */}
        <TabsContent value="overview" className="mt-4">
          <MarketInsightsDashboard />
        </TabsContent>

        {/* Competitors tab */}
        <TabsContent value="competitors" className="mt-4 space-y-4">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <Filter className="w-3.5 h-3.5" /> Threat:
            </div>
            {["all", "Critical", "Strong", "Medium", "Weak"].map((band) => (
              <button key={band} type="button" onClick={() => setThreatFilter(band)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  threatFilter === band
                    ? "bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white border-transparent shadow-sm"
                    : "bg-white text-slate-600 border-slate-200 hover:border-[#3bcac4]/60"
                }`}>
                {band === "all" ? "All" : band}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
              Sort:
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as any)}
                className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-700 focus:outline-none focus:ring-1 focus:ring-[#3bcac4]/40">
                <option value="threat">Threat Score</option>
                <option value="ads">Ad Count</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>

          {/* Competitors list */}
          {competitorsQuery.isLoading ? (
            <div className="text-sm text-slate-500 flex items-center gap-2 py-4"><Loader2 className="w-4 h-4 animate-spin" /> Loading competitors…</div>
          ) : competitorsQuery.isError ? (
            <QueryErrorCard label="competitors" error={competitorsQuery.error} />
          ) : filteredCompetitors.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              <Globe className="w-8 h-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">No competitors found. Use the search above to discover competitors.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredCompetitors.map((c) => (
                <div key={c.id} className="bg-white border border-slate-100 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow" data-testid={`row-competitor-${c.id}`}>
                  {/* Card header — always visible */}
                  <button
                    className="w-full flex items-center justify-between p-4 text-left"
                    onClick={() => setExpandedCompetitorId(expandedCompetitorId === c.id ? null : c.id)}
                  >
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center shrink-0">
                        <Building2 className="w-5 h-5 text-slate-400" />
                      </div>
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 truncate">{c.page_name}</div>
                        <div className="flex items-center gap-3 mt-0.5 text-xs text-slate-400">
                          <span>{c.ad_count} ads tracked</span>
                          <span>·</span>
                          <span>Since {new Date(c.first_detected_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 shrink-0 ml-3">
                      {/* Threat score mini bar */}
                      <div className="hidden sm:flex flex-col items-end gap-1">
                        <div className="text-xs font-semibold text-slate-600">{c.threat_score}/100</div>
                        <div className="w-24 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full bg-gradient-to-r ${threatBarColor(c.threat_band)} transition-all`}
                            style={{ width: `${c.threat_score}%` }}
                          />
                        </div>
                      </div>
                      <Badge variant="outline" className={`text-xs ${bandColor(c.threat_band)}`}>
                        {c.threat_band}
                      </Badge>
                      {expandedCompetitorId === c.id
                        ? <ChevronUp className="w-4 h-4 text-slate-400" />
                        : <ChevronDown className="w-4 h-4 text-slate-400" />}
                    </div>
                  </button>

                  {/* Expanded detail */}
                  {expandedCompetitorId === c.id && (
                    <CompetitorDetail
                      competitor={c}
                      adsQuery={adsQuery}
                      timelineQuery={timelineQuery}
                      threatV2Query={threatV2Query}
                      strategiesQuery={strategiesQuery}
                      generateStrategyMutation={generateStrategyMutation}
                      feedbackMutation={feedbackMutation}
                      feedbackNotes={feedbackNotes}
                      setFeedbackNotes={setFeedbackNotes}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </TabsContent>

        {/* Search History tab */}
        <TabsContent value="history" className="mt-4">
          <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100">
              <div className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                <History className="w-4 h-4 text-[#005476]" /> Search History
              </div>
            </div>
            <div className="p-4">
              {searchRunsQuery.isLoading ? (
                <div className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>
              ) : searchRunsQuery.isError ? (
                <QueryErrorCard label="search history" error={searchRunsQuery.error} />
              ) : toSafeArray<SearchRun>(searchRunsQuery.data).length === 0 ? (
                <div className="text-sm text-slate-400 text-center py-6">No searches run yet.</div>
              ) : (
                <div className="space-y-1.5">
                  {toSafeArray<SearchRun>(searchRunsQuery.data).map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm py-2 border-b border-slate-50 last:border-0" data-testid={`row-run-${r.id}`}>
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-slate-800 truncate">{toSafeDisplayString(r.search_term)}</span>
                        {r.country && <span className="text-xs text-slate-400 shrink-0">({r.country})</span>}
                      </div>
                      <div className="flex items-center gap-2 text-xs shrink-0 ml-3">
                        <span className="text-slate-400 hidden sm:block">{new Date(r.started_at).toLocaleDateString()}</span>
                        <Badge variant="outline" className={`text-[10px] ${r.success ? "bg-green-50 text-green-700 border-green-200" : "bg-red-50 text-red-700 border-red-200"}`}>
                          {r.success ? `${r.result_count ?? 0} ads` : "failed"}
                        </Badge>
                        {r.blocked && <Badge variant="outline" className="text-[10px] bg-amber-50 text-amber-700 border-amber-200">blocked</Badge>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function CompetitorIntelligencePage() {
  return (
    <CompetitorIntelligenceErrorBoundary>
      <CompetitorIntelligencePageInner />
    </CompetitorIntelligenceErrorBoundary>
  );
}
