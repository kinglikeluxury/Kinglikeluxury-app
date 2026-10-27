import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createSingleFlight,
  PushSubscriptionLike,
  reconcilePushSubscription,
  PushSubscriptionReconciliationDependencies,
} from "./push-subscription-reconciliation";

const OLD_KEY = new Uint8Array([1, 2, 3]);
const NEW_KEY = new Uint8Array([4, 5, 6]);

function toBuffer(key: Uint8Array): ArrayBuffer {
  return key.slice().buffer as ArrayBuffer;
}

function subscription(
  endpoint: string,
  key: Uint8Array,
  onUnsubscribe: () => Promise<boolean> = async () => true,
): PushSubscriptionLike {
  return {
    endpoint,
    options: { applicationServerKey: toBuffer(key) },
    unsubscribe: onUnsubscribe,
  };
}

function dependencies(overrides: Partial<PushSubscriptionReconciliationDependencies> = {}) {
  const calls: string[] = [];
  const existing = subscription("endpoint-old", OLD_KEY, async () => {
    calls.push("unsubscribe-old");
    return true;
  });
  const deps: PushSubscriptionReconciliationDependencies = {
    supported: true,
    permission: "granted",
    getPublicKey: async () => "new-public-key",
    getExisting: async () => existing,
    subscribe: async (key) => {
      calls.push(`subscribe-${Array.from(key).join("")}`);
      return subscription("endpoint-new", key);
    },
    register: async (sub) => {
      calls.push(`register-${sub.endpoint}`);
    },
    delete: async (endpoint) => {
      calls.push(`delete-${endpoint}`);
    },
    decodePublicKey: () => NEW_KEY,
    ...overrides,
  };
  return { deps, calls, existing };
}

test("matching VAPID key re-registers the existing subscription without creating another", async () => {
  const { deps, calls, existing } = dependencies({
    getPublicKey: async () => "same-key",
    decodePublicKey: () => OLD_KEY,
  });

  assert.equal(await reconcilePushSubscription(deps), true);
  assert.deepEqual(calls, [`register-${existing.endpoint}`]);
});

test("changed VAPID key registers replacement before deleting the old server record", async () => {
  const { deps, calls } = dependencies();

  assert.equal(await reconcilePushSubscription(deps), true);
  assert.deepEqual(calls, [
    "unsubscribe-old",
    "subscribe-456",
    "register-endpoint-new",
    "delete-endpoint-old",
  ]);
});

test("failed renewal preserves the old server record and attempts local rollback", async () => {
  const { deps, calls } = dependencies({
    subscribe: async (key) => {
      calls.push(`subscribe-${Array.from(key).join("")}`);
      return subscription(
        Array.from(key).join("") === "123" ? "endpoint-old" : "endpoint-new",
        key,
      );
    },
    register: async (sub) => {
      calls.push(`register-${sub.endpoint}`);
      if (sub.endpoint === "endpoint-new") throw new Error("registration failed");
    },
  });

  assert.equal(await reconcilePushSubscription(deps), false);
  assert.equal(calls.includes("delete-endpoint-old"), false);
  assert.equal(calls.includes("subscribe-123"), true);
  assert.equal(calls.includes("register-endpoint-old"), true);
});

test("automatic check does not prompt or fetch a key without granted permission", async () => {
  for (const permission of ["default", "denied"]) {
    let fetchedKey = false;
    const { deps } = dependencies({
      permission,
      getPublicKey: async () => {
        fetchedKey = true;
        return "new-public-key";
      },
    });

    assert.equal(await reconcilePushSubscription(deps), false);
    assert.equal(fetchedKey, false);
  }
});

test("concurrent checks share one reconciliation operation", async () => {
  let calls = 0;
  let resolveOperation!: (value: boolean) => void;
  const run = createSingleFlight(
    () =>
      new Promise<boolean>((resolve) => {
        calls += 1;
        resolveOperation = resolve;
      }),
  );

  const first = run();
  const second = run();
  assert.equal(first, second);
  assert.equal(calls, 1);
  resolveOperation(true);
  assert.equal(await first, true);
});

test("session restoration and login both invoke the granted-permission sync helper", () => {
  const authSource = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
  assert.match(
    authSource,
    /if \(response\.ok\) \{[\s\S]*setUser\(user\);[\s\S]*syncPushForAuthenticatedUser\(user\);/,
  );
  assert.match(authSource, /setUser\(userData\);[\s\S]*syncPushForAuthenticatedUser\(userData\);/);
});
