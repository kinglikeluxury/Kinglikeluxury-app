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
  const sdk = window.FB;
  if (!sdk) throw new Error("Meta signup could not be started.");
  if (initializedAppId && initializedAppId !== appId) {
    throw new Error("Meta signup is already initialized for another app.");
  }
  if (!initializedAppId) {
    sdk.init({
      appId,
      autoLogAppEvents: false,
      xfbml: false,
    });
    initializedAppId = appId;
  }
  return sdk;
}

function loadMetaSdk(appId: string): Promise<MetaSdk> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Meta signup is only available in a browser."));
  }

  if (window.FB) {
    try {
      return Promise.resolve(initializeSdk(appId));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  if (sdkInitialization) {
    if (sdkInitialization.appId !== appId) {
      return Promise.reject(new Error("Meta signup is already initializing."));
    }
    return sdkInitialization.promise;
  }

  const promise = new Promise<MetaSdk>((resolve, reject) => {
    const script =
      (document.getElementById(SDK_SCRIPT_ID) as HTMLScriptElement | null) ??
      document.createElement("script");
    let settled = false;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const resolveSdk = (sdk: MetaSdk) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      resolve(sdk);
    };

    const rejectLoad = (message: string) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      sdkInitialization = undefined;
      reject(new Error(message));
    };

    window.fbAsyncInit = () => {
      if (settled) return;
      try {
        resolveSdk(initializeSdk(appId));
      } catch {
        rejectLoad("Meta signup could not be initialized.");
      }
    };

    script.id = SDK_SCRIPT_ID;
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => rejectLoad("Meta signup could not be loaded.");
    timeout = setTimeout(
      () => rejectLoad("Meta signup SDK initialization timed out."),
      SDK_INITIALIZATION_TIMEOUT_MS,
    );

    if (!script.parentNode) document.head.appendChild(script);
  });

  sdkInitialization = { appId, promise };
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
    throw new Error("Meta signup is not ready.");
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