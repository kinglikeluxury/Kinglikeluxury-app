import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import test, { after } from "node:test";
import tls from "node:tls";
import {
  createSingleFlight,
  PushSubscriptionLike,
  PushSubscriptionReconciliationDependencies,
  reconcilePushSubscription,
} from "./push-subscription-reconciliation";
import { syncPushForAuthenticatedUser } from "./push-notifications";

const OLD_KEY = new Uint8Array([1, 2, 3, 4]);
const NEW_KEY = new Uint8Array([5, 6, 7, 8]);
const SAFE_ENV_KEYS = new Set([
  "PATH",
  "HOME",
  "TMPDIR",
  "NODE_ENV",
  "CI",
  "NODE_TEST_CONTEXT",
  "PWD",
  "SHLVL",
]);

let blockedNetworkAttempts = 0;
const originalFetch = globalThis.fetch;
const originalDnsLookup = dns.lookup;
const originalDnsResolve = dns.resolve;
const originalNetConnect = net.connect;
const originalNetCreateConnection = net.createConnection;
const originalHttpRequest = http.request;
const originalHttpsRequest = https.request;
const originalTlsConnect = tls.connect;

function blockedNetworkCall(api: string): never {
  blockedNetworkAttempts += 1;
  throw new Error(`External network blocked: ${api}`);
}

globalThis.fetch = (async () => blockedNetworkCall("fetch")) as typeof fetch;
(net as any).connect = () => blockedNetworkCall("net.connect");
(net as any).createConnection = () => blockedNetworkCall("net.createConnection");
(dns as any).lookup = () => blockedNetworkCall("dns.lookup");
(dns as any).resolve = () => blockedNetworkCall("dns.resolve");
(http as any).request = () => blockedNetworkCall("http.request");
(https as any).request = () => blockedNetworkCall("https.request");
(tls as any).connect = () => blockedNetworkCall("tls.connect");

after(() => {
  assert.equal(blockedNetworkAttempts, 0, "integration logic attempted external network access");
  globalThis.fetch = originalFetch;
  (dns as any).lookup = originalDnsLookup;
  (dns as any).resolve = originalDnsResolve;
  (net as any).connect = originalNetConnect;
  (net as any).createConnection = originalNetCreateConnection;
  (http as any).request = originalHttpRequest;
  (https as any).request = originalHttpsRequest;
  (tls as any).connect = originalTlsConnect;
});

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

class MockSubscription implements PushSubscriptionLike {
  options: { applicationServerKey: ArrayBuffer };
  unsubscribed = false;

  constructor(
    public endpoint: string,
    key: Uint8Array,
    private readonly onUnsubscribe: () => boolean = () => true,
  ) {
    this.options = { applicationServerKey: arrayBuffer(key) };
  }

  async unsubscribe(): Promise<boolean> {
    this.unsubscribed = true;
    return this.onUnsubscribe();
  }
}

function makeIntegrationHarness(options: { failNewRegistration?: boolean } = {}) {
  const events: string[] = [];
  const storedSubscriptions = new Map<string, { endpoint: string; key: number[] }>();
  const existing = new MockSubscription("endpoint-old", OLD_KEY, () => {
    events.push("browser-unsubscribe-old");
    return true;
  });
  storedSubscriptions.set(existing.endpoint, {
    endpoint: existing.endpoint,
    key: Array.from(OLD_KEY),
  });

  let currentSubscription: MockSubscription | null = existing;
  let nextEndpoint = 0;
  let permissionPromptCount = 0;

  const pushManager = {
    async getSubscription() {
      events.push("pushManager.getSubscription");
      return currentSubscription;
    },
    async subscribe(applicationServerKey: Uint8Array) {
      const key = Array.from(applicationServerKey);
      events.push(`pushManager.subscribe:${key.join("-")}`);
      const endpoint = key.join("-") === Array.from(OLD_KEY).join("-")
        ? `endpoint-restored-${++nextEndpoint}`
        : `endpoint-new-${++nextEndpoint}`;
      const created = new MockSubscription(endpoint, applicationServerKey);
      currentSubscription = created;
      return created;
    },
  };

  const serviceWorker = {
    ready: Promise.resolve({ pushManager }),
  };

  let currentPublicKey = "new-test-public-key";
  const api = {
    async getPublicKey() {
      events.push("api.get-vapid-public-key");
      return currentPublicKey;
    },
    async register(subscription: PushSubscriptionLike) {
      events.push(`api.register:${subscription.endpoint}`);
      if (options.failNewRegistration && subscription.endpoint.startsWith("endpoint-new")) {
        throw new Error("mock API rejected replacement registration");
      }
      const key = Array.from(
        new Uint8Array(subscription.options!.applicationServerKey!),
      );
      storedSubscriptions.set(subscription.endpoint, { endpoint: subscription.endpoint, key });
    },
    async delete(endpoint: string) {
      events.push(`api.delete:${endpoint}`);
      storedSubscriptions.delete(endpoint);
    },
  };

  const dependencies: PushSubscriptionReconciliationDependencies = {
    supported: true,
    permission: "granted",
    getPublicKey: () => api.getPublicKey(),
    getExisting: async () => {
      const registration = await serviceWorker.ready;
      return registration.pushManager.getSubscription();
    },
    subscribe: async (key) => {
      const registration = await serviceWorker.ready;
      return registration.pushManager.subscribe(key);
    },
    register: (subscription) => api.register(subscription),
    delete: (endpoint) => api.delete(endpoint),
    decodePublicKey: (key) => key === "new-test-public-key" ? NEW_KEY : OLD_KEY,
  };

  return {
    api,
    dependencies,
    events,
    get permissionPromptCount() {
      return permissionPromptCount;
    },
    set permissionPromptCount(value: number) {
      permissionPromptCount = value;
    },
    set currentPublicKey(value: string) {
      currentPublicKey = value;
    },
    get currentSubscription() {
      return currentSubscription;
    },
    storedSubscriptions,
  };
}

test("the test process has only explicit safe environment variables", () => {
  assert.equal(process.env.NODE_ENV, "test");
  const unsafeKeys = Object.keys(process.env).filter((key) =>
    /DATABASE|NEON|VAPID|SECRET|TOKEN|PASSWORD/i.test(key),
  );
  assert.deepEqual(unsafeKeys, []);
  assert.deepEqual(
    Object.keys(process.env).filter((key) => !SAFE_ENV_KEYS.has(key)),
    [],
  );
});

test("network guard blocks fetch and socket clients before any connection", async () => {
  await assert.rejects(fetch("https://example.invalid"), /External network blocked: fetch/);
  assert.throws(() => net.connect({ host: "203.0.113.1", port: 443 }), /External network blocked/);
  assert.throws(() => dns.lookup("example.invalid"), /External network blocked/);
  assert.throws(() => https.request("https://example.invalid"), /External network blocked/);
  assert.equal(blockedNetworkAttempts, 4);
  // These are intentional guard probes; later tests must make zero network attempts.
  blockedNetworkAttempts = 0;
});

test("a changed VAPID key registers the replacement before deleting the old in-memory record", async () => {
  const harness = makeIntegrationHarness();
  assert.equal(await reconcilePushSubscription(harness.dependencies), true);

  const registerIndex = harness.events.indexOf("api.register:endpoint-new-1");
  const deleteIndex = harness.events.indexOf("api.delete:endpoint-old");
  assert.ok(registerIndex >= 0);
  assert.ok(deleteIndex > registerIndex);
  assert.equal(harness.storedSubscriptions.has("endpoint-old"), false);
  assert.equal(harness.storedSubscriptions.has("endpoint-new-1"), true);
  assert.deepEqual(
    harness.storedSubscriptions.get("endpoint-new-1")?.key,
    Array.from(NEW_KEY),
  );
});

test("failed replacement preserves the old record and tries restoring the old local key", async () => {
  const harness = makeIntegrationHarness({ failNewRegistration: true });
  assert.equal(await reconcilePushSubscription(harness.dependencies), false);

  assert.equal(harness.events.includes("api.delete:endpoint-old"), false);
  assert.equal(harness.storedSubscriptions.has("endpoint-old"), true);
  assert.ok(harness.events.includes(`pushManager.subscribe:${Array.from(OLD_KEY).join("-")}`));
  assert.ok(harness.events.includes("api.register:endpoint-restored-2"));
  assert.equal(harness.currentSubscription?.endpoint, "endpoint-restored-2");
});

test("restored sessions invoke the same push reconciliation used after login", () => {
  const authSource = readFileSync(new URL("./auth.ts", import.meta.url), "utf8");
  assert.match(
    authSource,
    /if \(response\.ok\) \{[\s\S]*setUser\(user\);[\s\S]*syncPushForAuthenticatedUser\(user\);/,
  );
  assert.match(authSource, /setUser\(userData\);[\s\S]*syncPushForAuthenticatedUser\(userData\);/);
});

test("session restoration runs the real client sync against mocked service worker and API", async () => {
  const globals = globalThis as any;
  const previousWindow = Object.getOwnPropertyDescriptor(globals, "window");
  const previousNavigator = Object.getOwnPropertyDescriptor(globals, "navigator");
  const previousNotification = Object.getOwnPropertyDescriptor(globals, "Notification");
  const guardedFetch = globalThis.fetch;
  const requests: string[] = [];
  let permissionPromptCount = 0;
  let subscribeCount = 0;
  const existing = Object.assign(
    new MockSubscription("endpoint-session", OLD_KEY),
    {
      toJSON: () => ({
        endpoint: "endpoint-session",
        keys: { p256dh: "mock-p256dh", auth: "mock-auth" },
      }),
    },
  );
  const mockWindow = {
    PushManager: function PushManager() {},
    Notification: { permission: "granted", requestPermission: async () => {
      permissionPromptCount += 1;
      return "granted";
    } },
    atob,
  };
  const mockNavigator = {
    userAgent: "isolated-integration-test",
    serviceWorker: {
      ready: Promise.resolve({
        pushManager: {
          getSubscription: async () => existing,
          subscribe: async () => {
            subscribeCount += 1;
            throw new Error("matching subscription should not be recreated");
          },
        },
      }),
    },
  };
  Object.defineProperty(globals, "window", { configurable: true, value: mockWindow });
  Object.defineProperty(globals, "navigator", { configurable: true, value: mockNavigator });
  Object.defineProperty(globals, "Notification", {
    configurable: true,
    value: mockWindow.Notification,
  });
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    requests.push(url);
    if (url === "/api/push/vapid-key") {
      return new Response(JSON.stringify({ publicKey: "AQIDBA" }), { status: 200 });
    }
    if (url === "/api/push/subscribe") return new Response("{}", { status: 200 });
    throw new Error(`Unexpected mocked API request: ${url}`);
  }) as typeof fetch;

  try {
    // This is the same helper called by AuthProvider when /api/auth/me restores a session.
    syncPushForAuthenticatedUser({ isMetaReviewer: false });
    for (let attempt = 0; attempt < 20 && requests.length < 2; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.deepEqual(requests, ["/api/push/vapid-key", "/api/push/subscribe"]);
    assert.equal(subscribeCount, 0);
    assert.equal(permissionPromptCount, 0);
  } finally {
    globalThis.fetch = guardedFetch;
    if (previousWindow) Object.defineProperty(globals, "window", previousWindow);
    else delete globals.window;
    if (previousNavigator) Object.defineProperty(globals, "navigator", previousNavigator);
    else delete globals.navigator;
    if (previousNotification) Object.defineProperty(globals, "Notification", previousNotification);
    else delete globals.Notification;
  }
});

test("matching subscription and concurrent checks do not create duplicate subscriptions", async () => {
  const harness = makeIntegrationHarness();
  harness.currentPublicKey = "old-test-public-key";
  let releaseKey!: (key: string) => void;
  const pendingPublicKey = new Promise<string>((resolve) => {
    releaseKey = resolve;
  });
  harness.dependencies.getPublicKey = () => pendingPublicKey;
  const runOnce = createSingleFlight(() => reconcilePushSubscription(harness.dependencies));

  const first = runOnce();
  const second = runOnce();
  assert.equal(first, second);
  releaseKey("old-test-public-key");
  assert.equal(await first, true);

  assert.equal(
    harness.events.filter((event) => event.startsWith("pushManager.subscribe:")).length,
    0,
  );
  assert.equal(harness.events.filter((event) => event.startsWith("api.register:")).length, 1);
});

test("default or denied notification permission never triggers an automatic prompt", async () => {
  for (const permission of ["default", "denied"]) {
    const harness = makeIntegrationHarness();
    harness.dependencies.permission = permission;
    assert.equal(await reconcilePushSubscription(harness.dependencies), false);
    assert.equal(harness.permissionPromptCount, 0);
    assert.equal(harness.events.includes("api.get-vapid-public-key"), false);
  }
});
