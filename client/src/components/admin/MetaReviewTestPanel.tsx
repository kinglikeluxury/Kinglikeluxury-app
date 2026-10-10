import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";

type MetaReviewStatus = {
  enabled: boolean;
  webhookConfigured: boolean;
  sendConfigured: boolean;
  bufferedEventCount: number;
  storage: "in_memory";
};

type MetaReviewEvent = {
  id: string;
  timestamp: string;
  direction: "inbound" | "outbound";
  type: string;
  text?: string;
  status?: string;
};

function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

export default function MetaReviewTestPanel() {
  const [status, setStatus] = useState<MetaReviewStatus | null>(null);
  const [events, setEvents] = useState<MetaReviewEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [statusResponse, eventsResponse] = await Promise.all([
        apiRequest("GET", "/api/admin/meta-review/whatsapp/status"),
        apiRequest("GET", "/api/admin/meta-review/whatsapp/events"),
      ]);
      const [nextStatus, nextEvents] = await Promise.all([
        statusResponse.json() as Promise<MetaReviewStatus>,
        eventsResponse.json() as Promise<{ events: MetaReviewEvent[] }>,
      ]);
      setStatus(nextStatus);
      setEvents(Array.isArray(nextEvents.events) ? nextEvents.events : []);
      setError("");
    } catch {
      setError("Could not load Meta Review Test status or events.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 5000);
    return () => window.clearInterval(interval);
  }, [refresh]);

  const sendFixedTemplate = async () => {
    setSending(true);
    setError("");
    setNotice("");
    try {
      const response = await apiRequest(
        "POST",
        "/api/admin/meta-review/whatsapp/send-test-template",
        {},
      );
      const result = await response.json() as { message?: string };
      setNotice(result.message ?? "The fixed test template was submitted.");
      await refresh();
    } catch {
      setError("The test template was not sent. Check the isolated test configuration.");
    } finally {
      setSending(false);
    }
  };

  const fullyReady = status?.webhookConfigured && status.sendConfigured;

  return (
    <section
      aria-labelledby="meta-review-test-heading"
      className="mb-4 rounded-2xl border border-cyan-200 bg-white p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-xl bg-cyan-50 p-2 text-cyan-800">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="meta-review-test-heading" className="text-base font-bold text-slate-900">
                Meta Review Test
              </h2>
              <Badge className="bg-cyan-100 text-cyan-900 hover:bg-cyan-100">
                Test WABA only
              </Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm text-slate-600">
              Isolated real Cloud API events; not connected to employee mock conversations.
              Events are kept in memory and clear when this server restarts.
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void refresh()}
          disabled={loading}
        >
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-3 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          {fullyReady ? (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
          ) : (
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
          )}
          <span className="text-slate-700">
            {loading
              ? "Checking isolated test configuration…"
              : fullyReady
                ? "Test webhook and fixed template sender are configured."
                : "Demo disabled until dedicated META_REVIEW_WA_TEST_* settings are configured."}
          </span>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={() => void sendFixedTemplate()}
          disabled={!status?.sendConfigured || sending}
          className="bg-[#005476] text-white hover:bg-[#00415b]"
        >
          <Send className="mr-2 h-4 w-4" aria-hidden="true" />
          {sending ? "Sending…" : "Send hello_world test template"}
        </Button>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm text-emerald-700">
          {notice}
        </p>
      )}

      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-800">Verified test events</h3>
          <span className="text-xs text-slate-500">
            {status?.bufferedEventCount ?? events.length} in memory
          </span>
        </div>
        {events.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">
            No verified test events received yet.
          </div>
        ) : (
          <ol className="max-h-80 space-y-2 overflow-y-auto rounded-xl border border-slate-200 p-2">
            {events.map((event) => (
              <li
                key={event.id}
                className="rounded-lg bg-slate-50 px-3 py-2"
              >
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="capitalize">
                      {event.direction}
                    </Badge>
                    <span className="text-xs font-medium text-slate-700">
                      {event.type.replaceAll("_", " ")}
                      {event.status ? ` · ${event.status}` : ""}
                    </span>
                  </div>
                  <time className="text-xs text-slate-500" dateTime={event.timestamp}>
                    {formatTimestamp(event.timestamp)}
                  </time>
                </div>
                {event.text && (
                  <p dir="auto" className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-800">
                    {event.text}
                  </p>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
