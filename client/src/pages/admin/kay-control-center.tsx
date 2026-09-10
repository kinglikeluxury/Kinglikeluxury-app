import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Copy,
  ExternalLink,
  History,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";
import { Link } from "wouter";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KayWorkspace } from "@/components/kay/KayWorkspace";

type Decision = {
  id: number;
  leadId: number | null;
  decisionType?: string;
  rationale?: string;
  createdAt: string;
  payload?: any;
};
type Employee = {
  id?: number;
  employee_id?: number;
  name?: string;
  employee_name?: string;
  availability?: string;
};
type Control = {
  mode: "shadow" | "assisted" | "controlled_automation";
  decisions: Decision[];
  events?: any[];
  employees?: Employee[];
  employeeWorkflow?: Employee[];
  statusIntelligence?: any[];
  operationsHealth?: any;
  protectedLeads?: any[];
};
type RescuePreview = {
  lead: {
    id: number;
    status: string;
    ownerId: number;
    ownerName: string;
    contactStage?: string | null;
  };
  decision: {
    id: number;
    state: string;
    statusWindow?: string | null;
    thresholdMinutes: number;
    elapsedMinutes: number;
    why: string;
    fingerprint?: string;
  };
  protection: { protected: boolean };
  blockers: { id?: number; title?: string; reason?: string }[];
  lastMission: {
    id?: number;
    missionType?: string;
    status?: string;
    createdAt?: string;
    objective?: string;
  } | null;
  commitments: { id?: number; action?: string; status?: string; dueAt?: string }[];
  promises: { id?: number; promiseText?: string; status?: string; dueAt?: string }[];
  target: {
    id: number;
    name: string;
    role: string;
    active: boolean;
    availability: string;
    eligible: boolean;
  };
};
type PreviewResponse = {
  preview: RescuePreview;
  warning: string;
  revalidationRequired: boolean;
};
type RescueSettings = {
  no_answer_1_threshold_hours: number;
  no_answer_2_threshold_hours: number;
  max_human_rescue_attempts: number;
  rescue_warning_minutes: number;
  protected_review_after_days: number;
  assisted_rescue_undo_minutes: number;
  auto_rescue_no_answer_1_enabled: boolean;
  auto_rescue_no_answer_2_enabled: boolean;
  auto_rescue_kill_switch: boolean;
  auto_rescue_canary_enabled: boolean;
  auto_rescue_canary_employee_ids: number[];
  auto_rescue_daily_limit: number;
  auto_rescue_per_employee_daily_limit: number;
  rescue_grace_minutes: number;
  rescue_grace_max_count: number;
  auto_rescue_rule_version: string;
  rescue_enabled: false;
};
type AutoHealth = {
  enabled: boolean;
  mode: string;
  killSwitch: boolean;
  canaryEnabled: boolean;
  canaryEmployees: number;
  pendingWarnings: number;
  ready: number;
  blocked: number;
  rejected: number;
  executedToday: number;
  lastSuccessfulCycle?: string | null;
  errors: number;
  consecutiveFailures: number;
  circuit: string;
  leaseState: string;
};
type Readiness = {
  checked: number;
  wouldExecute: number;
  wouldBlock: number;
  managerReview: number;
  noEligibleEmployee: number;
  protected: number;
  dailyLimitImpact: number;
  dryRun?: boolean;
};
type AutoHistory = {
  id: number;
  outcome: string;
  rejection_reason?: string | null;
  created_at: string;
  undone_at?: string | null;
  rule_version?: string;
  rule_status?: string;
  queue_status?: string;
};

const date = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : "Not available";
const label = (value: any) =>
  value === undefined || value === null || value === "" ? "Not available" : String(value);

type QueryState<T> = {
  data: T | undefined;
  isLoading: boolean;
  isError: boolean;
  isFetching?: boolean;
  refetch: () => Promise<unknown>;
};

function SectionSkeleton({ title, rows = 3 }: { title: string; rows?: number }) {
  return (
    <Card aria-label={`${title} loading`}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {Array.from({ length: rows }).map((_, index) => (
          <div
            className="h-4 animate-pulse rounded bg-[#e4eeeb]"
            key={`${title}-skeleton-${index}`}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function SectionError({
  title,
  detail,
  retry,
  isFetching = false,
}: {
  title: string;
  detail: string;
  retry: () => unknown;
  isFetching?: boolean;
}) {
  return (
    <Card className="border-red-200" role="alert">
      <CardContent className="flex flex-wrap items-center gap-3 p-5">
        <ShieldAlert className="h-5 w-5 shrink-0 text-red-700" />
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-[#163b3b]">{title}</p>
          <p className="mt-1 text-sm text-slate-600">{detail}</p>
        </div>
        <Button variant="outline" onClick={retry} disabled={isFetching}>
          <RefreshCw className={`mr-2 h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
          Retry
        </Button>
      </CardContent>
    </Card>
  );
}

export default function KayControlCenterPage() {
  const control = useQuery<Control>({
    queryKey: ["/api/admin/kay/control"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/kay/control")).json(),
  });
  const [selected, setSelected] = useState<Decision | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [notice, setNotice] = useState("");
  const phaseD = useQuery<any>({
    queryKey: ["/api/admin/kay/settings/phase-d"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/kay/settings/phase-d")).json(),
  });
  const ownerBrief = useQuery<any>({
    queryKey: ["/api/admin/kay/owner-brief"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/kay/owner-brief")).json(),
  });
  const reviews = useQuery<any>({
    queryKey: ["/api/admin/kay/reviews"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/kay/reviews")).json(),
  });
  const rescueSettings = useQuery<RescueSettings>({
    queryKey: ["/api/admin/kay/settings/rescue"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/kay/settings/rescue")).json(),
  });
  const autoHealth = useQuery<AutoHealth>({
    queryKey: ["/api/admin/kay/auto-rescue/health"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/kay/auto-rescue/health")).json(),
  });
  const readiness = useQuery<Readiness>({
    queryKey: ["/api/admin/kay/auto-rescue/readiness"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/kay/auto-rescue/readiness")).json(),
  });
  const legacyReadiness = useQuery<any>({
    queryKey: ["/api/admin/kay/legacy-rescue-baselines/readiness"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/admin/kay/legacy-rescue-baselines/readiness")).json(),
  });
  const legacyDiagnostics = useQuery<any>({
    queryKey: ["/api/admin/kay/legacy-rescue-baselines/diagnostics"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/admin/kay/legacy-rescue-baselines/diagnostics")).json(),
  });
  const e23Diagnostics = useQuery<any>({
    queryKey: ["/api/admin/kay/legacy-rescue-baselines/e23-diagnostics"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/admin/kay/legacy-rescue-baselines/e23-diagnostics")).json(),
  });
  const scope = useQuery<any>({
    queryKey: ["/api/admin/kay/settings/operational-scope"],
    queryFn: async () =>
      (await apiRequest("GET", "/api/admin/kay/settings/operational-scope")).json(),
  });
  const autoHistory = useQuery<{ history: AutoHistory[] }>({
    queryKey: ["/api/admin/kay/auto-rescue/history"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/kay/auto-rescue/history")).json(),
  });
  const [legacyPreviewState, setLegacyPreview] = useState<any>(null);
  const [legacyPreviewError, setLegacyPreviewError] = useState("");
  const [legacyPreviewLoading, setLegacyPreviewLoading] = useState(false);
  const mode = "recommendation_only";
  const hasDecisionLedger = Array.isArray(control.data?.decisions);
  const decisions = useMemo(
    () =>
      (hasDecisionLedger ? control.data?.decisions ?? [] : []).filter(
        (decision) => decision.payload?.state === "ACTIVE",
      ),
    [control.data?.decisions, hasDecisionLedger],
  );
  const loadPreview = async (decision: Decision) => {
    if (!decision.leadId) return;
    setSelected(decision);
    setPreview(null);
    setPreviewError("");
    try {
      const response = await apiRequest(
        "GET",
        `/api/admin/kay/rescue/${decision.leadId}/${decision.id}/preview`,
      );
      setPreview((await response.json()) as PreviewResponse);
    } catch (error: any) {
      setPreviewError(error.message || "Unable to load the live rescue preview.");
    }
  };
  const loadLegacyPreview = async () => {
    setLegacyPreviewLoading(true);
    setLegacyPreview(null);
    setLegacyPreviewError("");
    try {
      const response = await apiRequest(
        "GET",
        "/api/admin/kay/legacy-rescue-baselines/preview",
      );
      setLegacyPreview(await response.json());
    } catch (error: any) {
      setLegacyPreviewError(error.message || "Unable to load the observation preview.");
    } finally {
      setLegacyPreviewLoading(false);
    }
  };

  if (control.isLoading) {
    return (
      <main className="min-h-[100dvh] bg-[#f4f7f6] p-6">
        <div className="mx-auto max-w-6xl animate-pulse space-y-4">
          <div className="h-28 rounded-2xl bg-[#dbe7e3]" />
          <div className="h-48 rounded-2xl bg-[#e7efec]" />
          <div className="h-64 rounded-2xl bg-[#e7efec]" />
        </div>
      </main>
    );
  }
  if (control.isError) {
    return (
      <main className="min-h-[100dvh] bg-[#f4f7f6] p-8">
        <Card className="mx-auto max-w-lg border-red-200">
          <CardContent className="space-y-4 p-6">
            <ShieldAlert className="text-red-700" />
            <h1 className="text-xl font-semibold text-[#163b3b]">
              Kay Control Center unavailable
            </h1>
            <p className="text-sm text-slate-600">
              The control snapshot could not be loaded. No CRM action was taken.
            </p>
            <Button onClick={() => control.refetch()} disabled={control.isFetching}>
              <RefreshCw className={`mr-2 h-4 w-4 ${control.isFetching ? "animate-spin" : ""}`} />
              Retry
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const copyRecommendation = (text: string) => {
    const copyPromise = navigator.clipboard?.writeText(text);
    if (copyPromise) {
      copyPromise.then(
        () => setNotice("Recommendation copied. No CRM change was made."),
        () => setNotice("Recommendation could not be copied; no CRM change was made."),
      );
    } else {
      setNotice("Clipboard unavailable; no CRM change was made.");
    }
  };

  return (
    <KayWorkspace
      admin
      title="Control Center"
      subtitle="Executive oversight for Kay’s recommendation ledger, operational scope, and preserved safety evidence."
      actions={
        <Button
          variant="outline"
          className="border-[#b9d9d6] bg-[#fbfdfd] text-[#005476]"
          onClick={() => control.refetch()}
          disabled={control.isFetching}
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Refresh
        </Button>
      }
    >
      <div className="space-y-5">
        <Card className="border-[#a9c9c0] bg-[#fbfdfc]">
          <CardContent className="flex flex-wrap items-center justify-between gap-5 p-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#57756e]">
                Permanent operating mode
              </p>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <Badge className="bg-[#d8eee8] text-[#205c52] hover:bg-[#d8eee8]">
                  {mode.replaceAll("_", " ").toUpperCase()}
                </Badge>
                <span className="text-sm font-medium">Read-only recommendations</span>
              </div>
            </div>
            <p className="max-w-xl text-sm leading-6 text-slate-600">
              This UI cannot execute Rescue, undo a historical execution, change an owner, or
              change a CRM status. Recommendation history remains visible for audit; CRM actions
              belong to authorized humans in the normal CRM.
            </p>
          </CardContent>
        </Card>
        <Card className="border-[#d6b36a] bg-[#fffdf7]">
          <CardContent className="flex items-start gap-3 p-5 text-sm">
            <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[#a66b20]" />
            <div>
              <p className="font-semibold text-[#765016]">KAY CRM ACCESS: READ ONLY</p>
              <p className="mt-1 text-slate-700">
                Kay can explain a recommendation and show the current CRM values, but it cannot
                perform the recommended change. Open the Lead to let an authorized employee
                manually review and act. This permanent rule is independent of mode, approval,
                kill switch, canary, scheduler, or endpoint.
              </p>
            </div>
          </CardContent>
        </Card>
        {notice && (
          <div
            role="status"
            className="rounded-xl border border-[#9ccabd] bg-[#e7f5ef] p-4 text-sm font-medium text-[#205c52]"
          >
            <CheckCircle2 className="mr-2 inline h-4 w-4" />
            {notice}
          </div>
        )}
        <section>
          <div className="mb-3 flex items-end justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-widest text-[#57756e]">
                Decision ledger
              </p>
              <h2 className="mt-1 text-2xl font-semibold">Active rescue recommendations</h2>
            </div>
            <Badge variant="outline">
              {hasDecisionLedger ? `${decisions.length} active` : "Unavailable"}
            </Badge>
          </div>
          {!hasDecisionLedger ? (
            <SectionError
              title="Decision ledger unavailable"
              detail="The active recommendation ledger is missing from the control snapshot. No empty ledger is inferred."
              retry={() => control.refetch()}
              isFetching={control.isFetching}
            />
          ) : decisions.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-sm text-slate-600">
                No active valid rescue decisions require review.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {decisions.map((decision) => (
                <DecisionRow
                  key={decision.id}
                  decision={decision}
                  onReview={() => loadPreview(decision)}
                />
              ))}
            </div>
          )}
        </section>
        <Card className="border-[#bed2cc]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardCheck className="h-5 w-5 text-[#287567]" />
              Operational trace
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
            <Metric title="Scheduler" value={label(control.data?.operationsHealth?.scheduler)} />
            <Metric
              title="Last successful cycle"
              value={date(control.data?.operationsHealth?.lastSuccessfulCycle)}
            />
            <Metric
              title="Protected leads"
              value={
                control.data?.protectedLeads
                  ? String(control.data.protectedLeads.length)
                  : "Not available"
              }
            />
          </CardContent>
        </Card>
        <LegacyBaselineCard
          query={legacyReadiness}
          preview={legacyPreviewState}
          previewError={legacyPreviewError}
          onPreview={loadLegacyPreview}
          busy={legacyPreviewLoading}
        />
        <LegacyDiagnosticsCard query={legacyDiagnostics} />
        <E23DiagnosticsSection query={e23Diagnostics} />
        <OperationalScopeCard query={scope} />
        <E2ControlPanelStatus
          settingsQuery={rescueSettings}
          healthQuery={autoHealth}
          readinessQuery={readiness}
          historyQuery={autoHistory}
        />
        <PhaseDStatus phaseQuery={phaseD} ownerQuery={ownerBrief} />
        <ReviewQueueStatus query={reviews} />
        <LegacyIntelligence data={control.data} />
      </div>
      {selected && (
        <RescueReview
          decision={selected}
          preview={preview}
          error={previewError}
          onCopy={copyRecommendation}
          onClose={() => setSelected(null)}
        />
      )}
    </KayWorkspace>
  );
}
function OperationalScopeCard({ query }: { query: QueryState<any> }) {
  if (query.isLoading) {
    return <SectionSkeleton title="Kay monitoring scope · read only" rows={4} />;
  }
  if (query.isError || !query.data) {
    return (
      <SectionError
        title="Operational scope unavailable"
        detail="Kay remains fail-closed; no scope setting was changed."
        retry={() => query.refetch()}
        isFetching={query.isFetching}
      />
    );
  }

  const data = query.data;
  const config = data.config;
  return (
    <Card className="border-[#9fbfb5]">
      <CardHeader>
        <CardTitle>Kay monitoring scope · read only</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-slate-600">
          Fixed cohort, not a rolling 90-day window. Configuration status:{" "}
          <b>{label(data.status)}</b>.
          Scope settings are frozen while Kay is recommendation-only.
        </p>
        {config && (
          <div className="grid gap-2 sm:grid-cols-3">
            <Metric title="Launch" value={label(config.launchAtIso)} />
            <Metric title="Fixed cutoff" value={label(config.cutoffAtIso)} />
            <Metric title="Timezone" value={label(config.timezone)} />
          </div>
        )}
        <div>
          <b>Append-only audit history</b>
          <div className="mt-2 max-h-48 space-y-2 overflow-auto">
            {Array.isArray(data.audit) ? (
              data.audit.length ? (
                data.audit.map((a: any) => (
                  <div className="rounded border p-2 text-xs" key={a.id}>
                    <b>{label(a.actor)}</b> · {label(a.createdAt)}
                    <br />
                    Launch {label(a.launchAt)} · cutoff {label(a.cutoffAt)} · {label(a.timezone)}
                    <br />
                    Old {JSON.stringify(a.oldValue)} → New {JSON.stringify(a.newValue)}
                  </div>
                ))
              ) : (
                <p className="mt-2 text-xs text-slate-500">No audit entries yet.</p>
              )
            ) : (
              <p className="mt-2 text-xs text-red-700">Audit history unavailable.</p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
function LegacyBaselineCard({
  query,
  preview,
  previewError,
  onPreview,
  busy,
}: {
  query: QueryState<any>;
  preview: any;
  previewError: string;
  onPreview: () => void;
  busy: boolean;
}) {
  if (query.isLoading) {
    return <SectionSkeleton title="Legacy Rescue Baseline · observation only" rows={4} />;
  }
  if (query.isError || !query.data) {
    return (
      <SectionError
        title="Legacy Rescue Baseline unavailable"
        detail="Historical readiness could not be loaded. No initialization or CRM change was performed."
        retry={() => query.refetch()}
        isFetching={query.isFetching}
      />
    );
  }

  const statuses = query.data.statuses;
  if (!statuses || typeof statuses !== "object") {
    return (
      <SectionError
        title="Legacy Rescue Baseline incomplete"
        detail="The readiness response did not include historical status evidence. No empty baseline is inferred."
        retry={() => query.refetch()}
        isFetching={query.isFetching}
      />
    );
  }
  return (
    <Card className="border-[#d6b36a] bg-[#fffdf7]">
      <CardHeader>
        <CardTitle>Legacy Rescue Baseline · observation only</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-slate-600">
          Actual historical status-entry time is unknown. Historical evidence remains visible, but
          Kay cannot initialize records, change ownership, or change CRM status.
        </p>
        {!Object.keys(statuses).length && (
          <p className="text-sm text-red-700">Historical status evidence unavailable.</p>
        )}
        <div className="grid gap-2 sm:grid-cols-2">
          {["no_answer_1", "no_answer_2"].map((status) => (
            <div className="rounded border p-3" key={status}>
              <b>{status}</b>
              <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
                {Object.entries(statuses[status] ?? {}).map(([key, value]) => (
                  <p key={key}>
                    <span className="text-slate-500">{key}:</span>{" "}
                    <b>{label(value)}</b>
                  </p>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" onClick={onPreview} disabled={busy}>
            {busy && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
            Preview observation
          </Button>
          <Badge variant="outline">Initialization frozen</Badge>
        </div>
        {previewError && (
          <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            <p>{previewError}</p>
            <Button className="mt-2" size="sm" variant="outline" onClick={onPreview} disabled={busy}>
              Retry preview
            </Button>
          </div>
        )}
        {preview && (
          <p className="text-xs text-slate-600">
            Inspected {label(preview.inspected)}; eligible {label(preview.eligible)}. Preview
            only; no ownership, status, or internal record was written.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
function E23DiagnosticsSection({ query }: { query: QueryState<any> }) {
  if (query.isLoading) {
    return <SectionSkeleton title="Rescue ownership policy · E.2.3" rows={5} />;
  }
  if (query.isError || !query.data) {
    return (
      <SectionError
        title="E.2.3 diagnostics unavailable"
        detail="Monitoring scope, ownership, and readiness could not be loaded. No Kay action was taken."
        retry={() => query.refetch()}
        isFetching={query.isFetching}
      />
    );
  }

  const data = query.data;
  const policy = data.ownershipPolicy?.kinglike_admin;
  const scope = data.monitoringScope;
  const simulation = data.routingSimulation;

  return (
    <Card className="border-[#d6b36a] bg-[#fffdf7]">
      <CardHeader>
        <CardTitle>Rescue ownership policy · E.2.3</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-slate-600">
          Read-only policy and capacity simulation. No production routing formula or ownership is
          changed.
        </p>
        {!scope && (
          <p className="text-sm text-red-700">
            Monitoring scope is unavailable; no scope count is inferred.
          </p>
        )}
        {scope && (
          <>
            <p className="rounded border border-[#d6b36a] bg-[#fff9e8] p-3 text-xs">
              Kay manages the fixed three-month pre-launch cohort plus all future Leads. This is not
              a rolling 90-day window.
              <br />
              Launch: <b>{label(scope.launchAt)}</b> · Fixed cutoff:{" "}
              <b>{label(scope.fixedCutoffAt)}</b>
            </p>
            <div className="grid gap-2 sm:grid-cols-5">
              {[
                ["All CRM", scope.all_crm],
                ["In scope", scope.in_scope],
                ["Out legacy", scope.out_legacy],
                ["Excluded admin", scope.excluded_admin],
                ["Date uncertain", scope.uncertain],
              ].map(([key, value]) => (
                <Metric key={String(key)} title={String(key)} value={label(value)} />
              ))}
            </div>
          </>
        )}
        <div className="grid gap-2 sm:grid-cols-3">
          <Metric
            title="kinglike_admin classification"
            value={label(policy?.classification)}
          />
          <Metric
            title="Can receive Rescue"
            value={
              policy?.canReceiveRescue === false
                ? "NO"
                : policy?.canReceiveRescue === true
                  ? "YES"
                  : "Not available"
            }
          />
          <Metric
            title="Can be rescued from"
            value={
              policy?.canBeRescuedFrom === false
                ? "NO"
                : policy?.canBeRescuedFrom === true
                  ? "YES"
                  : "Not available"
            }
          />
        </div>
        {data.noAnswerScope && (
          <div className="rounded border p-3">
            <b>No-answer scope partition</b>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              {Object.entries(data.noAnswerScope).map(([key, value]) => (
                <Metric key={key} title={key} value={label(value)} />
              ))}
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Readiness calculations use managed/in-scope leads only.
            </p>
          </div>
        )}
        {data.employeeOwnership && (
          <div className="overflow-x-auto">
            <b>Employee ownership (aggregate)</b>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr>
                  <th className="text-left">Employee</th>
                  <th>CRM total</th>
                  <th>In scope</th>
                  <th>Legacy</th>
                  <th>Uncertain</th>
                </tr>
              </thead>
              <tbody>
                {data.employeeOwnership.map((employee: any) => (
                  <tr key={employee.employee}>
                    <td>{employee.employee}</td>
                    <td className="text-center">{label(employee.totalCrm)}</td>
                    <td className="text-center">{label(employee.inScope)}</td>
                    <td className="text-center">{label(employee.outOfScopeLegacy)}</td>
                    <td className="text-center">{label(employee.uncertain)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {simulation && (
          <div className="rounded border p-3">
            <b>10 hypothetical NEW Rescue leads · no database writes</b>
            <p className="mt-1 text-xs">
              Assigned {label(simulation.assigned)}/{label(simulation.requested)}; deferred{" "}
              {label(simulation.deferred)}; concentration:{" "}
              <b>{label(simulation.concentrationRisk)}</b> (threshold{" "}
              {label(simulation.concentrationThreshold)}).{" "}
              {label(simulation.concentrationExplanation)}
            </p>
            {simulation.deferredReasons?.length > 0 && (
              <p className="mt-1 text-xs text-amber-700">
                Deferred reasons: {simulation.deferredReasons.join(", ")}
              </p>
            )}
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left">Employee</th>
                    <th>Starting capacity</th>
                    <th>Projected capacity</th>
                    <th>Would receive</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(simulation.startingCapacity ?? {}).map((name) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{label(simulation.startingCapacity[name])}</td>
                      <td>{label(simulation.projectedCapacity?.[name])}</td>
                      <td>{label(simulation.receivingByEmployee?.[name])}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        {data.recommendedCapacity && (
          <p className="text-xs text-slate-600">
            Recommended capacity (inactive diagnostic): {label(data.recommendedCapacity.formula)};
            production automation remains fail-closed unless an approved scoped formula exists.
          </p>
        )}
        <p className="text-xs text-slate-500">
          Safety: MODE={label(data.safety?.mode)} · Kill switch={label(data.safety?.killSwitch)} ·
          Canary employees={label(data.safety?.canaryEmployeeCount)}
        </p>
      </CardContent>
    </Card>
  );
}

function LegacyDiagnosticsCard({ query }: { query: QueryState<any> }) {
  if (query.isLoading) {
    return <SectionSkeleton title="Legacy owner & capacity diagnostics" rows={5} />;
  }
  if (query.isError || !query.data) {
    return (
      <SectionError
        title="Legacy diagnostics unavailable"
        detail="Owner and capacity evidence could not be loaded. No Kay action was taken."
        retry={() => query.refetch()}
        isFetching={query.isFetching}
      />
    );
  }

  const data = query.data;
  const owners = data.owners;
  const capacitySensitivity = data.capacitySensitivity;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Legacy owner & capacity diagnostics</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-slate-600">{label(data.recommendation)}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {Array.isArray(owners) ? (
            owners.map((owner: any) => (
              <div className="rounded border p-2" key={owner.account}>
                <b>{label(owner.account)}</b>
                <span className="ml-2 text-xs">{label(owner.classification)}</span>
                <p>
                  Active {label(owner.active_leads)} · NA1 {label(owner.no_answer_1)} · NA2{" "}
                  {label(owner.no_answer_2)}
                </p>
                <p className="text-xs text-slate-500">{label(owner.reason)}</p>
                {owner.conclusion && (
                  <p className="text-xs font-semibold">{owner.conclusion}</p>
                )}
                <ul className="list-disc pl-4 text-xs">
                  {(owner.evidence ?? []).map((evidence: string) => (
                    <li key={evidence}>{evidence}</li>
                  ))}
                </ul>
                <p className="text-xs">
                  Status mix:{" "}
                  {(owner.statusMix ?? [])
                    .map((status: any) => `${status.status} ${label(status.count)}`)
                    .join(" · ") || "Not available"}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-red-700">Owner diagnostics unavailable.</p>
          )}
          {Array.isArray(owners) && owners.length === 0 && (
            <p className="text-sm text-slate-600">No owner diagnostic records.</p>
          )}
        </div>
        {data.ageBuckets && (
          <p className="text-xs text-slate-600">
            Age buckets:{" "}
            {Object.entries(data.ageBuckets)
              .map(([key, value]) => `${key}: ${label(value)}`)
              .join(" · ")}
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr>
                <th>Employee</th>
                <th>All nonterminal</th>
                <th>Touched 30</th>
                <th>Touched 60</th>
                <th>Touched 90</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(capacitySensitivity) ? (
                capacitySensitivity.map((row: any) => (
                  <tr key={row.employee}>
                    <td>{label(row.employee)}</td>
                    <td>{label(row.all_nonterminal)}</td>
                    <td>{label(row.touched30)}</td>
                    <td>{label(row.touched60)}</td>
                    <td>{label(row.touched90)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td className="p-2 text-red-700" colSpan={5}>
                    Capacity sensitivity unavailable.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {Array.isArray(capacitySensitivity) && capacitySensitivity.length === 0 && (
            <p className="mt-2 text-sm text-slate-600">No capacity sensitivity records.</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
function E2ControlPanelStatus({
  settingsQuery,
  healthQuery,
  readinessQuery,
  historyQuery,
}: {
  settingsQuery: QueryState<RescueSettings>;
  healthQuery: QueryState<AutoHealth>;
  readinessQuery: QueryState<Readiness>;
  historyQuery: QueryState<{ history: AutoHistory[] }>;
}) {
  if (settingsQuery.isLoading) {
    return <SectionSkeleton title="Rescue recommendations and history" rows={5} />;
  }
  if (settingsQuery.isError || !settingsQuery.data) {
    return (
      <SectionError
        title="Rescue settings unavailable"
        detail="The frozen rescue settings snapshot could not be loaded. No safeguard or CRM setting was changed."
        retry={() => settingsQuery.refetch()}
        isFetching={settingsQuery.isFetching}
      />
    );
  }

  const health = healthQuery.data;
  const readiness = readinessQuery.data;
  const history = historyQuery.data?.history;

  return (
    <section className="overflow-hidden rounded-2xl border border-[#d6b36a] bg-[#fffdf7] shadow-sm">
      <div className="border-b border-[#ead5ad] bg-[#fff8e8] p-5">
        <p className="text-xs font-bold uppercase tracking-[.18em] text-[#765016]">
          Phase E.2 · permanently frozen
        </p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold">Rescue recommendations and history</h2>
            <p className="mt-1 text-sm text-[#765016]">
              Detection, warnings, target reasoning, and historical execution evidence remain
              visible. New CRM execution is unavailable.
            </p>
          </div>
          <Badge className="bg-[#f5e3b7] text-[#765016] hover:bg-[#f5e3b7]">
            FROZEN_NO_EXECUTION
          </Badge>
        </div>
        <p className="mt-3 text-sm text-slate-700">
          Kay cannot start a worker cycle, change safeguards, transfer a Lead, change status, or
          undo an execution. An authorized human can open the Lead in the normal CRM and act under
          existing permissions.
        </p>
      </div>
      <div className="space-y-4 p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <Metric title="Mode" value="Recommendation only" />
          <Metric title="Scheduler" value="Disabled by policy" />
          <Metric title="CRM mutation by Kay" value="Denied" />
        </div>
        <div className="rounded-xl border border-[#d6b36a] bg-white p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#a66b20]" />
            <b>Frozen safety snapshot</b>
          </div>
          {healthQuery.isLoading ? (
            <div className="mt-3 space-y-2" aria-label="Rescue health loading">
              {[1, 2, 3, 4].map((item) => (
                <div className="h-4 animate-pulse rounded bg-[#e4eeeb]" key={item} />
              ))}
            </div>
          ) : healthQuery.isError || !health ? (
            <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p>Rescue health is unavailable; no zero values are being inferred.</p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                onClick={() => healthQuery.refetch()}
                disabled={healthQuery.isFetching}
              >
                <RefreshCw
                  className={`mr-2 h-4 w-4 ${healthQuery.isFetching ? "animate-spin" : ""}`}
                />
                Retry health
              </Button>
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              {[
                ["Scheduler", "disabled by policy"],
                ["Lease", health.leaseState],
                ["Warnings", health.pendingWarnings],
                ["Recommendations ready", health.ready],
                ["Blocked", health.blocked],
                ["Historical executions", health.executedToday],
                ["Failures", health.consecutiveFailures],
                ["Last cycle", date(health.lastSuccessfulCycle)],
              ].map(([key, value]) => (
                <div key={String(key)}>
                  <p className="text-xs text-slate-500">{key}</p>
                  <b>{key === "Last cycle" ? value : label(value)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border p-4">
            <b>Recommendation readiness</b>
            {readinessQuery.isLoading ? (
              <div className="mt-3 space-y-2" aria-label="Recommendation readiness loading">
                {[1, 2, 3].map((item) => (
                  <div className="h-8 animate-pulse rounded bg-[#fff1d9]" key={item} />
                ))}
              </div>
            ) : readinessQuery.isError || !readiness ? (
              <div className="mt-2 text-sm text-red-700">
                <p>Readiness is unavailable; no counts are being inferred.</p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => readinessQuery.refetch()}
                  disabled={readinessQuery.isFetching}
                >
                  Retry readiness
                </Button>
              </div>
            ) : (
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                {Object.entries(readiness)
                  .filter(([key]) => key !== "dryRun")
                  .map(([key, value]) => (
                    <div className="rounded bg-[#fff8e8] p-2" key={key}>
                      <span className="block text-xs text-slate-500">{key}</span>
                      <b>{label(value)}</b>
                    </div>
                  ))}
              </div>
            )}
          </div>
          <div className="rounded-xl border p-4">
            <div className="flex items-center gap-2">
              <History className="h-4 w-4 text-[#a66b20]" />
              <b>Historical execution records</b>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Preserved for audit. They are not re-run or relabeled by this UI.
            </p>
            {historyQuery.isLoading ? (
              <div className="mt-3 space-y-2" aria-label="Execution history loading">
                {[1, 2, 3].map((item) => (
                  <div className="h-12 animate-pulse rounded bg-[#e4eeeb]" key={item} />
                ))}
              </div>
            ) : historyQuery.isError || !Array.isArray(history) ? (
              <div className="mt-3 text-sm text-red-700">
                <p>Historical execution records are unavailable; no empty history is inferred.</p>
                <Button
                  className="mt-2"
                  size="sm"
                  variant="outline"
                  onClick={() => historyQuery.refetch()}
                  disabled={historyQuery.isFetching}
                >
                  Retry history
                </Button>
              </div>
            ) : (
              <div className="mt-3 max-h-48 space-y-2 overflow-auto">
                {history.length ? (
                  history.map((row) => (
                    <div className="rounded border p-2 text-xs" key={row.id}>
                      <b>
                        #{row.id} · {row.outcome}
                      </b>
                      <span className="ml-2 text-slate-500">{date(row.created_at)}</span>
                      <p className="mt-1 text-slate-600">
                        {row.queue_status ?? "—"} · {row.rule_status ?? "—"} ·{" "}
                        {row.rejection_reason ?? row.rule_version ?? "No exception"}
                        {row.undone_at ? ` · historical undo ${date(row.undone_at)}` : ""}
                      </p>
                    </div>
                  ))
                ) : (
                  <p className="text-sm text-slate-600">No automatic rescue history.</p>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function DecisionRow({
  decision,
  onReview,
}: {
  decision: Decision;
  onReview: () => void;
}) {
  const payload = decision.payload ?? {};
  return (
    <Card className="border-l-4 border-l-[#d39b45]">
      <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold">Lead {decision.leadId ?? "—"}</span>
            <Badge className="bg-[#fff1d9] text-[#825a1d] hover:bg-[#fff1d9]">
              {payload.state ?? "ACTIVE"}
            </Badge>
            <span className="text-xs text-slate-500">{date(decision.createdAt)}</span>
          </div>
          <p className="mt-2 text-sm text-slate-600">
            {payload.employee_selection_explanation ??
              decision.rationale ??
              "Kay identified a rescue review candidate."}
          </p>
        </div>
        {decision.leadId ? (
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={onReview}
              className="bg-[#17685d] text-white hover:bg-[#10554b]"
            >
              View recommendation
            </Button>
            <Button asChild variant="outline">
              <Link href={`/admin/crm/${decision.leadId}`}>Open Lead</Link>
            </Button>
          </div>
        ) : (
          <Badge variant="outline" className="border-[#d39b45] text-[#825a1d]">
            No Lead link available
          </Badge>
        )}
      </CardContent>
    </Card>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg bg-[#eef5f2] p-3">
      <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
      <p className="mt-1 font-semibold">{value}</p>
    </div>
  );
}
function PhaseDStatus({
  phaseQuery,
  ownerQuery,
}: {
  phaseQuery: QueryState<any>;
  ownerQuery: QueryState<any>;
}) {
  if (phaseQuery.isLoading) {
    return <SectionSkeleton title="Phase D · internal briefing snapshot" rows={5} />;
  }
  if (phaseQuery.isError || !phaseQuery.data) {
    return (
      <SectionError
        title="Phase D briefing settings unavailable"
        detail="The internal briefing snapshot could not be loaded. No internal writer, evaluator, or CRM action was started."
        retry={() => phaseQuery.refetch()}
        isFetching={phaseQuery.isFetching}
      />
    );
  }

  const phaseDValue = phaseQuery.data;
  const ownerText = ownerQuery.data?.text;
  const hasOwnerBrief = typeof ownerText === "string" && ownerText.length > 0;
  const speak = () => {
    if (!hasOwnerBrief || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(ownerText);
    utterance.lang = phaseDValue.default_language === "ar" ? "ar-SA" : "en-US";
    utterance.rate = Number(phaseDValue.speech_rate ?? 1);
    utterance.pitch = Number(phaseDValue.speech_pitch ?? 1);
    const voice = window.speechSynthesis
      .getVoices()
      .find((candidate) => candidate.name === phaseDValue.preferred_voice_name);
    if (voice) utterance.voice = voice;
    window.speechSynthesis.speak(utterance);
  };

  return (
    <Card className="border-[#9fbfb5]">
      <CardHeader>
        <CardTitle>Phase D · internal briefing snapshot</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <p className="text-slate-600">
          Kay internal briefing data is shown for observation. Current internal writers and
          evaluators are frozen; no CRM action or customer contact is initiated here.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metric
            title="Enabled"
            value={
              phaseDValue.enabled === undefined
                ? "Not available"
                : phaseDValue.enabled
                  ? "Reported enabled"
                  : "Reported disabled"
            }
          />
          <Metric
            title="Voice"
            value={
              phaseDValue.voice_enabled === undefined
                ? "Not available"
                : phaseDValue.voice_enabled === false
                  ? "Disabled"
                  : "Browser local only"
            }
          />
          <Metric title="Language" value={label(phaseDValue.default_language)} />
          <Metric title="Brief length" value={label(phaseDValue.brief_length)} />
        </div>
        <div className="rounded border bg-[#f1f6f4] p-3">
          <b>Owner Brief</b>
          {ownerQuery.isLoading ? (
            <div
              className="mt-2 h-4 animate-pulse rounded bg-[#dceae5]"
              aria-label="Owner brief loading"
            />
          ) : ownerQuery.isError || !hasOwnerBrief ? (
            <div className="mt-2 text-sm text-red-700">
              <p>Owner brief unavailable; no brief content is being inferred.</p>
              <Button
                className="mt-2"
                size="sm"
                variant="outline"
                onClick={() => ownerQuery.refetch()}
                disabled={ownerQuery.isFetching}
              >
                Retry owner brief
              </Button>
            </div>
          ) : (
            <p className="mt-1">{ownerText}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={speak}
            disabled={!hasOwnerBrief || phaseDValue.voice_enabled !== true}
          >
            Play locally
          </Button>
          <Badge variant="outline">Settings and evaluator controls frozen</Badge>
        </div>
      </CardContent>
    </Card>
  );
}

function ReviewQueueStatus({ query }: { query: QueryState<{ reviews: any[] }> }) {
  if (query.isLoading) {
    return <SectionSkeleton title="Manager reviews · read only" rows={4} />;
  }
  if (query.isError || !Array.isArray(query.data?.reviews)) {
    return (
      <SectionError
        title="Manager review history unavailable"
        detail="Review history could not be loaded. No review was resolved, returned, or otherwise changed."
        retry={() => query.refetch()}
        isFetching={query.isFetching}
      />
    );
  }

  const reviews = query.data.reviews;
  return (
    <Card className="border-[#d5b374]">
      <CardHeader>
        <CardTitle>Manager reviews · read only</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-slate-600">
          Review history is preserved. Kay cannot resolve, return, or otherwise mutate CRM data
          from this surface.
        </p>
        {reviews.length === 0 ? (
          <p className="text-sm text-slate-600">No manager reviews.</p>
        ) : (
          reviews.map((review) => (
            <div className="rounded border p-3" key={review.id}>
              <div className="flex justify-between">
                <b>{review.title ?? review.reason ?? `Review #${review.id}`}</b>
                <Badge>{review.status ?? "Not available"}</Badge>
              </div>
              <p className="my-2 text-sm text-slate-600">
                {review.description ?? review.rationale ?? "Manager context is required."}
              </p>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

function LegacyIntelligence({ data }: { data?: Control }) {
  const workflow = data?.employeeWorkflow;
  const statuses = data?.statusIntelligence;

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>CRM status intelligence</CardTitle>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-500">
                <th className="p-2">Status</th>
                <th className="p-2">Classification</th>
                <th className="p-2">Rescue</th>
                <th className="p-2">Workflow meaning</th>
              </tr>
            </thead>
            <tbody>
              {Array.isArray(statuses) &&
                statuses.map((status: any) => (
                <tr className="border-t" key={status.status}>
                  <td className="p-2 font-medium">{status.status}</td>
                  <td className="p-2">{status.classification}</td>
                  <td className="p-2">
                    {status.rescueEvaluated === undefined
                      ? "Not available"
                      : status.rescueEvaluated
                        ? "Yes"
                        : "No"}
                  </td>
                  <td className="p-2">{status.description}</td>
                </tr>
                ))}
            </tbody>
          </table>
          {!Array.isArray(statuses) ? (
            <p className="p-3 text-sm text-red-700">Status intelligence unavailable.</p>
          ) : statuses.length === 0 ? (
            <p className="p-3 text-sm text-slate-600">No status intelligence records.</p>
          ) : null}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Employee workflow intelligence</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!Array.isArray(workflow) ? (
            <p className="text-sm text-red-700">Employee workflow intelligence unavailable.</p>
          ) : workflow.length ? (
            workflow.map((employee: any) => (
              <div className="rounded border p-3 text-sm" key={employee.employee_id}>
                <b>{employee.employee_name}</b>
                <p className="mt-1 text-slate-600">
                  Active {employee.active_missions} · Critical {employee.active_critical} · Rescue
                  risk {employee.rescue_risk} · Completed {employee.completed} · Stale{" "}
                  {employee.stale}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-slate-600">No eligible employee workflow records.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
function RescueReview({
  decision,
  preview,
  error,
  onCopy,
  onClose,
}: {
  decision: Decision;
  preview: PreviewResponse | null;
  error: string;
  onCopy: (text: string) => void;
  onClose: () => void;
}) {
  const rescuePreview = preview?.preview;
  const recommendation = rescuePreview
    ? `Lead #${rescuePreview.lead.id}: Kay recommends reviewing the owner assignment. Current owner: ${rescuePreview.lead.ownerName}. Recommended target: ${rescuePreview.target.name}. Reason: ${rescuePreview.decision.why}`
    : "";

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-[#173f3d]/70 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="rescue-review-title"
    >
      <div className="mx-auto my-6 max-w-3xl rounded-2xl border border-[#bed2cc] bg-[#fbfdfc] shadow-2xl">
        <div className="flex items-start justify-between border-b border-[#d5e2de] p-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-[#a96825]">
              Recommendation · read only
            </p>
            <h2 id="rescue-review-title" className="mt-1 text-2xl font-semibold">
              Review recommendation for Lead {decision.leadId}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Kay explains the recommendation and current CRM values. Kay cannot execute, undo,
              change the owner, or change the status.
            </p>
          </div>
          <Button variant="ghost" onClick={onClose} aria-label="Close recommendation">
            Close
          </Button>
        </div>
        <div className="space-y-5 p-5">
          {error && (
            <div role="alert" className="rounded-lg bg-[#fff0ed] p-3 text-sm text-[#943f32]">
              {error}
            </div>
          )}
          {!rescuePreview && !error && (
            <div className="flex items-center gap-2 rounded-lg bg-[#eef5f2] p-4 text-sm">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Loading read-only preview…
            </div>
          )}
          {rescuePreview && (
            <>
              <div className="rounded-lg border border-[#d6b36a] bg-[#fff8e8] p-4 text-sm text-[#765016]">
                <AlertTriangle className="mr-2 inline h-5 w-5" />
                Permanent rule: Kay CRM access is read only. Any owner or status change must be
                performed manually by an authorized human in the normal CRM.
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ["Lead", `#${rescuePreview.lead.id}`],
                  ["Current owner", rescuePreview.lead.ownerName],
                  ["Recommended target", rescuePreview.target.name],
                  ["Current status", rescuePreview.lead.status],
                  ["Contact stage", label(rescuePreview.lead.contactStage)],
                  ["Status window", date(rescuePreview.decision.statusWindow)],
                  [
                    "Time / threshold",
                    `${rescuePreview.decision.elapsedMinutes} min / ${rescuePreview.decision.thresholdMinutes} min`,
                  ],
                  ["Protected", rescuePreview.protection.protected ? "Yes" : "No"],
                  [
                    "Target eligibility",
                    rescuePreview.target.eligible
                      ? `${rescuePreview.target.role} · ${rescuePreview.target.availability}`
                      : "Not eligible",
                  ],
                  ["Fingerprint", label(rescuePreview.decision.fingerprint)],
                ].map(([title, value]) => (
                  <div
                    key={title}
                    className="rounded-lg border border-[#d5e2de] bg-white p-3"
                  >
                    <p className="text-xs uppercase tracking-wide text-slate-500">{title}</p>
                    <p className="mt-1 break-words text-sm font-semibold">{value}</p>
                  </div>
                ))}
              </div>
              <div className="rounded-lg bg-[#eef5f2] p-4 text-sm">
                <p className="font-semibold">WHY this recommendation exists</p>
                <p className="mt-1 text-slate-700">{rescuePreview.decision.why}</p>
              </div>
              <LiveList title="Blockers" items={rescuePreview.blockers} empty="No live blockers." />
              <LiveList
                title="Last mission"
                items={rescuePreview.lastMission ? [rescuePreview.lastMission] : []}
                empty="No prior mission supplied."
              />
              <LiveList
                title="Open commitments"
                items={rescuePreview.commitments}
                empty="No open commitments."
              />
              <LiveList
                title="Open promises"
                items={rescuePreview.promises}
                empty="No open promises."
              />
              <div className="flex flex-wrap justify-end gap-2 border-t border-[#d5e2de] pt-4">
                <Button asChild className="bg-[#17685d] hover:bg-[#10554b]">
                  <Link href={`/admin/crm/${rescuePreview.lead.id}`}>
                    Open Lead in CRM <ExternalLink className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" onClick={() => onCopy(recommendation)}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copy recommendation
                </Button>
                <Button variant="ghost" onClick={onClose}>
                  Close review
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveList({
  title,
  items,
  empty,
}: {
  title: string;
  items: Record<string, any>[];
  empty: string;
}) {
  return (
    <div className="rounded-lg border border-[#d5e2de] p-3 text-sm">
      <p className="font-semibold">{title}</p>
      {items.length ? (
        items.map((item, index) => (
          <pre
            className="mt-2 overflow-x-auto whitespace-pre-wrap rounded bg-[#f1f6f4] p-2 text-xs"
            key={item.id ?? index}
          >
            {JSON.stringify(item, null, 2)}
          </pre>
        ))
      ) : (
        <p className="mt-1 text-slate-600">{empty}</p>
      )}
    </div>
  );
}