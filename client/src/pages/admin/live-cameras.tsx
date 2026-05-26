import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, Trash2, Loader2, Camera, Globe, MapPin, Building2,
  Eye, EyeOff, Pencil, CheckCircle, X, Wifi, WifiOff, Clock
} from "lucide-react";
import { ProjectLiveCamera } from "@shared/schema";

const COUNTRIES = [
  { key: "georgia",      label: "🇬🇪 Georgia" },
  { key: "turkey",       label: "🇹🇷 Turkey" },
  { key: "dubai",        label: "🇦🇪 Dubai" },
  { key: "north_cyprus", label: "🇨🇾 North Cyprus" },
];

const STATUS_OPTIONS = [
  { key: "active",      label: "Active (LIVE)", icon: Wifi, color: "text-green-600" },
  { key: "offline",     label: "Offline",        icon: WifiOff, color: "text-gray-500" },
  { key: "coming_soon", label: "Coming Soon",    icon: Clock, color: "text-amber-500" },
];

const STATUS_BADGE: Record<string, string> = {
  active:      "bg-green-100 text-green-700",
  offline:     "bg-gray-100 text-gray-500",
  coming_soon: "bg-amber-100 text-amber-700",
};

const EMPTY_FORM = {
  propertyId: "",
  label: "Main Camera",
  embedUrl: "",
  thumbnailUrl: "",
  country: "georgia",
  city: "",
  isActive: true,
  status: "active",
};

export default function AdminLiveCameras() {
  const { toast } = useToast();

  // Fetch cameras
  const { data: rawCameras, isLoading } = useQuery<ProjectLiveCamera[]>({
    queryKey: ["/api/admin/live-cameras"],
    queryFn: () => fetch("/api/admin/live-cameras").then(r => {
      if (!r.ok) throw new Error("Forbidden");
      return r.json();
    }),
    retry: false,
  });
  const cameras: ProjectLiveCamera[] = Array.isArray(rawCameras) ? rawCameras : [];

  // Form state
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState({ ...EMPTY_FORM });

  const setField = (key: string, val: string | boolean) =>
    setForm(prev => ({ ...prev, [key]: val }));

  // Mutations
  const createMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/live-cameras", {
      ...form,
      propertyId: parseInt(form.propertyId),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/live-cameras"] });
      queryClient.invalidateQueries({ queryKey: ["/api/live-projects"] });
      setForm({ ...EMPTY_FORM }); setShowForm(false);
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

  const startEdit = (cam: ProjectLiveCamera) => {
    setEditingId(cam.id);
    setForm({
      propertyId: String(cam.propertyId),
      label: cam.label,
      embedUrl: cam.embedUrl,
      thumbnailUrl: cam.thumbnailUrl || "",
      country: cam.country,
      city: cam.city,
      isActive: cam.isActive,
      status: cam.status,
    });
    setShowForm(false);
  };

  const handleSubmit = () => {
    if (!form.propertyId || !form.embedUrl || !form.city) {
      toast({ title: "Property ID, embed URL, and city are required", variant: "destructive" });
      return;
    }
    if (editingId !== null) {
      updateMutation.mutate({ id: editingId, data: { ...form, propertyId: parseInt(form.propertyId) } });
    } else {
      createMutation.mutate();
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;

  // ── Render form ───────────────────────────────────────────────────────
  const renderForm = () => (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-bold text-gray-900 flex items-center gap-2">
          <Camera className="w-4 h-4 text-[#3bcac4]" />
          {editingId ? "Edit Camera" : "Add Live Camera"}
        </h3>
        <button onClick={() => { setShowForm(false); setEditingId(null); setForm({ ...EMPTY_FORM }); }}
          className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Property ID <span className="text-red-500">*</span></label>
          <Input type="number" placeholder="e.g. 42" value={form.propertyId}
            onChange={e => setField("propertyId", e.target.value)} dir="ltr" />
          <p className="text-[10px] text-gray-400 mt-0.5">The ID of the property/project to attach this camera to</p>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Camera Label</label>
          <Input placeholder="e.g. Main Camera, North View" value={form.label}
            onChange={e => setField("label", e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold text-gray-600 mb-1 block">iframe Embed URL <span className="text-red-500">*</span></label>
          <Input type="url" placeholder="https://rtsp.me/embed/hGAHYt5D/" value={form.embedUrl}
            onChange={e => setField("embedUrl", e.target.value)} dir="ltr" />
          <p className="text-[10px] text-gray-400 mt-0.5">Only use iframe embed URLs (e.g. rtsp.me/embed/...). Do NOT paste full page URLs.</p>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Thumbnail URL (optional)</label>
          <Input type="url" placeholder="https://..." value={form.thumbnailUrl}
            onChange={e => setField("thumbnailUrl", e.target.value)} dir="ltr" />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Country</label>
          <Select value={form.country} onValueChange={v => setField("country", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {COUNTRIES.map(c => <SelectItem key={c.key} value={c.key}>{c.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">City <span className="text-red-500">*</span></label>
          <Input placeholder="e.g. Batumi, Istanbul" value={form.city}
            onChange={e => setField("city", e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-semibold text-gray-600 mb-1 block">Camera Status</label>
          <Select value={form.status} onValueChange={v => setField("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-3 pt-5">
          <button
            type="button"
            onClick={() => setField("isActive", !form.isActive)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${form.isActive ? "bg-[#3bcac4]" : "bg-gray-200"}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${form.isActive ? "translate-x-6" : "translate-x-1"}`} />
          </button>
          <span className="text-sm text-gray-600">{form.isActive ? "Active (visible to users)" : "Inactive (hidden)"}</span>
        </div>
      </div>

      <div className="flex gap-3">
        <Button onClick={handleSubmit} disabled={isPending}
          style={{ background: "linear-gradient(135deg,#3bcac4,#005476)" }} className="text-white flex-1">
          {isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle className="w-4 h-4 mr-2" />}
          {editingId ? "Save Changes" : "Add Camera"}
        </Button>
        <Button variant="outline" onClick={() => { setShowForm(false); setEditingId(null); setForm({ ...EMPTY_FORM }); }}>
          Cancel
        </Button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="text-white px-4 pt-8 pb-6" style={{ background: "linear-gradient(135deg,#3bcac4 0%,#005476 100%)" }}>
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
          <Button onClick={() => { setShowForm(true); setEditingId(null); setForm({ ...EMPTY_FORM }); }}
            className="bg-white text-[#005476] hover:bg-white/90 font-semibold">
            <Plus className="w-4 h-4 mr-1" /> Add Camera
          </Button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Form */}
        {(showForm || editingId !== null) && renderForm()}

        {/* Camera list */}
        {isLoading ? (
          <div className="flex justify-center py-12"><Loader2 className="animate-spin w-8 h-8 text-[#3bcac4]" /></div>
        ) : cameras.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <Camera className="w-12 h-12 mx-auto mb-3 text-gray-200" />
            <p className="text-gray-400 mb-4">No live cameras configured yet.</p>
            <Button onClick={() => setShowForm(true)}
              style={{ background: "linear-gradient(135deg,#3bcac4,#005476)" }} className="text-white">
              <Plus className="w-4 h-4 mr-2" /> Add Your First Camera
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {cameras.map(cam => (
              <div key={cam.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <div className="flex items-start gap-4">
                  {/* Thumbnail / icon */}
                  <div className="w-16 h-16 rounded-xl overflow-hidden flex-shrink-0 flex items-center justify-center"
                    style={{ background: "linear-gradient(135deg,#3bcac4,#005476)" }}>
                    {cam.thumbnailUrl ? (
                      <img src={cam.thumbnailUrl} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Camera className="w-7 h-7 text-white/70" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span className="font-bold text-gray-900">{cam.label}</span>
                      <Badge className={`text-[10px] font-bold ${STATUS_BADGE[cam.status] || "bg-gray-100 text-gray-500"}`}>
                        {cam.status === "active" ? "● LIVE" : cam.status === "coming_soon" ? "SOON" : "OFFLINE"}
                      </Badge>
                      {!cam.isActive && (
                        <Badge className="text-[10px] bg-gray-100 text-gray-400">Hidden</Badge>
                      )}
                    </div>

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
                      className={`w-8 h-8 rounded-full flex items-center justify-center transition-colors ${cam.isActive ? "bg-green-100 text-green-600 hover:bg-green-200" : "bg-gray-100 text-gray-400 hover:bg-gray-200"}`}
                      title={cam.isActive ? "Deactivate" : "Activate"}
                    >
                      {cam.isActive ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    {/* Edit */}
                    <button onClick={() => startEdit(cam)}
                      className="w-8 h-8 rounded-full flex items-center justify-center bg-blue-50 text-blue-500 hover:bg-blue-100 transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                    {/* Delete */}
                    <button onClick={() => deleteMutation.mutate(cam.id)}
                      disabled={deleteMutation.isPending}
                      className="w-8 h-8 rounded-full flex items-center justify-center bg-red-50 text-red-400 hover:bg-red-100 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
