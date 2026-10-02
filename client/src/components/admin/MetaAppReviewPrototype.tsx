import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowUpRight, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  getMetaSdkBootstrapDiagnostics,
  getSafeMetaSdkInitializationStage,
  launchMetaWhatsappBusinessAppSignup,
  getSafeMetaSdkDiagnostic,
  parseMetaWhatsappSignupSessionEvent,
  preloadMetaWhatsappBusinessAppSignup,
  subscribeToMetaSdkBootstrapDiagnostics,
  type MetaSdkBootstrapDiagnostics,
  type MetaWhatsappLoginResult,
  type MetaWhatsappSignupConfig,
  type MetaWhatsappSignupSessionEvent,
} from "@/lib/metaWhatsappMonitorSignup";

type PrototypeConfigResponse = {
  enabled: boolean;
  configured: boolean;
  status: "not_connected";
  appId?: string;
  configId?: string;
};

function isPrototypeConfigResponse(
  value: unknown,
): value is PrototypeConfigResponse {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PrototypeConfigResponse>;
  return (
    typeof candidate.enabled === "boolean" &&
    typeof candidate.configured === "boolean" &&
    candidate.status === "not_connected" &&
    (candidate.appId === undefined || typeof candidate.appId === "string") &&
    (candidate.configId === undefined || typeof candidate.configId === "string")
  );
}

type PrototypeStatus =
  | MetaWhatsappSignupSessionEvent
  | { kind: "authorized" | "no_authorization" | "timeout" };

type SignupTimeoutRef = {
  current: ReturnType<typeof setTimeout> | null;
};

const SIGNUP_TIMEOUT_MS = 20_000;

function clearSignupTimeout(timeoutRef: SignupTimeoutRef): void {
  if (timeoutRef.current) {
    clearTimeout(timeoutRef.current);
    timeoutRef.current = null;
  }
}

export default function MetaAppReviewPrototype() {
  const [configuration, setConfiguration] =
    useState<PrototypeConfigResponse | null>(null);
  const [configurationError, setConfigurationError] = useState(false);
  const [sdkStatus, setSdkStatus] =
    useState<"idle" | "loading" | "ready" | "error">("idle");
  const [sdkDiagnostic, setSdkDiagnostic] = useState<string | null>(null);
  const [sdkDiagnostics, setSdkDiagnostics] =
    useState<MetaSdkBootstrapDiagnostics>(getMetaSdkBootstrapDiagnostics);
  const [isLaunching, setIsLaunching] = useState(false);
  const [sessionEvent, setSessionEvent] = useState<PrototypeStatus | null>(null);
  const signupTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionEventReceivedRef = useRef(false);
  const signupAttemptActiveRef = useRef(false);
  const signupAttemptIdRef = useRef(0);

  useEffect(() => {
    let active = true;

    fetch("/api/admin/whatsapp-monitor/prototype-config", {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Prototype configuration unavailable.");
        const data: unknown = await response.json();
        if (!isPrototypeConfigResponse(data)) {
          throw new Error("Prototype configuration unavailable.");
        }
        if (active) setConfiguration(data);
      })
      .catch(() => {
        if (active) setConfigurationError(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return subscribeToMetaSdkBootstrapDiagnostics((diagnostics) => {
      setSdkDiagnostics(diagnostics);
    });
  }, []);

  useEffect(() => {
    const appId =
      configuration?.enabled && configuration.configured
        ? configuration.appId
        : undefined;
    if (!appId) {
      setSdkStatus("idle");
      setSdkDiagnostic(null);
      return;
    }

    let active = true;
    setSdkStatus("loading");
    setSdkDiagnostic(null);
    preloadMetaWhatsappBusinessAppSignup(appId)
      .then(() => {
        if (active) setSdkStatus("ready");
      })
      .catch((error: unknown) => {
        if (active) {
          setSdkDiagnostic(getSafeMetaSdkDiagnostic(error));
          setSdkStatus("error");
        }
      });

    return () => {
      active = false;
    };
  }, [
    configuration?.enabled,
    configuration?.configured,
    configuration?.appId,
  ]);

  useEffect(() => {
    const handleMessage = (event: MessageEvent<unknown>) => {
      const parsed = parseMetaWhatsappSignupSessionEvent(
        event.origin,
        event.data,
      );
      if (!parsed) return;
      sessionEventReceivedRef.current = true;
      signupAttemptActiveRef.current = false;
      clearSignupTimeout(signupTimeoutRef);
      setSessionEvent(parsed);
      setIsLaunching(false);
    };

    window.addEventListener("message", handleMessage);
    return () => {
      window.removeEventListener("message", handleMessage);
      signupAttemptActiveRef.current = false;
      clearSignupTimeout(signupTimeoutRef);
    };
  }, []);

  const signupConfig: MetaWhatsappSignupConfig | null =
    configuration?.enabled &&
    configuration.configured &&
    configuration.appId &&
    configuration.configId
      ? {
          appId: configuration.appId,
          configId: configuration.configId,
        }
      : null;
  const canLaunch =
    Boolean(signupConfig) && sdkStatus === "ready" && !isLaunching;
  const sdkDiagnosticRows: Array<[string, boolean]> = [
    ["SDK script tag present", sdkDiagnostics.sdkScriptTagPresent],
    ["SDK script load event fired", sdkDiagnostics.sdkScriptLoadEventFired],
    ["SDK script error event fired", sdkDiagnostics.sdkScriptErrorEventFired],
    ["fbAsyncInit fired", sdkDiagnostics.fbAsyncInitFired],
    ["window.FB present", sdkDiagnostics.windowFbPresent],
    ["FB.init attempted", sdkDiagnostics.fbInitAttempted],
    ["SDK ready", sdkDiagnostics.sdkReady],
    ["Timeout reached", sdkDiagnostics.timeoutReached],
  ];

  const handleLoginResult = (result: MetaWhatsappLoginResult) => {
    if (
      !signupAttemptActiveRef.current ||
      sessionEventReceivedRef.current
    ) {
      return;
    }
    if (result === "authorized") {
      setSessionEvent({ kind: "authorized" });
      return;
    }

    signupAttemptActiveRef.current = false;
    clearSignupTimeout(signupTimeoutRef);
    setIsLaunching(false);
    if (result === "cancelled") {
      setSessionEvent({ kind: "cancelled" });
    } else if (result === "error") {
      setSessionEvent({ kind: "error" });
    } else {
      setSessionEvent({ kind: "no_authorization" });
    }
  };

  const handleLaunch = () => {
    if (!signupConfig || sdkStatus !== "ready" || isLaunching) return;
    const attemptId = signupAttemptIdRef.current + 1;
    signupAttemptIdRef.current = attemptId;
    sessionEventReceivedRef.current = false;
    signupAttemptActiveRef.current = true;
    setSessionEvent(null);
    setIsLaunching(true);
    clearSignupTimeout(signupTimeoutRef);
    signupTimeoutRef.current = setTimeout(() => {
      if (signupAttemptIdRef.current !== attemptId) return;
      signupTimeoutRef.current = null;
      signupAttemptActiveRef.current = false;
      if (sessionEventReceivedRef.current) return;
      setIsLaunching(false);
      setSessionEvent({ kind: "timeout" });
    }, SIGNUP_TIMEOUT_MS);

    try {
      // SDK readiness is established before enabling the button, so FB.login
      // runs synchronously within this click handler's user-activation window.
      launchMetaWhatsappBusinessAppSignup(signupConfig, (result) => {
        if (signupAttemptIdRef.current !== attemptId) return;
        handleLoginResult(result);
      });
    } catch {
      signupAttemptActiveRef.current = false;
      clearSignupTimeout(signupTimeoutRef);
      setIsLaunching(false);
      setSessionEvent({ kind: "error" });
    }
  };

  return (
    <section
      aria-labelledby="meta-app-review-prototype-title"
      className="mb-4 shrink-0 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[#005476]" aria-hidden="true" />
            <h2
              id="meta-app-review-prototype-title"
              className="text-sm font-bold text-[#005476]"
            >
              Meta App Review Prototype
            </h2>
            <Badge
              variant="outline"
              className="border-slate-300 bg-slate-50 text-slate-700"
            >
              Status: Not connected
            </Badge>
          </div>

          <p className="text-xs leading-relaxed text-slate-600">
            Only authorized company-owned WhatsApp Business accounts may be
            connected.
          </p>
          <p className="text-xs leading-relaxed text-slate-600">
            No WhatsApp account data is stored in this prototype.
          </p>

          {configurationError && (
            <p className="flex items-center gap-1.5 text-xs text-amber-700" role="status">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Prototype configuration is unavailable. No account data was saved.
            </p>
          )}

          {configuration && !configuration.enabled && (
            <p className="text-xs text-slate-500" role="status">
              The prototype is disabled.
            </p>
          )}

          {configuration?.enabled && !configuration.configured && (
            <p className="text-xs text-amber-700" role="status">
              The prototype is enabled but its app configuration is incomplete.
            </p>
          )}

          {sdkStatus === "loading" && (
            <p className="text-xs text-slate-500" role="status">
              Preparing Meta signup. The connect button will be available when ready.
            </p>
          )}

          {sdkStatus === "error" && (
            <p className="text-xs text-amber-700" role="status">
              {sdkDiagnostic ?? "Facebook SDK initialization failed."} No
              account data was saved.
            </p>
          )}

          <div
            className="rounded-md border border-slate-200 bg-slate-50 p-2 text-xs"
            aria-label="Temporary SDK diagnostics"
          >
            <p className="mb-1 font-semibold text-slate-700">
              Temporary SDK diagnostics
            </p>
            <dl className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
              {sdkDiagnosticRows.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-slate-600">{label}</dt>
                  <dd className="font-medium text-slate-900">
                    {value ? "Yes" : "No"}
                  </dd>
                </div>
              ))}
              <div className="flex justify-between gap-3 sm:col-span-2">
                <dt className="text-slate-600">Current initialization stage</dt>
                <dd className="text-right font-medium text-slate-900">
                  {getSafeMetaSdkInitializationStage(sdkDiagnostics.stage)}
                </dd>
              </div>
            </dl>
          </div>

          {sessionEvent?.kind === "completed" && (
            <div className="rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-900" role="status">
              <p>
                Signup session completed. Nothing was saved or token-exchanged.
              </p>
              {sessionEvent.wabaId && (
                <p className="mt-1">
                  WABA ID: <code dir="ltr">{sessionEvent.wabaId}</code>
                </p>
              )}
              {sessionEvent.phoneNumberId && (
                <p className="mt-1">
                  Phone Number ID:{" "}
                  <code dir="ltr">{sessionEvent.phoneNumberId}</code>
                </p>
              )}
            </div>
          )}

          {sessionEvent?.kind === "cancelled" && (
            <p className="text-xs text-slate-600" role="status">
              Signup was canceled. Nothing was saved.
            </p>
          )}

          {sessionEvent?.kind === "error" && (
            <p className="text-xs text-amber-700" role="status">
              Meta returned an error or could not open the signup dialog. No account data was saved.
            </p>
          )}

          {sessionEvent?.kind === "no_authorization" && (
            <p className="text-xs text-slate-600" role="status">
              Meta did not return authorization. Nothing was saved.
            </p>
          )}

          {sessionEvent?.kind === "authorized" && (
            <p className="text-xs text-slate-600" role="status">
              Meta authorization returned. Waiting for signup confirmation; no code or token was saved.
            </p>
          )}

          {sessionEvent?.kind === "timeout" && (
            <p className="text-xs text-amber-700" role="status">
              Meta did not respond in time. Nothing was saved; you can try again.
            </p>
          )}
        </div>

        <Button
          type="button"
          onClick={handleLaunch}
          disabled={!canLaunch}
          className="shrink-0 bg-[#1877f2] text-white hover:bg-[#1668d5] md:min-w-56"
        >
          {isLaunching
            ? "Waiting for Meta…"
            : sdkStatus === "loading"
              ? "Preparing Meta…"
              : "Connect company WhatsApp"}
          {!isLaunching && sdkStatus !== "loading" && (
            <ArrowUpRight aria-hidden="true" />
          )}
        </Button>
      </div>
    </section>
  );
}