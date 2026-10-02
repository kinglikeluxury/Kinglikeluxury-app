export type MetaWhatsappSignupConfig = {
  appId: string;
  configId: string;
};

export type MetaWhatsappSignupSessionEvent =
  | {
      kind: "completed";
      wabaId?: string;
      phoneNumberId?: string;
    }
  | { kind: "cancelled" }
  | { kind: "error" };

export type MetaWhatsappLoginResult =
  | "authorized"
  | "cancelled"
  | "error"
  | "no_authorization";

export type MetaSdkInitializationDiagnostic =
  | "invalid_app_id_format"
  | "sdk_script_load_failed"
  | "sdk_script_insert_failed"
  | "sdk_initialization_timeout"
  | "fb_async_init_did_not_run"
  | "fb_object_missing"
  | "fb_init_threw"
  | "already_initialized_for_another_app"
  | "not_browser"
  | "sdk_not_ready"
  | "unexpected_initialization_error";

const SAFE_DIAGNOSTIC_MESSAGES: Record<
  MetaSdkInitializationDiagnostic,
  string
> = {
  invalid_app_id_format: "Invalid App ID format; the App ID must contain digits only.",
  sdk_script_load_failed:
    "Facebook SDK script failed to load. Check network access or browser blockers.",
  sdk_script_insert_failed: "The Facebook SDK script could not be added to the page.",
  sdk_initialization_timeout: "Facebook SDK initialization timed out.",
  fb_async_init_did_not_run:
    "Facebook SDK initialization timed out before fbAsyncInit ran.",
  fb_object_missing: "fbAsyncInit ran, but the FB object was missing.",
  fb_init_threw: "FB.init threw an error. Details are hidden.",
  already_initialized_for_another_app:
    "Facebook SDK is already initialized for a different App ID.",
  not_browser: "Facebook SDK initialization requires a browser.",
  sdk_not_ready: "Facebook SDK is not ready yet.",
  unexpected_initialization_error:
    "Facebook SDK initialization failed for an unexpected reason. Details are hidden.",
};

export class MetaSdkInitializationError extends Error {
  readonly diagnostic: MetaSdkInitializationDiagnostic;
  readonly cause?: unknown;

  constructor(
    diagnostic: MetaSdkInitializationDiagnostic,
    cause?: unknown,
  ) {
    super(diagnostic);
    this.name = "MetaSdkInitializationError";
    this.diagnostic = diagnostic;
    this.cause = cause;
  }
}

export function getSafeMetaSdkDiagnostic(error: unknown): string {
  if (error instanceof MetaSdkInitializationError) {
    return SAFE_DIAGNOSTIC_MESSAGES[error.diagnostic];
  }
  return SAFE_DIAGNOSTIC_MESSAGES.unexpected_initialization_error;
}

type MetaSdkLoginOptions = {
  config_id: string;
  response_type: "code";
  override_default_response_type: true;
  extras: {
    featureType: "whatsapp_business_app_onboarding";
    sessionInfoVersion: "3";
  };
};

type MetaSdk = {
  init: (options: {
    appId: string;
    autoLogAppEvents: false;
    xfbml: false;
  }) => void;
  login: (
    callback: (response: unknown) => void,
    options: MetaSdkLoginOptions,
  ) => void;
};

declare global {
  interface Window {
    FB?: MetaSdk;
    fbAsyncInit?: () => void;
  }
}

const SDK_SCRIPT_ID = "facebook-jssdk-whatsapp-monitor-prototype";
const SDK_INITIALIZATION_TIMEOUT_MS = 20_000;
let sdkInitialization:
  | { appId: string; promise: Promise<MetaSdk> }
  | undefined;
let initializedAppId: string | undefined;

function initializeSdk(appId: string): MetaSdk {
  if (!/^\d+$/.test(appId)) {
    throw new MetaSdkInitializationError("invalid_app_id_format");
  }
  const sdk = window.FB;
  if (!sdk) throw new MetaSdkInitializationError("fb_object_missing");
  if (initializedAppId && initializedAppId !== appId) {
    throw new MetaSdkInitializationError(
      "already_initialized_for_another_app",
    );
  }
  if (!initializedAppId) {
    // Reserve initialization before invoking the SDK so callback/poll races
    // cannot make this loader call FB.init twice.
    initializedAppId = appId;
    try {
      sdk.init({
        appId,
        autoLogAppEvents: false,
        xfbml: false,
      });
    } catch (error) {
      initializedAppId = undefined;
      throw new MetaSdkInitializationError("fb_init_threw", error);
    }
  }
  return sdk;
}

function findExistingMetaSdkScript(): HTMLScriptElement | null {
  return (
    Array.from(document.scripts).find((script) => {
      if (script.id === SDK_SCRIPT_ID) return true;
      if (!script.src) return false;

      try {
        const url = new URL(script.src, document.baseURI);
        return (
          url.hostname.toLowerCase() === "connect.facebook.net" &&
          /\/sdk\.js$/i.test(url.pathname)
        );
      } catch {
        return false;
      }
    }) ?? null
  );
}

function loadMetaSdk(appId: string): Promise<MetaSdk> {
  if (!/^\d+$/.test(appId)) {
    return Promise.reject(
      new MetaSdkInitializationError("invalid_app_id_format"),
    );
  }
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new MetaSdkInitializationError("not_browser"));
  }

  if (sdkInitialization) {
    if (sdkInitialization.appId !== appId) {
      return Promise.reject(
        new MetaSdkInitializationError(
          "already_initialized_for_another_app",
        ),
      );
    }
    return sdkInitialization.promise;
  }

  // The SDK may already have been loaded by this page or another script.
  // Initialize it directly rather than waiting for fbAsyncInit or injecting
  // another script tag.
  if (window.FB) {
    try {
      return Promise.resolve(initializeSdk(appId));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  const existingScript = findExistingMetaSdkScript();
  const script = existingScript ?? document.createElement("script");
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let pollInterval: ReturnType<typeof setInterval> | undefined;
  let promiseReference: Promise<MetaSdk> | undefined;

  const promise = new Promise<MetaSdk>((resolve, reject) => {
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (pollInterval) clearInterval(pollInterval);
      script.removeEventListener("error", onScriptError);
      script.removeEventListener("load", initializeWhenAvailable);
      if (window.fbAsyncInit === onFbAsyncInit) {
        window.fbAsyncInit = previousFbAsyncInit;
      }
    };

    const resolveSdk = (sdk: MetaSdk) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (sdkInitialization?.promise === promiseReference) {
        sdkInitialization = undefined;
      }
      resolve(sdk);
    };

    const rejectLoad = (error: MetaSdkInitializationError) => {
      if (settled) return;
      settled = true;
      cleanup();
      sdkInitialization = undefined;
      reject(error);
    };

    let fbAsyncInitRan = false;
    const initializeWhenAvailable = () => {
      if (settled || !window.FB) return;
      try {
        resolveSdk(initializeSdk(appId));
      } catch (error) {
        rejectLoad(
          error instanceof MetaSdkInitializationError
            ? error
            : new MetaSdkInitializationError(
                "unexpected_initialization_error",
                error,
              ),
        );
      }
    };

    const previousFbAsyncInit = window.fbAsyncInit;
    const onFbAsyncInit = () => {
      if (settled) return;
      fbAsyncInitRan = true;
      initializeWhenAvailable();
    };
    const onScriptError = () =>
      rejectLoad(new MetaSdkInitializationError("sdk_script_load_failed"));

    // Register the callback before injecting a new script. Polling also
    // handles a script tag that was already present or a callback that is
    // never invoked even though window.FB appears.
    window.fbAsyncInit = onFbAsyncInit;
    script.addEventListener("error", onScriptError, { once: true });
    script.addEventListener("load", initializeWhenAvailable);
    pollInterval = setInterval(initializeWhenAvailable, 100);
    timeout = setTimeout(
      () =>
        rejectLoad(
          new MetaSdkInitializationError(
            fbAsyncInitRan
              ? "sdk_initialization_timeout"
              : "fb_async_init_did_not_run",
          ),
        ),
      SDK_INITIALIZATION_TIMEOUT_MS,
    );

    if (!existingScript) {
      script.id = SDK_SCRIPT_ID;
      script.src = "https://connect.facebook.net/en_US/sdk.js";
      script.async = true;
      script.defer = true;
      script.crossOrigin = "anonymous";
    } else if (
      script.id === SDK_SCRIPT_ID &&
      !/\/sdk\.js(?:[?#]|$)/i.test(script.src)
    ) {
      script.src = "https://connect.facebook.net/en_US/sdk.js";
    }

    if (!script.parentNode) {
      try {
        document.head.appendChild(script);
      } catch (error) {
        rejectLoad(
          new MetaSdkInitializationError(
            "sdk_script_insert_failed",
            error,
          ),
        );
      }
    }
  });

  promiseReference = promise;
  if (!settled) {
    sdkInitialization = { appId, promise };
  }
  return promise;
}

export function preloadMetaWhatsappBusinessAppSignup(
  appId: string,
): Promise<void> {
  return loadMetaSdk(appId).then(() => undefined);
}

export function classifyMetaWhatsappLoginResponse(
  response: unknown,
): MetaWhatsappLoginResult {
  if (!response || typeof response !== "object") {
    return "no_authorization";
  }

  const result = response as Record<string, unknown>;
  if (
    result.error != null ||
    result.error_code != null ||
    result.error_reason != null
  ) {
    return "error";
  }

  const authResponse = result.authResponse;
  if (
    (authResponse !== null && typeof authResponse === "object") ||
    result.status === "connected"
  ) {
    return "authorized";
  }

  if (result.status === "unknown") return "cancelled";
  return "no_authorization";
}

export function launchMetaWhatsappBusinessAppSignup(
  config: MetaWhatsappSignupConfig,
  onLoginResult: (result: MetaWhatsappLoginResult) => void,
): void {
  const sdk = window.FB;
  if (!sdk || initializedAppId !== config.appId) {
    throw new MetaSdkInitializationError("sdk_not_ready");
  }

  sdk.login(
    (response) => onLoginResult(classifyMetaWhatsappLoginResponse(response)),
    {
      config_id: config.configId,
      response_type: "code",
      override_default_response_type: true,
      extras: {
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
      },
    },
  );
}

function safeMetaId(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{1,40}$/.test(value)
    ? value
    : undefined;
}

export function parseMetaWhatsappSignupSessionEvent(
  origin: string,
  message: unknown,
): MetaWhatsappSignupSessionEvent | null {
  if (origin !== "https://www.facebook.com" || typeof message !== "string") {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(message);
  } catch {
    return null;
  }

  if (!payload || typeof payload !== "object") return null;
  const eventPayload = payload as {
    type?: unknown;
    event?: unknown;
    data?: unknown;
  };
  if (eventPayload.type !== "WA_EMBEDDED_SIGNUP") return null;

  if (
    eventPayload.event === "FINISH" ||
    eventPayload.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
  ) {
    const data =
      eventPayload.data && typeof eventPayload.data === "object"
        ? (eventPayload.data as Record<string, unknown>)
        : {};
    return {
      kind: "completed",
      wabaId: safeMetaId(data.waba_id),
      phoneNumberId: safeMetaId(data.phone_number_id),
    };
  }

  if (eventPayload.event === "CANCEL") return { kind: "cancelled" };
  if (eventPayload.event === "ERROR") return { kind: "error" };
  return null;
}