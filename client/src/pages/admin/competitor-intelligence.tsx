import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Swords, Search, Loader2, ShieldAlert, TrendingUp, Image as ImageIcon,
  Video, Link as LinkIcon, Sparkles, Target, AlertTriangle, History, ChevronDown, ChevronUp,
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

// ── Helpers ──────────────────────────────────────────────────────────────

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
      </div>

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
