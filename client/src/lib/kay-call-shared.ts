export const KAY_AUDIO_CONSTRAINTS: MediaStreamConstraints = { audio: true, video: false };

export function isKayCallPushUrl(url: string = window.location.href): boolean {
  try {
    const origin = typeof window === "undefined" ? "http://localhost" : window.location.origin;
    return new URL(url, origin).pathname === "/admin/kay/call";
  } catch {
    return false;
  }
}