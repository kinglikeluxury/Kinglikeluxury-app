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
    version: string;
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
      version: "v25.0",
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

    window.fbAsyncInit = () => {
      try {
        resolve(initializeSdk(appId));
      } catch {
        reject(new Error("Meta signup could not be initialized."));
      }
    };

    script.id = SDK_SCRIPT_ID;
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.defer = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      sdkInitialization = undefined;
      reject(new Error("Meta signup could not be loaded."));
    };

    if (!script.parentNode) document.head.appendChild(script);
  });

  sdkInitialization = { appId, promise };
  return promise;
}

export async function launchMetaWhatsappBusinessAppSignup(
  config: MetaWhatsappSignupConfig,
  onLoginDialogClosed: () => void,
): Promise<void> {
  const sdk = await loadMetaSdk(config.appId);
  sdk.login(
    () => {
      // The login response may contain an exchangeable code. Deliberately ignore it.
      onLoginDialogClosed();
    },
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