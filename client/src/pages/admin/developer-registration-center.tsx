import { useState } from "react";
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
  Plus, Loader2, ChevronRight, FileText,
  Send, History, AlertTriangle, Info, Play, CalendarDays,
  TrendingUp, Users, BarChart3, Search,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

// ── Status configs ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; desc: string; color: string }> = {
  pending:                 { label: "Pending",             desc: "Waiting to be prepared",                          color: "bg-slate-100 text-slate-600 border border-slate-300" },
  prepared:                { label: "Prepared",            desc: "Data ready — NOT yet sent to Silk",               color: "bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40" },
  submitting:              { label: "Submitting…",         desc: "HTTP request in progress",                        color: "bg-blue-50 text-blue-700 border border-blue-200" },
  submitted:               { label: "Submitted",           desc: "Manually marked as submitted",                    color: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  success:                 { label: "Success ✓",           desc: "Accepted by Silk — registration confirmed",       color: "bg-emerald-100 text-emerald-800 border border-emerald-300" },
  failed:                  { label: "Failed",              desc: "Not accepted — check audit log",                  color: "bg-red-50 text-red-600 border border-red-200" },
  duplicate:               { label: "Duplicate",           desc: "Already registered",                              color: "bg-gray-100 text-gray-500 border border-gray-200" },
  needs_review:            { label: "Needs Review",        desc: "Flagged for manual review",                       color: "bg-amber-50 text-amber-700 border border-amber-200" },
  login_required:          { label: "⚠ Login Required",   desc: "Ambassadori session expired — re-login needed",   color: "bg-red-50 text-red-700 border border-red-300" },
  stopped:                 { label: "Stopped",             desc: "Protection stopped",                              color: "bg-slate-200 text-slate-600 border border-slate-300" },
  pending_re_registration: { label: "Re-Reg Due",          desc: "Re-registration interval has passed",             color: "bg-purple-50 text-purple-700 border border-purple-200" },
};

const PROT_CONFIG: Record<string, { label: string; color: string }> = {
  protected: { label: "Protected",  color: "bg-emerald-50 text-emerald-700 border border-emerald-200" },
  expired:   { label: "Expired",    color: "bg-orange-50 text-orange-600 border border-orange-200" },
  stopped:   { label: "Stopped",    color: "bg-slate-100 text-slate-500 border border-slate-200" },
  sold:      { label: "Sold",       color: "bg-[#005476]/10 text-[#005476] border border-[#005476]/30" },
};

const ATTEMPT_TYPE_LABELS: Record<string, string> = {
  initial:            "Initial",
  re_registration:    "Re-Registration",
  manual_retry:       "Manual Retry",
  silk_auto:          "Auto (Silk)",
  ambassadori_auto:   "Auto (Ambassadori)",
  manual:             "Manual",
};

function StatusBadge({ status, map }: { status: string; map: Record<string, { label: string; color: string }> }) {
  const cfg = map[status] ?? { label: status, color: "bg-gray-100 text-gray-500 border border-gray-200" };
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full border ${cfg.color}`}>{cfg.label}</span>;
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(d: string | null | undefined) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, color, sub }: { label: string; value: number | string; icon: React.ReactNode; color: string; sub?: string }) {
  return (
    <Card className="border-0 shadow-sm">
      <CardContent className="p-4 flex items-center gap-3">
        <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
          {icon}
        </div>
        <div>
          <p className="text-2xl font-bold text-[#005476]">{value}</p>
          <p className="text-xs text-muted-foreground">{label}</p>
          {sub && <p className="text-[10px] text-[#3bcac4] font-medium">{sub}</p>}
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

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-[#005476] flex items-center gap-2">
          <FileText className="h-5 w-5 text-[#3bcac4]" />
          Prepared Payload — {data?.developer_name}
        </DialogTitle>
      </DialogHeader>

      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
        <p className="text-xs text-amber-700 font-medium">
          Prepared does not mean registered. The lead is registered only after a successful portal confirmation (status = Success ✓).
        </p>
      </div>

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
              <a href={data.form_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-sm text-[#3bcac4] hover:text-[#005476] font-medium">
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
          <Button size="sm" className="bg-gradient-to-r from-[#3bcac4] to-[#005476] gap-2"
            onClick={() => {
              navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
              toast({ title: "Copied!", description: "Full payload copied to clipboard." });
            }}>
            <Copy className="h-3.5 w-3.5" /> Copy All Fields
          </Button>
        )}
      </DialogFooter>
    </DialogContent>
  );
}

// ── Attempts audit modal ──────────────────────────────────────────────────────

function AttemptsModal({ recordId, leadName, onClose }: { recordId: number; leadName: string; onClose: () => void }) {
  const { data: attempts, isLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/developer-registration", recordId, "attempts"],
    queryFn: () =>
      apiRequest("GET", `/api/admin/developer-registration/${recordId}/attempts`).then(r => r.json()),
  });

  const [expanded, setExpanded] = useState<number | null>(null);

  return (
    <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-[#005476] flex items-center gap-2">
          <History className="h-5 w-5 text-[#3bcac4]" />
          Silk Submission Audit — {leadName}
        </DialogTitle>
      </DialogHeader>

      <div className="text-xs text-muted-foreground mb-2">
        Record ID: <strong>#{recordId}</strong> · Destination:{" "}
        <code className="bg-gray-100 px-1 rounded">
          https://system.silkdevelopment.ge/rest/local/api/deal/broker/addDeal.php
        </code>
      </div>

      {isLoading && (
        <div className="flex justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-[#3bcac4]" />
        </div>
      )}

      {!isLoading && (!attempts || attempts.length === 0) && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          <History className="h-8 w-8 mx-auto mb-2 opacity-30" />
          No submission attempts yet for this record.
        </div>
      )}

      {!isLoading && attempts && attempts.length > 0 && (
        <div className="space-y-3">
          {attempts.map((a, idx) => (
            <div key={a.id} className={`rounded-xl border ${a.status === "success" ? "border-emerald-200 bg-emerald-50/40" : "border-red-200 bg-red-50/30"}`}>
              <button
                className="w-full flex items-center justify-between px-4 py-3 text-left"
                onClick={() => setExpanded(expanded === idx ? null : idx)}
              >
                <div className="flex items-center gap-3">
                  {a.status === "success"
                    ? <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    : <XCircle className="h-4 w-4 text-red-500 shrink-0" />}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${a.status === "success" ? "bg-emerald-100 text-emerald-800 border-emerald-300" : "bg-red-50 text-red-600 border-red-200"}`}>
                        {a.status === "success" ? "SUCCESS — Accepted by Silk" : "FAILED — Not accepted"}
                      </span>
                      <span className="text-[10px] bg-[#005476]/10 text-[#005476] border border-[#005476]/20 px-2 py-0.5 rounded-full font-semibold">
                        {ATTEMPT_TYPE_LABELS[a.attempt_type] ?? a.attempt_type}
                      </span>
                      {a.response_status && (
                        <span className="text-[10px] text-muted-foreground">HTTP {a.response_status}</span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{fmtDateTime(a.created_at)}</p>
                  </div>
                </div>
                <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${expanded === idx ? "rotate-90" : ""}`} />
              </button>

              {expanded === idx && (
                <div className="px-4 pb-4 space-y-3 border-t border-inherit">
                  {a.error_message && (
                    <div className="mt-3 bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                      <strong>Error:</strong> {a.error_message}
                    </div>
                  )}
                  <div className="mt-3">
                    <p className="text-[10px] font-bold text-[#005476] mb-1.5 uppercase tracking-wide">Request Payload Sent to Silk</p>
                    <pre className="text-[10px] bg-[#005476]/4 border border-[#3bcac4]/20 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all">
                      {a.payload_json
                        ? JSON.stringify(typeof a.payload_json === "string" ? JSON.parse(a.payload_json) : a.payload_json, null, 2)
                        : "—"}
                    </pre>
                  </div>
                  {a.response_body && (
                    <div>
                      <p className="text-[10px] font-bold text-[#005476] mb-1.5 uppercase tracking-wide">
                        Raw Response Body (HTTP {a.response_status ?? "?"})
                      </p>
                      <pre className="text-[10px] bg-gray-50 border border-gray-200 rounded-lg p-3 overflow-x-auto whitespace-pre-wrap break-all max-h-40">
                        {a.response_body}
                      </pre>
                    </div>
                  )}
                  {a.destination_url && (
                    <p className="text-[10px] text-muted-foreground">
                      Destination: <code className="bg-gray-100 px-1 rounded">{a.destination_url}</code>
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ── Add / Edit company modal ───────────────────────────────────────────────────

function CompanyModal({
  company, onClose, onSaved,
}: { company?: any; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [name, setName]                   = useState(company?.name ?? "");
  const [formUrl, setFormUrl]             = useState(company?.form_url ?? "");
  const [interval, setInterval]           = useState(String(company?.registration_interval_days ?? 30));
  const [mode, setMode]                   = useState(company?.registration_mode ?? "manual");
  const [active, setActive]               = useState(company?.is_active ?? true);
  const [autoRegEnabled, setAutoRegEnabled] = useState(company?.auto_register_enabled ?? true);
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
          registration_mode: mode, is_active: active, auto_register_enabled: autoRegEnabled,
          config_json: JSON.parse(configJson),
        });
      } else {
        await apiRequest("POST", "/api/admin/developer-registration/companies", {
          name, form_url: formUrl, registration_interval_days: parseInt(interval, 10),
          registration_mode: mode, is_active: active, auto_register_enabled: autoRegEnabled,
          config_json: JSON.parse(configJson),
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
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-gray-50">
            <Switch checked={active} onCheckedChange={setActive} />
            <div>
              <Label className="text-sm">{active ? "Active" : "Inactive"}</Label>
              <p className="text-[10px] text-muted-foreground">New leads enqueued only when active</p>
            </div>
          </div>
          <div className="flex items-center gap-3 p-3 rounded-lg border bg-gray-50">
            <Switch checked={autoRegEnabled} onCheckedChange={setAutoRegEnabled} />
            <div>
              <Label className="text-sm">{autoRegEnabled ? "Auto-Register ON" : "Auto-Register OFF"}</Label>
              <p className="text-[10px] text-muted-foreground">Auto-enqueue new leads &amp; re-register on schedule</p>
            </div>
          </div>
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
        <Button className="bg-gradient-to-r from-[#3bcac4] to-[#005476]"
          disabled={saving || !name.trim()} onClick={save}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          {company?.id ? "Save Changes" : "Add Developer"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ── Register With Developer modal ─────────────────────────────────────────────

function RegisterWithDeveloperModal({
  leadId, leadName, leadPhone, companies, onClose, onRegistered,
}: {
  leadId: number; leadName: string; leadPhone: string;
  companies: any[]; onClose: () => void; onRegistered: () => void;
}) {
  const { toast }   = useToast();
  const queryClient = useQueryClient();
  const activeCompanies = (companies ?? []).filter(c => c.is_active);

  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const { data: leadRecords, isLoading: recordsLoading } = useQuery<any[]>({
    queryKey: ["/api/admin/developer-registration/lead", leadId],
    queryFn: () =>
      apiRequest("GET", `/api/admin/developer-registration/lead/${leadId}`).then(r => r.json()),
    enabled: !!leadId,
  });

  const existingByDevId: Record<number, any> = {};
  for (const r of (leadRecords ?? [])) existingByDevId[r.developer_company_id] = r;

  const newCompanies = activeCompanies.filter(c => !existingByDevId[c.id]);

  function toggle(id: number) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function quickSelect(ids: number[]) {
    setSelectedIds(new Set(ids.filter(id => !existingByDevId[id])));
  }

  const registerMutation = useMutation({
    mutationFn: (ids: number[]) =>
      apiRequest("POST", `/api/admin/developer-registration/lead/${leadId}/register-with`, {
        developer_company_ids: ids,
      }).then(r => r.json()),
    onSuccess: (data: any) => {
      const created  = data.created?.length  ?? 0;
      const existing = data.existing?.length ?? 0;
      const errors   = data.errors?.length   ?? 0;
      if (created > 0) {
        toast({
          title: `✅ Registered with ${created} developer${created > 1 ? "s" : ""}`,
          description: [
            existing > 0 ? `${existing} already existed.` : "",
            errors   > 0 ? `${errors} error(s).`          : "",
          ].filter(Boolean).join(" ") || undefined,
        });
      } else if (existing > 0) {
        toast({ title: "All selected developers already have records for this lead." });
      } else {
        toast({ title: "No records created", variant: "destructive" });
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/developer-registration/queue"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/developer-registration/overview"] });
      onRegistered();
      onClose();
    },
    onError: (e: any) =>
      toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const SILK_ID = 1;
  const AMB_ID  = 2;

  return (
    <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle className="text-[#005476] flex items-center gap-2">
          <Building2 className="h-5 w-5 text-[#3bcac4]" />
          Register With Developer
        </DialogTitle>
      </DialogHeader>

      <div className="-mt-2 mb-1">
        <p className="text-sm font-semibold text-[#005476]">{leadName}</p>
        {leadPhone && <p className="text-[11px] text-muted-foreground">{leadPhone}</p>}
      </div>

      {/* Quick action buttons */}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm" variant="outline"
          className="text-xs h-7 gap-1 border-[#3bcac4]/40 text-[#005476]"
          disabled={!!existingByDevId[SILK_ID]}
          onClick={() => quickSelect([SILK_ID])}>
          <Plus className="h-3 w-3" /> Silk Only
          {existingByDevId[SILK_ID] && <span className="text-[9px] opacity-60 ml-0.5">(exists)</span>}
        </Button>
        <Button
          size="sm" variant="outline"
          className="text-xs h-7 gap-1 border-purple-200 text-purple-700"
          disabled={!!existingByDevId[AMB_ID]}
          onClick={() => quickSelect([AMB_ID])}>
          <Plus className="h-3 w-3" /> Ambassadori Only
          {existingByDevId[AMB_ID] && <span className="text-[9px] opacity-60 ml-0.5">(exists)</span>}
        </Button>
        {newCompanies.length > 0 && (
          <Button
            size="sm"
            className="text-xs h-7 gap-1 bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white"
            onClick={() => quickSelect(newCompanies.map(c => c.id))}>
            <Plus className="h-3 w-3" /> All Developers ({newCompanies.length} new)
          </Button>
        )}
        {newCompanies.length === 0 && !recordsLoading && (
          <span className="text-[11px] text-muted-foreground self-center">
            All active developers already have records for this lead.
          </span>
        )}
      </div>

      <Separator />

      {recordsLoading && (
        <div className="flex justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-[#3bcac4]" />
        </div>
      )}

      {!recordsLoading && (
        <div className="space-y-2">
          {activeCompanies.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No active developers configured.</p>
          )}
          {activeCompanies.map(company => {
            const existing   = existingByDevId[company.id];
            const isSelected = selectedIds.has(company.id);
            const isSilk     = company.id === SILK_ID;
            const isAmb      = company.id === AMB_ID || (company.name ?? "").toLowerCase().includes("ambassadori");

            return (
              <div
                key={company.id}
                className={`rounded-lg border p-3 flex items-center justify-between gap-3 transition-colors
                  ${existing
                    ? "bg-gray-50 border-gray-200 cursor-not-allowed"
                    : isSelected
                      ? "bg-[#3bcac4]/8 border-[#3bcac4]/50 cursor-pointer"
                      : "bg-white border-gray-200 hover:border-[#3bcac4]/30 cursor-pointer"
                  }`}
                onClick={() => { if (!existing) toggle(company.id); }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 text-white text-xs font-bold
                    ${isSilk ? "bg-gradient-to-br from-[#3bcac4] to-[#005476]" : isAmb ? "bg-purple-600" : "bg-slate-500"}`}>
                    {company.name.charAt(0)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-[#005476] truncate">{company.name}</p>
                    {existing ? (
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <StatusBadge status={existing.status} map={STATUS_CONFIG} />
                        <StatusBadge status={existing.protection_status} map={PROT_CONFIG} />
                        <span className="text-[10px] text-muted-foreground">Record #{existing.id}</span>
                      </div>
                    ) : (
                      <p className="text-[10px] text-muted-foreground mt-0.5">No record — click to select</p>
                    )}
                  </div>
                </div>
                {existing ? (
                  <span className="text-[10px] text-emerald-600 font-medium shrink-0 flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Exists
                  </span>
                ) : (
                  <div className={`h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors
                    ${isSelected ? "bg-[#3bcac4] border-[#3bcac4]" : "border-gray-300"}`}>
                    {isSelected && <CheckCircle2 className="h-3 w-3 text-white" />}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <DialogFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
        <Button
          size="sm"
          className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white gap-1.5"
          disabled={selectedIds.size === 0 || registerMutation.isPending}
          onClick={() => registerMutation.mutate(Array.from(selectedIds))}>
          {registerMutation.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
            : <Building2 className="h-3.5 w-3.5" />}
          Register with {selectedIds.size > 0
            ? `${selectedIds.size} Developer${selectedIds.size > 1 ? "s" : ""}`
            : "Developer"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ── Per-developer stats table ─────────────────────────────────────────────────

function PerDeveloperTable({ rows }: { rows: any[] }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-[#005476]/5 border-b">
            <th className="text-left px-4 py-2.5 font-semibold text-[#005476]">Developer</th>
            <th className="text-right px-3 py-2.5 font-semibold text-[#005476]">Total</th>
            <th className="text-right px-3 py-2.5 font-semibold text-emerald-700">Success</th>
            <th className="text-right px-3 py-2.5 font-semibold text-red-600">Failed</th>
            <th className="text-right px-3 py-2.5 font-semibold text-slate-500">Stopped</th>
            <th className="text-right px-3 py-2.5 font-semibold text-purple-600">Re-Reg Due</th>
            <th className="text-left px-3 py-2.5 font-semibold text-[#005476]">Last Registered</th>
            <th className="text-left px-3 py-2.5 font-semibold text-[#005476]">Next Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.developerId} className="border-b hover:bg-gray-50/60">
              <td className="px-4 py-2.5 font-semibold text-[#005476]">{r.developerName}</td>
              <td className="px-3 py-2.5 text-right font-bold text-[#005476]">{r.total}</td>
              <td className="px-3 py-2.5 text-right text-emerald-700 font-semibold">{r.success}</td>
              <td className="px-3 py-2.5 text-right text-red-600 font-semibold">{r.failed}</td>
              <td className="px-3 py-2.5 text-right text-slate-500">{r.stopped}</td>
              <td className="px-3 py-2.5 text-right text-purple-600 font-semibold">{r.pendingReReg}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(r.lastRegisteredAt)}</td>
              <td className="px-3 py-2.5 text-muted-foreground">{fmtDate(r.nextDueAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DeveloperRegistrationCenterPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [payloadRecordId, setPayloadRecordId] = useState<number | null>(null);
  const [auditRecordId,   setAuditRecordId]   = useState<number | null>(null);
  const [auditLeadName,   setAuditLeadName]   = useState<string>("");
  const [editCompany,     setEditCompany]     = useState<any | null>(null);
  const [addCompany,      setAddCompany]      = useState(false);
  const [statusFilter,    setStatusFilter]    = useState("");
  const [developerFilter, setDeveloperFilter] = useState("");
  const [searchFilter,    setSearchFilter]    = useState("");
  const [dateFrom,        setDateFrom]        = useState("");
  const [dateTo,          setDateTo]          = useState("");
  const [sourceFilter,    setSourceFilter]    = useState("");
  const [failReason,      setFailReason]      = useState("");
  const [failRecordId,    setFailRecordId]    = useState<number | null>(null);
  const [registerLeadId,  setRegisterLeadId]  = useState<number | null>(null);
  const [registerLeadName, setRegisterLeadName] = useState("");
  const [registerLeadPhone, setRegisterLeadPhone] = useState("");

  const { data: overview, refetch: refetchOverview } = useQuery<any>({
    queryKey: ["/api/admin/developer-registration/overview"],
    queryFn: () => apiRequest("GET", "/api/admin/developer-registration/overview").then(r => r.json()),
    enabled: !!user?.isAdmin,
    refetchInterval: 30000,
  });

  const queueParams = new URLSearchParams();
  if (statusFilter)    queueParams.set("status", statusFilter);
  if (developerFilter) queueParams.set("developer_id", developerFilter);
  if (searchFilter)    queueParams.set("search", searchFilter);
  if (dateFrom)        queueParams.set("date_from", dateFrom);
  if (dateTo)          queueParams.set("date_to", dateTo);
  if (sourceFilter)    queueParams.set("lead_source", sourceFilter);

  const { data: queueData, isLoading: queueLoading, refetch: refetchQueue } = useQuery<any>({
    queryKey: ["/api/admin/developer-registration/queue", statusFilter, developerFilter, searchFilter, dateFrom, dateTo, sourceFilter],
    queryFn: () => {
      const qs = queueParams.toString();
      return apiRequest("GET", `/api/admin/developer-registration/queue${qs ? `?${qs}` : ""}`).then(r => r.json());
    },
    enabled: !!user?.isAdmin,
  });

  const { data: companies, refetch: refetchCompanies } = useQuery<any[]>({
    queryKey: ["/api/admin/developer-registration/companies"],
    queryFn: () => apiRequest("GET", "/api/admin/developer-registration/companies").then(r => r.json()),
    enabled: !!user?.isAdmin,
  });

  const { data: ambSession, refetch: refetchAmbSession } = useQuery<any>({
    queryKey: ["/api/admin/developer-registration/ambassadori/session-status"],
    queryFn: () =>
      apiRequest("GET", "/api/admin/developer-registration/ambassadori/session-status").then(r => r.json()),
    enabled: !!user?.isAdmin,
    refetchInterval: 60000,
  });

  // ── Mutations ───────────────────────────────────────────────────────────────

  const submitToSilkMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/admin/developer-registration/${id}/submit-to-silk`, {}).then(r => r.json()),
    onSuccess: (data: any) => {
      if (data.success) {
        toast({ title: "✅ Accepted by Silk", description: "Registration confirmed — status set to Success." });
      } else {
        toast({
          title: "❌ Silk rejected the submission",
          description: data.errorMessage ?? "Check the audit log for details.",
          variant: "destructive",
        });
      }
      refetchQueue();
      refetchOverview();
    },
    onError: (e: any) =>
      toast({ title: "Submission Error", description: e.message, variant: "destructive" }),
  });

  const submitToAmbassadoriMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/admin/developer-registration/${id}/submit-to-ambassadori`, {}).then(r => r.json()),
    onSuccess: (data: any) => {
      if (data.outcome === "success") {
        toast({
          title: "✅ Ambassadori deal created",
          description: `Registration confirmed${data.dealId ? ` — deal ID: ${data.dealId}` : ""}.`,
        });
      } else if (data.outcome === "protected") {
        toast({
          title: "🛡️ Lead already registered (Ambassadori)",
          description: "Duplicate detected — lead is now marked as protected.",
        });
      } else {
        toast({
          title: "❌ Ambassadori submission failed",
          description: data.errorMessage ?? "Check the audit log for details.",
          variant: "destructive",
        });
      }
      refetchQueue();
      refetchOverview();
    },
    onError: (e: any) =>
      toast({ title: "Ambassadori Error", description: e.message, variant: "destructive" }),
  });

  const submitToAmbassadoriBrowserMutation = useMutation({
    mutationFn: (id: number) =>
      apiRequest("POST", `/api/admin/developer-registration/${id}/submit-to-ambassadori-browser`, {}).then(r => r.json()),
    onSuccess: (data: any) => {
      if (data.outcome === "success") {
        toast({
          title: "✅ Browser deal created",
          description: `Ambassadori registration confirmed${data.dealId ? ` — deal ID: ${data.dealId}` : " (no ID returned)"}`,
        });
      } else if (data.outcome === "protected") {
        toast({ title: "🛡️ Already registered", description: "Lead is a duplicate in the portal." });
      } else if (data.outcome === "login_required") {
        toast({
          title: "🔐 Login Required",
          description: "Ambassadori session expired — please re-login and save session cookies.",
          variant: "destructive",
        });
      } else if (data.outcome === "needs_review") {
        toast({
          title: "⚠ Needs Review",
          description: data.errorMessage ?? "Form submitted but confirmation not detected.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "❌ Browser submission failed",
          description: data.errorMessage ?? "Check the audit log for details.",
          variant: "destructive",
        });
      }
      refetchQueue(); refetchOverview(); refetchAmbSession();
    },
    onError: (e: any) =>
      toast({ title: "Browser Error", description: e.message, variant: "destructive" }),
  });

  const markManuallyConfirmedMutation = useMutation({
    mutationFn: ({ id, dealId }: { id: number; dealId?: string }) =>
      apiRequest("POST", `/api/admin/developer-registration/${id}/mark-manually-confirmed`, { dealId: dealId ?? "" }).then(r => r.json()),
    onSuccess: () => {
      toast({ title: "✅ Marked as confirmed", description: "Record status set to success." });
      refetchQueue(); refetchOverview();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const markSubmittedMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/developer-registration/${id}/mark-submitted`, {}),
    onSuccess: () => { toast({ title: "Marked submitted" }); refetchQueue(); refetchOverview(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const stopMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/developer-registration/${id}/stop`, {}),
    onSuccess: () => { toast({ title: "Protection stopped" }); refetchQueue(); refetchOverview(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const resumeMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/developer-registration/${id}/resume`, {}),
    onSuccess: () => { toast({ title: "Protection resumed" }); refetchQueue(); refetchOverview(); },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
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

  const runDueRegsMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/admin/developer-registration/run-due-registrations", {}).then(r => r.json()),
    onSuccess: (data: any) => {
      toast({
        title: "✅ Re-registration run complete",
        description: `Marked: ${data.marked} · Submitted: ${data.submitted} · Failed: ${data.failed} · Skipped: ${data.skipped}`,
      });
      refetchQueue();
      refetchOverview();
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

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

  const stats    = overview?.stats ?? {};
  const today    = overview?.today ?? { total: 0, success: 0, failed: 0 };
  const perDev   = overview?.perDeveloper ?? [];
  const nextDue  = overview?.nextDueAt;

  const statCards = [
    { label: "Prepared",       key: "prepared",              icon: <FileText className="h-5 w-5 text-[#3bcac4]" />,       color: "bg-[#3bcac4]/10" },
    { label: "Success",        key: "success",               icon: <CheckCircle2 className="h-5 w-5 text-emerald-700" />, color: "bg-emerald-100" },
    { label: "Submitted",      key: "submitted",             icon: <CheckCircle2 className="h-5 w-5 text-emerald-600" />, color: "bg-emerald-50" },
    { label: "Failed",         key: "failed",                icon: <XCircle className="h-5 w-5 text-red-500" />,          color: "bg-red-50" },
    { label: "Needs Review",   key: "needs_review",          icon: <AlertCircle className="h-5 w-5 text-amber-600" />,    color: "bg-amber-50" },
    { label: "Re-Reg Due",     key: "pending_re_registration", icon: <RefreshCw className="h-5 w-5 text-purple-600" />,   color: "bg-purple-50" },
    { label: "Protected",      key: "_protected",            icon: <ShieldCheck className="h-5 w-5 text-emerald-600" />,  color: "bg-emerald-50" },
    { label: "Stopped / Sold", key: "_stopped",              icon: <ShieldOff className="h-5 w-5 text-slate-500" />,      color: "bg-slate-100" },
  ];

  const records: any[] = queueData?.records ?? [];
  const isSilkRecord        = (rec: any) => rec.developer_company_id === 1 || rec.developer_name === "Silk Development";
  const isAmbassadoriRecord = (rec: any) => rec.developer_company_id === 2 || (rec.developer_name ?? "").toLowerCase().includes("ambassadori");
  const isPetraRecord       = (rec: any) => (rec.developer_name ?? "").toLowerCase().includes("petra group");

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 flex items-center gap-4 sticky top-0 z-10">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center shrink-0">
          <Building2 className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold text-[#005476]">Developer Registration Center</h1>
          <p className="text-xs text-muted-foreground">نظام تسجيل العملاء لدى شركات الإنشاء — Phase 3 (Silk + Ambassadori)</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <Badge className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200">
            Silk Active
          </Badge>
          {ambSession?.isLikelyExpired ? (
            <Badge className="text-[10px] bg-red-50 text-red-700 border border-red-300 flex items-center gap-1 cursor-pointer"
              title={`Session saved ${ambSession?.ageHours ?? "?"}h ago — likely expired. Open the portal and re-login.`}>
              <AlertTriangle className="h-3 w-3" /> Amb Session Expired
            </Badge>
          ) : ambSession?.hasSession ? (
            <Badge className="text-[10px] bg-[#3bcac4]/10 text-[#005476] border border-[#3bcac4]/30 flex items-center gap-1"
              title={`Session active — saved ${ambSession?.ageHours ?? "?"}h ago (${ambSession?.cookieCount ?? 0} cookies)`}>
              Ambassadori Active ✓
            </Badge>
          ) : (
            <Badge className="text-[10px] bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1"
              title="No saved browser session — token seed from env will be used on first attempt">
              <AlertTriangle className="h-3 w-3" /> Amb: No Session
            </Badge>
          )}
          <Button
            size="sm"
            className="gap-1.5 text-xs bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white"
            disabled={runDueRegsMutation.isPending}
            onClick={() => runDueRegsMutation.mutate()}
          >
            {runDueRegsMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Play className="h-3.5 w-3.5" />}
            Run Due Re-registrations Now
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-5">

        {/* ── Today's summary strip ──────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Card className="border-0 shadow-sm bg-gradient-to-br from-[#005476] to-[#3bcac4] text-white">
            <CardContent className="p-4 flex items-center gap-3">
              <CalendarDays className="h-8 w-8 opacity-80" />
              <div>
                <p className="text-2xl font-bold">{today.total}</p>
                <p className="text-xs opacity-90">Attempts Today</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                <TrendingUp className="h-5 w-5 text-emerald-700" />
              </div>
              <div>
                <p className="text-2xl font-bold text-emerald-700">{today.success}</p>
                <p className="text-xs text-muted-foreground">Successful Today</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-red-50 flex items-center justify-center">
                <XCircle className="h-5 w-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">{today.failed}</p>
                <p className="text-xs text-muted-foreground">Failed Today</p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4 flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-purple-50 flex items-center justify-center">
                <Clock className="h-5 w-5 text-purple-600" />
              </div>
              <div>
                <p className="text-lg font-bold text-[#005476]">{nextDue ? fmtDate(nextDue) : "—"}</p>
                <p className="text-xs text-muted-foreground">Next Re-Reg Due</p>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── All-time stat cards ─────────────────────────────────────────── */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          {statCards.map(sc => (
            <StatCard
              key={sc.key}
              label={sc.label}
              value={
                sc.key === "_protected" ? (overview?.protected ?? 0) :
                sc.key === "_stopped"   ? (overview?.stopped   ?? 0) :
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
            <TabsTrigger value="reports">
              <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
              Reports
            </TabsTrigger>
            <TabsTrigger value="companies">Developer Companies</TabsTrigger>
            <TabsTrigger value="legend">Status Guide</TabsTrigger>
          </TabsList>

          {/* ── Queue tab ──────────────────────────────────────────────────── */}
          <TabsContent value="queue">
            <div className="mb-4 bg-amber-50 border border-amber-300 rounded-xl p-4 flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800">Prepared does not mean registered.</p>
                <p className="text-xs text-amber-700 mt-0.5">
                  The lead is registered with Silk Development <strong>only after a successful Silk confirmation</strong> (status = Success ✓).
                  Click <em>"Submit to Silk"</em> to send. The system will show Success or Failed based on Silk's actual response.
                </p>
              </div>
            </div>

            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <CardTitle className="text-sm font-semibold text-[#005476]">
                    Registration Queue ({queueData?.total ?? 0})
                  </CardTitle>
                  <Button size="sm" variant="outline" className="gap-1 text-xs" onClick={() => refetchQueue()}>
                    <RefreshCw className="h-3 w-3" /> Refresh
                  </Button>
                </div>

                {/* Filters row */}
                <div className="flex flex-wrap gap-2 mt-2">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      placeholder="Search lead name / phone…"
                      value={searchFilter}
                      onChange={e => setSearchFilter(e.target.value)}
                      className="pl-7 h-8 text-xs w-48"
                    />
                  </div>
                  <select
                    className="text-xs border rounded-md px-2 py-1 text-[#005476] bg-white h-8"
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                  >
                    <option value="">All Statuses</option>
                    {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                      <option key={k} value={k}>{v.label}</option>
                    ))}
                  </select>
                  <select
                    className="text-xs border rounded-md px-2 py-1 text-[#005476] bg-white h-8"
                    value={developerFilter}
                    onChange={e => setDeveloperFilter(e.target.value)}
                  >
                    <option value="">All Developers</option>
                    {(companies ?? []).map(c => (
                      <option key={c.id} value={String(c.id)}>{c.name}</option>
                    ))}
                  </select>
                  <select
                    className="text-xs border rounded-md px-2 py-1 text-[#005476] bg-white h-8"
                    value={sourceFilter}
                    onChange={e => setSourceFilter(e.target.value)}
                  >
                    <option value="">All Sources</option>
                    <option value="meta">Meta</option>
                    <option value="manual">Manual</option>
                    <option value="import">Import</option>
                    <option value="whatsapp">WhatsApp</option>
                    <option value="website">Website</option>
                  </select>
                  <Input
                    type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                    className="h-8 text-xs w-36"
                    title="From date"
                  />
                  <Input
                    type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                    className="h-8 text-xs w-36"
                    title="To date"
                  />
                  {(statusFilter || developerFilter || searchFilter || dateFrom || dateTo || sourceFilter) && (
                    <Button
                      size="sm" variant="ghost" className="h-8 text-xs text-red-500 hover:text-red-700"
                      onClick={() => {
                        setStatusFilter(""); setDeveloperFilter(""); setSearchFilter("");
                        setDateFrom(""); setDateTo(""); setSourceFilter("");
                      }}
                    >
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Clear
                    </Button>
                  )}
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
                          <th className="text-left px-4 py-2.5 font-semibold text-[#005476] min-w-[280px]">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {records.map(rec => {
                          const isSilk         = isSilkRecord(rec);
                          const isAmb          = isAmbassadoriRecord(rec);
                          const isPetra        = isPetraRecord(rec);
                          const canSubmitSilk  = isSilk && !["stopped", "submitting", "success"].includes(rec.status);
                          const canSubmitAmb   = isAmb  && !["stopped", "submitting", "success"].includes(rec.status);

                          return (
                            <tr key={rec.id} className="border-b hover:bg-gray-50/70 transition-colors">
                              <td className="px-4 py-2.5">
                                <a href={`/admin/crm/${rec.crm_lead_id}`}
                                  className="font-semibold text-[#005476] hover:text-[#3bcac4] flex items-center gap-1">
                                  {rec.lead_full_name || rec.lead_first_name || "—"}
                                  <ChevronRight className="h-3 w-3 opacity-50" />
                                </a>
                                <span className="text-muted-foreground">{rec.lead_phone ?? "—"}</span>
                                {rec.lead_source && (
                                  <span className="ml-1 text-[9px] bg-gray-100 text-gray-500 border border-gray-200 px-1 rounded">
                                    {rec.lead_source}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-2.5 font-medium text-[#005476]">
                                {rec.developer_name}
                                {isSilk && (
                                  <span className="ml-1 text-[9px] bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/30 px-1 rounded">Silk</span>
                                )}
                                {isAmb && (
                                  <span className="ml-1 text-[9px] bg-purple-50 text-purple-700 border border-purple-200 px-1 rounded">Amb</span>
                                )}
                              </td>
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
                                  <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1"
                                    onClick={() => setPayloadRecordId(rec.id)}>
                                    <Eye className="h-3 w-3" /> Payload
                                  </Button>
                                  <Button
                                    size="sm" variant="outline"
                                    className="h-6 px-2 text-[10px] gap-1 text-[#005476] border-[#3bcac4]/40"
                                    onClick={() => {
                                      setAuditRecordId(rec.id);
                                      setAuditLeadName(rec.lead_full_name || rec.lead_first_name || "Lead");
                                    }}
                                  >
                                    <History className="h-3 w-3" /> Audit
                                  </Button>
                                  <Button
                                    size="sm" variant="outline"
                                    className="h-6 px-2 text-[10px] gap-1 text-[#3bcac4] border-[#3bcac4]/50 hover:bg-[#3bcac4]/5"
                                    onClick={() => {
                                      setRegisterLeadId(rec.crm_lead_id);
                                      setRegisterLeadName(rec.lead_full_name || rec.lead_first_name || "Lead");
                                      setRegisterLeadPhone(rec.lead_phone ?? "");
                                    }}
                                  >
                                    <Plus className="h-3 w-3" /> Developers
                                  </Button>
                                  {isSilk && canSubmitSilk && (
                                    <Button
                                      size="sm"
                                      className="h-6 px-2 text-[10px] gap-1 bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white"
                                      disabled={submitToSilkMutation.isPending}
                                      onClick={() => submitToSilkMutation.mutate(rec.id)}
                                    >
                                      {submitToSilkMutation.isPending
                                        ? <Loader2 className="h-3 w-3 animate-spin" />
                                        : <Send className="h-3 w-3" />}
                                      Submit to Silk
                                    </Button>
                                  )}
                                  {isAmb && (
                                    <a href="https://broker.islandambassadori.com/deals/create"
                                      target="_blank" rel="noopener noreferrer">
                                      <Button size="sm" variant="outline"
                                        className="h-6 px-2 text-[10px] gap-1 text-purple-700 border-purple-200">
                                        <ExternalLink className="h-3 w-3" /> Portal
                                      </Button>
                                    </a>
                                  )}
                                  {isAmb && canSubmitAmb && (
                                    <>
                                      <Button
                                        size="sm"
                                        className="h-6 px-2 text-[10px] gap-1 bg-purple-600 hover:bg-purple-700 text-white"
                                        disabled={submitToAmbassadoriMutation.isPending}
                                        onClick={() => submitToAmbassadoriMutation.mutate(rec.id)}
                                        title="API submission (token-based)"
                                      >
                                        {submitToAmbassadoriMutation.isPending
                                          ? <Loader2 className="h-3 w-3 animate-spin" />
                                          : <Send className="h-3 w-3" />}
                                        API
                                      </Button>
                                      <Button
                                        size="sm"
                                        className="h-6 px-2 text-[10px] gap-1 bg-gradient-to-r from-purple-600 to-purple-800 hover:opacity-90 text-white"
                                        disabled={submitToAmbassadoriBrowserMutation.isPending}
                                        onClick={() => submitToAmbassadoriBrowserMutation.mutate(rec.id)}
                                        title="Browser automation — fills form exactly as a human would"
                                      >
                                        {submitToAmbassadoriBrowserMutation.isPending
                                          ? <Loader2 className="h-3 w-3 animate-spin" />
                                          : <Play className="h-3 w-3" />}
                                        Browser
                                      </Button>
                                    </>
                                  )}
                                  {isAmb && rec.status !== "success" && (
                                    <Button
                                      size="sm" variant="outline"
                                      className="h-6 px-2 text-[10px] gap-1 text-emerald-700 border-emerald-300 hover:bg-emerald-50"
                                      disabled={markManuallyConfirmedMutation.isPending}
                                      onClick={() => markManuallyConfirmedMutation.mutate({ id: rec.id })}
                                      title="Admin manually confirms this lead was registered in the portal"
                                    >
                                      <CheckCircle2 className="h-3 w-3" /> Confirm ✓
                                    </Button>
                                  )}
                                  {isPetra && rec.status !== "stopped" && (
                                    <a href="https://petragroup.bitrix24.site/crm_form_9zewt/"
                                      target="_blank" rel="noopener noreferrer">
                                      <Button size="sm"
                                        className="h-6 px-2 text-[10px] gap-1 bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90"
                                        title="Open Petra Group Bitrix24 form — fill manually then mark as submitted">
                                        <ExternalLink className="h-3 w-3" /> Petra Form
                                      </Button>
                                    </a>
                                  )}
                                  {isPetra && rec.status !== "submitted" && rec.status !== "stopped" && rec.status !== "success" && (
                                    <Button size="sm"
                                      className="h-6 px-2 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                                      disabled={markSubmittedMutation.isPending}
                                      title="Mark as manually submitted after filling the Petra form"
                                      onClick={() => markSubmittedMutation.mutate(rec.id)}>
                                      <CheckCircle2 className="h-3 w-3" /> Submitted
                                    </Button>
                                  )}
                                  {!isSilk && !isAmb && !isPetra && rec.form_url && (
                                    <a href={rec.form_url} target="_blank" rel="noopener noreferrer">
                                      <Button size="sm" variant="outline" className="h-6 px-2 text-[10px] gap-1">
                                        <ExternalLink className="h-3 w-3" /> Form
                                      </Button>
                                    </a>
                                  )}
                                  {!isSilk && !isAmb && !isPetra && rec.status !== "submitted" && rec.status !== "stopped" && (
                                    <Button size="sm"
                                      className="h-6 px-2 text-[10px] gap-1 bg-emerald-600 hover:bg-emerald-700 text-white"
                                      disabled={markSubmittedMutation.isPending}
                                      onClick={() => markSubmittedMutation.mutate(rec.id)}>
                                      <CheckCircle2 className="h-3 w-3" /> Submitted
                                    </Button>
                                  )}
                                  {rec.status !== "stopped" && rec.status !== "success" && (
                                    <Button size="sm" variant="outline"
                                      className="h-6 px-2 text-[10px] gap-1 text-red-600 border-red-200"
                                      onClick={() => setFailRecordId(rec.id)}>
                                      <XCircle className="h-3 w-3" /> Failed
                                    </Button>
                                  )}
                                  {rec.protection_status !== "stopped" && rec.protection_status !== "sold" ? (
                                    <Button size="sm" variant="outline"
                                      className="h-6 px-2 text-[10px] gap-1 text-slate-600"
                                      disabled={stopMutation.isPending}
                                      onClick={() => stopMutation.mutate(rec.id)}>
                                      <ShieldOff className="h-3 w-3" /> Stop
                                    </Button>
                                  ) : (
                                    <Button size="sm" variant="outline"
                                      className="h-6 px-2 text-[10px] gap-1 text-emerald-600 border-emerald-200"
                                      disabled={resumeMutation.isPending}
                                      onClick={() => resumeMutation.mutate(rec.id)}>
                                      <ShieldCheck className="h-3 w-3" /> Resume
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Reports tab ────────────────────────────────────────────────── */}
          <TabsContent value="reports">
            <div className="space-y-5">

              {/* Today strip */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-[#005476] flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-[#3bcac4]" />
                    Today's Activity
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-4">
                    <div className="text-center p-4 rounded-xl bg-[#005476]/5">
                      <p className="text-3xl font-bold text-[#005476]">{today.total}</p>
                      <p className="text-xs text-muted-foreground mt-1">Total Attempts Today</p>
                    </div>
                    <div className="text-center p-4 rounded-xl bg-emerald-50">
                      <p className="text-3xl font-bold text-emerald-700">{today.success}</p>
                      <p className="text-xs text-muted-foreground mt-1">Successful Today</p>
                    </div>
                    <div className="text-center p-4 rounded-xl bg-red-50">
                      <p className="text-3xl font-bold text-red-600">{today.failed}</p>
                      <p className="text-xs text-muted-foreground mt-1">Failed Today</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Global stats */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-[#005476] flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-[#3bcac4]" />
                    All-Time Summary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                      { label: "Total Prepared",       value: (stats.prepared ?? 0) + (stats.needs_review ?? 0),  color: "text-[#005476]" },
                      { label: "Total Success",         value: stats.success  ?? 0,  color: "text-emerald-700" },
                      { label: "Total Failed",          value: stats.failed   ?? 0,  color: "text-red-600" },
                      { label: "Pending Re-Reg",        value: stats.pending_re_registration ?? 0, color: "text-purple-600" },
                      { label: "Protected Leads",       value: overview?.protected ?? 0, color: "text-emerald-700" },
                      { label: "Stopped / Sold",        value: overview?.stopped ?? 0, color: "text-slate-500" },
                      { label: "Needs Review",          value: stats.needs_review ?? 0, color: "text-amber-600" },
                      { label: "Next Re-Reg Due",       value: nextDue ? fmtDate(nextDue) : "—", color: "text-[#005476]" },
                    ].map(item => (
                      <div key={item.label} className="p-3 rounded-xl border bg-white">
                        <p className={`text-xl font-bold ${item.color}`}>{item.value}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{item.label}</p>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Per-developer breakdown */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-[#005476] flex items-center gap-2">
                    <Users className="h-4 w-4 text-[#3bcac4]" />
                    Leads Registered Per Developer
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <PerDeveloperTable rows={perDev} />
                  {(!perDev || perDev.length === 0) && (
                    <p className="text-center text-muted-foreground text-sm py-6">No developer data available.</p>
                  )}
                </CardContent>
              </Card>

              {/* Scheduler info */}
              <Card className="border-0 shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-semibold text-[#005476] flex items-center gap-2">
                    <Clock className="h-4 w-4 text-[#3bcac4]" />
                    Scheduler Information
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="p-3 rounded-xl bg-[#005476]/5 border border-[#3bcac4]/20">
                      <p className="text-xs font-semibold text-[#005476] mb-1">Daily Auto Re-registration</p>
                      <p className="text-[11px] text-muted-foreground">
                        Runs automatically every 24 hours. Finds all leads with <strong>next_registration_at ≤ today</strong>,
                        marks them as Re-Reg Due, and auto-submits Silk records to the Silk API.
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-[#005476]/5 border border-[#3bcac4]/20">
                      <p className="text-xs font-semibold text-[#005476] mb-1">30-Day Re-registration Rule</p>
                      <p className="text-[11px] text-muted-foreground">
                        After a successful registration, <strong>next_registration_at = success_date + interval_days</strong>.
                        Default interval is 30 days (configurable per developer company).
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-[#005476]/5 border border-[#3bcac4]/20">
                      <p className="text-xs font-semibold text-[#005476] mb-1">Protection Rules</p>
                      <p className="text-[11px] text-muted-foreground">
                        Leads marked as Sold, Stopped, Junk, Not Interested, or Duplicate are
                        automatically excluded from all re-registration runs.
                      </p>
                    </div>
                    <div className="p-3 rounded-xl bg-[#005476]/5 border border-[#3bcac4]/20">
                      <p className="text-xs font-semibold text-[#005476] mb-1">Duplicate Prevention</p>
                      <p className="text-[11px] text-muted-foreground">
                        The scheduler prevents concurrent runs. Each lead is processed only once per run.
                        Use the <strong>"Run Due Re-registrations Now"</strong> button for an immediate manual trigger.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* ── Companies tab ──────────────────────────────────────────────── */}
          <TabsContent value="companies">
            <Card className="border-0 shadow-sm">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-semibold text-[#005476]">
                    Developer Companies ({companies?.length ?? 0})
                  </CardTitle>
                  <Button size="sm" className="bg-gradient-to-r from-[#3bcac4] to-[#005476] gap-2 text-xs"
                    onClick={() => setAddCompany(true)}>
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
                      const isSilkCo  = co.id === 1 || co.name === "Silk Development";
                      const autoReg   = co.auto_register_enabled !== false;
                      return (
                        <div key={co.id} className="px-5 py-4 hover:bg-gray-50/70 transition-colors">
                          <div className="flex items-start justify-between gap-3 flex-wrap">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-semibold text-sm text-[#005476]">{co.name}</span>
                                <Badge className={`text-[10px] ${co.is_active ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-slate-100 text-slate-500 border border-slate-200"}`}>
                                  {co.is_active ? "Active" : "Inactive"}
                                </Badge>
                                <Badge className={`text-[10px] ${autoReg ? "bg-[#3bcac4]/10 text-[#005476] border border-[#3bcac4]/20" : "bg-orange-50 text-orange-600 border border-orange-200"}`}>
                                  {autoReg ? "Auto-Register ON" : "Auto-Register OFF"}
                                </Badge>
                                <Badge className="text-[10px] bg-gray-100 text-gray-600 border border-gray-200">
                                  {co.registration_mode}
                                </Badge>
                                {isSilkCo && (
                                  <Badge className="text-[10px] bg-emerald-100 text-emerald-800 border border-emerald-300">
                                    Silk — Live Submission
                                  </Badge>
                                )}
                                {(co.id === 2 || (co.name ?? "").toLowerCase().includes("ambassadori")) && (
                                  <Badge className="text-[10px] bg-purple-50 text-purple-700 border border-purple-200">
                                    Ambassadori — HTTP Adapter
                                  </Badge>
                                )}
                                {(co.name ?? "").toLowerCase().includes("petra group") && (
                                  <Badge className="text-[10px] bg-[#3bcac4]/10 text-[#005476] border border-[#3bcac4]/30">
                                    Petra — Manual Phase 1
                                  </Badge>
                                )}
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
                              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1"
                                onClick={() => setEditCompany(co)}>
                                Edit
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 px-2.5 text-xs gap-1"
                                disabled={compatCheckMutation.isPending}
                                onClick={() => compatCheckMutation.mutate(co.id)}>
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
                  Adding future developer companies (Petra, Gumbati, Next Partners, Wyndham, Rotana, etc.)
                  requires <strong>no code changes</strong>. Click <em>Add Developer</em> above and fill in the company name,
                  form URL, registration interval, and config JSON with field mappings.
                  New leads will automatically receive registration records for all active developers that have <strong>Auto-Register ON</strong>.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Status Guide tab ────────────────────────────────────────────── */}
          <TabsContent value="legend">
            <Card className="border-0 shadow-sm">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-[#005476] flex items-center gap-2">
                  <Info className="h-4 w-4 text-[#3bcac4]" />
                  Status Meaning Guide
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(STATUS_CONFIG).map(([k, v]) => (
                    <div key={k} className="flex items-start gap-3">
                      <span className={`text-[10px] font-semibold px-2 py-1 rounded-full border shrink-0 ${v.color}`}>
                        {v.label}
                      </span>
                      <p className="text-xs text-muted-foreground pt-0.5">{v.desc}</p>
                    </div>
                  ))}
                </div>

                <Separator className="my-4" />

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[#005476]">Attempt Types</p>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    {Object.entries(ATTEMPT_TYPE_LABELS).map(([k, v]) => (
                      <div key={k} className="flex items-center gap-2 p-2 rounded-lg bg-[#005476]/5">
                        <span className="text-[10px] bg-[#005476]/10 text-[#005476] border border-[#005476]/20 px-2 py-0.5 rounded-full font-semibold">{v}</span>
                        <span className="text-[10px] text-muted-foreground font-mono">{k}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <Separator className="my-4" />

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[#005476]">Silk Submission Flow</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span className="bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40 px-2 py-0.5 rounded-full text-[10px] font-semibold">Prepared</span>
                    <span>→</span>
                    <span className="italic">[Admin clicks Submit to Silk or scheduler runs]</span>
                    <span>→</span>
                    <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full text-[10px] font-semibold">Submitting…</span>
                    <span>→</span>
                    <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full text-[10px] font-semibold">Success ✓</span>
                    <span className="text-muted-foreground">or</span>
                    <span className="bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full text-[10px] font-semibold">Failed</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Success requires <strong>explicit confirmation from Silk's API</strong> (<code>&#123;"status":"success"&#125;</code> in response body).
                    HTTP 200 alone is not enough. Every attempt — including failures — is saved to the audit log.
                  </p>
                </div>

                <Separator className="my-4" />

                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[#005476]">Ambassadori Island Batumi — Submission Flow</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                    <span className="bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40 px-2 py-0.5 rounded-full text-[10px] font-semibold">Prepared</span>
                    <span>→</span>
                    <span className="italic">[Admin clicks "Submit to Amb" or scheduler runs]</span>
                    <span>→</span>
                    <span className="bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full text-[10px] font-semibold">Submitting…</span>
                    <span>→</span>
                    <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full text-[10px] font-semibold">Success ✓</span>
                    <span className="text-muted-foreground">or</span>
                    <span className="bg-purple-50 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full text-[10px] font-semibold">Protected (duplicate)</span>
                    <span className="text-muted-foreground">or</span>
                    <span className="bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded-full text-[10px] font-semibold">Failed</span>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Uses the <strong>ITRIELT broker portal HTTP API</strong>. Authenticates via <code>GET /api/get-hash</code> (MD5 password).
                    Uniqueness checked via <code>GET /api/get-buys-loot-check</code> before creation.
                    Requires <strong>AMBASSADORI_BROKER_USERNAME</strong> and <strong>AMBASSADORI_BROKER_PASSWORD</strong> in Secrets.
                    Expert: <em>Aphina Martley</em> · Project: <em>Ambassadori Island Batumi</em> · Type: <em>Apartments</em>. Re-registers every 30 days.
                  </p>
                </div>
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

      {/* Audit / Attempts dialog */}
      <Dialog open={auditRecordId !== null} onOpenChange={open => !open && setAuditRecordId(null)}>
        {auditRecordId !== null && (
          <AttemptsModal
            recordId={auditRecordId}
            leadName={auditLeadName}
            onClose={() => setAuditRecordId(null)}
          />
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

      {/* Register With Developer dialog */}
      <Dialog open={registerLeadId !== null} onOpenChange={open => { if (!open) setRegisterLeadId(null); }}>
        {registerLeadId !== null && (
          <RegisterWithDeveloperModal
            leadId={registerLeadId}
            leadName={registerLeadName}
            leadPhone={registerLeadPhone}
            companies={companies ?? []}
            onClose={() => setRegisterLeadId(null)}
            onRegistered={() => { refetchQueue(); refetchOverview(); }}
          />
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
            <Button className="bg-red-600 hover:bg-red-700 text-white"
              disabled={markFailedMutation.isPending}
              onClick={() => failRecordId && markFailedMutation.mutate({ id: failRecordId, reason: failReason })}>
              {markFailedMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Mark Failed
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
