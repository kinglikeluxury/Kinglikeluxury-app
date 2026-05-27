import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Trash2, Loader2, Camera, Globe, MapPin, Building2,
  Eye, EyeOff, Pencil, CheckCircle, X, Wifi, WifiOff, Clock,
  ChevronRight, AlertCircle
} from "lucide-react";
import { ProjectLiveCamera } from "@shared/schema";

// ── Constants ──────────────────────────────────────────────────────────────

const COUNTRIES = [
  { key: "georgia",      label: "🇬🇪 Georgia" },
  { key: "turkey",       label: "🇹🇷 Turkey" },
  { key: "dubai",        label: "🇦🇪 Dubai" },
  { key: "north_cyprus", label: "🇨🇾 North Cyprus" },
];

const CITIES_BY_COUNTRY: Record<string, string[]> = {
  georgia:      ["Batumi", "Tbilisi", "Kutaisi", "Kobuleti", "Ureki", "Gudauri", "Borjomi"],
  turkey:       ["Istanbul", "Antalya", "Alanya", "Bodrum", "Izmir", "Ankara", "Trabzon"],
  dubai:        ["Dubai Marina", "Downtown Dubai", "Palm Jumeirah", "Business Bay", "JVC", "JBR"],
  north_cyprus: ["Kyrenia", "Famagusta", "Lefkosa", "Iskele", "Guzelyurt", "Bogazici"],
};

// Keywords used to infer which country a property belongs to from its location text
const COUNTRY_KEYWORDS: Record<string, string[]> = {
  georgia:      ["georgia", "batumi", "tbilisi", "kutaisi", "kobuleti", "ureki", "gudauri", "borjomi", "adjara"],
  turkey:       ["turkey", "türkiye", "istanbul", "antalya", "alanya", "bodrum", "izmir", "ankara", "trabzon"],
  dubai:        ["dubai", "uae", "abu dhabi", "sharjah", "emirates"],
  north_cyprus: ["cyprus", "kyrenia", "famagusta", "lefkosa", "iskele", "guzelyurt"],
};

function inferCountry(location: string, liveCountry?: string | null): string | null {
  if (liveCountry) return liveCountry;
  const loc = location.toLowerCase();
  for (const [country, keywords] of Object.entries(COUNTRY_KEYWORDS)) {
    if (keywords.some(kw => loc.includes(kw))) return country;
  }
  return null;
}

function inferCity(location: string, liveCity?: string | null): string | null {
  if (liveCity) return liveCity;
  const loc = location.toLowerCase();
  for (const cities of Object.values(CITIES_BY_COUNTRY)) {
    for (const city of cities) {
      if (loc.includes(city.toLowerCase())) return city;
    }
  }
  return null;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface ProjectOption {
  id: number;
  title: string;
  location: string;
  status: string;
  liveCountry?: string | null;
  liveCity?: string | null;
}

const STATUS_OPTIONS = [
  { key: "active",      label: "Active (LIVE)", icon: Wifi,    color: "text-green-600" },
  { key: "offline",     label: "Offline",       icon: WifiOff, color: "text-gray-500"  },
  { key: "coming_soon", label: "Coming Soon",   icon: Clock,   color: "text-amber-500" },
];

const STATUS_BADGE: Record<string, string> = {
  active:      "bg-green-100 text-green-700",
  offline:     "bg-gray-100 text-gray-500",
  coming_soon: "bg-amber-100 text-amber-700",
};

const EMPTY_FORM = {
  projectId:    null as number | null,
  label:        "Main Camera",
  embedUrl:     "",
  thumbnailUrl: "",
  country:      "georgia",
  city:         "",
  isActive:     true,
  status:       "active",
};

// ── Component ──────────────────────────────────────────────────────────────

export default function AdminLiveCameras() {
  const { toast } = useToast();

  // ── Data fetching ──────────────────────────────────────────────────────
  const { data: rawCameras, isLoading } = useQuery<ProjectLiveCamera[]>({
    queryKey: ["/api/admin/live-cameras"],
    queryFn: () => fetch("/api/admin/live-cameras").then(r => {
      if (!r.ok) throw new Error("Forbidden");
      return r.json();
    }),
    retry: false,
  });
  const cameras: ProjectLiveCamera[] = Array.isArray(rawCameras) ? rawCameras : [];

  const { data: rawProjects } = useQuery<ProjectOption[]>({
    queryKey: ["/api/admin/projects-for-cameras"],
    queryFn: () => fetch("/api/admin/projects-for-cameras").then(r => {
      if (!r.ok) throw new Error("Forbidden");
      return r.json();
    }),
    retry: false,
  });
  const allProjects: ProjectOption[] = Array.isArray(rawProjects) ? rawProjects : [];

  // ── Form state ─────────────────────────────────────────────────────────
  const [showForm, setShowForm]   = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm]           = useState({ ...EMPTY_FORM });

  const setField = (key: string, val: string | boolean | number | null) =>
    setForm(prev => ({ ...prev, [key]: val }));

  // Reset cascading fields when country changes
  const handleCountryChange = (country: string) => {
    setForm(prev => ({ ...prev, country, city: "", projectId: null }));
  };
  // Reset project when city changes
  const handleCityChange = (city: string) => {
    setForm(prev => ({ ...prev, city, projectId: null }));
  };

  // ── Computed: filtered cities & projects ───────────────────────────────
  const availableCities = useMemo(() => {
    return CITIES_BY_COUNTRY[form.country] ?? [];
  }, [form.country]);

  const filteredProjects = useMemo(() => {
    if (!form.country) return allProjects;
    // First pass: match by inferred country
    let byCountry = allProjects.filter(p =>
      inferCountry(p.location, p.liveCountry) === form.country
    );
    // If nothing matched, show all (fallback so admin isn't left with empty list)
    if (byCountry.length === 0) byCountry = allProjects;

    if (!form.city) return byCountry;
    // Second pass: match by city
    const byCity = byCountry.filter(p => {
      const loc = p.location.toLowerCase();
      const inferredCity = inferCity(p.location, p.liveCity);
      return loc.includes(form.city.toLowerCase()) || inferredCity?.toLowerCase() === form.city.toLowerCase();
    });
    return byCity.length > 0 ? byCity : byCountry; // fallback to country-filtered if no city match
  }, [allProjects, form.country, form.city]);

  // Set of property IDs that already have at least one camera
  const propertyIdsWithCameras = useMemo(
    () => new Set(cameras.map(c => c.propertyId)),
    [cameras]
  );

  // ── Mutations ──────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/live-cameras", {
      propertyId: form.projectId,
      label:        form.label,
      embedUrl:     form.embedUrl,
      thumbnailUrl: form.thumbnailUrl,
      country:      form.country,
      city:         form.city,
      isActive:     form.isActive,
      status:       form.status,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/live-cameras"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-projects"] });
      setForm({ ...EMPTY_FORM });
      setShowForm(false);
      toast({ title: "Camera added successfully" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: number; data: any }) =>
      apiRequest("PATCH", `/api/admin/live-cameras/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/live-cameras"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-projects"] });
      setEditingId(null);
      toast({ title: "Camera updated" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/admin/live-cameras/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/live-cameras"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-projects"] });
      toast({ title: "Camera deleted" });
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  // ── Helpers ────────────────────────────────────────────────────────────
  const startEdit = (cam: ProjectLiveCamera) => {
    setEditingId(cam.id);
    setForm({
      projectId:    cam.propertyId,
      label:        cam.label,
      embedUrl:     cam.embedUrl,
      thumbnailUrl: cam.thumbnailUrl || "",
      country:      cam.country,
      city:         cam.city,
      isActive:     cam.isActive,
      status:       cam.status,
    });
    setShowForm(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const closeForm = () => {
    setShowForm(false);
    setEditingId(null);
    setForm({ ...EMPTY_FORM });
  };

  const handleSubmit = () => {
    if (!form.projectId) {
      toast({ title: "Please select a project", variant: "destructive" });
      return;
    }
    if (!form.embedUrl) {
      toast({ title: "iframe Embed URL is required", variant: "destructive" });
      return;
    }
    if (!form.city) {
      toast({ title: "Please select a city", variant: "destructive" });
      return;
    }
    if (editingId !== null) {
      updateMutation.mutate({
        id: editingId,
        data: {
          propertyId:   form.projectId,
          label:        form.label,
          embedUrl:     form.embedUrl,
          thumbnailUrl: form.thumbnailUrl || null,
          country:      form.country,
          city:         form.city,
          isActive:     form.isActive,
          status:       form.status,
        },
      });
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  // Find the selected project object
  const selectedProject = form.projectId
    ? allProjects.find(p => p.id === form.projectId) ?? null
    : null;

  // ── Render form ────────────────────────────────────────────────────────
  const renderForm = () => (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <Camera className="w-4 h-4 text-[#3bcac4]" />
          {editingId ? "Edit Camera" : "Add Live Camera"}
        </h3>
        <button onClick={closeForm}
          className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* ── Step 1: Country ── */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: "linear-gradient(135deg,#3bcac4,#005476)" }}>1</div>
          <span className="text-sm font-semibold text-gray-700">Select Country</span>
        </div>
        <Select value={form.country} onValueChange={handleCountryChange}>
          <SelectTrigger className="h-11">
            <SelectValue placeholder="Select country…" />
          </SelectTrigger>
          <SelectContent>
            {COUNTRIES.map(c => (
              <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Step 2: City ── */}
      <div className={`mb-6 transition-opacity ${form.country ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: form.country ? "linear-gradient(135deg,#3bcac4,#005476)" : "#d1d5db" }}>2</div>
          <span className="text-sm font-semibold text-gray-700">Select City</span>
          {form.country && !form.city && (
            <span className="text-xs text-gray-400 ml-1">— choose a city to filter projects</span>
          )}
        </div>
        <Select
          value={form.city || "__none__"}
          onValueChange={v => handleCityChange(v === "__none__" ? "" : v)}
          disabled={!form.country}
        >
          <SelectTrigger className="h-11">
            <SelectValue placeholder="Select city…" />
          </SelectTrigger>
          <SelectContent>
            {availableCities.map(city => (
              <SelectItem key={city} value={city}>
                <span className="flex items-center gap-2">
                  <MapPin className="w-3.5 h-3.5 text-gray-400" />
                  {city}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* ── Step 3: Project ── */}
      <div className={`mb-6 transition-opacity ${form.city ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
            style={{ background: form.city ? "linear-gradient(135deg,#3bcac4,#005476)" : "#d1d5db" }}>3</div>
          <span className="text-sm font-semibold text-gray-700">Select Project</span>
          {filteredProjects.length > 0 && form.city && (
            <span className="text-xs text-gray-400 ml-1">— {filteredProjects.length} project{filteredProjects.length !== 1 ? "s" : ""} found</span>
          )}
        </div>

        <Select
          value={form.projectId ? String(form.projectId) : "__none__"}
          onValueChange={v => {
            if (v === "__none__") { setField("projectId", null); return; }
            const pid = parseInt(v);
            const proj = allProjects.find(p => p.id === pid);
            setForm(prev => ({
              ...prev,
              projectId: pid,
              label: proj ? proj.title : prev.label,
            }));
          }}
          disabled={!form.city}
        >
          <SelectTrigger className="h-11">
            <SelectValue placeholder="Select project…" />
          </SelectTrigger>
          <SelectContent className="max-h-72">
            {filteredProjects.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-400 text-center">
                No projects found for this location
              </div>
            ) : (
              filteredProjects.map(proj => {
                const hasCamera = propertyIdsWithCameras.has(proj.id);
                return (
                  <SelectItem key={proj.id} value={String(proj.id)}>
                    <div className="flex items-center gap-2 w-full">
                      <Building2 className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                      <span className="flex-1 truncate max-w-[220px]">{proj.title}</span>
                      {hasCamera && (
                        <span className="ml-auto text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 flex-shrink-0">
                          📷 Camera exists
                        </span>
                      )}
                    </div>
                  </SelectItem>
                );
              })
            )}
          </SelectContent>
        </Select>

        {/* Selected project info card */}
        {selectedProject && (
          <div className={`mt-3 rounded-xl px-4 py-3 border flex items-start gap-3 ${
            propertyIdsWithCameras.has(selectedProject.id)
              ? "bg-amber-50 border-amber-200"
              : "bg-teal-50 border-teal-200"
          }`}>
            <Building2 className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
              propertyIdsWithCameras.has(selectedProject.id) ? "text-amber-500" : "text-[#3bcac4]"
            }`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-gray-800 truncate">{selectedProject.title}</p>
              <p className="text-xs text-gray-500 mt-0.5 flex items-center gap-1">
                <MapPin className="w-3 h-3" /> {selectedProject.location}
              </p>
              {propertyIdsWithCameras.has(selectedProject.id) && (
                <p className="text-xs font-medium text-amber-600 mt-1.5 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" />
                  Live camera already added — adding another will create a second view
                </p>
              )}
            </div>
            <span className="text-[10px] text-gray-400 flex-shrink-0">ID #{selectedProject.id}</span>
          </div>
        )}
      </div>

      {/* ── Camera details (shown after project selection) ── */}
      <div className={`transition-opacity ${form.projectId ? "opacity-100" : "opacity-40 pointer-events-none"}`}>
        <div className="border-t border-gray-100 pt-5 mb-4">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-4">Camera Details</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Label */}
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Camera Label</label>
              <Input
                placeholder="e.g. Main Camera, North View"
                value={form.label}
                onChange={e => setField("label", e.target.value)}
                disabled={!form.projectId}
              />
            </div>

            {/* Status */}
            <div>
              <label className="text-xs font-semibold text-gray-600 mb-1 block">Camera Status</label>
              <Select value={form.status} onValueChange={v => setField("status", v)} disabled={!form.projectId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Embed URL */}
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-gray-600 mb-1 block">
                iframe Embed URL <span className="text-red-500">*</span>
              </label>
              <Input
                type="url"
                placeholder="https://rtsp.me/embed/hGAHYt5D/"
                value={form.embedUrl}
                onChange={e => setField("embedUrl", e.target.value)}
                dir="ltr"
                disabled={!form.projectId}
              />
              <p className="text-[10px] text-gray-400 mt-0.5">
                Only use iframe embed URLs (e.g. rtsp.me/embed/…). Do NOT paste full page URLs.
              </p>
            </div>

            {/* Thumbnail */}
            <div className="sm:col-span-2">
              <label className="text-xs font-semibold text-gray-600 mb-1 block">
                Thumbnail URL <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <Input
                type="url"
                placeholder="https://…"
                value={form.thumbnailUrl}
                onChange={e => setField("thumbnailUrl", e.target.value)}
                dir="ltr"
                disabled={!form.projectId}
              />
            </div>

            {/* Active toggle */}
            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                onClick={() => setField("isActive", !form.isActive)}
                disabled={!form.projectId}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  form.isActive ? "bg-[#3bcac4]" : "bg-gray-200"
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  form.isActive ? "translate-x-6" : "translate-x-1"
                }`} />
              </button>
              <span className="text-sm text-gray-600">
                {form.isActive ? "Active — visible to users" : "Inactive — hidden from users"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex gap-3">
          <Button
            onClick={handleSubmit}
            disabled={isPending || !form.projectId}
            style={{ background: "linear-gradient(135deg,#3bcac4,#005476)" }}
            className="text-white flex-1"
          >
            {isPending
              ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              : <CheckCircle className="w-4 h-4 mr-2" />}
            {editingId ? "Save Changes" : "Add Camera"}
          </Button>
          <Button variant="outline" onClick={closeForm}>Cancel</Button>
        </div>
      </div>
    </div>
  );

  // ── Main render ────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="text-white px-4 pt-8 pb-6"
        style={{ background: "linear-gradient(135deg,#3bcac4 0%,#005476 100%)" }}>
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Camera className="w-6 h-6" /> Live Construction Cameras
            </h1>
            <p className="text-white/70 text-sm mt-1">
              {cameras.length} camera{cameras.length !== 1 ? "s" : ""} configured ·{" "}
              {cameras.filter(c => c.status === "active" && c.isActive).length} live
            </p>
          </div>
          <Button
            onClick={() => { setShowForm(true); setEditingId(null); setForm({ ...EMPTY_FORM }); }}
            className="bg-white text-[#005476] hover:bg-white/90 font-semibold"
          >
            <Plus className="w-4 h-4 mr-1" /> Add Camera
          </Button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Form */}
        {(showForm || editingId !== null) && renderForm()}

        {/* Camera list */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="animate-spin w-8 h-8 text-[#3bcac4]" />
          </div>
        ) : cameras.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <Camera className="w-12 h-12 mx-auto mb-3 text-gray-200" />
            <p className="text-gray-400 mb-4">No live cameras configured yet.</p>
            <Button
              onClick={() => setShowForm(true)}
              style={{ background: "linear-gradient(135deg,#3bcac4,#005476)" }}
              className="text-white"
            >
              <Plus className="w-4 h-4 mr-2" /> Add Your First Camera
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {cameras.map(cam => {
              const proj = allProjects.find(p => p.id === cam.propertyId);
              return (
                <div key={cam.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                  <div className="flex items-start gap-4">
                    {/* Thumbnail / icon */}
                    <div
                      className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
                      style={{ background: "linear-gradient(135deg,#3bcac4,#005476)" }}
                    >
                      {cam.thumbnailUrl
                        ? <img src={cam.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                        : <Camera className="w-7 h-7 text-white/70" />}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 mb-1">
                        <span className="font-bold text-gray-900">{cam.label}</span>
                        <Badge className={`text-[10px] font-bold ${STATUS_BADGE[cam.status] || "bg-gray-100 text-gray-500"}`}>
                          {cam.status === "active" ? "● LIVE" : cam.status === "coming_soon" ? "SOON" : "OFFLINE"}
                        </Badge>
                        {!cam.isActive && (
                          <Badge className="text-[10px] bg-gray-100 text-gray-400">Hidden</Badge>
                        )}
                      </div>

                      {proj && (
                        <p className="text-sm font-medium text-[#005476] mb-1 truncate">{proj.title}</p>
                      )}

                      <div className="flex flex-wrap gap-3 text-xs text-gray-500 mb-3">
                        <span className="flex items-center gap-1">
                          <Building2 className="w-3 h-3" /> Property #{cam.propertyId}
                        </span>
                        <span className="flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          {COUNTRIES.find(c => c.key === cam.country)?.label || cam.country}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="w-3 h-3" /> {cam.city}
                        </span>
                      </div>

                      <div className="bg-gray-50 rounded-lg px-3 py-1.5 font-mono text-xs text-gray-600 truncate" dir="ltr">
                        {cam.embedUrl}
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {/* Toggle active */}
                      <button
                        onClick={() => updateMutation.mutate({ id: cam.id, data: { isActive: !cam.isActive } })}
                        className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                          cam.isActive
                            ? "bg-green-100 text-green-600 hover:bg-green-200"
                            : "bg-gray-100 text-gray-400 hover:bg-gray-200"
                        }`}
                        title={cam.isActive ? "Deactivate" : "Activate"}
                      >
                        {cam.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                      </button>
                      {/* Edit */}
                      <button
                        onClick={() => startEdit(cam)}
                        className="w-8 h-8 rounded-full flex items-center justify-center bg-blue-50 text-blue-500 hover:bg-blue-100 transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      {/* Delete */}
                      <button
                        onClick={() => deleteMutation.mutate(cam.id)}
                        disabled={deleteMutation.isPending}
                        className="w-8 h-8 rounded-full flex items-center justify-center bg-red-50 text-red-400 hover:bg-red-100 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
