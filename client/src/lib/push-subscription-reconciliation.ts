export interface PushSubscriptionLike {
  endpoint: string;
  options?: {
    applicationServerKey?: ArrayBuffer | null;
  };
  unsubscribe(): Promise<boolean>;
}

export interface PushSubscriptionReconciliationDependencies {
  supported: boolean;
  permission: string;
  getPublicKey(): Promise<string | null>;
  getExisting(): Promise<PushSubscriptionLike | null>;
  subscribe(applicationServerKey: Uint8Array): Promise<PushSubscriptionLike>;
  register(subscription: PushSubscriptionLike): Promise<void>;
  delete(endpoint: string): Promise<void>;
  decodePublicKey(value: string): Uint8Array;
}

export function createSingleFlight<T>(operation: () => Promise<T>): () => Promise<T> {
  let inFlight: Promise<T> | null = null;
  return () => {
    if (inFlight) return inFlight;
    const attempt = operation();
    const trackedAttempt = attempt.finally(() => {
      if (inFlight === trackedAttempt) inFlight = null;
    });
    inFlight = trackedAttempt;
    return trackedAttempt;
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function readApplicationServerKey(subscription: PushSubscriptionLike): Uint8Array | null {
  const key = subscription.options?.applicationServerKey;
  return key ? new Uint8Array(key) : null;
}

async function restoreOldSubscription(
  deps: PushSubscriptionReconciliationDependencies,
  oldKey: Uint8Array,
): Promise<void> {
  const restored = await deps.subscribe(oldKey);
  await deps.register(restored);
}

export async function reconcilePushSubscription(
  deps: PushSubscriptionReconciliationDependencies,
): Promise<boolean> {
  // Automatic checks must never prompt, including for the default permission state.
  if (!deps.supported || deps.permission !== "granted") return false;

  try {
    const publicKey = await deps.getPublicKey();
    if (!publicKey) return false;
    const newKey = deps.decodePublicKey(publicKey);
    const existing = await deps.getExisting();

    if (!existing) {
      const created = await deps.subscribe(newKey);
      try {
        await deps.register(created);
        return true;
      } catch (error) {
        await created.unsubscribe().catch(() => false);
        throw error;
      }
    }

    const oldKey = readApplicationServerKey(existing);
    // If the browser cannot expose the bound key, preserve the existing subscription.
    if (!oldKey || equalBytes(oldKey, newKey)) {
      await deps.register(existing);
      return true;
    }

    const oldEndpoint = existing.endpoint;
    const unsubscribed = await existing.unsubscribe();
    if (!unsubscribed) return false;

    let replacement: PushSubscriptionLike | null = null;
    try {
      replacement = await deps.subscribe(newKey);
      await deps.register(replacement);
    } catch (error) {
      if (replacement) await replacement.unsubscribe().catch(() => false);
      await restoreOldSubscription(deps, oldKey).catch(() => undefined);
      throw error;
    }

    // Keep the old server record until the new subscription has been saved successfully.
    if (replacement.endpoint !== oldEndpoint) {
      await deps.delete(oldEndpoint).catch(() => undefined);
    }
    return true;
  } catch {
    return false;
  }
}
