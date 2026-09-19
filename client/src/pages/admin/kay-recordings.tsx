import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Download, FileAudio, LockKeyhole, Play, RefreshCw, ShieldCheck } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type Recording = {
  id: number;
  archive_type: "EMPLOYEE_CALL" | "MANAGER_DEBRIEF";
  employee_id: number | null;
  employee_name: string | null;
  counterpart_name: string | null;
  call_started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  recording_status: string;
  notice_status: string;
  notice_played_at: string | null;
  notice_failure_reason: string | null;
  media_type: string | null;
  created_at: string;
};

type ArchiveView = {
  supervisedEmployees: Array<{ id: number; name: string }>;
  recordings: Recording[];
  managerDebriefs: Recording[];
  storage: {
    configured: boolean;
    playbackAvailable: boolean;
    provider: string;
    reason?: string;
  };
  controls: {
    employeeStop: boolean;
    employeeDelete: boolean;
    consentFlow: boolean;
  };
};

function formatDate(value: string | null) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatDuration(seconds: number | null) {
  if (seconds == null) return "—";
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "READY") return "default";
  if (status === "NOTICE_FAILED" || status === "FAILED") return "destructive";
  if (status === "RECORDING" || status === "FINALIZING" || status === "UPLOADING") return "secondary";
  return "outline";
}

function RecordingRow({ recording }: { recording: Recording }) {
  const ready = recording.recording_status === "READY";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">
              {recording.counterpart_name || "Kay internal call"}
            </span>
            <Badge variant={statusVariant(recording.recording_status)}>
              {recording.recording_status}
            </Badge>
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Started {formatDate(recording.call_started_at || recording.created_at)}
            {" · "}Duration {formatDuration(recording.duration_seconds)}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Notice: {recording.notice_status === "PLAYED" ? "played" : recording.notice_status.toLowerCase()}
            {recording.notice_failure_reason ? ` — ${recording.notice_failure_reason}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {ready ? (
            <>
              <Button asChild size="sm" variant="outline" className="gap-2">
                <a href={`/api/admin/kay/recordings/${recording.id}/play`} target="_blank" rel="noreferrer">
                  <Play className="h-4 w-4" /> Play
                </a>
              </Button>
              <Button asChild size="sm" variant="outline" className="gap-2">
                <a href={`/api/admin/kay/recordings/${recording.id}/download`} target="_blank" rel="noreferrer">
                  <Download className="h-4 w-4" /> Download
                </a>
              </Button>
            </>
          ) : (
            <span className="rounded-lg bg-slate-100 px-3 py-2 text-xs text-slate-500">
              Audio unavailable
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function ArchiveCard({
  employee,
  recordings,
}: {
  employee: { id: number; name: string };
  recordings: Recording[];
}) {
  return (
    <Card className="border-slate-200 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg text-slate-900">{employee.name}</CardTitle>
        <CardDescription>Private Kay call archive · employee controls are unavailable</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {recordings.length ? (
          recordings.map(recording => <RecordingRow key={recording.id} recording={recording} />)
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-sm text-slate-500">
            No recorded calls yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function KayRecordingsPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ArchiveView>({
    queryKey: ["/api/admin/kay/recordings"],
    queryFn: async () => (await apiRequest("GET", "/api/admin/kay/recordings")).json(),
    staleTime: 30_000,
  });

  return (
    <div className="min-h-screen bg-[#f4f8f8] pb-20">
      <header className="bg-gradient-to-r from-[#005476] to-[#3bcac4] px-6 py-8 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-white/15 p-3">
              <FileAudio className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Kay Recorded Calls</h1>
              <p className="mt-1 text-sm text-white/80">
                Administrative archive · Samer, Fadi, and Jwana
              </p>
            </div>
          </div>
          <Button
            variant="secondary"
            size="sm"
            className="gap-2 bg-white/15 text-white hover:bg-white/25"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6">
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="border-slate-200">
            <CardContent className="flex items-start gap-3 p-5">
              <LockKeyhole className="mt-0.5 h-5 w-5 text-[#005476]" />
              <div>
                <p className="font-semibold text-slate-900">Private storage</p>
                <p className="mt-1 text-sm text-slate-500">
                  Audio stays outside PostgreSQL and is served only through short-lived signed URLs.
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="flex items-start gap-3 p-5">
              <ShieldCheck className="mt-0.5 h-5 w-5 text-[#005476]" />
              <div>
                <p className="font-semibold text-slate-900">Informational notice</p>
                <p className="mt-1 text-sm text-slate-500">
                  No employee consent flow is required. Failed notice playback blocks CRM discussion.
                </p>
              </div>
            </CardContent>
          </Card>
          <Card className="border-slate-200">
            <CardContent className="flex items-start gap-3 p-5">
              <FileAudio className="mt-0.5 h-5 w-5 text-[#005476]" />
              <div>
                <p className="font-semibold text-slate-900">Foundation phase</p>
                <p className="mt-1 text-sm text-slate-500">
                  No calls, uploads, transcription, or employee stop/delete controls are enabled here.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

        {isLoading && (
          <div className="rounded-xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
            Loading Kay recording archives…
          </div>
        )}

        {isError && (
          <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Archive unavailable</p>
              <p className="mt-1 text-sm">
                {(error as Error)?.message || "Kay recording metadata is not installed or is unavailable."}
              </p>
            </div>
          </div>
        )}

        {data && (
          <>
            <div className={`rounded-xl border p-4 text-sm ${
              data.storage.configured
                ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                : "border-amber-200 bg-amber-50 text-amber-900"
            }`}>
              <p className="font-semibold">
                Storage: {data.storage.configured ? "configured" : "fail-closed"}
              </p>
              <p className="mt-1">
                {data.storage.reason || "Private storage is ready for future signed playback."}
              </p>
            </div>

            <section className="space-y-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">Employee archives</h2>
                <p className="mt-1 text-sm text-slate-500">
                  Only the three supervised employees are included. Admin identity and Unassigned are excluded.
                </p>
              </div>
              <div className="grid gap-5 lg:grid-cols-3">
                {data.supervisedEmployees.map(employee => (
                  <ArchiveCard
                    key={employee.id}
                    employee={employee}
                    recordings={data.recordings.filter(recording => recording.employee_id === employee.id)}
                  />
                ))}
              </div>
            </section>

            <section>
              <Card className="border-slate-200 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-xl text-slate-900">Manager Debriefs</CardTitle>
                  <CardDescription>
                    Reserved for Kay’s future daily manager call with Tarek. This is a separate archive.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {data.managerDebriefs.length ? (
                    data.managerDebriefs.map(recording => <RecordingRow key={recording.id} recording={recording} />)
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-200 px-4 py-7 text-center text-sm text-slate-500">
                      No manager debrief recordings yet.
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          </>
        )}
      </main>
    </div>
  );
}