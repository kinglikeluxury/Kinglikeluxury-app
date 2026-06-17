import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import {
  Wifi, WifiOff, CheckCircle2, XCircle, AlertTriangle,
  RefreshCw, BarChart3, Target, Layers, Image, TrendingUp,
  DollarSign, Eye, MousePointer, Info, Lock, Settings,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// ── Types ─────────────────────────────────────────────────────────────────────

interface MetaConfig {
  tokenPresent: boolean;
  adAccountPresent: boolean;
  adAccountId: string | null;
}

interface MetaReadTestResult {
  success: boolean;
  tokenPresent: boolean;
  adAccountPresent: boolean;
  adAccountId: string | null;
  campaignsReadable: boolean;
  insightsReadable: boolean;
  adsetsReadable: boolean;
  adsReadable: boolean;
  errors: { campaigns: string | null; insights: string | null; adsets: string | null; ads: string | null };
  counts: { campaigns: number; insights: number; adsets: number; ads: number };
}

interface MetaReadResult {
  ok: boolean;
  data: any[];
  error: string | null;
  httpStatus: number;
}

// ── Sub-tabs ──────────────────────────────────────────────────────────────────

const SUB_TABS = [
  { key: "status",    label: "Connection Status", Icon: Wifi },
  { key: "campaigns", label: "Campaigns",          Icon: Target },
  { key: "adsets",    label: "Ad Sets",            Icon: Layers },
  { key: "ads",       label: "Ads",                Icon: Image },
  { key: "insights",  label: "Insights",           Icon: BarChart3 },
] as const;
type SubKey = typeof SUB_TABS[number]["key"];

// ── Helpers ────────────────────────────────────────────────────────────────────

function StatusBadge({ ok, label }: { ok: boolean | null; label: string }) {
  if (ok === null) return <Badge variant="outline" className="text-slate-400 border-slate-200">{label}: —</Badge>;
  return ok
    ? <Badge className="bg-green-100 text-green-700 border-green-200 hover:bg-green-100">{label}: ✓ Readable</Badge>
    : <Badge className="bg-red-100 text-red-700 border-red-200 hover:bg-red-100">{label}: ✗ Failed</Badge>;
}

function StatusRow({ label, ok, error }: { label: string; ok: boolean | null; error?: string | null }) {
  return (
    <div className="flex items-start justify-between py-3 border-b last:border-b-0">
      <div>
        <span className="font-medium text-slate-700 text-sm">{label}</span>
        {error && <p className="text-xs text-red-500 mt-0.5 max-w-sm">{error}</p>}
      </div>
      {ok === null
        ? <span className="text-xs text-slate-400">—</span>
        : ok
          ? <span className="flex items-center gap-1 text-green-600 text-sm font-semibold"><CheckCircle2 className="h-4 w-4" /> OK</span>
          : <span className="flex items-center gap-1 text-red-500 text-sm font-semibold"><XCircle className="h-4 w-4" /> Failed</span>
      }
    </div>
  );
}

function fmt(v: number | string | null | undefined) {
  if (v == null || v === "") return "—";
  const n = Number(v);
  if (!isNaN(n)) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(v);
}

function statusColor(status: string) {
  switch (status?.toUpperCase()) {
    case "ACTIVE":   return "bg-green-100 text-green-700";
    case "PAUSED":   return "bg-yellow-100 text-yellow-700";
    case "ARCHIVED": return "bg-slate-100 text-slate-500";
    case "DELETED":  return "bg-red-100 text-red-500";
    default:         return "bg-slate-100 text-slate-600";
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function MetaConnection() {
  const [sub, setSub] = useState<SubKey>("status");
  const [datePreset, setDatePreset] = useState("last_30d");
  const [insightLevel, setInsightLevel] = useState("campaign");
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── TRY Display Exchange Rate ──────────────────────────────────────────────
  // Conversion is display-only. Raw Meta values are never overwritten.
  const [tryRate, setTryRate] = useState<number>(() => {
    try {
      const stored = localStorage.getItem("meta_try_rate");
      return stored && Number(stored) > 0 ? Number(stored) : 39.5;
    } catch { return 39.5; }
  });
  const [rateInput, setRateInput] = useState<string>(String(tryRate));
  const [showRateEditor, setShowRateEditor] = useState(false);

  function toTRY(usd: number): number {
    return usd * tryRate;
  }
  function fmtTRY(usd: number): string {
    return Math.round(toTRY(usd)).toLocaleString();
  }
  function saveTryRate() {
    const r = parseFloat(rateInput);
    if (r > 0 && isFinite(r)) {
      setTryRate(r);
      try { localStorage.setItem("meta_try_rate", String(r)); } catch {}
      setShowRateEditor(false);
      toast({ title: "Exchange rate saved", description: `1 USD = ${r} TRY` });
    }
  }

  // Config (booleans only — no token values ever sent to frontend)
  const { data: cfg } = useQuery<MetaConfig>({
    queryKey: ["/api/admin/ai-marketing/meta-config"],
  });

  // Diagnostic test (run on demand)
  const testMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("GET", "/api/admin/ai-marketing/meta-read-test");
      return res.json() as Promise<MetaReadTestResult>;
    },
    onSuccess: (data: any) => {
      qc.setQueryData(["/api/admin/ai-marketing/meta-read-test-result"], data);
      if (data.success) {
        toast({ title: "✅ All reads successful", description: "Campaigns, ad sets, ads and insights are all readable." });
      } else {
        toast({ title: "⚠️ Some reads failed", description: "Check the status panel for details.", variant: "destructive" });
      }
    },
    onError: (e: any) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const testResult: MetaReadTestResult | undefined = qc.getQueryData(["/api/admin/ai-marketing/meta-read-test-result"]);

  // Data queries (only fetched when on the relevant sub-tab)
  const { data: campaigns, isLoading: campaignsLoading, refetch: refetchCampaigns } = useQuery<MetaReadResult>({
    queryKey: ["/api/admin/ai-marketing/meta-campaigns"],
    enabled: sub === "campaigns",
  });

  const { data: adsets, isLoading: adsetsLoading, refetch: refetchAdsets } = useQuery<MetaReadResult>({
    queryKey: ["/api/admin/ai-marketing/meta-adsets"],
    enabled: sub === "adsets",
  });

  const { data: ads, isLoading: adsLoading, refetch: refetchAds } = useQuery<MetaReadResult>({
    queryKey: ["/api/admin/ai-marketing/meta-ads"],
    enabled: sub === "ads",
  });

  const { data: insights, isLoading: insightsLoading, refetch: refetchInsights } = useQuery<MetaReadResult>({
    queryKey: ["/api/admin/ai-marketing/meta-insights", datePreset, insightLevel],
    queryFn: () =>
      fetch(`/api/admin/ai-marketing/meta-insights?date_preset=${datePreset}&level=${insightLevel}`, { credentials: "include" })
        .then(r => r.json()),
    enabled: sub === "insights",
  });

  // Campaign-level insights fetched alongside campaigns tab — used for Spent column
  const { data: campaignInsights } = useQuery<MetaReadResult>({
    queryKey: ["/api/admin/ai-marketing/meta-insights", "last_30d", "campaign"],
    queryFn: () =>
      fetch("/api/admin/ai-marketing/meta-insights?date_preset=last_30d&level=campaign", { credentials: "include" })
        .then(r => r.json()),
    enabled: sub === "campaigns" && !!cfg?.tokenPresent && !!cfg?.adAccountPresent,
  });

  const campaignSpendMap = useMemo(() => {
    const m = new Map<string, string>();
    if (campaignInsights?.ok) {
      for (const row of campaignInsights.data) {
        if (row.campaign_id != null && row.spend != null) {
          m.set(String(row.campaign_id), row.spend);
        }
      }
    }
    return m;
  }, [campaignInsights]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Safety banner */}
      <div className="flex flex-wrap gap-2 mb-3">
        {["📡 Read-Only", "🔒 No Write Actions", "🚫 No Campaign Changes", "💳 No Ad Spend", "🌐 Railway Compatible"].map(b => (
          <span key={b} className="text-xs bg-slate-100 text-slate-600 font-medium px-3 py-1 rounded-full border border-slate-200">{b}</span>
        ))}
      </div>

      {/* Meta Display Exchange Rate — admin setting, display-only, never overwrites raw Meta data */}
      <div className="flex flex-wrap items-center gap-2 mb-4 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
        <span className="text-xs font-semibold text-amber-700">Display Currency: TRY</span>
        <span className="text-xs text-amber-600">1 USD = {tryRate} TRY</span>
        <button
          onClick={() => { setRateInput(String(tryRate)); setShowRateEditor(v => !v); }}
          className="flex items-center gap-1 text-xs text-amber-600 hover:text-[#005476] transition-colors ml-1"
          title="Configure exchange rate"
        >
          <Settings className="h-3.5 w-3.5" />
          {showRateEditor ? "Cancel" : "Edit Rate"}
        </button>
        {showRateEditor && (
          <div className="flex items-center gap-2 ml-1">
            <span className="text-xs text-amber-700">1 USD =</span>
            <input
              type="number"
              value={rateInput}
              onChange={e => setRateInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveTryRate()}
              className="w-24 text-xs border border-amber-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#3bcac4]"
              step="0.1"
              min="1"
              placeholder="39.5"
            />
            <span className="text-xs text-amber-700">TRY</span>
            <button
              onClick={saveTryRate}
              className="text-xs bg-[#3bcac4] hover:bg-[#005476] text-white px-3 py-1 rounded transition-colors font-medium"
            >
              Save
            </button>
          </div>
        )}
        <span className="text-[10px] text-amber-500 ml-auto">Conversion applied to display only — raw Meta values unchanged</span>
      </div>

      {/* Sub-tab bar */}
      <div className="flex flex-wrap gap-1 mb-5 bg-slate-100 p-1 rounded-xl">
        {SUB_TABS.map(({ key, label, Icon }) => (
          <button key={key} onClick={() => setSub(key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-lg transition-all ${
              sub === key ? "bg-white text-[#005476] shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
            <Icon className="h-3.5 w-3.5" />{label}
          </button>
        ))}
      </div>

      {/* ── Connection Status ────────────────────────────────────────────── */}
      {sub === "status" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold text-slate-800 text-base">Meta Marketing API Connection</h3>
              <p className="text-sm text-slate-500">Verify that campaigns, ad sets, ads and insights are readable. No write actions performed.</p>
            </div>
            <Button
              onClick={() => testMutation.mutate()}
              disabled={testMutation.isPending}
              className="bg-[#3bcac4] hover:bg-[#005476] text-white"
            >
              {testMutation.isPending
                ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" /> Testing…</>
                : <><RefreshCw className="h-4 w-4 mr-2" /> Run Diagnostic</>}
            </Button>
          </div>

          {/* Credential presence cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card className={`shadow-sm border-2 ${cfg?.tokenPresent ? "border-green-200 bg-green-50/50" : "border-red-200 bg-red-50/50"}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <Lock className={`h-6 w-6 ${cfg?.tokenPresent ? "text-green-600" : "text-red-500"}`} />
                <div>
                  <p className="font-semibold text-slate-800 text-sm">META_ACCESS_TOKEN</p>
                  <p className={`text-xs mt-0.5 ${cfg?.tokenPresent ? "text-green-700" : "text-red-500"}`}>
                    {cfg?.tokenPresent ? "✓ Present (value hidden)" : "✗ Not configured"}
                  </p>
                </div>
              </CardContent>
            </Card>
            <Card className={`shadow-sm border-2 ${cfg?.adAccountPresent ? "border-green-200 bg-green-50/50" : "border-amber-200 bg-amber-50/50"}`}>
              <CardContent className="p-4 flex items-center gap-3">
                <Target className={`h-6 w-6 ${cfg?.adAccountPresent ? "text-green-600" : "text-amber-500"}`} />
                <div>
                  <p className="font-semibold text-slate-800 text-sm">META_AD_ACCOUNT_ID</p>
                  <p className={`text-xs mt-0.5 ${cfg?.adAccountPresent ? "text-green-700" : "text-amber-600"}`}>
                    {cfg?.adAccountPresent
                      ? `✓ Present — ${cfg.adAccountId}`
                      : "✗ Not configured — add as Replit/Railway secret"}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Missing credential guidance */}
          {(!cfg?.tokenPresent || !cfg?.adAccountPresent) && (
            <Card className="border-amber-200 bg-amber-50">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-amber-800 text-sm">Setup Required</p>
                    <ul className="text-xs text-amber-700 mt-2 space-y-1 list-disc ml-4">
                      {!cfg?.tokenPresent && <li><strong>META_ACCESS_TOKEN</strong> — already present for lead sync. Confirm it has <code>ads_read</code> permission in Meta Business Manager.</li>}
                      {!cfg?.adAccountPresent && <li><strong>META_AD_ACCOUNT_ID</strong> — add your Ad Account ID as a secret (format: <code>act_XXXXXXXXX</code> or just the number). Found in Meta Business Manager → Ad Accounts.</li>}
                    </ul>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Diagnostic results */}
          {testResult && (
            <Card className={`shadow-sm border-2 ${testResult.success ? "border-green-200" : "border-red-200"}`}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  {testResult.success
                    ? <><CheckCircle2 className="h-5 w-5 text-green-600" /> All Reads Successful</>
                    : <><XCircle className="h-5 w-5 text-red-500" /> Some Reads Failed</>}
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <StatusRow label="Campaigns" ok={testResult.campaignsReadable} error={testResult.errors.campaigns} />
                <StatusRow label="Ad Sets"   ok={testResult.adsetsReadable}    error={testResult.errors.adsets} />
                <StatusRow label="Ads"       ok={testResult.adsReadable}       error={testResult.errors.ads} />
                <StatusRow label="Insights"  ok={testResult.insightsReadable}  error={testResult.errors.insights} />
                <div className="mt-3 grid grid-cols-4 gap-2">
                  {[
                    { label: "Campaigns", v: testResult.counts.campaigns, Icon: Target },
                    { label: "Ad Sets",   v: testResult.counts.adsets,    Icon: Layers },
                    { label: "Ads",       v: testResult.counts.ads,       Icon: Image },
                    { label: "Insights",  v: testResult.counts.insights,  Icon: BarChart3 },
                  ].map(({ label, v, Icon: I }) => (
                    <div key={label} className="bg-slate-50 rounded-lg p-2 text-center">
                      <I className="h-3.5 w-3.5 mx-auto mb-1 text-[#3bcac4]" />
                      <div className="text-lg font-bold text-[#005476]">{v}</div>
                      <div className="text-[10px] text-slate-500">{label}</div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Security notice */}
          <Card className="border-slate-200 bg-slate-50">
            <CardContent className="p-4">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-slate-400 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-slate-500">
                  This panel performs <strong>read-only</strong> GET requests to the Meta Marketing API.
                  No campaigns are created, edited, paused, or deleted. No budget changes are made.
                  Token values are never sent to the browser. All calls are admin-only server-side.
                  Compatible with Replit and Railway deployments.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Campaigns ───────────────────────────────────────────────────── */}
      {sub === "campaigns" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-base">Campaigns</h3>
              <p className="text-sm text-slate-500">Read-only view of your Meta ad campaigns.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchCampaigns()} disabled={campaignsLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${campaignsLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          {!cfg?.tokenPresent || !cfg?.adAccountPresent ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center text-slate-400"><WifiOff className="h-10 w-10 mx-auto mb-3 opacity-30" /><p className="font-medium">Not connected</p><p className="text-sm mt-1">Configure META_ACCESS_TOKEN and META_AD_ACCOUNT_ID first</p></CardContent></Card>
          ) : campaignsLoading ? (
            <div className="text-center py-12 text-slate-400">Loading campaigns…</div>
          ) : !campaigns?.ok ? (
            <Card className="border-red-200 bg-red-50"><CardContent className="py-8 text-center"><XCircle className="h-8 w-8 text-red-400 mx-auto mb-2" /><p className="text-sm font-medium text-red-700">{campaigns?.error ?? "Failed to load"}</p></CardContent></Card>
          ) : campaigns.data.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center text-slate-400"><Target className="h-10 w-10 mx-auto mb-3 opacity-30" /><p className="font-medium">No campaigns found</p></CardContent></Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr>{["Campaign Name","Status","Objective","Daily Budget (TRY)","Spent (TRY, 30d)","Start","ID"].map(h => <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {campaigns.data.map((c: any) => (
                    <tr key={c.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[220px] truncate">{c.name}</td>
                      <td className="px-3 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor(c.status)}`}>{c.status ?? "—"}</span></td>
                      <td className="px-3 py-2.5 text-slate-500 text-xs">{c.objective ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        {c.daily_budget
                          ? <span className="font-semibold text-slate-700">{Math.round(Number(c.daily_budget) / 100).toLocaleString()} TRY</span>
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        {(() => {
                          const sp = campaignSpendMap.get(String(c.id));
                          return sp != null
                            ? <span className="font-semibold text-green-700">{Math.round(Number(sp)).toLocaleString()} TRY</span>
                            : <span className="text-slate-300 text-xs">—</span>;
                        })()}
                      </td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs">{c.start_time ? new Date(c.start_time).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-slate-400">{c.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Ad Sets ─────────────────────────────────────────────────────── */}
      {sub === "adsets" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-base">Ad Sets</h3>
              <p className="text-sm text-slate-500">Read-only view of your Meta ad sets.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchAdsets()} disabled={adsetsLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${adsetsLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          {!cfg?.tokenPresent || !cfg?.adAccountPresent ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center text-slate-400"><WifiOff className="h-10 w-10 mx-auto mb-3 opacity-30" /><p className="font-medium">Not connected</p></CardContent></Card>
          ) : adsetsLoading ? (
            <div className="text-center py-12 text-slate-400">Loading ad sets…</div>
          ) : !adsets?.ok ? (
            <Card className="border-red-200 bg-red-50"><CardContent className="py-8 text-center"><XCircle className="h-8 w-8 text-red-400 mx-auto mb-2" /><p className="text-sm font-medium text-red-700">{adsets?.error ?? "Failed to load"}</p></CardContent></Card>
          ) : adsets.data.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center text-slate-400"><Layers className="h-10 w-10 mx-auto mb-3 opacity-30" /><p className="font-medium">No ad sets found</p></CardContent></Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr>{["Ad Set Name","Status","Campaign ID","Daily Budget","Billing Event","ID"].map(h => <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {adsets.data.map((s: any) => (
                    <tr key={s.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[200px] truncate">{s.name}</td>
                      <td className="px-3 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor(s.status)}`}>{s.status ?? "—"}</span></td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-slate-400">{s.campaign_id ?? "—"}</td>
                      <td className="px-3 py-2.5">
                        {s.daily_budget
                          ? <span className="font-semibold text-slate-700">{Math.round(Number(s.daily_budget) / 100).toLocaleString()} TRY</span>
                          : "—"}
                      </td>
                      <td className="px-3 py-2.5 text-slate-500 text-xs">{s.billing_event ?? "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-slate-400">{s.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Ads ─────────────────────────────────────────────────────────── */}
      {sub === "ads" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-base">Ads</h3>
              <p className="text-sm text-slate-500">Read-only view of your Meta ads.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchAds()} disabled={adsLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${adsLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>
          {!cfg?.tokenPresent || !cfg?.adAccountPresent ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center text-slate-400"><WifiOff className="h-10 w-10 mx-auto mb-3 opacity-30" /><p className="font-medium">Not connected</p></CardContent></Card>
          ) : adsLoading ? (
            <div className="text-center py-12 text-slate-400">Loading ads…</div>
          ) : !ads?.ok ? (
            <Card className="border-red-200 bg-red-50"><CardContent className="py-8 text-center"><XCircle className="h-8 w-8 text-red-400 mx-auto mb-2" /><p className="text-sm font-medium text-red-700">{ads?.error ?? "Failed to load"}</p></CardContent></Card>
          ) : ads.data.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center text-slate-400"><Image className="h-10 w-10 mx-auto mb-3 opacity-30" /><p className="font-medium">No ads found</p></CardContent></Card>
          ) : (
            <div className="overflow-x-auto rounded-xl border">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                  <tr>{["Ad Name","Status","Effective Status","Ad Set ID","Campaign ID","Created","ID"].map(h => <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {ads.data.map((a: any) => (
                    <tr key={a.id} className="hover:bg-slate-50">
                      <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[180px] truncate">{a.name}</td>
                      <td className="px-3 py-2.5"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor(a.status)}`}>{a.status ?? "—"}</span></td>
                      <td className="px-3 py-2.5 text-slate-500 text-xs">{a.effective_status ?? "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-slate-400">{a.adset_id ?? "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-slate-400">{a.campaign_id ?? "—"}</td>
                      <td className="px-3 py-2.5 text-slate-400 text-xs">{a.created_time ? new Date(a.created_time).toLocaleDateString() : "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-[10px] text-slate-400">{a.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Insights ─────────────────────────────────────────────────────── */}
      {sub === "insights" && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-bold text-slate-800 text-base">Performance Insights</h3>
              <p className="text-sm text-slate-500">Read-only performance data from Meta.</p>
            </div>
            <Button variant="outline" size="sm" onClick={() => refetchInsights()} disabled={insightsLoading}>
              <RefreshCw className={`h-3.5 w-3.5 mr-1 ${insightsLoading ? "animate-spin" : ""}`} /> Refresh
            </Button>
          </div>

          {/* Filter controls */}
          <div className="flex flex-wrap gap-2 mb-4">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Date:</span>
              {[["last_7d","7 days"],["last_14d","14 days"],["last_30d","30 days"],["last_90d","90 days"]].map(([val,label]) => (
                <button key={val} onClick={() => setDatePreset(val)} className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${datePreset===val?"bg-[#3bcac4] text-white border-[#3bcac4]":"bg-white text-slate-600 border-slate-200 hover:border-[#3bcac4]"}`}>{label}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">Level:</span>
              {[["campaign","Campaign"],["adset","Ad Set"],["ad","Ad"]].map(([val,label]) => (
                <button key={val} onClick={() => setInsightLevel(val)} className={`text-xs px-2.5 py-1 rounded-lg border transition-all ${insightLevel===val?"bg-[#005476] text-white border-[#005476]":"bg-white text-slate-600 border-slate-200 hover:border-[#005476]"}`}>{label}</button>
              ))}
            </div>
          </div>

          {!cfg?.tokenPresent || !cfg?.adAccountPresent ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center text-slate-400"><WifiOff className="h-10 w-10 mx-auto mb-3 opacity-30" /><p className="font-medium">Not connected</p></CardContent></Card>
          ) : insightsLoading ? (
            <div className="text-center py-12 text-slate-400">Loading insights…</div>
          ) : !insights?.ok ? (
            <Card className="border-red-200 bg-red-50"><CardContent className="py-8 text-center"><XCircle className="h-8 w-8 text-red-400 mx-auto mb-2" /><p className="text-sm font-medium text-red-700">{insights?.error ?? "Failed to load"}</p></CardContent></Card>
          ) : insights.data.length === 0 ? (
            <Card className="border-dashed"><CardContent className="py-12 text-center text-slate-400"><BarChart3 className="h-10 w-10 mx-auto mb-3 opacity-30" /><p className="font-medium">No insight data found for this period</p></CardContent></Card>
          ) : (
            <>
              {/* KPI Summary */}
              {(() => {
                const totals = insights.data.reduce((acc: any, row: any) => ({
                  impressions: acc.impressions + Number(row.impressions||0),
                  reach:       acc.reach       + Number(row.reach||0),
                  clicks:      acc.clicks      + Number(row.clicks||0),
                  spend:       acc.spend       + Number(row.spend||0),
                }), { impressions:0, reach:0, clicks:0, spend:0 });
                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                    {[
                      { label: "Impressions", v: totals.impressions, Icon: Eye,          cls: "text-[#005476]", bg: "bg-[#005476]/10" },
                      { label: "Reach",       v: totals.reach,       Icon: TrendingUp,   cls: "text-[#3bcac4]", bg: "bg-[#3bcac4]/10" },
                      { label: "Clicks",      v: totals.clicks,      Icon: MousePointer, cls: "text-purple-600", bg: "bg-purple-50" },
                      { label: "Spend (TRY)", v: totals.spend, Icon: DollarSign, cls: "text-green-600", bg: "bg-green-50", isTRY: true },
                    ].map(({ label, v, Icon: I, cls, bg, isTRY }) => (
                      <Card key={label} className="shadow-sm">
                        <CardContent className="p-3 flex items-center gap-2">
                          <div className={`p-2 rounded-xl ${bg}`}><I className={`h-4 w-4 ${cls}`} /></div>
                          <div>
                            <p className={`text-base font-extrabold ${cls}`}>
                              {isTRY ? `${Math.round(Number(v)).toLocaleString()} TRY` : Number(v).toLocaleString()}
                            </p>
                            <p className="text-[10px] text-slate-500">{label}</p>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                );
              })()}
              <div className="overflow-x-auto rounded-xl border">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                    <tr>{["Name","Impressions","Reach","Clicks","Spend","CPC","CPM","CTR","Period"].map(h => <th key={h} className="px-3 py-2.5 text-left font-semibold whitespace-nowrap">{h}</th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {insights.data.map((r: any, i: number) => {
                      const name = r.campaign_name || r.adset_name || r.ad_name || r.campaign_id || r.adset_id || r.ad_id || "—";
                      const leads = r.actions?.find((a: any) => a.action_type === "lead")?.value;
                      return (
                        <tr key={i} className="hover:bg-slate-50">
                          <td className="px-3 py-2.5 font-medium text-slate-800 max-w-[200px] truncate">{name}</td>
                          <td className="px-3 py-2.5 text-slate-600">{fmt(r.impressions)}</td>
                          <td className="px-3 py-2.5 text-slate-600">{fmt(r.reach)}</td>
                          <td className="px-3 py-2.5 text-slate-600">{fmt(r.clicks)}</td>
                          <td className="px-3 py-2.5">
                            {r.spend
                              ? <span className="font-semibold text-green-700">{Math.round(Number(r.spend)).toLocaleString()} TRY</span>
                              : "—"}
                          </td>
                          <td className="px-3 py-2.5 text-slate-500">{r.cpc ? `$${Number(r.cpc).toFixed(2)}` : "—"}</td>
                          <td className="px-3 py-2.5 text-slate-500">{r.cpm ? `$${Number(r.cpm).toFixed(2)}` : "—"}</td>
                          <td className="px-3 py-2.5 text-slate-500">{r.ctr ? `${Number(r.ctr).toFixed(2)}%` : "—"}</td>
                          <td className="px-3 py-2.5 text-slate-400 text-xs">{r.date_start} – {r.date_stop}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
