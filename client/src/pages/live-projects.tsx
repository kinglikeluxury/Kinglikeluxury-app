import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import {
  WifiOff, Maximize2, RefreshCw, CalendarDays, Bot,
  MapPin, ChevronRight, Camera, Globe, Building2, Loader2, Tv
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Property } from "@shared/schema";

// ── Country config ─────────────────────────────────────────────────────────
const COUNTRY_META: Record<string, { flag: string; labelKey: string; fallback: string }> = {
  georgia:      { flag: "🇬🇪", labelKey: "countries.georgia",      fallback: "Georgia" },
  turkey:       { flag: "🇹🇷", labelKey: "countries.turkey",       fallback: "Turkey" },
  dubai:        { flag: "🇦🇪", labelKey: "countries.dubai",        fallback: "Dubai" },
  north_cyprus: { flag: "🇨🇾", labelKey: "countries.north_cyprus", fallback: "North Cyprus" },
};

// ── LIVE badge ─────────────────────────────────────────────────────────────
function LiveBadge({ status, t }: { status: string | null; t: (k: string, fb: string) => string }) {
  const cfgs: Record<string, { color: string; labelKey: string; fallback: string }> = {
    active:      { color: "bg-red-500",    labelKey: "liveProjects.statusLive",        fallback: "LIVE" },
    unavailable: { color: "bg-gray-400",   labelKey: "liveProjects.statusUnavailable", fallback: "UNAVAILABLE" },
    maintenance: { color: "bg-amber-500",  labelKey: "liveProjects.statusMaintenance", fallback: "MAINTENANCE" },
  };
  const cfg = cfgs[status || "unavailable"] || cfgs.unavailable;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-white text-[10px] font-bold uppercase tracking-wider ${cfg.color}`}>
      {status === "active" && <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-ping" />}
      {t(cfg.labelKey, cfg.fallback)}
    </span>
  );
}

// ── Camera fallback ────────────────────────────────────────────────────────
function CameraFallback({ onRetry, t }: { onRetry: () => void; t: (k: string, fb: string) => string }) {
  const [, navigate] = useLocation();
  return (
    <div className="w-full aspect-video rounded-2xl flex flex-col items-center justify-center gap-4 border-2 border-dashed border-gray-200 bg-gray-50 px-6">
      <WifiOff className="w-12 h-12 text-gray-300" />
      <div className="text-center">
        <p className="font-semibold text-gray-600 mb-1">
          {t("liveProjects.cameraUnavailable", "Live camera is temporarily unavailable.")}
        </p>
        <p className="text-sm text-gray-400 mb-4 max-w-xs mx-auto">
          {t("liveProjects.cameraUnavailableDesc", "Please request the latest construction update from our advisor.")}
        </p>
        <div className="flex flex-col sm:flex-row gap-2 justify-center">
          <Button size="sm" onClick={onRetry} variant="outline" className="gap-2">
            <RefreshCw className="w-4 h-4" />
            {t("liveProjects.tryAgain", "Try again")}
          </Button>
          <Button
            size="sm"
            onClick={() => navigate("/consultation")}
            style={{ background: "linear-gradient(135deg,#3bcac4,#005476)" }}
            className="text-white gap-2"
          >
            <CalendarDays className="w-4 h-4" />
            {t("liveProjects.requestConsultation", "Request Consultation")}
          </Button>
          <Button size="sm" onClick={() => navigate("/ai-advisor")} variant="outline" className="gap-2">
            <Bot className="w-4 h-4 text-[#3bcac4]" />
            {t("liveProjects.contactAdvisor", "Contact AI Advisor")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Live Camera Viewer ─────────────────────────────────────────────────────
function LiveViewer({ project, t }: { project: Property; t: (k: string, fb: string) => string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const liveStatus = (project as any).liveStatus as string | null;
  const liveEmbedUrl = (project as any).liveEmbedUrl as string | null;
  const liveTitle = (project as any).liveTitle as string | null;

  const handleRetry = () => { setError(false); setLoading(true); setRetryKey(k => k + 1); };

  const handleFullscreen = () => {
    if (iframeRef.current?.requestFullscreen) iframeRef.current.requestFullscreen();
  };

  if (liveStatus === "unavailable" || !liveEmbedUrl) {
    return <CameraFallback onRetry={() => {}} t={t} />;
  }

  if (liveStatus === "maintenance") {
    return (
      <div className="w-full aspect-video rounded-2xl flex flex-col items-center justify-center gap-3 bg-gradient-to-br from-amber-50 to-amber-100 border-2 border-amber-200">
        <Camera className="w-12 h-12 text-amber-400" />
        <p className="font-semibold text-amber-700">
          {t("liveProjects.underMaintenance", "Camera under maintenance")}
        </p>
        <p className="text-sm text-amber-500">{liveTitle || project.title}</p>
      </div>
    );
  }

  return (
    <div className="relative rounded-2xl overflow-hidden bg-black shadow-2xl group">
      {/* Top bar */}
      <div className="absolute top-3 left-3 right-3 z-10 flex items-center justify-between">
        <LiveBadge status={liveStatus} t={t} />
        <button
          onClick={handleFullscreen}
          className="w-8 h-8 rounded-full bg-black/50 flex items-center justify-center text-white hover:bg-black/70 transition-colors opacity-0 group-hover:opacity-100"
        >
          <Maximize2 className="w-4 h-4" />
        </button>
      </div>

      {/* Bottom overlay */}
      <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-4 py-3">
        <p className="text-white font-semibold text-sm">{liveTitle || project.title}</p>
        <p className="text-white/60 text-xs">{project.location}</p>
      </div>

      {/* Loading skeleton */}
      {loading && !error && (
        <div className="absolute inset-0 z-20 bg-gray-900 flex flex-col items-center justify-center gap-3">
          <Camera className="w-12 h-12 text-gray-600" />
          <p className="text-sm text-gray-400">Loading live stream…</p>
        </div>
      )}

      {/* Error fallback */}
      {error && (
        <div className="absolute inset-0 z-20 bg-white">
          <CameraFallback onRetry={handleRetry} t={t} />
        </div>
      )}

      {/* iframe */}
      <div className="w-full aspect-video">
        <iframe
          key={retryKey}
          ref={iframeRef}
          src={liveEmbedUrl}
          className="w-full h-full border-0"
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture"
          allowFullScreen
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setError(true); }}
          title={liveTitle || project.title}
          sandbox="allow-scripts allow-same-origin allow-presentation allow-forms"
        />
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
export default function LiveProjects() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language;
  const isRtl = lang === "ar" || lang === "he" || lang === "fa";

  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [selectedCity, setSelectedCity] = useState<string | null>(null);
  const [selectedProject, setSelectedProject] = useState<Property | null>(null);

  const { data: rawProjects = [], isLoading } = useQuery<Property[]>({
    queryKey: ["/api/live-projects"],
    queryFn: () => fetch("/api/live-projects").then(r => r.json()),
  });

  // Only projects with liveEnabled and a valid embed URL
  const projects = rawProjects.filter(p => (p as any).liveEnabled && (p as any).liveEmbedUrl);

  // Derived filters
  const availableCountries = [...new Set(projects.map(p => (p as any).liveCountry).filter(Boolean))] as string[];
  const citiesForCountry = [...new Set(
    projects.filter(p => (p as any).liveCountry === selectedCountry).map(p => (p as any).liveCity).filter(Boolean)
  )] as string[];
  const projectsForCity = projects.filter(
    p => (p as any).liveCountry === selectedCountry && (p as any).liveCity === selectedCity
  );

  const handleCountrySelect = (country: string) => {
    setSelectedCountry(country);
    setSelectedCity(null);
    setSelectedProject(null);
  };

  const handleCitySelect = (city: string) => {
    setSelectedCity(city);
    setSelectedProject(null);
  };

  // Typed t() helper (avoids TypeScript complaints about overloads)
  const tr = (key: string, fallback: string) => t(key, fallback);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-[#f0fdfc]" dir={isRtl ? "rtl" : "ltr"}>

      {/* ── Hero ─────────────────────────────────────────────────────── */}
      <div className="text-white pt-10 pb-16 px-4" style={{ background: "linear-gradient(135deg,#3bcac4 0%,#005476 100%)" }}>
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-white/20 rounded-full px-4 py-1.5 mb-4">
            <span className="w-2 h-2 bg-red-400 rounded-full animate-ping" />
            <span className="text-sm font-bold tracking-widest">
              {tr("liveProjects.badge", "LIVE CAMERAS")}
            </span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold mb-3">
            {tr("liveProjects.title", "Live Projects")}
          </h1>
          <p className="text-white/80 text-base max-w-lg mx-auto">
            {tr("liveProjects.subtitle", "Watch real-time construction progress on our premium projects via live streaming cameras.")}
          </p>
          {projects.length > 0 && (
            <p className="text-white/60 text-sm mt-2">
              {t("liveProjects.projectsAvailable", { count: projects.length, defaultValue: "{{count}} live projects available" })}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 -mt-8 pb-24">

        {/* ── Loading ─────────────────────────────────────────────────── */}
        {isLoading && (
          <div className="bg-white rounded-2xl shadow-md p-12 flex justify-center">
            <Loader2 className="w-8 h-8 animate-spin text-[#3bcac4]" />
          </div>
        )}

        {/* ── No cameras yet ───────────────────────────────────────────── */}
        {!isLoading && projects.length === 0 && (
          <div className="bg-white rounded-2xl shadow-md p-12 text-center">
            <Tv className="w-16 h-16 mx-auto mb-4 text-gray-200" />
            <h2 className="text-xl font-bold text-gray-700 mb-2">
              {tr("liveProjects.comingSoon", "Coming Soon — Live Cameras")}
            </h2>
            <p className="text-gray-400 text-sm max-w-sm mx-auto">
              {tr("liveProjects.comingSoonDesc", "We'll be adding live construction cameras to our projects soon. Stay tuned!")}
            </p>
          </div>
        )}

        {!isLoading && projects.length > 0 && (
          <div className="space-y-4">

            {/* ── STEP 1 — Select Country ──────────────────────────────── */}
            <div className="bg-white rounded-2xl shadow-md p-5">
              <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4 text-[#3bcac4]" />
                {tr("liveProjects.step1", "1. Select Country")}
              </h2>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {availableCountries.map(key => {
                  const meta = COUNTRY_META[key] || { flag: "🌍", labelKey: "", fallback: key };
                  const label = meta.labelKey ? t(meta.labelKey, meta.fallback) : meta.fallback;
                  return (
                    <button
                      key={key}
                      onClick={() => handleCountrySelect(key)}
                      className="rounded-xl p-4 border-2 text-center transition-all active:scale-95"
                      style={{
                        borderColor: selectedCountry === key ? "#3bcac4" : "#e5e7eb",
                        background: selectedCountry === key ? "#f0fdfc" : "#fff",
                      }}
                    >
                      <span className="text-3xl block mb-1">{meta.flag}</span>
                      <span className="text-sm font-semibold" style={{ color: selectedCountry === key ? "#005476" : "#374151" }}>
                        {label}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* ── STEP 2 — Select City ────────────────────────────────── */}
            {selectedCountry && citiesForCountry.length > 0 && (
              <div className="bg-white rounded-2xl shadow-md p-5">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-[#3bcac4]" />
                  {tr("liveProjects.step2", "2. Select City")}
                </h2>
                <div className="flex flex-wrap gap-2">
                  {citiesForCountry.map(city => (
                    <button
                      key={city}
                      onClick={() => handleCitySelect(city)}
                      className="rounded-xl px-5 py-3 border-2 text-sm font-semibold transition-all active:scale-95"
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

            {/* ── STEP 3 — Select Project ──────────────────────────────── */}
            {selectedCity && projectsForCity.length > 0 && (
              <div className="bg-white rounded-2xl shadow-md p-5">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-[#3bcac4]" />
                  {tr("liveProjects.step3", "3. Select Project")}
                </h2>
                <div className="space-y-3">
                  {projectsForCity.map(proj => {
                    const isSelected = selectedProject?.id === proj.id;
                    const thumb = (proj as any).liveThumbnail || (proj.images?.[0]);
                    const liveStatus = (proj as any).liveStatus as string;
                    return (
                      <button
                        key={proj.id}
                        onClick={() => setSelectedProject(isSelected ? null : proj)}
                        className="w-full rounded-xl border-2 overflow-hidden text-left transition-all active:scale-[.99]"
                        style={{
                          borderColor: isSelected ? "#3bcac4" : "#e5e7eb",
                          background: isSelected ? "#f0fdfc" : "#fff",
                        }}
                      >
                        <div className="flex items-center gap-4 p-4">
                          <div
                            className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
                            style={{ background: "linear-gradient(135deg,#3bcac4,#005476)" }}
                          >
                            {thumb
                              ? <img src={thumb} alt="" className="w-full h-full object-cover" />
                              : <Camera className="w-6 h-6 text-white/70" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-bold text-gray-900 truncate">{proj.title}</p>
                            <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
                              <MapPin className="w-3 h-3" /> {proj.location}
                            </p>
                            <LiveBadge status={liveStatus} t={tr} />
                          </div>
                          <ChevronRight className="w-5 h-5 flex-shrink-0" style={{ color: isSelected ? "#3bcac4" : "#d1d5db" }} />
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── STEP 4 — Live Stream ─────────────────────────────────── */}
            {selectedProject && (
              <div className="bg-white rounded-2xl shadow-md p-5">
                <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 flex items-center gap-2">
                  <Camera className="w-4 h-4 text-[#3bcac4]" />
                  {tr("liveProjects.step4", "4. Live Stream")}
                </h2>
                <LiveViewer project={selectedProject} t={tr} />
              </div>
            )}

          </div>
        )}
      </div>
    </div>
  );
}
