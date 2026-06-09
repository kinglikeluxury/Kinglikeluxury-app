import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Building2, CheckCircle2, AlertCircle, Clock, XCircle,
  RefreshCw, Eye, ExternalLink, Copy, ShieldCheck, ShieldOff,
  Plus, Loader2, ChevronRight, RotateCcw, FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  pending:               { label: "Pending",              color: "bg-slate-100 text-slate-600 border border-slate-300" },
  prepared:              { label: "Prepared",             color: "bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40" },
  submitted:             { label: "Submitted",            color: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  failed:                { label: "Failed",               color: "bg-red-50 text-red-600 border border-red-200" },
  duplicate:             { label: "Duplicate",            color: "bg-gray-100 text-gray-500 border border-gray-200" },
  needs_review:          { label: "Needs Review",         color: "bg-amber-50 text-amber-700 border border-amber-200" },
  stopped:               { label: "Stopped",              color: "bg-slate-200 text-slate-600 border border-slate-300" },
  pending_re_registration: { label: "Re-Registration Due", color: "bg-purple-50 text-purple-700 border border-purple-200" },
};

const PROT_CONFIG: Record<string, { label: string; color: string }> = {
  protected: { label: "Protected",  color: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  expired:   { label: "Expired",    color: "bg-orange-50 text-orange-600 border border-orange-200" },
  stopped:   { label: "Stopped",    color: "bg-slate-100 text-slate-500 border border-slate-200" },
  sold:      { label: "Sold",       color: "bg-[#005476]/10 text-[#005476] border border-[#005476]/30" },
};

function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; color: string }> }) {
  const cfg = map[status] ?? { label: status, color: "bg-gray-100 text-gray-500 border border-gray-200" };
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.color}`}>{cfg.label}</span>;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-[#005476]">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}

// ── Payload modal ─────────────────────────────────────────────────────────────

function PayloadModal({ recordId, onClose }: { recordId: number; onClose: () => void }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/developer-registration", recordId, "payload"],
    queryFn: () => apiRequest("GET", `/api/admin/developer-registration/${recordId}/payload`).then(r => r.json()),
  });

  const payload = data?.registration_payload_json
    ? (typeof data.registration_payload_json === "string"
        ? JSON.parse(data.registration_payload_json)
        : data.registration_payload_json)
    : null;

  function copyAll() {
    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    toast({ title: "Copied!", description: "Full payload copied to clipboard." });
  }

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-[#005476] flex items-center gap-2">
          <FileText className="h-5 w-5 text-[#3bcac4]" />
          Prepared Payload — {data?.developer_name}
        </DialogTitle>
      </DialogHeader>

      {isLoading && <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-[#3bcac4]" /></div>}

      {!isLoading && payload && (
        <>
          <div className="grid grid-cols-1 gap-2">
            {Object.entries(payload).map(([key, value]) => (
              <div key={key} className="flex items-start gap-3 p-2.5 rounded-lg bg-[#005476]/3 border border-[#3bcac4]/15">
                <span className="text-[10px] font-bold text-[#005476] min-w-[120px] pt-0.5">{key}</span>
                <span className="text-xs text-[#005476]/80 break-all flex-1" dir={String(value).match(/[\u0600-\u06FF]/) ? "rtl" : "ltr"}>
                  {String(value) || <em className="opacity-40">empty</em>}
                </span>
                <button
                  className="text-[#3bcac4] hover:text-[#005476] transition-colors shrink-0"
                  onClick={() => {
                    navigator.clipboard.writeText(String(value));
                    toast({ title: "Copied", description: `${key} copied` });
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          {data?.form_url && (
            <>
              <Separator />
              <a
                href={data.form_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-[#3bcac4] hover:text-[#005476] font-medium"
              >
                <ExternalLink className="h-4 w-4" />
                Open Developer Registration Form
              </a>
            </>
          )}
        </>
      )}

      {data?.last_error && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">
          <strong>Review note:</strong> {data.last_error}
        </div>
      )}

      <DialogFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
        {payload && (
          <Button size="sm" className="bg-gradient-to-r from-[#3bcac4] to-[#005476] gap-2" onClick={copyAll}>
            <Copy className="h-3.5 w-3.5" /> Copy All Fields
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

// ── Add / Edit company modal ───────────────────────────────────────────────────

function CompanyModal({
  company,
  onClose,
  onSaved,
}: {
  company?: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const [name, setName]           = useState(company?.name ?? "");
  const [formUrl, setFormUrl]     = useState(company?.form_url ?? "");
  const [interval, setInterval]   = useState(String(company?.registration_interval_days ?? 40));
  const [mode, setMode]           = useState(company?.registration_mode ?? "manual");
  const [active, setActive]       = useState(company?.is_active ?? true);
  const [configJson, setConfigJson] = useState(
    company?.config_json
      ? JSON.stringify(typeof company.config_json === "string" ? JSON.parse(company.config_json) : company.config_json, null, 2)
      : JSON.stringify({
          field_mappings: {},
          required_fields: [],
          default_values: {},
          payload_rules: { use_lead_full_name_as_contact_name: true, use_lead_phone_as_contact_phone: true, generate_stable_contact_id: true, contact_email_override: "info@kinglikeluxury.com" },
          representative_settings: {},
          compatibility_checker_result: { can_auto_fill: false, risk_level: "medium", last_checked_at: null, notes: "Phase 1 — manual workflow only" },
          risk_level: "medium",
          notes: "",
        }, null, 2)
  );
  const [jsonError, setJsonError] = useState("");
  const [saving, setSaving]       = useState(false);

  function validateJson() {
    try { JSON.parse(configJson); setJsonError(""); return true; }
    catch (e: any) { setJsonError(e.message); return false; }
  }

  async function save() {
    if (!validateJson()) return;
    setSaving(true);
    try {
      if (company?.id) {
        await apiRequest("PATCH", `/api/admin/developer-registration/companies/${company.id}`, {
          name, form_url: formUrl, registration_interval_days: parseInt(interval, 10),
          registration_mode: mode, is_active: active, config_json: JSON.parse(configJson),
        });
      } else {
        await apiRequest("POST", "/api/admin/developer-registration/companies", {
          name, form_url: formUrl, registration_interval_days: parseInt(interval, 10),
          registration_mode: mode, is_active: active, config_json: JSON.parse(configJson),
        });
      }
      toast({ title: "Saved", description: `${name} ${company?.id ? "updated" : "added"} successfully.` });
      onSaved();
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally { setSaving(false); }
  }

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-[#005476]">
          {company?.id ? "Edit Developer Company" : "Add Developer Company"}
        </DialogTitle>
      </DialogHeader>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Company Name *</Label>
            <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Silk Development" />
          </div>
          <div className="space-y-1.5">
            <Label>Registration Form URL</Label>
            <Input value={formUrl} onChange={e => setFormUrl(e.target.value)} placeholder="https://..." />
          </div>
          <div className="space-y-1.5">
            <Label>Re-registration Interval (days)</Label>
            <Input type="number" value={interval} onChange={e => setInterval(e.target.value)} min="1" />
          </div>
          <div className="space-y-1.5">
            <Label>Mode</Label>
            <Input value={mode} onChange={e => setMode(e.target.value)} placeholder="manual" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={active} onCheckedChange={setActive} />
          <Label>{active ? "Active" : "Inactive"}</Label>
        </div>

        <div className="space-y-1.5">
          <Label>Field Config JSON</Label>
          <Textarea
            value={configJson}
            onChange={e => { setConfigJson(e.target.value); setJsonError(""); }}
            onBlur={validateJson}
            rows={14}
            className="font-mono text-xs"
          />
          {jsonError && <p className="text-xs text-red-500">{jsonError}</p>}
        </div>
      </div>

      <DialogFooter className="gap-2">
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button
          className="bg-gradient-to-r from-[#3bcac4] to-[#005476]"
          disabled={saving || !name.trim()}
          onClick={save}
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {company?.id ? "Save Changes" : "Add Developer"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DeveloperRegistrationCenterPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ALL state hooks unconditionally at top
  const [payloadRecordId, setPayloadRecordId] = useState<number | null>(null);
  const [editCompany, setEditCompany]         = useState<any | null>(null);
  const [addCompany, setAddCompany]           = useState(false);
  const [statusFilter, setStatusFilter]       = useState("");
  const [failReason, setFailReason]           = useState("");
  const [failRecordId, setFailRecordId]       = useState<number | null>(null);

  // Queries — always called
  const { data: overview } = useQuery<any>({
    queryKey: ["/api/admin/developer-registration/overview"],
    queryFn: () => apiRequest("GET", "/api/admin/developer-registration/overview").then(r => r.json()),
    enabled: !!user?.isAdmin,
    refetchInterval: 30000,
  });

  const { data: queueData, isLoading: queueLoading, refetch: refetchQueue } = useQuery<any>({
    queryKey: ["/api/admin/developer-registration/queue", statusFilter],
    queryFn: () => apiRequest("GET", `/api/admin/developer-registration/queue${statusFilter ? `?status=${statusFilter}` : ""}`).then(r => r.json()),
    enabled: !!user?.isAdmin,
  });

  const { data: companies, refetch: refetchCompanies } = useQuery<any[]>({
    queryKey: ["/api/admin/developer-registration/companies"],
    queryFn: () => apiRequest("GET", "/api/admin/developer-registration/companies").then(r => r.json()),
    enabled: !!user?.isAdmin,
  });

  // Mutations
  const markSubmittedMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/developer-registration/${id}/mark-submitted`, {}),
    onSuccess: () => { toast({ title: "Marked submitted" }); refetchQueue(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const stopMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/developer-registration/${id}/stop`, {}),
    onSuccess: () => { toast({ title: "Protection stopped" }); refetchQueue(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/developer-registration/${id}/resume`, {}),
    onSuccess: () => { toast({ title: "Protection resumed" }); refetchQueue(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const needsReviewMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/developer-registration/${id}/needs-review`, {}),
    onSuccess: () => { toast({ title: "Flagged for review" }); refetchQueue(); },
  });

  const markFailedMutation = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      apiRequest("POST", `/api/admin/developer-registration/${id}/mark-failed`, { reason }),
    onSuccess: () => { toast({ title: "Marked failed" }); refetchQueue(); setFailRecordId(null); setFailReason(""); },
  });

  const compatCheckMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/developer-registration/companies/${id}/compatibility-check`, {}),
    onSuccess: () => { toast({ title: "Compatibility check run (Phase 1 placeholder)" }); refetchCompanies(); },
  });

  // Auth guard effect
  useEffect(() => {
    if (!authLoading && user !== undefined && !user?.isAdmin) navigate("/");
  }, [authLoading, user, navigate]);

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[#3bcac4]" />
      </div>
    );
  }
  if (!user?.isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <ShieldCheck className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Admin access required.</p>
        </div>
      </div>
    );
  }

  const stats = overview?.stats ?? {};
  const statCards = [
    { label: "Pending",          key: "pending",               icon: <Clock className="h-5 w-5 text-slate-500" />,         color: "bg-slate-100" },
    { label: "Prepared",         key: "prepared",              icon: <FileText className="h-5 w-5 text-[#3bcac4]" />,      color: "bg-[#3bcac4]/10" },
    { label: "Submitted",        key: "submitted",             icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />, color: "bg-emerald-50" },
    { label: "Failed",           key: "failed",                icon: <XCircle className="h-5 w-5 text-red-500" />,         color: "bg-red-50" },
    { label: "Needs Review",     key: "needs_review",          icon: <AlertCircle className="h-5 w-5 text-amber-600" />,   color: "bg-amber-50" },
    { label: "Re-Reg Due",       key: "pending_re_registration", icon: <RotateCcw className="h-5 w-5 text-purple-600" />,  color: "bg-purple-50" },
    { label: "Protected",        key: "_protected",            icon: <ShieldCheck className="h-5 w-5 text-emerald-600" />, color: "bg-emerald-50" },
    { label: "Stopped / Sold",   key: "_stopped",              icon: <ShieldOff className="h-5 w-5 text-slate-500" />,     color: "bg-slate-100" },
  ];

  const records: any[] = queueData?.records ?? [];

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center shrink-0">
          <Building2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold text-[#005476]">Developer Registration Center</h1>
          <p className="text-xs text-muted-foreground">نظام تسجيل العملاء لدى شركات الإنشاء — Phase 1 (Manual)</p>
        </div>
        <Badge className="ml-auto text-[10px] bg-amber-50 text-amber-700 border border-amber-200">
          Phase 1 — No Auto-Submit
        </Badge>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Stat cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3 mb-6">
          {statCards.map(sc => (
            <StatCard
              key={sc.key}
              label={sc.label}
              value={
                sc.key === "_protected" ? (overview?.protected ?? 0) :
                sc.key === "_stopped"   ? (overview?.stopped ?? 0) :
                (stats[sc.key] ?? 0)
              }
              icon={sc.icon}
              color={sc.color}
            />
          ))}
        </div>

        <Tabs defaultValue="queue">
          <TabsList className="mb-4">
            <TabsTrigger value="queue">Registration Queue</TabsTrigger>
            <TabsTrigger value="companies">Developer Companies</TabsTrigger>
          </TabsList>

          {/* ── Queue tab ──────────────────────────────────────────────────── */}
          <TabsContent value="queue">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-semibold text-[#005476]">
                    Registration Queue ({queueData?.total ?? 0})
                  </CardTitle>
                  <div className="flex items-center gap-2">
                    <select
                      className="text-xs border rounded-md px-2 py-1 text-[#005476] bg-white"
                      value={statusFilter}
                      onChange={e => setStatusFilter(e.target.value)}
                    >
                      <option value="">All Statuses</option>
                      {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                        <option key={k} value={k}>{v.label}</option>
                      ))}
                    </select>
                    <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => refetchQueue()}>
                      <RefreshCw className="h-3 w-3" /> Refresh
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {queueLoading && (
                  <div className="flex justify-center py-10">
                    <Loader2 className="h-6 w-6 animate-spin text-[#3bcac4]" />
                  </div>
                )}
                {!queueLoading && records.length === 0 && (
                  <div className="text-center py-10 text-muted-foreground text-sm">No records found.</div>
                )}
                {!queueLoading && records.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b bg-[#005476]/3">
                          <th className="text-left px-4 py-2.5 font-semibold text-[#005476]">Lead</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-[#005476]">Developer</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-[#005476]">Status</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-[#005476]">Protection</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-[#005476]">Last Reg</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-[#005476]">Next Reg</th>
                          <th className="text-left px-4 py-2.5 font-semibold text-[#005476] min-w-[240px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map(rec => (
                          <tr key={rec.id} className="border-b hover:bg-gray-50/70 transition-colors">
                            <td className="px-4 py-2.5">
                              <a
                                href={`/admin/crm/${rec.crm_lead_id}`}
                                className="font-semibold text-[#005476] hover:text-[#3bcac4] flex items-center gap-1"
                              >
                                {rec.lead_full_name || rec.lead_first_name || "—"}
                                <ChevronRight className="h-3 w-3 opacity-50" />
                              </a>
                              <span className="text-muted-foreground">{rec.lead_phone ?? "—"}</span>
                            </td>
                            <td className="px-4 py-2.5 font-medium text-[#005476]">{rec.developer_name}</td>
                            <td className="px-4 py-2.5">
                              <StatusBadge status={rec.status} map={STATUS_CONFIG} />
                              {rec.last_error && (
                                <p className="text-[10px] text-amber-600 mt-0.5 max-w-[140px] truncate" title={rec.last_error}>
                                  ⚠ {rec.last_error}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-2.5">
                              <StatusBadge status={rec.protection_status} map={PROT_CONFIG} />
                            </td>
                            <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(rec.last_registered_at)}</td>
                            <td className="px-4 py-2.5 text-muted-foreground">{fmtDate(rec.next_registration_at)}</td>
                            <td className="px-4 py-2.5">
                              <div className="flex items-center gap-1 flex-wrap">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-6 px-2 text-[10px] gap-1"
                                  onClick={() => setPayloadRecordId(rec.id)}
                                >
                                  <Eye className="h-3 w-3" /> Payload
                                </Button>
                                {rec.form_url && (
                                  <a href={rec.form_url} target="_blank" rel="noopener noreferrer">
                                    <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1">
                                      <ExternalLink className="h-3 w-3" /> Form
                                    </Button>
                                  </a>
                                )}
                                {rec.status !== "submitted" && rec.status !== "stopped" && (
                                  <Button
                                    size="sm"
                                    className="h-6 px-2 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                                    disabled={markSubmittedMutation.isPending}
                                    onClick={() => markSubmittedMutation.mutate(rec.id)}
                                  >
                                    <CheckCircle2 className="h-3 w-3" /> Submitted
                                  </Button>
                                )}
                                {rec.status !== "stopped" && (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-[10px] gap-1 text-red-600 border-red-200"
                                    onClick={() => setFailRecordId(rec.id)}
                                  >
                                    <XCircle className="h-3 w-3" /> Failed
                                  </Button>
                                )}
                                {rec.protection_status !== "stopped" && rec.protection_status !== "sold" ? (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-[10px] gap-1 text-slate-600"
                                    disabled={stopMutation.isPending}
                                    onClick={() => stopMutation.mutate(rec.id)}
                                  >
                                    <ShieldOff className="h-3 w-3" /> Stop
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-[10px] gap-1 text-emerald-600 border-emerald-200"
                                    disabled={resumeMutation.isPending}
                                    onClick={() => resumeMutation.mutate(rec.id)}
                                  >
                                    <ShieldCheck className="h-3 w-3" /> Resume
                                  </Button>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Companies tab ──────────────────────────────────────────────── */}
          <TabsContent value="companies">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-[#005476]">
                    Developer Companies ({companies?.length ?? 0})
                  </CardTitle>
                  <Button
                    size="sm"
                    className="bg-gradient-to-r from-[#3bcac4] to-[#005476] gap-2 text-xs"
                    onClick={() => setAddCompany(true)}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add Developer
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                {!companies || companies.length === 0 ? (
                  <div className="text-center py-10 text-muted-foreground text-sm">No developers configured.</div>
                ) : (
                  <div className="divide-y">
                    {companies.map(co => {
                      const cfg = co.config_json
                        ? (typeof co.config_json === "string" ? JSON.parse(co.config_json) : co.config_json)
                        : {};
                      const riskLevel = cfg.risk_level ?? cfg.compatibility_checker_result?.risk_level ?? "—";
                      const lastCheck = cfg.compatibility_checker_result?.last_checked_at;
                      return (
                        <div key={co.id} className="px-5 py-4 hover:bg-gray-50/70 transition-colors">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-semibold text-sm text-[#005476]">{co.name}</span>
                                <Badge className={`text-[10px] ${co.is_active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"}`}>
                                  {co.is_active ? "Active" : "Inactive"}
                                </Badge>
                                <Badge className="text-[10px] bg-[#3bcac4]/10 text-[#005476] border border-[#3bcac4]/20">
                                  {co.registration_mode}
                                </Badge>
                              </div>
                              {co.form_url && (
                                <a href={co.form_url} target="_blank" rel="noopener noreferrer"
                                  className="text-xs text-[#3bcac4] hover:text-[#005476] flex items-center gap-1 mb-1">
                                  <ExternalLink className="h-3 w-3" />
                                  <span className="truncate max-w-[300px]">{co.form_url}</span>
                                </a>
                              )}
                              <div className="flex items-center gap-4 text-[10px] text-muted-foreground flex-wrap">
                                <span>Interval: <strong>{co.registration_interval_days}d</strong></span>
                                <span>Risk: <strong>{riskLevel}</strong></span>
                                <span>Last check: <strong>{lastCheck ? fmtDate(lastCheck) : "Never"}</strong></span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 text-xs gap-1"
                                onClick={() => setEditCompany(co)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 px-2.5 text-xs gap-1"
                                disabled={compatCheckMutation.isPending}
                                onClick={() => compatCheckMutation.mutate(co.id)}
                              >
                                <RefreshCw className="h-3 w-3" /> Check
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-0 shadow-sm mt-4">
              <CardHeader>
                <CardTitle className="text-xs font-semibold text-[#005476]">Future Developers</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  Adding future developer companies (Petra, Gumbati, Next Partners, Ambassadori, Wyndham, Rotana, etc.)
                  requires <strong>no code changes</strong>. Click <em>Add Developer</em> above and fill in the company name,
                  form URL, registration interval, and config JSON with field mappings.
                  New leads will automatically receive registration records for all active developers.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>

      {/* Payload dialog */}
      <Dialog open={payloadRecordId !== null} onOpenChange={open => !open && setPayloadRecordId(null)}>
        {payloadRecordId !== null && (
          <PayloadModal recordId={payloadRecordId} onClose={() => setPayloadRecordId(null)} />
        )}
      </Dialog>

      {/* Add company dialog */}
      <Dialog open={addCompany} onOpenChange={open => { if (!open) setAddCompany(false); }}>
        {addCompany && (
          <CompanyModal onClose={() => setAddCompany(false)} onSaved={() => { setAddCompany(false); refetchCompanies(); }} />
        )}
      </Dialog>

      {/* Edit company dialog */}
      <Dialog open={editCompany !== null} onOpenChange={open => { if (!open) setEditCompany(null); }}>
        {editCompany && (
          <CompanyModal company={editCompany} onClose={() => setEditCompany(null)} onSaved={() => { setEditCompany(null); refetchCompanies(); }} />
        )}
      </Dialog>

      {/* Mark failed dialog */}
      <Dialog open={failRecordId !== null} onOpenChange={open => { if (!open) { setFailRecordId(null); setFailReason(""); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Mark as Failed</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Reason (optional)</Label>
            <Textarea value={failReason} onChange={e => setFailReason(e.target.value)} rows={3} placeholder="Describe what went wrong…" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setFailRecordId(null); setFailReason(""); }}>Cancel</Button>
            <Button
              className="bg-red-600 hover:bg-red-700 text-white"
              disabled={markFailedMutation.isPending}
              onClick={() => failRecordId && markFailedMutation.mutate({ id: failRecordId, reason: failReason })}
            >
              {markFailedMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Mark Failed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
