import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Image as ImageIcon, Video, Loader2, X, Sparkles, AlertTriangle,
  ShieldCheck, Heart, Eye, Lightbulb, Dna, Target, Users, Clock, Gem,
  Palette, TrendingUp, RefreshCw, CheckCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

interface MediaItem {
  id: number;
  ad_id: number;
  media_type: "image" | "video" | "video_poster";
  position: number;
  original_url: string;
  cloudinary_url: string | null;
  cached: boolean;
  cache_error: string | null;
  cached_at: string | null;
  media_status: string | null;
  ai_analysis: CreativeAnalysis | null;
  ai_analysis_generated_at: string | null;
}

interface CreativeAnalysis {
  whyChosen: string;
  luxuryCues: string;
  trustSignals: string;
  emotionalTriggers: string;
  weaknesses: string;
  kinglikeSuggestion: string;
}

interface CreativeDna {
  id: number;
  mediaId: number;
  version: number;
  luxuryScore: number | null;
  trustScore: number | null;
  investmentAppealScore: number | null;
  emotionalScore: number | null;
  familyAppealScore: number | null;
  urgencyScore: number | null;
  scarcityScore: number | null;
  visualQualityScore: number | null;
  brandQualityScore: number | null;
  expectedConversionScore: number | null;
  detectedObjects: string[];
  sceneType: string;
  colors: string[];
  brightness: string;
  compositionNotes: string;
  visibleTextOcr: string;
  likelyTargetAudience: string;
  strengths: string;
  weaknesses: string;
  kinglikeBetterAngle: string;
  aiExplanation: string;
  confidencePercent: number | null;
  createdAt: string;
}

function toSafeArray<T = any>(raw: unknown): T[] {
  if (Array.isArray(raw)) return raw as T[];
  if (raw && typeof raw === "object" && Array.isArray((raw as any).data)) return (raw as any).data as T[];
  return [];
}

function unwrapObject<T = any>(raw: unknown): T | null {
  if (raw && typeof raw === "object" && "data" in (raw as Record<string, unknown>)) {
    return (raw as Record<string, unknown>).data as T;
  }
  return (raw as T) ?? null;
}

// ── Cache age helper ────────────────────────────────────────────────────────

function cacheAgeInfo(cachedAt: string | null): { days: number; label: string } | null {
  if (!cachedAt) return null;
  const days = Math.floor((Date.now() - new Date(cachedAt).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return { days, label: "Cached today" };
  if (days === 1) return { days, label: "Cached 1 day ago" };
  return { days, label: `Cached ${days} days ago` };
}

/** Thumbnail for a single media item */
function Thumbnail({ item, onOpen }: { item: MediaItem; onOpen: (item: MediaItem) => void }) {
  const isVideo = item.media_type === "video";
  const isExpired = item.media_status === "expired";
  const previewUrl = item.cloudinary_url;

  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="relative w-20 h-20 rounded-lg overflow-hidden border bg-slate-100 hover:ring-2 hover:ring-[#3bcac4] transition-shadow shrink-0"
      data-testid={`button-open-creative-${item.id}`}
    >
      {previewUrl ? (
        <img src={previewUrl} alt="Competitor creative" loading="lazy" className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-slate-400">
          {isVideo ? <Video className="w-5 h-5" /> : <ImageIcon className="w-5 h-5" />}
        </div>
      )}
      {isVideo && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="w-6 h-6 rounded-full bg-white/90 flex items-center justify-center">
            <div className="w-0 h-0 border-y-4 border-y-transparent border-l-6 border-l-slate-800 ml-0.5" />
          </div>
        </div>
      )}
      {isExpired && (
        <div className="absolute bottom-0 left-0 right-0 bg-amber-600/80 text-white text-[9px] text-center py-0.5">
          expired
        </div>
      )}
      {!isExpired && item.cache_error && (
        <div className="absolute bottom-0 left-0 right-0 bg-red-600/80 text-white text-[9px] text-center py-0.5">
          unavailable
        </div>
      )}
    </button>
  );
}

function AnalysisRow({ icon: Icon, label, value }: { icon: any; label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="flex gap-2 text-xs">
      <Icon className="w-3.5 h-3.5 text-[#005476] shrink-0 mt-0.5" />
      <span><span className="font-semibold text-slate-600">{label}:</span> <span className="text-slate-700">{value}</span></span>
    </div>
  );
}

function DnaScoreChip({ label, value }: { label: string; value: number | null }) {
  if (value === null || value === undefined) return null;
  return (
    <div className="flex flex-col items-center bg-white rounded-lg border px-2 py-1.5 min-w-[72px]">
      <span className="text-[10px] text-slate-500 uppercase text-center leading-tight">{label}</span>
      <span className="text-sm font-bold text-[#005476]">{value}</span>
    </div>
  );
}

function CreativeDnaPanel({ item }: { item: MediaItem }) {
  const queryClient = useQueryClient();

  const dnaQuery = useQuery<CreativeDna | null>({
    queryKey: ["/api/admin/competitor-intelligence/media", item.id, "dna"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/competitor-intelligence/media/${item.id}/dna`);
      if (res.status === 404) return null;
      const json = await res.json();
      if (!json.ok) return null;
      return unwrapObject<CreativeDna>(json);
    },
    enabled: !!item.cached && item.media_type !== "video",
    retry: false,
  });

  const analyzeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/competitor-intelligence/media/${item.id}/dna/analyze`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to analyze Creative DNA");
      return unwrapObject<CreativeDna>(json);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/media", item.id, "dna"] });
    },
  });

  const isCached = !!item.cloudinary_url;
  const dna = dnaQuery.data;

  if (!isCached) {
    return (
      <div className="border-t pt-3">
        <div className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
          <Dna className="w-3.5 h-3.5" /> Creative DNA
        </div>
        <p className="text-xs text-slate-400">Cache this creative first.</p>
      </div>
    );
  }

  if (item.media_type === "video") {
    return (
      <div className="border-t pt-3">
        <div className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
          <Dna className="w-3.5 h-3.5" /> Creative DNA
        </div>
        <p className="text-xs text-slate-400">Creative DNA currently supports images only.</p>
      </div>
    );
  }

  return (
    <div className="border-t pt-3">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-semibold text-slate-500 uppercase flex items-center gap-1">
          <Dna className="w-3.5 h-3.5" /> Creative DNA {dna ? `(v${dna.version})` : ""}
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => analyzeMutation.mutate()}
          disabled={analyzeMutation.isPending || dnaQuery.isLoading}
          className="h-7 text-xs"
          data-testid={`button-analyze-dna-${item.id}`}
        >
          {analyzeMutation.isPending ? (
            <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Analyzing DNA...</>
          ) : dna ? (
            "Re-analyze Creative DNA"
          ) : (
            "Analyze Creative DNA"
          )}
        </Button>
      </div>

      {analyzeMutation.isError && (
        <p className="text-xs text-red-600 flex items-center gap-1 mb-2">
          <AlertTriangle className="w-3.5 h-3.5" /> {(analyzeMutation.error as Error).message}
        </p>
      )}

      {dnaQuery.isLoading ? (
        <div className="text-sm text-slate-500 flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Loading Creative DNA...
        </div>
      ) : dna ? (
        <div className="space-y-3 bg-slate-50 rounded-lg p-3">
          <div className="flex gap-2 flex-wrap">
            <DnaScoreChip label="Luxury" value={dna.luxuryScore} />
            <DnaScoreChip label="Trust" value={dna.trustScore} />
            <DnaScoreChip label="Investment" value={dna.investmentAppealScore} />
            <DnaScoreChip label="Emotional" value={dna.emotionalScore} />
            <DnaScoreChip label="Family" value={dna.familyAppealScore} />
            <DnaScoreChip label="Urgency" value={dna.urgencyScore} />
            <DnaScoreChip label="Scarcity" value={dna.scarcityScore} />
            <DnaScoreChip label="Visual quality" value={dna.visualQualityScore} />
            <DnaScoreChip label="Brand quality" value={dna.brandQualityScore} />
            <DnaScoreChip label="Exp. conversion" value={dna.expectedConversionScore} />
          </div>

          {dna.detectedObjects.length > 0 && (
            <div className="flex gap-2 text-xs">
              <Target className="w-3.5 h-3.5 text-[#005476] shrink-0 mt-0.5" />
              <span>
                <span className="font-semibold text-slate-600">Detected objects:</span>{" "}
                {dna.detectedObjects.map((obj, i) => (
                  <Badge key={i} variant="secondary" className="mr-1 mb-1 text-[10px]">{obj}</Badge>
                ))}
              </span>
            </div>
          )}

          <AnalysisRow icon={ImageIcon} label="Scene type" value={dna.sceneType} />
          {dna.colors.length > 0 && (
            <div className="flex gap-2 text-xs">
              <Palette className="w-3.5 h-3.5 text-[#005476] shrink-0 mt-0.5" />
              <span><span className="font-semibold text-slate-600">Colors:</span> {dna.colors.join(", ")}</span>
            </div>
          )}
          <AnalysisRow icon={Eye} label="Brightness" value={dna.brightness} />
          <AnalysisRow icon={Sparkles} label="Composition" value={dna.compositionNotes} />
          <AnalysisRow icon={Clock} label="Visible text (OCR)" value={dna.visibleTextOcr} />
          <AnalysisRow icon={Users} label="Likely target audience" value={dna.likelyTargetAudience} />
          <AnalysisRow icon={Gem} label="Strengths" value={dna.strengths} />
          <AnalysisRow icon={AlertTriangle} label="Weaknesses" value={dna.weaknesses} />

          {dna.kinglikeBetterAngle && (
            <div className="flex gap-2 text-xs bg-[#3bcac4]/10 rounded p-2 mt-2">
              <Lightbulb className="w-3.5 h-3.5 text-[#005476] shrink-0 mt-0.5" />
              <span><span className="font-semibold text-[#005476]">Kinglike better angle:</span> {dna.kinglikeBetterAngle}</span>
            </div>
          )}

          {dna.aiExplanation && (
            <div className="flex gap-2 text-xs text-slate-500 italic">
              <TrendingUp className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{dna.aiExplanation}</span>
            </div>
          )}

          {dna.confidencePercent !== null && (
            <div className="text-[10px] text-slate-400">Confidence: {dna.confidencePercent}%</div>
          )}
        </div>
      ) : (
        <p className="text-xs text-slate-400">No Creative DNA analysis yet — click "Analyze Creative DNA" above.</p>
      )}
    </div>
  );
}

function Lightbox({ item, onClose }: { item: MediaItem; onClose: () => void }) {
  const queryClient = useQueryClient();

  const cacheMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/competitor-intelligence/media/${item.id}/cache`);
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Failed to cache creative");
      return json.data as MediaItem;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/ads", item.ad_id, "media"] });
    },
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/admin/competitor-intelligence/media/${item.id}/refresh`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/ads", item.ad_id, "media"] });
    },
  });

  const analysisQuery = useQuery<CreativeAnalysis | null>({
    queryKey: ["/api/admin/competitor-intelligence/media", item.id, "analysis"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/competitor-intelligence/media/${item.id}/analysis`);
      const json = await res.json();
      if (!json.ok) return null;
      return unwrapObject<CreativeAnalysis>(json);
    },
    enabled: !!item.cached && item.media_type !== "video",
    retry: false,
  });

  const isCached = !!item.cloudinary_url;
  const isExpired = item.media_status === "expired";
  const cannotCache = !!item.cache_error && !isCached && !isExpired;

  const age = cacheAgeInfo(item.cached_at);
  const isStale = age !== null && age.days > 90;

  return (
    <div className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-white rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-3 border-b">
          <div className="text-sm font-semibold text-slate-700 flex items-center gap-2">
            {item.media_type === "video" ? <Video className="w-4 h-4" /> : <ImageIcon className="w-4 h-4" />}
            Competitor Creative
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-lightbox">
            <X className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-4 space-y-4">

          {/* Expired Meta URL notice */}
          {isExpired && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-800">
                  <p className="font-semibold mb-0.5">Original Meta media has expired.</p>
                  <p>Run a new competitor search to refresh this creative, or try the button below to check if the URL has recovered.</p>
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => refreshMutation.mutate()}
                disabled={refreshMutation.isPending}
                className="self-start h-7 text-xs border-amber-400 text-amber-800 hover:bg-amber-100"
                data-testid={`button-refresh-original-${item.id}`}
              >
                {refreshMutation.isPending ? (
                  <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Checking...</>
                ) : (
                  <><RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh Original Media</>
                )}
              </Button>
              {refreshMutation.isSuccess && (refreshMutation.data as any)?.ok && (
                <p className="text-xs text-emerald-700 flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" /> Original URL is live again.
                </p>
              )}
              {refreshMutation.isSuccess && !(refreshMutation.data as any)?.ok && (
                <p className="text-xs text-amber-700 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Still expired — try running a new search to get a fresh URL.
                </p>
              )}
            </div>
          )}

          {/* Pre-cache CTA */}
          {!isCached && !cannotCache && !isExpired && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Button
                onClick={() => cacheMutation.mutate()}
                disabled={cacheMutation.isPending}
                className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white"
                data-testid="button-load-creative"
              >
                {cacheMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Loading creative...</>
                ) : (
                  "Load creative"
                )}
              </Button>
              <p className="text-xs text-slate-400 text-center max-w-xs">
                Cached once on first view, then reused for every admin — nothing downloads until you click.
              </p>
              {cacheMutation.isError && (
                <p className="text-xs text-red-600 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> {(cacheMutation.error as Error).message}
                </p>
              )}
            </div>
          )}

          {/* Permanent error state */}
          {cannotCache && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <p className="text-sm text-slate-600 max-w-sm">
                This creative couldn't be cached ({item.cache_error}). It may be a large video or an unsupported source.
              </p>
            </div>
          )}

          {/* Media display */}
          {isCached && item.media_type === "video" ? (
            <video src={item.cloudinary_url!} controls className="w-full rounded-lg max-h-[50vh]" />
          ) : isCached ? (
            <img src={item.cloudinary_url!} alt="Competitor creative" className="w-full rounded-lg max-h-[50vh] object-contain bg-slate-50" />
          ) : null}

          {/* Cache age */}
          {isCached && age && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] text-slate-400 flex items-center gap-1">
                <Clock className="w-3 h-3" /> {age.label}
              </span>
              {isStale && (
                <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700 bg-amber-50">
                  Cache may be outdated
                </Badge>
              )}
              {isStale && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => refreshMutation.mutate()}
                  disabled={refreshMutation.isPending}
                  className="h-6 text-[11px] text-slate-500 px-2"
                  data-testid={`button-refresh-stale-${item.id}`}
                >
                  {refreshMutation.isPending ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <><RefreshCw className="w-3 h-3 mr-1" /> Refresh Original</>
                  )}
                </Button>
              )}
            </div>
          )}

          {/* AI Creative Analysis */}
          {isCached && item.media_type !== "video" && (
            <div className="border-t pt-3">
              <div className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
                <Sparkles className="w-3.5 h-3.5" /> AI Creative Analysis
              </div>
              {analysisQuery.isLoading ? (
                <div className="text-sm text-slate-500 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" /> Analyzing creative...
                </div>
              ) : analysisQuery.data ? (
                <div className="space-y-2 bg-slate-50 rounded-lg p-3">
                  <AnalysisRow icon={Eye} label="Why this was likely chosen" value={analysisQuery.data.whyChosen} />
                  <AnalysisRow icon={Sparkles} label="Luxury cues" value={analysisQuery.data.luxuryCues} />
                  <AnalysisRow icon={ShieldCheck} label="Trust signals" value={analysisQuery.data.trustSignals} />
                  <AnalysisRow icon={Heart} label="Emotional triggers" value={analysisQuery.data.emotionalTriggers} />
                  <AnalysisRow icon={AlertTriangle} label="Weaknesses" value={analysisQuery.data.weaknesses} />
                  {analysisQuery.data.kinglikeSuggestion && (
                    <div className="flex gap-2 text-xs bg-[#3bcac4]/10 rounded p-2 mt-2">
                      <Lightbulb className="w-3.5 h-3.5 text-[#005476] shrink-0 mt-0.5" />
                      <span><span className="font-semibold text-[#005476]">Kinglike suggestion:</span> {analysisQuery.data.kinglikeSuggestion}</span>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-xs text-slate-400">AI analysis unavailable for this creative.</p>
              )}
            </div>
          )}
          {isCached && item.media_type === "video" && (
            <p className="text-xs text-slate-400">AI analysis currently supports images and video posters only.</p>
          )}

          <CreativeDnaPanel item={item} />
        </div>
      </div>
    </div>
  );
}

export function CompetitorCreativeGallery({ adId }: { adId: number }) {
  const [openItem, setOpenItem] = useState<MediaItem | null>(null);

  const mediaQuery = useQuery<MediaItem[]>({
    queryKey: ["/api/admin/competitor-intelligence/ads", adId, "media"],
    queryFn: async () => {
      const res = await apiRequest("GET", `/api/admin/competitor-intelligence/ads/${adId}/media`);
      const json = await res.json();
      return toSafeArray<MediaItem>(json);
    },
  });

  const items = toSafeArray<MediaItem>(mediaQuery.data);
  const displayItems: MediaItem[] = [];
  const posters = items.filter((m) => m.media_type === "video_poster");
  const images = items.filter((m) => m.media_type === "image");
  const videos = items.filter((m) => m.media_type === "video");

  for (const img of images) displayItems.push(img);
  for (const poster of posters) displayItems.push(poster);
  if (videos.length > 0 && posters.length === 0) {
    for (const v of videos) displayItems.push(v);
  }

  if (mediaQuery.isLoading) {
    return <div className="text-xs text-slate-400 flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading creatives...</div>;
  }

  if (displayItems.length === 0) {
    return null;
  }

  return (
    <div className="pt-2 border-t">
      <div className="text-xs font-semibold text-slate-500 uppercase mb-2 flex items-center gap-1">
        <ImageIcon className="w-3.5 h-3.5" /> Creatives ({displayItems.length})
      </div>
      <div className="flex gap-2 flex-wrap">
        {displayItems.map((item) => (
          <Thumbnail key={item.id} item={item} onOpen={setOpenItem} />
        ))}
      </div>
      {openItem && <Lightbox item={openItem} onClose={() => setOpenItem(null)} />}
    </div>
  );
}
