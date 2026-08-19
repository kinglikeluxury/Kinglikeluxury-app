const GOOGLE_ADS_CONVERSION_SEND_TO = "AW-11335852863/1BLVCPbst-QcEL_Grz0q";

let conversionAlreadySent = false;

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Sends the lead conversion at most once per page lifetime.
 * Tracking failures must never affect the lead submission flow.
 */
export function trackGoogleAdsLeadConversion(): void {
  if (conversionAlreadySent) return;
  conversionAlreadySent = true;

  try {
    if (typeof window === "undefined" || typeof window.gtag !== "function") return;

    window.gtag("event", "conversion", {
      send_to: GOOGLE_ADS_CONVERSION_SEND_TO,
      value: 1.0,
      currency: "TRY",
    });
  } catch {
    // The conversion tracker is optional and must not interrupt a successful lead.
  }
}