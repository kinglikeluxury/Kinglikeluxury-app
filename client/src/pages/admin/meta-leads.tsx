import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertTriangle, RefreshCw, CheckCircle2, XCircle, Clock,
  Eye, RotateCcw, Inbox, Copy, Loader2, ShieldAlert,
  Activity, Users, ChevronLeft, ChevronRight,
} from "lucide-react";
import { SiMeta } from "react-icons/si";
import type { LeadImportQueue, LeadImportAuditLog } from "@shared/schema";

// ── Status badge config ──────────────────────────────────────────────────────
const STATUS_CFG: Record<string, { label: string; color: string }> = {
  pending:      { label: "Pending",      color: "bg-slate-100 text-slate-600 border border-slate-300" },
  processing:   { label: "Processing",   color: "bg-blue-100 text-blue-700 border border-blue-300" },
  completed:    { label: "Completed",    color: "bg-[#3bcac4]/15 text-[#005476] border border-[#3bcac4]/40" },
  failed:       { label: "Failed",       color: "bg-red-100 text-red-700 border border-red-300" },
  retry:        { label: "Retry",        color: "bg-amber-100 text-amber-700 border border-amber-300" },
  needs_review: { label: "Needs Review", color: "bg-orange-100 text-orange-700 border border-orange-300" },
};

const ACTION_CFG: Record<string, { label: string; color: string }> = {
  received:           { label: "Received",           color: "bg-[#3bcac4]/10 text-[#005476]" },
  processing:         { label: "Processing",         color: "bg-blue-50 text-blue-700" },
  completed:          { label: "Completed",           color: "bg-green-50 text-green-700" },
  failed:             { label: "Failed",              color: "bg-red-50 text-red-700" },
  retry_scheduled:    { label: "Retry Scheduled",    color: "bg-amber-50 text-amber-700" },
  duplicate_detected: { label: "Duplicate Detected", color: "bg-purple-50 text-purple-700" },
  needs_review:       { label: "Needs Review",        color: "bg-orange-50 text-orange-700" },
  manual_retry:       { label: "Manual Retry",        color: "bg-[#005476]/10 text-[#005476]" },
};

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status] || { label: status, color: "bg-gray-100 text-gray-600 border border-gray-200" };
  return <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${cfg.color}`}>{cfg.label}</span>;
}

function timeAgo(dateStr: string | Date) {
  const d = typeof dateStr === "string" ? new Date(dateStr) : dateStr;
  const mins = Math.round((Date.now() - d.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

// ── Audit log dialog ──────────────────────────────────────────────────────────
function AuditDialog({ entryId, open, onClose }: { entryId: number | null; open: boolean; onClose: () => void }) {
  const { data } = useQuery<{ logs: LeadImportAuditLog[] }>({
    queryKey: ["/api/admin/meta-leads", entryId, "audit"],
    queryFn: () => fetch(`/api/admin/meta-leads/${entryId}/audit`, { credentials: "include" }).then(r => r.json()),
    enabled: open && !!entryId,
  });

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-[#005476]">
            <Activity className="h-4 w-4" /> Audit Log — Queue #{entryId}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          {!data?.logs?.length && <p className="text-sm text-gray-400 py-4 text-center">No audit entries found.</p>}
          {data?.logs?.map((log) => {
            const cfg = ACTION_CFG[log.action] || { label: log.action, color: "bg-gray-50 text-gray-700" };
            return (
              <div key={log.id} className={`rounded-lg px-3 py-2 ${cfg.color}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold">{cfg.label}</span>
                  <span className="text-xs opacity-60">{timeAgo(log.createdAt)}</span>
                </div>
                {log.details && (
                  <pre className="text-xs opacity-70 whitespace-pre-wrap break-all">
                    {JSON.stringify(log.details, null, 2)}
                  </pre>
                )}
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Lead row ──────────────────────────────────────────────────────────────────
function LeadRow({
  entry,
  onRetry,
  onAudit,
  retrying,
}: {
  entry: LeadImportQueue;
  onRetry: (id: number) => void;
  onAudit: (id: number) => void;
  retrying: boolean;
}) {
  const leadData: any = entry.leadData || {};
  const fields: Record<string, string> = {};
  for (const f of leadData.field_data || []) {
    fields[f.name] = (f.values || [])[0] || "";
  }
  const name = fields["full_name"] || fields["first_name"]
    ? `${fields["first_name"] || ""} ${fields["last_name"] || ""}`.trim()
    : "—";
  const phone = fields["phone_number"] || fields["phone"] || "—";
  const canRetry = ["failed", "needs_review", "retry"].includes(entry.status);

  return (
    <tr className="hover:bg-gray-50 transition-colors">
      <td className="px-4 py-3 text-xs text-gray-400 font-mono">#{entry.id}</td>
      <td className="px-4 py-3">
        <StatusBadge status={entry.status} />
      </td>
      <td className="px-4 py-3">
        <div className="text-sm font-medium text-gray-800">{name}</div>
        <div className="text-xs text-gray-400 font-mono truncate max-w-[140px]" title={entry.metaLeadId}>
          {entry.metaLeadId}
        </div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">{phone}</td>
      <td className="px-4 py-3 text-xs text-gray-500">{entry.adId || "—"}</td>
      <td className="px-4 py-3">
        <div className="text-xs text-gray-500">{timeAgo(entry.receivedAt)}</div>
        {entry.retryCount > 0 && (
          <div className="text-xs text-amber-600">Attempts: {entry.retryCount}</div>
        )}
      </td>
      <td className="px-4 py-3">
        {entry.errorMessage && (
          <div className="text-xs text-red-500 max-w-[160px] truncate" title={entry.errorMessage}>
            {entry.errorMessage}
          </div>
        )}
        {entry.crmLeadId && (
          <div className="text-xs text-[#3bcac4]">CRM #{entry.crmLeadId}</div>
        )}
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-gray-400 hover:text-[#005476]"
            onClick={() => onAudit(entry.id)}
            title="View audit log"
          >
            <Eye className="h-3.5 w-3.5" />
          </Button>
          {canRetry && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0 text-amber-500 hover:text-amber-700"
              onClick={() => onRetry(entry.id)}
              disabled={retrying}
              title="Retry this lead"
            >
              {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Duplicates tab ────────────────────────────────────────────────────────────
function DuplicatesTab() {
  const { data } = useQuery<{ duplicates: LeadImportAuditLog[] }>({
    queryKey: ["/api/admin/meta-leads/duplicates"],
  });

  if (!data?.duplicates?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <Copy className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm">No duplicate leads detected</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-gray-50">
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Meta Lead ID</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Queue Entry</th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">Detected</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {data.duplicates.map((d) => (
            <tr key={d.id} className="hover:bg-gray-50">
              <td className="px-4 py-3 font-mono text-xs text-gray-600">{d.metaLeadId}</td>
              <td className="px-4 py-3 text-xs text-gray-500">#{d.queueEntryId}</td>
              <td className="px-4 py-3 text-xs text-gray-400">{timeAgo(d.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MetaLeadsPage() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [tab, setTab] = useState("all");
  const [page, setPage] = useState(1);
  const [auditId, setAuditId] = useState<number | null>(null);
  const [retryingId, setRetryingId] = useState<number | null>(null);

  if (!user?.isAdmin) {
    navigate("/");
    return null;
  }

  const { data, isLoading, refetch } = useQuery<{
    rows: LeadImportQueue[];
    stats: Record<string, number>;
    duplicateCount: number;
    page: number;
    limit: number;
  }>({
    queryKey: ["/api/admin/meta-leads/dashboard", tab, page],
    queryFn: () =>
      fetch(`/api/admin/meta-leads/dashboard?tab=${tab}&page=${page}&limit=25`, {
        credentials: "include",
      }).then((r) => r.json()),
    refetchInterval: 30_000,
  });

  const { data: alerts } = useQuery<{
    alertActive: boolean;
    lastReceivedAt: string | null;
    minutesSinceLast: number | null;
    isConfigured: boolean;
  }>({
    queryKey: ["/api/admin/meta-leads/alerts"],
    refetchInterval: 60_000,
  });

  const retryMutation = useMutation({
    mutationFn: (id: number) => apiRequest("POST", `/api/admin/meta-leads/${id}/retry`),
    onSuccess: () => {
      toast({ title: "Lead queued for retry", description: "It will be processed in the next cycle." });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/meta-leads/dashboard"] });
      setRetryingId(null);
    },
    onError: (err: any) => {
      toast({ title: "Retry failed", description: err.message, variant: "destructive" });
      setRetryingId(null);
    },
  });

  const handleRetry = (id: number) => {
    setRetryingId(id);
    retryMutation.mutate(id);
  };

  const stats = data?.stats || {};
  const totalReceived = Object.values(stats).reduce((a, b) => a + b, 0);

  const TABS = [
    { key: "all",          label: "All",           count: totalReceived },
    { key: "failed",       label: "Failed",         count: stats.failed || 0 },
    { key: "retry",        label: "Retry Queue",    count: stats.retry || 0 },
    { key: "needs_review", label: "Needs Review",   count: stats.needs_review || 0 },
    { key: "duplicates",   label: "Duplicates",     count: data?.duplicateCount || 0 },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl flex items-center justify-center"
              style={{ background: "linear-gradient(135deg, #3bcac4, #005476)" }}>
              <SiMeta className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#005476]">Meta Lead Ads</h1>
              <p className="text-xs text-gray-400">Secure import queue & audit log</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetch()}
            className="border-[#3bcac4]/40 text-[#005476] hover:bg-[#3bcac4]/10"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6 space-y-5">

        {/* Alert banner */}
        {alerts?.alertActive && (
          <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-amber-800">No Meta leads received in the last 30 minutes</p>
              <p className="text-xs text-amber-600 mt-0.5">
                {alerts.lastReceivedAt
                  ? `Last lead was ${alerts.minutesSinceLast} minutes ago. Check your Meta campaign and webhook configuration.`
                  : "No leads have been received yet. Verify your Meta webhook is connected."}
              </p>
            </div>
          </div>
        )}

        {/* Config warning */}
        {alerts && !alerts.isConfigured && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
            <ShieldAlert className="h-5 w-5 text-red-500 mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-red-800">Meta credentials not configured</p>
              <p className="text-xs text-red-600 mt-0.5">
                Set META_APP_SECRET, META_ACCESS_TOKEN, and META_VERIFY_TOKEN in Replit Secrets.
              </p>
            </div>
          </div>
        )}

        {/* Stats cards */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {[
            { label: "Total Received", value: totalReceived, icon: Inbox, color: "text-[#005476]" },
            { label: "Completed",      value: stats.completed || 0, icon: CheckCircle2, color: "text-[#3bcac4]" },
            { label: "Failed",         value: stats.failed || 0,    icon: XCircle,      color: "text-red-500" },
            { label: "Retry Queue",    value: stats.retry || 0,     icon: Clock,        color: "text-amber-500" },
            { label: "Needs Review",   value: stats.needs_review || 0, icon: AlertTriangle, color: "text-orange-500" },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="border-0 shadow-sm">
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs text-gray-500">{label}</span>
                  <Icon className={`h-4 w-4 ${color}`} />
                </div>
                <div className={`text-2xl font-bold ${color}`}>{value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Tabs */}
        <Card className="border-0 shadow-sm">
          <CardContent className="p-0">
            <Tabs value={tab} onValueChange={(t) => { setTab(t); setPage(1); }}>
              <div className="border-b px-4 pt-1">
                <TabsList className="bg-transparent h-auto gap-0 p-0">
                  {TABS.map(({ key, label, count }) => (
                    <TabsTrigger
                      key={key}
                      value={key}
                      className="rounded-none border-b-2 border-transparent data-[state=active]:border-[#3bcac4] data-[state=active]:text-[#005476] px-4 py-2.5 text-sm"
                    >
                      {label}
                      {count > 0 && (
                        <span className="ml-1.5 text-xs bg-gray-100 text-gray-600 rounded-full px-1.5 py-0.5">
                          {count}
                        </span>
                      )}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              {/* Duplicates tab */}
              <TabsContent value="duplicates" className="m-0">
                <DuplicatesTab />
              </TabsContent>

              {/* All other tabs share the same table */}
              {["all", "failed", "retry", "needs_review", "completed", "pending"].map((t) => (
                <TabsContent key={t} value={t} className="m-0">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-16">
                      <Loader2 className="h-6 w-6 animate-spin text-[#3bcac4]" />
                    </div>
                  ) : !data?.rows?.length ? (
                    <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                      <Users className="h-10 w-10 mb-3 opacity-30" />
                      <p className="text-sm">No leads in this category</p>
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b bg-gray-50">
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 w-12">#</th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Status</th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Lead</th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Phone</th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Ad ID</th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Received</th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Result / Error</th>
                            <th className="px-4 py-2.5 text-left text-xs font-medium text-gray-500">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {data.rows.map((entry) => (
                            <LeadRow
                              key={entry.id}
                              entry={entry}
                              onRetry={handleRetry}
                              onAudit={(id) => setAuditId(id)}
                              retrying={retryingId === entry.id}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>

            {/* Pagination */}
            {tab !== "duplicates" && (data?.rows?.length || 0) > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <span className="text-xs text-gray-500">Page {page}</span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="h-7 px-2"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(data?.rows?.length || 0) < 25}
                    onClick={() => setPage((p) => p + 1)}
                    className="h-7 px-2"
                  >
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Audit dialog */}
      <AuditDialog
        entryId={auditId}
        open={auditId !== null}
        onClose={() => setAuditId(null)}
      />
    </div>
  );
}
