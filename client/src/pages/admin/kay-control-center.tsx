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
    task_blocker?: { id: number; title: string; dueDate?: string | null; dueTime?: string | null; createdBy?: number | null; classification: string; confidence: number; rule: string };
    protected_review_after_days?: number; protected_at?: string;
  };
};
type StatusIntelligence = { status: string; classification: string; terminal: boolean; rescueEvaluated: boolean; protectedCandidate: boolean; description: string };
type WorkflowEmployee = { employee_id:number; employee_name:string; missions_total:number; active_missions:number; active_critical:number; completed:number; dismissed:number; stale:number; rescue_risk:number; unprotected:number; protected_attention:number; results:Record<string,number> };
type MissionInspection = {id:number;mission_type:string;priority:string;status:string;reason_code:string;created_at:string;accepted_at?:string;completed_at?:string;result_code?:string;lead_id?:number;lead_name?:string;employee_name?:string};
type KayControlData = { mode: "shadow"; events: LedgerItem[]; decisions: LedgerItem[]; protectedLeads?: { id: number; leadId: number; reason: string; protectedAt: string }[]; statusIntelligence?: StatusIntelligence[]; employeeWorkflow?: WorkflowEmployee[]; missionInspection?:MissionInspection[] };

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
    item.decisionType?.includes("rescue") || item.decisionType === "manager_review" || item.decisionType === "unprotected_opportunity" ||
    item.decisionType === "protection_recommended" || item.decisionType === "protected_lead_review_due");

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
              {["ACTIVE", "BLOCKED", "NOT_YET_ELIGIBLE", "STALE", "SIMULATED_LIMIT_REACHED"].map(state => <div key={state} className="rounded-lg border bg-white px-3 py-2">
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
                   {item.payload?.task_blocker && <div>Task WHY: #{item.payload.task_blocker.id} · {item.payload.task_blocker.title || "Untitled"} · due {item.payload.task_blocker.dueDate || "unscheduled"} {item.payload.task_blocker.dueTime || ""} · created by {item.payload.task_blocker.createdBy ?? "—"} · {item.payload.task_blocker.classification} ({item.payload.task_blocker.rule})</div>}
                   {item.decisionType === "protected_lead_review_due" && <div>Protection review: protected since {item.payload?.protected_at ? timestamp(item.payload.protected_at) : "—"}; informational threshold {item.payload?.protected_review_after_days} days. No removal was performed.</div>}
                  <Badge className="mt-1 w-fit bg-amber-100 text-amber-800 hover:bg-amber-100">SHADOW · NO ACTION TAKEN</Badge>
                </div>
              </details>)}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-lg text-[#005476]">CRM Status Intelligence</CardTitle></CardHeader>
          <CardContent className="overflow-x-auto">
            <table className="w-full text-xs"><thead className="text-left text-muted-foreground"><tr><th className="p-2">CRM Status</th><th className="p-2">Kay Classification</th><th className="p-2">Terminal?</th><th className="p-2">Rescue evaluated?</th><th className="p-2">Protected candidate?</th><th className="p-2">Workflow meaning</th></tr></thead>
              <tbody>{(data?.statusIntelligence ?? []).map(row => <tr key={row.status} className="border-t"><td className="p-2 font-medium">{row.status}</td><td className="p-2">{row.classification}</td><td className="p-2">{row.terminal ? "Yes" : "No"}</td><td className="p-2">{row.rescueEvaluated ? "Yes" : "No"}</td><td className="p-2">{row.protectedCandidate ? "Yes" : "No"}</td><td className="p-2 text-muted-foreground">{row.description}</td></tr>)}</tbody>
            </table>
          </CardContent>
        </Card>
        <Card className="border-[#3bcac4]/40">
          <CardHeader><CardTitle className="text-lg text-[#005476]">Employee Workflow Intelligence</CardTitle></CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-3">Work organization counts only — not a performance ranking or score.</p>
            {(data?.employeeWorkflow?.length ?? 0) === 0 ? <p className="text-sm text-muted-foreground">No eligible employee workflow records yet.</p> :
              <div className="grid gap-3 md:grid-cols-2">{data!.employeeWorkflow!.map(employee => <div key={employee.employee_id} className="rounded-lg border p-3">
                <div className="font-medium text-[#005476]">{employee.employee_name}</div>
                <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                  <div>Active <b>{employee.active_missions}</b></div><div>Critical <b>{employee.active_critical}</b></div><div>Rescue risk <b>{employee.rescue_risk}</b></div>
                  <div>Follow-up gaps <b>{employee.unprotected}</b></div><div>Protected attention <b>{employee.protected_attention}</b></div><div>Completed <b>{employee.completed}</b></div>
                  <div>Dismissed <b>{employee.dismissed}</b></div><div>Stale <b>{employee.stale}</b></div><div>Total <b>{employee.missions_total}</b></div>
                </div>
                {Object.keys(employee.results || {}).length > 0 && <div className="mt-2 text-xs text-muted-foreground">Reported outcomes: {Object.entries(employee.results).map(([name,total]) => `${name}: ${total}`).join(" · ")}</div>}
              </div>)}</div>}
            <details className="mt-4"><summary className="cursor-pointer text-sm font-medium text-[#005476]">Inspect recent missions (50 max)</summary>
              <div className="mt-2 max-h-64 overflow-auto text-xs">{(data?.missionInspection ?? []).map(m=><div key={m.id} className="border-b py-2">#{m.id} · {m.employee_name || "—"} · {m.lead_name || `Lead ${m.lead_id ?? "—"}`} · {m.mission_type} · {m.priority} · {m.status} · {m.reason_code} · created {timestamp(m.created_at)} {m.accepted_at ? `· accepted ${timestamp(m.accepted_at)}` : ""} {m.completed_at ? `· completed ${timestamp(m.completed_at)}` : ""} {m.result_code ? `· result ${m.result_code}` : ""}</div>)}</div>
            </details>
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