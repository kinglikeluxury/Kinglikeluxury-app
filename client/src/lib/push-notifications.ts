/**
 * Web Push subscription management for Kinglike Luxury PWA.
 * Handles VAPID key fetching, subscription creation, and server registration.
 */

let cachedVapidKey: string | null = null;

async function getVapidPublicKey(): Promise<string | null> {
  if (cachedVapidKey) return cachedVapidKey;
  try {
    const res = await fetch("/api/push/vapid-key");
    if (!res.ok) return null;
    const { publicKey } = await res.json();
    cachedVapidKey = publicKey;
    return publicKey;
  } catch {
    return null;
  }
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export async function requestPushPermission(): Promise<boolean> {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

export async function subscribeToPush(): Promise<boolean> {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      console.log("[Push] Browser does not support push notifications");
      return false;
    }

    const granted = await requestPushPermission();
    if (!granted) {
      console.log("[Push] Permission not granted");
      return false;
    }

    const vapidKey = await getVapidPublicKey();
    if (!vapidKey) {
      console.log("[Push] No VAPID key available");
      return false;
    }

    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();

    // If already subscribed, just re-register with server
    if (existing) {
      await registerSubscriptionWithServer(existing);
      return true;
    }

    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    await registerSubscriptionWithServer(subscription);
    console.log("[Push] ✓ Subscribed successfully");
    return true;
  } catch (err) {
    console.error("[Push] Subscription failed:", err);
    return false;
  }
}

async function registerSubscriptionWithServer(
  subscription: PushSubscription
): Promise<void> {
  const sub = subscription.toJSON();
  await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      endpoint: sub.endpoint,
      p256dh: sub.keys?.p256dh,
      auth: sub.keys?.auth,
      userAgent: navigator.userAgent,
    }),
  });
}

export async function unsubscribeFromPush(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      await fetch("/api/push/unsubscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ endpoint: subscription.endpoint }),
      });
    }
  } catch (err) {
    console.error("[Push] Unsubscribe failed:", err);
  }
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
