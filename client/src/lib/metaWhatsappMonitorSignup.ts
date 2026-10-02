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

export type MetaWhatsappSignupEventType =
  | "success"
  | "cancel"
  | "error"
  | "none";

export type MetaWhatsappLoginAttemptDiagnostics = {
  fbLoginCalled: boolean;
  callbackFired: boolean;
  authResponsePresent: boolean;
  callbackErrorPresent: boolean;
  safeErrorCode: string | null;
  safeErrorMessage: string | null;
  waEmbeddedSignupMessageReceived: boolean;
  signupEventType: MetaWhatsappSignupEventType;
  popupLaunchException: boolean;
};

export type MetaWhatsappSignupMessageDiagnostics = Pick<
  MetaWhatsappLoginAttemptDiagnostics,
  "waEmbeddedSignupMessageReceived" | "signupEventType"
>;

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

export type MetaSdkInitializationStage =
  | "idle"
  | "validating_app_id"
  | "checking_for_sdk"
  | "using_existing_fb"
  | "reusing_existing_script"
  | "injecting_script"
  | "waiting_for_sdk"
  | "script_load_event_fired"
  | "script_loaded_waiting_for_fb"
  | "script_error_event_fired"
  | "fb_async_init_fired"
  | "fb_init_attempted"
  | "fb_init_returned"
  | "fb_init_failed"
  | "initialization_failed"
  | "script_insert_failed"
  | "invalid_app_id"
  | "not_browser"
  | "timeout_reached"
  | "ready";

export type MetaSdkBootstrapDiagnostics = {
  sdkScriptTagPresent: boolean;
  sdkScriptLoadEventFired: boolean;
  sdkScriptErrorEventFired: boolean;
  fbAsyncInitFired: boolean;
  windowFbPresent: boolean;
  fbInitAttempted: boolean;
  sdkReady: boolean;
  stage: MetaSdkInitializationStage;
  timeoutReached: boolean;
};

const INITIAL_META_SDK_DIAGNOSTICS: MetaSdkBootstrapDiagnostics = {
  sdkScriptTagPresent: false,
  sdkScriptLoadEventFired: false,
  sdkScriptErrorEventFired: false,
  fbAsyncInitFired: false,
  windowFbPresent: false,
  fbInitAttempted: false,
  sdkReady: false,
  stage: "idle",
  timeoutReached: false,
};

let metaSdkDiagnostics: MetaSdkBootstrapDiagnostics = {
  ...INITIAL_META_SDK_DIAGNOSTICS,
};
const metaSdkDiagnosticListeners = new Set<
  (diagnostics: MetaSdkBootstrapDiagnostics) => void
>();

export function getMetaSdkBootstrapDiagnostics(): MetaSdkBootstrapDiagnostics {
  return { ...metaSdkDiagnostics };
}

export function subscribeToMetaSdkBootstrapDiagnostics(
  listener: (diagnostics: MetaSdkBootstrapDiagnostics) => void,
): () => void {
  metaSdkDiagnosticListeners.add(listener);
  listener(getMetaSdkBootstrapDiagnostics());
  return () => metaSdkDiagnosticListeners.delete(listener);
}

function notifyMetaSdkDiagnosticListeners(): void {
  const snapshot = getMetaSdkBootstrapDiagnostics();
  for (const listener of metaSdkDiagnosticListeners) {
    try {
      listener(snapshot);
    } catch {
      // Diagnostic rendering must never interrupt SDK initialization.
    }
  }
}

function beginMetaSdkDiagnosticAttempt(
  stage: MetaSdkInitializationStage,
  sdkScriptTagPresent: boolean,
): void {
  metaSdkDiagnostics = {
    ...INITIAL_META_SDK_DIAGNOSTICS,
    stage,
    sdkScriptTagPresent,
    windowFbPresent:
      typeof window !== "undefined" && Boolean(window.FB),
  };
  notifyMetaSdkDiagnosticListeners();
}

function updateMetaSdkDiagnostics(
  update: Partial<MetaSdkBootstrapDiagnostics>,
): void {
  const next: MetaSdkBootstrapDiagnostics = {
    ...metaSdkDiagnostics,
    ...update,
    windowFbPresent:
      typeof window !== "undefined" ? Boolean(window.FB) : false,
  };
  const changed = (
    Object.keys(next) as Array<keyof MetaSdkBootstrapDiagnostics>
  ).some((key) => next[key] !== metaSdkDiagnostics[key]);
  if (!changed) return;
  metaSdkDiagnostics = next;
  notifyMetaSdkDiagnosticListeners();
}

const SAFE_INITIALIZATION_STAGE_LABELS: Record<
  MetaSdkInitializationStage,
  string
> = {
  idle: "Idle",
  validating_app_id: "Validating App ID format",
  checking_for_sdk: "Checking for an existing SDK",
  using_existing_fb: "Using the existing FB object",
  reusing_existing_script: "Reusing an existing SDK script",
  injecting_script: "Adding the SDK script",
  waiting_for_sdk: "Waiting for fbAsyncInit or window.FB",
  script_load_event_fired: "SDK script load event fired",
  script_loaded_waiting_for_fb: "SDK script loaded; waiting for window.FB",
  script_error_event_fired: "SDK script error event fired",
  fb_async_init_fired: "fbAsyncInit fired",
  fb_init_attempted: "FB.init attempted",
  fb_init_returned: "FB.init returned",
  fb_init_failed: "FB.init failed",
  initialization_failed: "SDK initialization failed",
  script_insert_failed: "SDK script could not be inserted",
  invalid_app_id: "App ID format validation failed",
  not_browser: "Browser environment unavailable",
  timeout_reached: "20-second initialization timeout reached",
  ready: "SDK ready",
};

export function getSafeMetaSdkInitializationStage(
  stage: MetaSdkInitializationStage,
): string {
  return SAFE_INITIALIZATION_STAGE_LABELS[stage];
}

type MetaSdkLoginOptions = {
  config_id: string;
  response_type: "code";
  override_default_response_type: true;
  extras: {
    setup: {};
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
    updateMetaSdkDiagnostics({ stage: "invalid_app_id" });
    throw new MetaSdkInitializationError("invalid_app_id_format");
  }
  const sdk = window.FB;
  if (!sdk) {
    updateMetaSdkDiagnostics({ stage: "initialization_failed" });
    throw new MetaSdkInitializationError("fb_object_missing");
  }
  if (initializedAppId && initializedAppId !== appId) {
    updateMetaSdkDiagnostics({ stage: "initialization_failed" });
    throw new MetaSdkInitializationError(
      "already_initialized_for_another_app",
    );
  }
  if (!initializedAppId) {
    // Reserve initialization before invoking the SDK so callback/poll races
    // cannot make this loader call FB.init twice.
    initializedAppId = appId;
    updateMetaSdkDiagnostics({
      fbInitAttempted: true,
      stage: "fb_init_attempted",
    });
    try {
      sdk.init({
        appId,
        version: "v26.0",
        autoLogAppEvents: false,
        xfbml: false,
      });
    } catch (error) {
      initializedAppId = undefined;
      updateMetaSdkDiagnostics({ stage: "fb_init_failed" });
      throw new MetaSdkInitializationError("fb_init_threw", error);
    }
    updateMetaSdkDiagnostics({ stage: "fb_init_returned" });
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
    beginMetaSdkDiagnosticAttempt(
      "validating_app_id",
      typeof document !== "undefined" &&
        Boolean(findExistingMetaSdkScript()),
    );
    updateMetaSdkDiagnostics({ stage: "invalid_app_id" });
    return Promise.reject(
      new MetaSdkInitializationError("invalid_app_id_format"),
    );
  }
  if (typeof window === "undefined" || typeof document === "undefined") {
    beginMetaSdkDiagnosticAttempt("checking_for_sdk", false);
    updateMetaSdkDiagnostics({ stage: "not_browser" });
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

  const existingScript = findExistingMetaSdkScript();
  beginMetaSdkDiagnosticAttempt(
    "checking_for_sdk",
    Boolean(existingScript),
  );

  // The SDK may already have been loaded by this page or another script.
  // Initialize it directly rather than waiting for fbAsyncInit or injecting
  // another script tag.
  if (window.FB) {
    updateMetaSdkDiagnostics({
      sdkScriptTagPresent: Boolean(existingScript),
      stage: "using_existing_fb",
    });
    try {
      const sdk = initializeSdk(appId);
      updateMetaSdkDiagnostics({
        sdkReady: true,
        stage: "ready",
      });
      return Promise.resolve(sdk);
    } catch (error) {
      return Promise.reject(error);
    }
  }

  const script = existingScript ?? document.createElement("script");
  updateMetaSdkDiagnostics({
    sdkScriptTagPresent: Boolean(existingScript),
    stage: existingScript ? "reusing_existing_script" : "injecting_script",
  });
  let settled = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let pollInterval: ReturnType<typeof setInterval> | undefined;
  let promiseReference: Promise<MetaSdk> | undefined;

  const promise = new Promise<MetaSdk>((resolve, reject) => {
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      if (pollInterval) clearInterval(pollInterval);
      script.removeEventListener("error", onScriptError);
      script.removeEventListener("load", onScriptLoad);
      if (window.fbAsyncInit === onFbAsyncInit) {
        window.fbAsyncInit = previousFbAsyncInit;
      }
    };

    const resolveSdk = (sdk: MetaSdk) => {
      if (settled) return;
      settled = true;
      updateMetaSdkDiagnostics({
        sdkScriptTagPresent: script.isConnected,
        sdkReady: true,
        stage: "ready",
      });
      cleanup();
      if (sdkInitialization?.promise === promiseReference) {
        sdkInitialization = undefined;
      }
      resolve(sdk);
    };

    const rejectLoad = (error: MetaSdkInitializationError) => {
      if (settled) return;
      settled = true;
      updateMetaSdkDiagnostics({
        sdkScriptTagPresent: script.isConnected,
        sdkReady: false,
      });
      cleanup();
      sdkInitialization = undefined;
      reject(error);
    };

    let fbAsyncInitRan = false;
    const initializeWhenAvailable = () => {
      updateMetaSdkDiagnostics({
        sdkScriptTagPresent: script.isConnected,
      });
      if (settled || !window.FB) return;
      try {
        resolveSdk(initializeSdk(appId));
      } catch (error) {
        if (
          !(error instanceof MetaSdkInitializationError) ||
          error.diagnostic !== "fb_init_threw"
        ) {
          updateMetaSdkDiagnostics({ stage: "initialization_failed" });
        }
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
      updateMetaSdkDiagnostics({
        fbAsyncInitFired: true,
        stage: "fb_async_init_fired",
      });
      initializeWhenAvailable();
    };
    const onScriptError = () => {
      updateMetaSdkDiagnostics({
        sdkScriptErrorEventFired: true,
        stage: "script_error_event_fired",
      });
      rejectLoad(new MetaSdkInitializationError("sdk_script_load_failed"));
    };
    const onScriptLoad = () => {
      updateMetaSdkDiagnostics({
        sdkScriptLoadEventFired: true,
        sdkScriptTagPresent: script.isConnected,
        stage: "script_load_event_fired",
      });
      if (!window.FB) {
        updateMetaSdkDiagnostics({
          stage: "script_loaded_waiting_for_fb",
        });
      }
      initializeWhenAvailable();
    };

    // Register the callback before injecting a new script. Polling also
    // handles a script tag that was already present or a callback that is
    // never invoked even though window.FB appears.
    window.fbAsyncInit = onFbAsyncInit;
    script.addEventListener("error", onScriptError, { once: true });
    script.addEventListener("load", onScriptLoad);
    pollInterval = setInterval(initializeWhenAvailable, 100);
    timeout = setTimeout(
      () => {
        updateMetaSdkDiagnostics({
          timeoutReached: true,
          stage: "timeout_reached",
        });
        rejectLoad(
          new MetaSdkInitializationError(
            fbAsyncInitRan
              ? "sdk_initialization_timeout"
              : "fb_async_init_did_not_run",
          ),
        );
      },
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
        updateMetaSdkDiagnostics({
          sdkScriptTagPresent: script.isConnected,
          stage: "waiting_for_sdk",
        });
      } catch (error) {
        updateMetaSdkDiagnostics({ stage: "script_insert_failed" });
        rejectLoad(
          new MetaSdkInitializationError(
            "sdk_script_insert_failed",
            error,
          ),
        );
      }
    } else {
      updateMetaSdkDiagnostics({
        sdkScriptTagPresent: script.isConnected,
        stage: "waiting_for_sdk",
      });
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

const SAFE_META_LOGIN_ERROR_MESSAGES: Record<string, string> = {
  access_denied: "Access was denied.",
  user_denied: "Access was denied.",
  invalid_request: "Meta rejected the signup request.",
  popup_blocked: "The browser blocked the signup popup.",
  popup_closed: "The signup popup was closed.",
  temporarily_unavailable: "Meta reported a temporary issue.",
};

function getSafeNumericErrorCode(value: unknown): string | null {
  if (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 999_999
  ) {
    return String(value);
  }
  return typeof value === "string" && /^\d{1,6}$/.test(value)
    ? value
    : null;
}

function getSafeLoginResponseDiagnostics(
  response: unknown,
): Pick<
  MetaWhatsappLoginAttemptDiagnostics,
  | "authResponsePresent"
  | "callbackErrorPresent"
  | "safeErrorCode"
  | "safeErrorMessage"
> {
  if (!response || typeof response !== "object") {
    return {
      authResponsePresent: false,
      callbackErrorPresent: false,
      safeErrorCode: null,
      safeErrorMessage: null,
    };
  }

  const result = response as Record<string, unknown>;
  const errorObject =
    result.error && typeof result.error === "object"
      ? (result.error as Record<string, unknown>)
      : undefined;
  const callbackErrorPresent = [
    result.error,
    result.error_code,
    result.error_reason,
    result.error_message,
    result.error_description,
  ].some((value) => value != null);

  const safeErrorCode = callbackErrorPresent
    ? [
        result.error_code,
        errorObject?.code,
        errorObject?.error_code,
      ]
        .map(getSafeNumericErrorCode)
        .find((value) => value !== null) ?? null
    : null;

  const safeMessageKeyCandidates = [
    result.error,
    result.error_reason,
    result.error_type,
    errorObject?.type,
    errorObject?.error,
  ];
  const safeErrorMessage = callbackErrorPresent
    ? safeMessageKeyCandidates
        .map((value) =>
          typeof value === "string" ? value.trim().toLowerCase() : "",
        )
        .map((key) =>
          Object.prototype.hasOwnProperty.call(
            SAFE_META_LOGIN_ERROR_MESSAGES,
            key,
          )
            ? SAFE_META_LOGIN_ERROR_MESSAGES[key]
            : undefined,
        )
        .find((message) => message !== undefined) ?? null
    : null;

  return {
    authResponsePresent:
      result.authResponse !== null &&
      typeof result.authResponse === "object",
    callbackErrorPresent,
    safeErrorCode,
    safeErrorMessage,
  };
}

export function launchMetaWhatsappBusinessAppSignup(
  config: MetaWhatsappSignupConfig,
  onLoginResult: (result: MetaWhatsappLoginResult) => void,
  onDiagnosticsUpdate?: (
    update: Partial<MetaWhatsappLoginAttemptDiagnostics>,
  ) => void,
): void {
  const sdk = window.FB;
  if (!sdk || initializedAppId !== config.appId) {
    throw new MetaSdkInitializationError("sdk_not_ready");
  }

  const reportDiagnostics = (
    update: Partial<MetaWhatsappLoginAttemptDiagnostics>,
  ) => {
    try {
      onDiagnosticsUpdate?.(update);
    } catch {
      // Per-click diagnostics must never interrupt the signup flow.
    }
  };
  let callbackFired = false;
  try {
    reportDiagnostics({ fbLoginCalled: true });
    sdk.login(
      (response) => {
        callbackFired = true;
        let responseDiagnostics: ReturnType<
          typeof getSafeLoginResponseDiagnostics
        >;
        try {
          responseDiagnostics = getSafeLoginResponseDiagnostics(response);
        } catch {
          responseDiagnostics = {
            authResponsePresent: false,
            callbackErrorPresent: false,
            safeErrorCode: null,
            safeErrorMessage: null,
          };
        }
        reportDiagnostics({
          callbackFired: true,
          ...responseDiagnostics,
        });
        onLoginResult(classifyMetaWhatsappLoginResponse(response));
      },
      {
        config_id: config.configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  } catch (error) {
    if (!callbackFired) {
      reportDiagnostics({ popupLaunchException: true });
    }
    throw error;
  }
}

function safeMetaId(value: unknown): string | undefined {
  return typeof value === "string" && /^\d{1,40}$/.test(value)
    ? value
    : undefined;
}

export function parseMetaWhatsappSignupSessionEvent(
  origin: string,
  message: unknown,
  onDiagnosticsUpdate?: (diagnostics: MetaWhatsappSignupMessageDiagnostics) => void,
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

  const signupEventType: MetaWhatsappSignupEventType =
    eventPayload.event === "FINISH" ||
    eventPayload.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING"
      ? "success"
      : eventPayload.event === "CANCEL"
        ? "cancel"
        : eventPayload.event === "ERROR"
          ? "error"
          : "none";
  try {
    onDiagnosticsUpdate?.({
      waEmbeddedSignupMessageReceived: true,
      signupEventType,
    });
  } catch {
    // Per-click diagnostics must never interrupt signup event handling.
  }

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