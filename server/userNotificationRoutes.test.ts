import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import type { AddressInfo } from "node:net";
import bcrypt from "bcrypt";
import express from "express";
import session from "express-session";
import type { User, UserNotification } from "@shared/schema";
import {
  createSessionAuthGuards,
  registerAuthSessionRoutes,
  type AuthSessionStorage,
} from "./authSessionRoutes";
import { registerUserNotificationRoutes } from "./userNotificationRoutes";
import { registerPushSubscriptionRoutes } from "./pushSubscriptionRoutes";

const SYNTHETIC_PASSWORD = "notification-test-only-password";
const SYNTHETIC_SESSION_SECRET = "notification-test-only-session-secret";
const COOKIE_POLICY = { secure: false, sameSite: "lax" as const };

function userFixture(id: number, password: string): User {
  return {
    id,
    username: `notice-user-${id}`,
    password,
    email: `notice-user-${id}@example.test`,
    phoneNumber: null,
    whatsappNumber: null,
    facebookId: null,
    authMethod: "email",
    isVerified: true,
    isAdmin: false,
    isActive: true,
    role: "buyer",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  } as User;
}

type SyntheticNotice = {
  id: number;
  userId: number;
  isRead: boolean;
};

type SyntheticPush = {
  id: number;
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string | null;
  createdAt: Date;
};

async function startHarness(t: TestContext) {
  const passwordHash = await bcrypt.hash(SYNTHETIC_PASSWORD, 4);
  const users = new Map([
    [61, userFixture(61, passwordHash)],
    [62, userFixture(62, passwordHash)],
  ]);
  const notices: SyntheticNotice[] = [
    { id: 1, userId: 61, isRead: false },
    { id: 2, userId: 62, isRead: false },
  ];
  const pushes: SyntheticPush[] = [
    {
      id: 71,
      userId: 61,
      endpoint: "https://push.example.test/user-61",
      p256dh: "synthetic-p256dh-61",
      auth: "synthetic-auth-61",
      userAgent: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
    {
      id: 72,
      userId: 62,
      endpoint: "https://push.example.test/user-62",
      p256dh: "synthetic-p256dh-62",
      auth: "synthetic-auth-62",
      userAgent: null,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    },
  ];

  const authStorage: AuthSessionStorage = {
    getUser: async (id) => users.get(id),
    getUserByUsername: async (username) =>
      [...users.values()].find((user) => user.username === username),
    getUserByEmail: async (email) =>
      [...users.values()].find((user) => user.email === email),
    getUserByPhone: async (phoneNumber) =>
      [...users.values()].find((user) => user.phoneNumber === phoneNumber),
    verifyCode: async () => false,
  };

  const notificationStorage = {
    getUserNotifications: async (userId: number) =>
      notices.filter((notice) => notice.userId === userId) as UserNotification[],
    markNotificationRead: async (id: number, userId: number) => {
      const notice = notices.find((entry) => entry.id === id && entry.userId === userId);
      if (notice) notice.isRead = true;
    },
    markAllNotificationsRead: async (userId: number) => {
      for (const notice of notices) {
        if (notice.userId === userId) notice.isRead = true;
      }
    },
  };

  const pushStorage = {
    savePushSubscription: async (data: {
      userId: number;
      endpoint: string;
      p256dh: string;
      auth: string;
      userAgent: string | null;
    }) => {
      const existing = pushes.find((entry) => entry.endpoint === data.endpoint);
      if (existing) {
        if (existing.userId !== data.userId) {
          throw new Error("synthetic push owner mismatch");
        }
        existing.p256dh = data.p256dh;
        existing.auth = data.auth;
        existing.userAgent = data.userAgent;
        return existing;
      }
      const added: SyntheticPush = { id: 73, createdAt: new Date(), ...data };
      pushes.push(added);
      return added;
    },
    deletePushSubscriptionByEndpoint: async (endpoint: string, userId: number) => {
      const index = pushes.findIndex(
        (entry) => entry.endpoint === endpoint && entry.userId === userId,
      );
      if (index >= 0) pushes.splice(index, 1);
    },
  };

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: SYNTHETIC_SESSION_SECRET,
    store: new session.MemoryStore(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: COOKIE_POLICY.secure,
      sameSite: COOKIE_POLICY.sameSite,
    },
  }));

  registerAuthSessionRoutes(app, {
    storage: authStorage,
    comparePassword: (candidate, hash) => bcrypt.compare(candidate, hash),
    allowPhoneOtpAttempt: () => true,
    cookiePolicy: COOKIE_POLICY,
  });
  const guards = createSessionAuthGuards(authStorage, COOKIE_POLICY);
  registerUserNotificationRoutes(app, guards.isAuthenticated, notificationStorage);
  registerPushSubscriptionRoutes(
    app,
    guards.isAuthenticated,
    pushStorage,
    () => "synthetic-public-vapid-key",
    () => undefined,
  );

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  }));

  return {
    app,
    notices,
    pushes,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

async function http(
  baseUrl: string,
  path: string,
  options: { method?: string; cookie?: string; body?: unknown } = {},
): Promise<Response> {
  const headers = new Headers({ connection: "close" });
  if (options.cookie) headers.set("cookie", options.cookie);
  if (options.body !== undefined) headers.set("content-type", "application/json");
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    redirect: "manual",
  });
}

function cookieFrom(response: Response): string | undefined {
  return response.headers.get("set-cookie")?.split(";")[0];
}

async function login(baseUrl: string, userId: 61 | 62): Promise<string> {
  const response = await http(baseUrl, "/api/auth/login", {
    method: "POST",
    body: {
      username: `notice-user-${userId}`,
      password: SYNTHETIC_PASSWORD,
    },
  });
  assert.equal(response.status, 200);
  const cookie = cookieFrom(response);
  assert.ok(cookie);
  return cookie;
}

test("notifications and push mutations require an authenticated session", async (t) => {
  const harness = await startHarness(t);
  const unauthenticated = [
    ["GET", "/api/notifications"],
    ["PATCH", "/api/notifications/1/read"],
    ["PATCH", "/api/notifications/read-all"],
    ["POST", "/api/push/subscribe"],
    ["DELETE", "/api/push/unsubscribe"],
  ] as const;

  for (const [method, path] of unauthenticated) {
    const response = await http(harness.baseUrl, path, { method });
    assert.equal(response.status, 401, `${method} ${path}`);
  }
});

test("notification reads and mutations stay scoped to the signed-in user", async (t) => {
  const harness = await startHarness(t);
  const userOneCookie = await login(harness.baseUrl, 61);

  const list = await http(harness.baseUrl, "/api/notifications", {
    cookie: userOneCookie,
  });
  assert.equal(list.status, 200);
  assert.deepEqual(
    (await list.json()).map((notice: SyntheticNotice) => notice.id),
    [1],
  );

  const crossUserRead = await http(harness.baseUrl, "/api/notifications/2/read", {
    method: "PATCH",
    cookie: userOneCookie,
  });
  assert.equal(crossUserRead.status, 200);
  assert.equal(harness.notices.find((notice) => notice.id === 2)?.isRead, false);

  const ownRead = await http(harness.baseUrl, "/api/notifications/1/read", {
    method: "PATCH",
    cookie: userOneCookie,
  });
  assert.equal(ownRead.status, 200);
  assert.equal(harness.notices.find((notice) => notice.id === 1)?.isRead, true);

  await http(harness.baseUrl, "/api/notifications/read-all", {
    method: "PATCH",
    cookie: userOneCookie,
  });
  assert.equal(harness.notices.find((notice) => notice.id === 2)?.isRead, false);
});

test("push subscriptions are created for and deleted only by their owner", async (t) => {
  const harness = await startHarness(t);
  const userOneCookie = await login(harness.baseUrl, 61);
  const userTwoEndpoint = "https://push.example.test/user-62";

  const subscribe = await http(harness.baseUrl, "/api/push/subscribe", {
    method: "POST",
    cookie: userOneCookie,
    body: {
      endpoint: "https://push.example.test/new-user-61",
      p256dh: "synthetic-new-p256dh",
      auth: "synthetic-new-auth",
    },
  });
  assert.equal(subscribe.status, 200);
  assert.equal(
    harness.pushes.find((entry) => entry.endpoint.endsWith("new-user-61"))?.userId,
    61,
  );

  const originalForeignKeys = {
    p256dh: harness.pushes.find((entry) => entry.endpoint === userTwoEndpoint)?.p256dh,
    auth: harness.pushes.find((entry) => entry.endpoint === userTwoEndpoint)?.auth,
  };
  const crossUserReplace = await http(harness.baseUrl, "/api/push/subscribe", {
    method: "POST",
    cookie: userOneCookie,
    body: {
      endpoint: userTwoEndpoint,
      p256dh: "synthetic-attacker-p256dh",
      auth: "synthetic-attacker-auth",
    },
  });
  assert.equal(crossUserReplace.status, 500);
  assert.deepEqual(
    {
      p256dh: harness.pushes.find((entry) => entry.endpoint === userTwoEndpoint)?.p256dh,
      auth: harness.pushes.find((entry) => entry.endpoint === userTwoEndpoint)?.auth,
    },
    originalForeignKeys,
  );

  const crossUserDelete = await http(harness.baseUrl, "/api/push/unsubscribe", {
    method: "DELETE",
    cookie: userOneCookie,
    body: { endpoint: userTwoEndpoint },
  });
  assert.equal(crossUserDelete.status, 200);
  assert.equal(harness.pushes.some((entry) => entry.endpoint === userTwoEndpoint), true);

  await http(harness.baseUrl, "/api/push/unsubscribe", {
    method: "DELETE",
    cookie: userOneCookie,
    body: { endpoint: "https://push.example.test/new-user-61" },
  });
  assert.equal(
    harness.pushes.some((entry) => entry.endpoint.endsWith("new-user-61")),
    false,
  );
});

test("route factories are wired in the app and persistence predicates include owner IDs", () => {
  const routes = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const databaseStorage = readFileSync(
    new URL("./database-storage.ts", import.meta.url),
    "utf8",
  );
  const pushSave = databaseStorage.slice(
    databaseStorage.indexOf("async savePushSubscription"),
    databaseStorage.indexOf("async getPushSubscriptionsByUserId"),
  );
  assert.match(routes, /registerUserNotificationRoutes\(app,\s*isAuthenticated,\s*storage\)/);
  assert.match(routes, /registerPushSubscriptionRoutes\(/);
  assert.match(databaseStorage, /markNotificationRead\(id: number, userId: number\)/);
  assert.match(
    databaseStorage,
    /eq\(userNotifications\.id, id\)[\s\S]{0,100}eq\(userNotifications\.userId, userId\)/,
  );
  assert.match(
    databaseStorage,
    /eq\(pushSubscriptions\.endpoint, endpoint\)[\s\S]{0,100}eq\(pushSubscriptions\.userId, userId\)/,
  );
  assert.match(pushSave, /eq\(pushSubscriptions\.userId, data\.userId\)/);
  assert.match(pushSave, /onConflictDoNothing/);
  assert.doesNotMatch(pushSave, /onConflictDoUpdate/);
});
