import { useEffect, useState } from "react";
import { AlertCircle, ArrowUpRight, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  launchMetaWhatsappBusinessAppSignup,
  parseMetaWhatsappSignupSessionEvent,
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

export default function MetaAppReviewPrototype() {
  const [configuration, setConfiguration] =
    useState<PrototypeConfigResponse | null>(null);
  const [configurationError, setConfigurationError] = useState(false);
  const [isLaunching, setIsLaunching] = useState(false);
  const [sessionEvent, setSessionEvent] =
    useState<MetaWhatsappSignupSessionEvent | null>(null);

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
    const handleMessage = (event: MessageEvent<unknown>) => {
      const parsed = parseMetaWhatsappSignupSessionEvent(
        event.origin,
        event.data,
      );
      if (!parsed) return;
      setSessionEvent(parsed);
      setIsLaunching(false);
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
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
  const canLaunch = Boolean(signupConfig) && !isLaunching;

  const handleLaunch = async () => {
    if (!signupConfig || isLaunching) return;
    setSessionEvent(null);
    setIsLaunching(true);
    try {
      await launchMetaWhatsappBusinessAppSignup(signupConfig, () => {
        setIsLaunching(false);
      });
    } catch {
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
              Signup did not complete. No account data was saved.
            </p>
          )}
        </div>

        <Button
          type="button"
          onClick={handleLaunch}
          disabled={!canLaunch}
          className="shrink-0 bg-[#1877f2] text-white hover:bg-[#1668d5] md:min-w-56"
        >
          {isLaunching ? "Waiting for Meta…" : "Connect company WhatsApp"}
          {!isLaunching && <ArrowUpRight aria-hidden="true" />}
        </Button>
      </div>
    </section>
  );
}