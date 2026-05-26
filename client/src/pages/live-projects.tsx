import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  Wifi, WifiOff, Maximize2, RefreshCw, CalendarDays, Bot,
  MapPin, ChevronRight, Camera, Globe, Building2, Loader2, Tv
} from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Types ──────────────────────────────────────────────────────────────────
interface LiveCamera {
  id: number;
  propertyId: number;
  label: string;
  embedUrl: string;
  thumbnailUrl: string | null;
  country: string;
  city: string;
  isActive: boolean;
  status: string;
  propertyTitle?: string;
  propertyLocation?: string;
}

// ── Country / City config ──────────────────────────────────────────────────
const COUNTRIES = [
  { key: "georgia",     flag: "🇬🇪", label: "Georgia" },
  { key: "turkey",      flag: "🇹🇷", label: "Turkey" },
  { key: "dubai",       flag: "🇦🇪", label: "Dubai" },
  { key: "north_cyprus",flag: "🇨🇾", label: "North Cyprus" },
] as const;

const STATUS_CONFIG: Record<string, { label: string; color: string; dot: string }> = {
  active:      { label: "LIVE", color: "bg-red-500",    dot: "bg-red-400" },
  offline:     { label: "OFFLINE", color: "bg-gray-400", dot: "bg-gray-300" },
  coming_soon: { label: "COMING SOON", color: "bg-amber-500", dot: "bg-amber-400" },
};

// ── LiveBadge ─────────────────────────────────────────────────────────────
function LiveBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.offline;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[10px] font-bold uppercase tracking-wider ${cfg.color}`}>
      {status === "active" && (
        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot} animate-ping`} />
      )}
      {cfg.label}
    </span>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────
function CameraSkeleton() {
  return (
    <div className="w-full aspect-video bg-gray-200 rounded-2xl animate-pulse flex items-center justify-center">
      <Camera className="w-12 h-12 text-gray-300" />
    </div>
  );
}

// ── Fallback card ─────────────────────────────────────────────────────────
function CameraFallback({ onRetry, lang }: { onRetry: () => void; lang: string }) {
  const [, navigate] = useLocation();
  const ar = lang === "ar";
  return (
    <div className="w-full aspect-video rounded-2xl flex flex-col items-center justify-center gap-4 border-2 border-dashed border-gray-200 bg-gray-50">
      <WifiOff className="w-12 h-12 text-gray-300" />
      <div className="text-center px-4">
        <p className="font-semibold text-gray-600 mb-1">
          {ar ? "الكاميرا غير متاحة مؤقتاً" : "Live camera temporarily unavailable."}
        </p>
        <p className="text-xs text-gray-400 mb-4">
          {ar ? "يمكنك التواصل مع مستشارينا للحصول على المزيد من المعلومات." : "Contact our advisors for more information about this project."}
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button size="sm" onClick={onRetry} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />{ar ? "إعادة المحاولة" : "Try again"}
          </Button>
          <Button size="sm" onClick={() => navigate("/consultation")}
            style={{ background: "linear-gradient(135deg,#3bcac4,#005476)" }} className="text-white gap-2">
            <CalendarDays className="w-4 h-4" />{ar ? "حجز استشارة" : "Request Consultation"}
          </Button>
          <Button size="sm" onClick={() => navigate("/ai-advisor")} variant="outline" className="gap-2">
            <Bot className="w-4 h-4 text-[#3bcac4]" />{ar ? "المستشار الذكي" : "Contact AI Advisor"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── LiveCameraCard ─────────────────────────────────────────────────────────
function LiveCameraCard({ camera, lang }: { camera: LiveCamera; lang: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const ar = lang === "ar";

  const handleFullscreen = () => {
    if (iframeRef.current?.requestFullscreen) {
      iframeRef.current.requestFullscreen();
    }
  };

  const handleRetry = () => {
    setError(false);
    setLoading(true);
    setRetryKey(k => k + 1);
  };

  if (camera.status === "offline" || !camera.isActive) {
    return (
      <div>
        <CameraFallback onRetry={() => {}} lang={lang} />
        <p className="text-xs text-gray-400 text-center mt-2">{camera.label}</p>
      </div>
    );
  }

  if (camera.status === "coming_soon") {
    return (
      <div className="w-full aspect-video rounded-2xl flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-[#005476] to-[#3bcac4]">
        <Camera className="w-12 h-12 text-white/60" />
        <p className="text-white font-semibold text-lg">
          {ar ? "الكاميرا قادمة قريباً" : "Camera Coming Soon"}
        </p>
        <p className="text-white/70 text-sm">{camera.label}</p>
      </div>
    );
  }

  return (
    <div className="relative rounded-2xl overflow-hidden bg-black shadow-xl group">
      {/* LIVE badge */}
      <div className="absolute top-3 left-3 z-10">
        <LiveBadge status={camera.status} />
      </div>

      {/* Fullscreen button */}
      <button
        onClick={handleFullscreen}
        className="absolute top-3 right-3 z-10 w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors opacity-0 group-hover:opacity-100"
      >
        <Maximize2 className="w-4 h-4" />
      </button>

      {/* Camera label */}
      <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-4 py-3">
        <p className="text-white text-sm font-medium">{camera.label}</p>
        {camera.propertyTitle && (
          <p className="text-white/70 text-xs">{camera.propertyTitle}</p>
        )}
      </div>

      {/* Skeleton */}
      {loading && !error && (
        <div className="absolute inset-0 z-20">
          <CameraSkeleton />
        </div>
      )}

      {/* Error fallback */}
      {error && (
        <div className="absolute inset-0 z-20">
          <CameraFallback onRetry={handleRetry} lang={lang} />
        </div>
      )}

      {/* Iframe */}
      <div className="w-full aspect-video">
        <iframe
          key={retryKey}
          ref={iframeRef}
          src={camera.embedUrl}
          className="w-full h-full border-0"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true); }}
          title={camera.label}
          sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
        />
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────
export default function LiveProjects() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isRtl = lang === "ar" || lang === "he";
  const ar = lang === "ar";

  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedCamera, setSelectedCamera] = useState<LiveCamera | null>(null);

  const { data: allCameras = [], isLoading } = useQuery<LiveCamera[]>({
    queryKey: ["/api/live-projects"],
    queryFn: () => fetch("/api/live-projects").then(r => r.json()),
  });

  // Derived data
  const countries = COUNTRIES.filter(c => allCameras.some(cam => cam.country === c.key));
  const citiesForCountry = [...new Set(
    allCameras.filter(cam => cam.country === selectedCountry).map(cam => cam.city)
  )];
  const camerasForCity = allCameras.filter(
    cam => cam.country === selectedCountry && cam.city === selectedCity
  );

  // Group cameras by propertyId for "per project" display
  const projectGroups: Record<number, LiveCamera[]> = {};
  camerasForCity.forEach(cam => {
    if (!projectGroups[cam.propertyId]) projectGroups[cam.propertyId] = [];
    projectGroups[cam.propertyId].push(cam);
  });

  // Reset downstream selections when country/city changes
  useEffect(() => { setSelectedCity(null); setSelectedCamera(null); }, [selectedCountry]);
  useEffect(() => { setSelectedCamera(null); }, [selectedCity]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-[#f0fdfc]" dir={isRtl ? "rtl" : "ltr"}>
      {/* Hero */}
      <div className="text-white pt-10 pb-16 px-4" style={{ background: "linear-gradient(135deg,#3bcac4 0%,#005476 100%)" }}>
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/20 rounded-full px-4 py-1.5 mb-4">
            <span className="w-2 h-2 bg-red-400 rounded-full animate-ping" />
            <span className="text-sm font-semibold tracking-wide">
              {ar ? "كاميرات مباشرة" : "LIVE CAMERAS"}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            {ar ? "مشاريعنا الحية" : "Live Projects"}
          </h1>
          <p className="text-white/80 text-base max-w-lg mx-auto">
            {ar
              ? "شاهد تقدم البناء في مشاريعنا مباشرة من خلال كاميرات البث الحي."
              : "Watch real-time construction progress on our premium projects with live streaming cameras."}
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 -mt-8 pb-24">

        {/* Loading */}
        {isLoading && (
          <div className="bg-white rounded-2xl shadow-md p-12 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-[#3bcac4]" />
          </div>
        )}

        {/* No cameras configured yet */}
        {!isLoading && allCameras.length === 0 && (
          <div className="bg-white rounded-2xl shadow-md p-12 text-center">
            <Tv className="w-16 h-16 mx-auto mb-4 text-gray-200" />
            <h2 className="text-xl font-bold text-gray-700 mb-2">
              {ar ? "قريباً — كاميرات مباشرة" : "Coming Soon — Live Cameras"}
            </h2>
            <p className="text-gray-400 text-sm max-w-sm mx-auto">
              {ar
                ? "سنضيف كاميرات البث المباشر لمشاريعنا قريباً. تابعنا!"
                : "We'll be adding live construction cameras to our projects soon. Stay tuned!"}
            </p>
          </div>
        )}

        {!isLoading && allCameras.length > 0 && (
          <>
            {/* STEP 1 — Country */}
            <div className="bg-white rounded-2xl shadow-md p-5 mb-4">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#3bcac4]" />
                {ar ? "اختر الدولة" : "Select Country"}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {COUNTRIES.map(c => {
                  const available = allCameras.some(cam => cam.country === c.key);
                  if (!available) return null;
                  return (
                    <button
                      key={c.key}
                      onClick={() => setSelectedCountry(c.key)}
                      className="rounded-xl p-4 border-2 text-center transition-all"
                      style={{
                        borderColor: selectedCountry === c.key ? "#3bcac4" : "#e5e7eb",
                        background: selectedCountry === c.key ? "#f0fdfc" : "#fff",
                      }}
                    >
                      <span className="text-3xl block mb-1">{c.flag}</span>
                      <span className="text-sm font-semibold" style={{ color: selectedCountry === c.key ? "#005476" : "#374151" }}>
                        {c.label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* STEP 2 — City */}
            {selectedCountry && citiesForCountry.length > 0 && (
              <div className="bg-white rounded-2xl shadow-md p-5 mb-4">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#3bcac4]" />
                  {ar ? "اختر المدينة" : "Select City"}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {citiesForCountry.map(city => (
                    <button
                      key={city}
                      onClick={() => setSelectedCity(city)}
                      className="rounded-xl px-5 py-3 border-2 text-sm font-semibold transition-all"
                      style={{
                        borderColor: selectedCity === city ? "#3bcac4" : "#e5e7eb",
                        background: selectedCity === city ? "#f0fdfc" : "#fff",
                        color: selectedCity === city ? "#005476" : "#374151",
                      }}
                    >
                      {city}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* STEP 3 — Projects */}
            {selectedCity && Object.keys(projectGroups).length > 0 && (
              <div className="bg-white rounded-2xl shadow-md p-5 mb-4">
                <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#3bcac4]" />
                  {ar ? "اختر المشروع" : "Select Project"}
                </h2>
                <div className="space-y-3">
                  {Object.entries(projectGroups).map(([propId, cameras]) => {
                    const firstCam = cameras[0];
                    const isSelected = selectedCamera && cameras.some(c => c.id === selectedCamera.id);
                    return (
                      <button
                        key={propId}
                        onClick={() => setSelectedCamera(firstCam)}
                        className="w-full rounded-xl border-2 overflow-hidden text-left transition-all"
                        style={{
                          borderColor: isSelected ? "#3bcac4" : "#e5e7eb",
                          background: isSelected ? "#f0fdfc" : "#fff",
                        }}
                      >
                        <div className="flex items-center gap-4 p-4">
                          {/* Thumbnail */}
                          <div className="w-16 h-16 rounded-xl overflow-hidden bg-gradient-to-br from-[#3bcac4] to-[#005476] flex-shrink-0 flex items-center justify-center">
                            {firstCam.thumbnailUrl ? (
                              <img src={firstCam.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                            ) : (
                              <Camera className="w-6 h-6 text-white/70" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900 truncate">{firstCam.propertyTitle || `Project #${propId}`}</p>
                            <p className="text-xs text-gray-500 mb-2">{firstCam.city} · {cameras.length} {ar ? "كاميرا" : cameras.length === 1 ? "camera" : "cameras"}</p>
                            <div className="flex flex-wrap gap-1.5">
                              {cameras.map(c => <LiveBadge key={c.id} status={c.status} />)}
                            </div>
                          </div>
                          <ChevronRight className="w-5 h-5 text-gray-300 flex-shrink-0" style={{ color: isSelected ? "#3bcac4" : undefined }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* STEP 4 — Live Camera viewer */}
            {selectedCamera && (() => {
              const projectCameras = projectGroups[selectedCamera.propertyId] || [];
              return (
                <div className="bg-white rounded-2xl shadow-md p-5">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-2">
                      <Camera className="w-4 h-4 text-[#3bcac4]" />
                      {ar ? "البث المباشر" : "Live Stream"}
                    </h2>
                    {projectCameras.length > 1 && (
                      <div className="flex gap-2">
                        {projectCameras.map(c => (
                          <button
                            key={c.id}
                            onClick={() => setSelectedCamera(c)}
                            className="text-xs px-3 py-1.5 rounded-lg border-2 font-medium transition-all"
                            style={{
                              borderColor: selectedCamera.id === c.id ? "#3bcac4" : "#e5e7eb",
                              background: selectedCamera.id === c.id ? "#f0fdfc" : "#fff",
                              color: selectedCamera.id === c.id ? "#005476" : "#6b7280",
                            }}
                          >
                            {c.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <LiveCameraCard camera={selectedCamera} lang={lang} />
                </div>
              );
            })()}
          </>
        )}
      </div>
    </div>
  );
}
