import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Image as ImageIcon, Video, Loader2, X, Sparkles, AlertTriangle,
  ShieldCheck, Heart, Eye, Lightbulb,
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

/** Thumbnail for a single media item — lazy loads only when rendered, and
 *  only triggers the caching+analysis network calls when explicitly clicked. */
function Thumbnail({ item, onOpen }: { item: MediaItem; onOpen: (item: MediaItem) => void }) {
  const isVideo = item.media_type === "video";
  const previewUrl = item.cloudinary_url; // never render the raw third-party URL directly

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
      {item.cache_error && (
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
  const cannotCache = !!item.cache_error && !isCached;

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
          {!isCached && !cannotCache && (
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

          {cannotCache && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center">
              <AlertTriangle className="w-6 h-6 text-amber-500" />
              <p className="text-sm text-slate-600 max-w-sm">
                This creative couldn't be cached ({item.cache_error}). It may be a large video or an unsupported source.
              </p>
            </div>
          )}

          {isCached && item.media_type === "video" ? (
            <video src={item.cloudinary_url!} controls className="w-full rounded-lg max-h-[50vh]" />
          ) : isCached ? (
            <img src={item.cloudinary_url!} alt="Competitor creative" className="w-full rounded-lg max-h-[50vh] object-contain bg-slate-50" />
          ) : null}

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
  // Prefer showing one thumbnail per visual: images as-is, and for videos show
  // the poster thumbnail if one exists (fallback to the video item itself).
  const displayItems: MediaItem[] = [];
  const posters = items.filter((m) => m.media_type === "video_poster");
  const images = items.filter((m) => m.media_type === "image");
  const videos = items.filter((m) => m.media_type === "video");

  // Simple ordering: images, then video posters (acting as the video's visual
  // thumbnail — clicking still opens the full lightbox for the actual video item
  // if one exists at the same position, otherwise shows the poster itself).
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
