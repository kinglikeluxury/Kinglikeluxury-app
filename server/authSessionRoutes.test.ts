import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import test, { type TestContext } from "node:test";
import type { AddressInfo } from "node:net";
import bcrypt from "bcrypt";
import express from "express";
import session from "express-session";
import type { User } from "@shared/schema";
import {
  createSessionAuthGuards,
  registerAuthSessionRoutes,
  type AuthSessionStorage,
} from "./authSessionRoutes";

const COOKIE_POLICY = { secure: false, sameSite: "lax" as const };
const SYNTHETIC_SESSION_SECRET = "test-only-session-secret-not-for-reuse";
const SYNTHETIC_PASSWORD = "synthetic-only-password";

function makeUser(
  id: number,
  password: string,
  overrides: Partial<User> = {},
): User {
  return {
    id,
    username: `synthetic-${id}`,
    password,
    email: `synthetic-${id}@example.test`,
    phoneNumber: null,
    whatsappNumber: null,
    facebookId: null,
    authMethod: "email",
    isVerified: true,
    isAdmin: false,
    isActive: true,
    role: "buyer",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  } as User;
}

function createStorage(initialUsers: User[]) {
  const users = new Map(initialUsers.map((user) => [user.id, user]));
  let failUserReads = false;

  const storage: AuthSessionStorage = {
    getUser: async (id) => {
      if (failUserReads) throw new Error("synthetic storage failure");
      return users.get(id);
    },
    getUserByUsername: async (username) =>
      [...users.values()].find((user) => user.username === username),
    getUserByEmail: async (email) =>
      [...users.values()].find((user) => user.email === email),
    getUserByPhone: async (phoneNumber) =>
      [...users.values()].find((user) => user.phoneNumber === phoneNumber),
    verifyCode: async () => false,
  };

  return {
    storage,
    users,
    setFailUserReads(value: boolean) {
      failUserReads = value;
    },
  };
}

type GuardMethod = "get" | "post" | "patch" | "delete";
type GuardKind = "authenticated" | "admin";

const LEGACY_GUARD_ROUTES: Array<{
  method: GuardMethod;
  route: string;
  requestPath: string;
  guard: GuardKind;
}> = [
  { method: "post", route: "/api/payments", requestPath: "/api/payments", guard: "authenticated" },
  { method: "post", route: "/api/bog/create-order", requestPath: "/api/bog/create-order", guard: "authenticated" },
  { method: "get", route: "/api/bog/order-status/:orderId", requestPath: "/api/bog/order-status/synthetic-order", guard: "authenticated" },
  { method: "post", route: "/api/bog/refund/:propertyId", requestPath: "/api/bog/refund/123", guard: "admin" },
  { method: "post", route: "/api/consultation/bookings", requestPath: "/api/consultation/bookings", guard: "authenticated" },
  { method: "get", route: "/api/consultation/bookings/mine", requestPath: "/api/consultation/bookings/mine", guard: "authenticated" },
  { method: "get", route: "/api/notifications", requestPath: "/api/notifications", guard: "authenticated" },
  { method: "patch", route: "/api/notifications/:id/read", requestPath: "/api/notifications/7/read", guard: "authenticated" },
  { method: "patch", route: "/api/notifications/read-all", requestPath: "/api/notifications/read-all", guard: "authenticated" },
  { method: "post", route: "/api/push/subscribe", requestPath: "/api/push/subscribe", guard: "authenticated" },
  { method: "delete", route: "/api/push/unsubscribe", requestPath: "/api/push/unsubscribe", guard: "authenticated" },
  { method: "post", route: "/api/ai/start", requestPath: "/api/ai/start", guard: "authenticated" },
  { method: "post", route: "/api/ai/chat", requestPath: "/api/ai/chat", guard: "authenticated" },
  { method: "get", route: "/api/admin/crm/leads", requestPath: "/api/admin/crm/leads", guard: "authenticated" },
];

async function startHarness(
  t: TestContext,
  initialUsers: User[],
) {
  const app = express();
  const data = createStorage(initialUsers);
  const memoryStore = new session.MemoryStore();
  app.use(express.json());
  app.use(session({
    secret: SYNTHETIC_SESSION_SECRET,
    store: memoryStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: COOKIE_POLICY.secure,
      sameSite: COOKIE_POLICY.sameSite,
    },
  }));

  app.get("/__synthetic/seed-session", (req, res) => {
    (req.session as unknown as Record<string, unknown>).preAuthMarker = true;
    res.status(204).end();
  });

  registerAuthSessionRoutes(app, {
    storage: data.storage,
    comparePassword: (candidate, hash) => bcrypt.compare(candidate, hash),
    allowPhoneOtpAttempt: () => true,
    cookiePolicy: COOKIE_POLICY,
  });

  const guards = createSessionAuthGuards(data.storage, COOKIE_POLICY);
  for (const item of LEGACY_GUARD_ROUTES) {
    const guard =
      item.guard === "admin" ? guards.isAdmin : guards.isAuthenticated;
    const handler: express.RequestHandler = (_req, res) =>
      res.status(204).end();
    const route = app.route(item.route);
    route[item.method](guard, handler);
  }
  app.get("/__synthetic/role", guards.isAuthenticated, (req, res) =>
    res.json({
      userId: req.session.userId,
      isAdmin: req.session.isAdmin,
      role: req.session.role,
    }),
  );
  app.get("/__synthetic/admin", guards.isAdmin, (_req, res) =>
    res.status(204).end(),
  );

  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
    server.closeAllConnections();
  }));

  const address = server.address() as AddressInfo;
  return {
    ...data,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

function cookieFrom(response: Response): string | undefined {
  return response.headers.get("set-cookie")?.split(";")[0];
}

async function request(
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

async function syntheticUser(
  id: number,
  overrides: Partial<User> = {},
): Promise<User> {
  const passwordHash = await bcrypt.hash(SYNTHETIC_PASSWORD, 4);
  return makeUser(id, passwordHash, overrides);
}

test("real HTTP login uses bcrypt, rotates the session, and invalidates the old cookie", async (t) => {
  const buyer = await syntheticUser(11);
  const secondBuyer = await syntheticUser(12);
  const harness = await startHarness(t, [buyer, secondBuyer]);

  const seeded = await request(harness.baseUrl, "/__synthetic/seed-session");
  const oldAnonymousCookie = cookieFrom(seeded);
  assert.ok(oldAnonymousCookie, "the synthetic pre-login session should issue a cookie");

  const login = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    cookie: oldAnonymousCookie,
    body: { username: buyer.username, password: SYNTHETIC_PASSWORD },
  });
  assert.equal(login.status, 200);
  const buyerCookie = cookieFrom(login);
  assert.ok(buyerCookie);
  assert.notEqual(buyerCookie, oldAnonymousCookie, "login must rotate the session ID");

  const oldCookieMe = await request(harness.baseUrl, "/api/auth/me", {
    cookie: oldAnonymousCookie,
  });
  assert.equal(oldCookieMe.status, 401, "the pre-login cookie must not remain authenticated");

  const buyerMe = await request(harness.baseUrl, "/api/auth/me", {
    cookie: buyerCookie,
  });
  assert.equal(buyerMe.status, 200);
  assert.equal((await buyerMe.json()).id, buyer.id);

  const switchLogin = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    cookie: buyerCookie,
    body: { username: secondBuyer.username, password: SYNTHETIC_PASSWORD },
  });
  assert.equal(switchLogin.status, 200);
  const secondBuyerCookie = cookieFrom(switchLogin);
  assert.ok(secondBuyerCookie);
  assert.notEqual(secondBuyerCookie, buyerCookie, "switching users must rotate the session again");

  const formerBuyerMe = await request(harness.baseUrl, "/api/auth/me", {
    cookie: buyerCookie,
  });
  assert.equal(formerBuyerMe.status, 401, "the former user's cookie must be revoked");
  const secondBuyerMe = await request(harness.baseUrl, "/api/auth/me", {
    cookie: secondBuyerCookie,
  });
  assert.equal(secondBuyerMe.status, 200);
  assert.equal((await secondBuyerMe.json()).id, secondBuyer.id);

  const logout = await request(harness.baseUrl, "/api/auth/logout", {
    method: "POST",
    cookie: secondBuyerCookie,
  });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get("set-cookie") ?? "", /connect\.sid=;/);
  const afterLogout = await request(harness.baseUrl, "/api/auth/me", {
    cookie: secondBuyerCookie,
  });
  assert.equal(afterLogout.status, 401);
});

test("failed password and ineligible accounts never create an authenticated session", async (t) => {
  const eligible = await syntheticUser(21);
  const inactive = await syntheticUser(22, { isActive: false });
  const unverified = await syntheticUser(23, { isVerified: false });
  const harness = await startHarness(t, [eligible, inactive, unverified]);
  const seeded = await request(harness.baseUrl, "/__synthetic/seed-session");
  const anonymousCookie = cookieFrom(seeded);
  assert.ok(anonymousCookie);

  for (const attempt of [
    { username: eligible.username, password: "wrong synthetic password" },
    { username: inactive.username, password: SYNTHETIC_PASSWORD },
    { username: unverified.username, password: SYNTHETIC_PASSWORD },
  ]) {
    const login = await request(harness.baseUrl, "/api/auth/login", {
      method: "POST",
      cookie: anonymousCookie,
      body: attempt,
    });
    assert.equal(login.status, 401);
    const me = await request(harness.baseUrl, "/api/auth/me", {
      cookie: anonymousCookie,
    });
    assert.equal(me.status, 401);
  }
});

test("/me and admin guards use current account state and revoke stale authority", async (t) => {
  const admin = await syntheticUser(31, { isAdmin: true, role: "admin" });
  const harness = await startHarness(t, [admin]);
  const login = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    body: { username: admin.username, password: SYNTHETIC_PASSWORD },
  });
  const adminCookie = cookieFrom(login);
  assert.equal(login.status, 200);
  assert.ok(adminCookie);
  assert.equal((await request(harness.baseUrl, "/__synthetic/admin", {
    cookie: adminCookie,
  })).status, 204);

  const current = harness.users.get(admin.id)!;
  current.isAdmin = false;
  current.role = "seller";
  const refreshedMe = await request(harness.baseUrl, "/api/auth/me", {
    cookie: adminCookie,
  });
  assert.equal(refreshedMe.status, 200);
  assert.deepEqual(
    { isAdmin: (await refreshedMe.clone().json()).isAdmin, role: (await refreshedMe.json()).role },
    { isAdmin: false, role: "seller" },
  );
  assert.equal((await request(harness.baseUrl, "/__synthetic/admin", {
    cookie: adminCookie,
  })).status, 403);
  const refreshedRole = await request(harness.baseUrl, "/__synthetic/role", {
    cookie: adminCookie,
  });
  assert.deepEqual(await refreshedRole.json(), {
    userId: admin.id,
    isAdmin: false,
    role: "seller",
  });

  current.isActive = false;
  const inactiveMe = await request(harness.baseUrl, "/api/auth/me", {
    cookie: adminCookie,
  });
  assert.equal(inactiveMe.status, 401);
  assert.match(inactiveMe.headers.get("set-cookie") ?? "", /connect\.sid=;/);
});

test("guard failures fail closed and do not expose storage diagnostics", async (t) => {
  const buyer = await syntheticUser(41);
  const harness = await startHarness(t, [buyer]);
  const login = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    body: { username: buyer.username, password: SYNTHETIC_PASSWORD },
  });
  const buyerCookie = cookieFrom(login);
  assert.ok(buyerCookie);

  harness.setFailUserReads(true);
  for (const route of ["/__synthetic/role", "/__synthetic/admin"]) {
    const response = await request(harness.baseUrl, route, { cookie: buyerCookie });
    assert.equal(response.status, 503);
    assert.equal((await response.text()).includes("synthetic storage failure"), false);
  }
});

test("shared auth guards gate legacy route families without invoking providers", async (t) => {
  const buyer = await syntheticUser(51);
  const harness = await startHarness(t, [buyer]);

  for (const route of LEGACY_GUARD_ROUTES) {
    const response = await request(harness.baseUrl, route.requestPath, {
      method: route.method.toUpperCase(),
    });
    assert.equal(
      response.status,
      route.guard === "admin" ? 403 : 401,
      `${route.method.toUpperCase()} ${route.route}`,
    );
  }

  const login = await request(harness.baseUrl, "/api/auth/login", {
    method: "POST",
    body: { username: buyer.username, password: SYNTHETIC_PASSWORD },
  });
  const buyerCookie = cookieFrom(login);
  assert.ok(buyerCookie);
  for (const route of LEGACY_GUARD_ROUTES) {
    const response = await request(harness.baseUrl, route.requestPath, {
      method: route.method.toUpperCase(),
      cookie: buyerCookie,
    });
    assert.equal(
      response.status,
      route.guard === "admin" ? 403 : 204,
      `${route.method.toUpperCase()} ${route.route}`,
    );
  }
});

test("actual legacy route declarations keep the expected shared guard wiring", () => {
  const source = readFileSync(new URL("./routes.ts", import.meta.url), "utf8");
  const actualBindings = [
    ...LEGACY_GUARD_ROUTES
      .filter(({ route }) =>
        !route.startsWith("/api/notifications") &&
        !route.startsWith("/api/push/"),
      )
      .map(({ method, route, guard }) => ({
      method,
      route,
      middleware: guard === "admin" ? "isAdmin" : "isAuthenticated",
      })),
  ];

  for (const { method, route, middleware } of actualBindings) {
    const escapedRoute = route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const registration = new RegExp(
      `app\\.${method}\\(\\s*["']${escapedRoute}["']\\s*,\\s*${middleware}\\s*,`,
    );
    assert.match(
      source,
      registration,
      `${method.toUpperCase()} ${route} should retain ${middleware}`,
    );
  }
});
