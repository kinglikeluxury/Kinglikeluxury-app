import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Bot, RefreshCw, ShieldCheck } from "lucide-react";

type LedgerItem = {
  id: number; eventType?: string; decisionType?: string; eventSource?: string;
  mode?: string; rationale?: string; leadId: number | null; createdAt: string;
  payload?: {
    state?: string; status?: string; elapsed_minutes?: number; threshold_minutes?: number;
    blockers?: string[]; recommended_employee_name?: string | null;
    employee_selection_explanation?: string; manager_review?: boolean; shadow?: boolean;
  };
};
type KayControlData = { mode: "shadow"; events: LedgerItem[]; decisions: LedgerItem[]; protectedLeads?: { id: number; leadId: number; reason: string; protectedAt: string }[] };

function timestamp(value: string) {
  return new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

export default function KayControlCenterPage() {
  const { data, isLoading, isFetching, refetch } = useQuery<KayControlData>({
    queryKey: ["/api/admin/kay/control"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/kay/control")).json(),
  });
  const saveMode = useMutation({
    mutationFn: async (mode: KayControlData["mode"]) =>
      (await apiRequest("PUT", "/api/admin/kay/settings/mode", { mode })).json(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/admin/kay/control"] }),
  });
  const mode = data?.mode ?? "shadow";
  const rescueItems = (data?.decisions ?? []).filter(item =>
    item.decisionType?.includes("rescue") || item.decisionType === "manager_review" || item.decisionType === "unprotected_opportunity");

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <div className="bg-gradient-to-r from-[#005476] to-[#3bcac4] text-white px-6 py-8">
        <div className="max-w-6xl mx-auto flex justify-between gap-4 flex-wrap">
          <div className="flex gap-3">
            <div className="p-2.5 bg-white/20 rounded-xl"><Bot className="h-6 w-6" /></div>
            <div>
              <h1 className="text-2xl font-bold">Kay Control Center</h1>
              <p className="text-sm text-white/80 mt-0.5">Phase B · Lead protection and rescue intelligence</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <Card className="border-[#3bcac4]/40">
          <CardHeader><CardTitle className="flex items-center gap-2 text-[#005476]"><ShieldCheck className="h-5 w-5" /> Operating mode</CardTitle></CardHeader>
          <CardContent className="flex items-center gap-4 flex-wrap">
            <Select value={mode} onValueChange={(value) => saveMode.mutate(value as KayControlData["mode"])} disabled={saveMode.isPending}>
              <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="shadow">Shadow (default)</SelectItem>
              </SelectContent>
            </Select>
            <Badge className="bg-[#3bcac4]/20 text-[#005476] hover:bg-[#3bcac4]/20">{mode.toUpperCase()}</Badge>
            <p className="text-sm text-muted-foreground">Kay records observations and decisions only. It does not change leads, assignments, statuses, messages, or CRM permissions.</p>
            {saveMode.isError && <p className="text-sm text-red-600">Mode update failed. The existing setting was kept.</p>}
          </CardContent>
        </Card>
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader><CardTitle className="text-lg text-[#005476]">Rescue Intelligence · SHADOW</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="font-medium">SHADOW — NO LEADS ARE BEING REASSIGNED</p>
            <p className="text-muted-foreground">Kay only observes, calculates, logs, and recommends. It never changes lead status, ownership, customer communication, tasks, or WhatsApp.</p>
            <p className="text-muted-foreground">Protected Leads: <span className="font-medium text-[#005476]">{data?.protectedLeads?.length ?? 0}</span></p>
            {(data?.protectedLeads?.length ?? 0) > 0 && <div className="text-xs text-muted-foreground">{data!.protectedLeads!.slice(0, 10).map(p => <div key={p.id}>🔒 Lead {p.leadId} · {p.reason} · {timestamp(p.protectedAt)}</div>)}</div>}
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-3">
              {["ACTIVE", "BLOCKED", "STALE", "SIMULATED_LIMIT_REACHED"].map(state => <div key={state} className="rounded-lg border bg-white px-3 py-2">
                <div className="text-xs text-muted-foreground">{state.replaceAll("_", " ")}</div>
                <div className="text-xl font-semibold text-[#005476]">{rescueItems.filter(item => item.payload?.state === state).length}</div>
              </div>)}
            </div>
            <div className="space-y-2 pt-2">
              {rescueItems.slice(0, 12).map(item => <details key={item.id} className="rounded-lg border bg-white p-3">
                <summary className="cursor-pointer font-medium">Lead {item.leadId ?? "—"} · {item.payload?.state ?? "OBSERVED"} · WHY?</summary>
                <div className="mt-2 grid gap-1 text-xs text-muted-foreground">
                  <div>Status: {item.payload?.status ?? "—"}</div>
                  <div>Time in status: {item.payload?.elapsed_minutes ?? 0}m / {item.payload?.threshold_minutes ?? 0}m</div>
                  <div>Blockers: {item.payload?.blockers?.join(", ") || "None"}</div>
                  <div>Recommended: {item.payload?.recommended_employee_name || (item.payload?.manager_review ? "Manager review" : "—")}</div>
                  <div>Reason: {item.payload?.employee_selection_explanation || item.rationale}</div>
                  <Badge className="mt-1 w-fit bg-amber-100 text-amber-800 hover:bg-amber-100">SHADOW · NO ACTION TAKEN</Badge>
                </div>
              </details>)}
            </div>
          </CardContent>
        </Card>
        <div className="grid lg:grid-cols-2 gap-6">
          <Ledger title="Recent events" items={data?.events ?? []} loading={isLoading} />
          <Ledger title="Recent decisions" items={data?.decisions ?? []} loading={isLoading} decisions />
        </div>
      </div>
    </div>
  );
}

function Ledger({ title, items, loading, decisions = false }: { title: string; items: LedgerItem[]; loading: boolean; decisions?: boolean }) {
  return <Card>
    <CardHeader><CardTitle className="text-lg text-[#005476]">{title}</CardTitle></CardHeader>
    <CardContent>
      {loading ? <p className="text-sm text-muted-foreground">Loading…</p> : items.length === 0 ? <p className="text-sm text-muted-foreground">No Kay records yet.</p> :
        <div className="space-y-3">{items.map(item => <div key={item.id} className="border-b last:border-0 pb-3 last:pb-0">
          <div className="flex justify-between gap-3"><span className="font-medium text-sm">{decisions ? item.decisionType : item.eventType}</span><span className="text-xs text-muted-foreground whitespace-nowrap">{timestamp(item.createdAt)}</span></div>
          <p className="text-xs text-muted-foreground mt-1">{decisions ? item.rationale : `${item.eventSource} · Lead ${item.leadId ?? "—"}`}</p>
        </div>)}</div>}
    </CardContent>
  </Card>;
}