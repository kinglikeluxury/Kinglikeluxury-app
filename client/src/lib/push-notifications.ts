/**
 * Web Push subscription management for Kinglike Luxury PWA.
 * Handles VAPID key fetching, subscription creation, and server registration.
 */

import {
  createSingleFlight,
  reconcilePushSubscription,
} from "./push-subscription-reconciliation";

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

// Call this only from an explicit user action, never as part of session restoration.
export async function requestPushPermission(): Promise<boolean> {
  if (!("Notification" in window) || !("serviceWorker" in navigator)) return false;
  if (Notification.permission === "granted") return true;
  if (Notification.permission === "denied") return false;
  const permission = await Notification.requestPermission();
  return permission === "granted";
}

const runSubscriptionCheck = createSingleFlight(() =>
  reconcilePushSubscription({
    supported: "serviceWorker" in navigator && "PushManager" in window,
    permission: "Notification" in window ? Notification.permission : "unsupported",
    getPublicKey: async () => {
      const response = await fetch("/api/push/vapid-key", { cache: "no-store" });
      if (!response.ok) return null;
      const body = await response.json();
      return typeof body.publicKey === "string" ? body.publicKey : null;
    },
    getExisting: async () => {
      const registration = await navigator.serviceWorker.ready;
      return registration.pushManager.getSubscription();
    },
    subscribe: async (applicationServerKey) => {
      const registration = await navigator.serviceWorker.ready;
      return registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    },
    register: registerSubscriptionWithServer,
    delete: deleteSubscriptionFromServer,
    decodePublicKey: urlBase64ToUint8Array,
  }),
);

export function subscribeToPush(): Promise<boolean> {
  return runSubscriptionCheck();
}

async function registerSubscriptionWithServer(
  subscription: PushSubscription
): Promise<void> {
  const sub = subscription.toJSON();
  const response = await fetch("/api/push/subscribe", {
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
  if (!response.ok) throw new Error("Push subscription registration failed");
}

async function deleteSubscriptionFromServer(endpoint: string): Promise<void> {
  const response = await fetch("/api/push/unsubscribe", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ endpoint }),
  });
  if (!response.ok) throw new Error("Old push subscription cleanup failed");
}

export function syncPushForAuthenticatedUser(user: { isMetaReviewer?: boolean }): void {
  if (
    user.isMetaReviewer ||
    typeof window === "undefined" ||
    !("Notification" in window) ||
    Notification.permission !== "granted" ||
    !isPushSupported()
  ) {
    return;
  }
  void subscribeToPush().catch((error) => {
    console.error("[Push] Session subscription check failed:", error);
  });
}

export async function unsubscribeFromPush(): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await subscription.unsubscribe();
      await deleteSubscriptionFromServer(subscription.endpoint);
    }
  } catch (err) {
    console.error("[Push] Unsubscribe failed:", err);
  }
}

export function isPushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}
