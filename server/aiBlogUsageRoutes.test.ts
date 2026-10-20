import test from "node:test";
import assert from "node:assert/strict";
import type { Express, RequestHandler } from "express";
import type { Pool } from "pg";
import { registerAiBlogDraftRoutes } from "./aiBlogDraftRoutes";

type Handler = (req: any, res: any, next?: () => void) => unknown;
type CapturedRoute = { method: string; handlers: Handler[] };

function makeHarness(options: {
  query?: (sql: string, values?: unknown[]) => Promise<any>;
  authenticated?: boolean;
  admin?: boolean;
} = {}) {
  const routes = new Map<string, CapturedRoute>();
  const app = {
    get(path: string, ...handlers: Handler[]) { routes.set(`GET ${path}`, { method: "GET", handlers }); return app; },
    put(path: string, ...handlers: Handler[]) { routes.set(`PUT ${path}`, { method: "PUT", handlers }); return app; },
    post(path: string, ...handlers: Handler[]) { routes.set(`POST ${path}`, { method: "POST", handlers }); return app; },
  } as unknown as Express;
  const pool = {
    query: options.query ?? (async () => ({ rows: [] })),
    connect: async () => { throw new Error("unexpected database connection in route mock"); },
  } as unknown as Pick<Pool, "query" | "connect">;
  const isAuthenticated: RequestHandler = (req: any, res: any, next: any) =>
    options.authenticated === false ? res.status(401).json({ message: "unauthorized" }) : next();
  const isAdmin: RequestHandler = (_req: any, res: any, next: any) =>
    options.admin === false ? res.status(403).json({ message: "forbidden" }) : next();
  registerAiBlogDraftRoutes(app, {
    pool,
    isAuthenticated,
    isAdmin,
    getUser: async () => ({ id: 1, isAdmin: true }),
  });
  return routes;
}

async function callRoute(
  route: CapturedRoute,
  request: { body?: unknown; params?: Record<string, string> } = {},
) {
  const result: { statusCode: number; body: any } = { statusCode: 200, body: undefined };
  const response = {
    status(code: number) { result.statusCode = code; return response; },
    json(body: unknown) { result.body = body; return response; },
  };
  const req = { body: request.body ?? {}, params: request.params ?? {} };
  const [auth, admin, handler] = route.handlers;
  let authPassed = false;
  await Promise.resolve(auth(req, response, () => { authPassed = true; }));
  if (!authPassed) return result;
  let adminPassed = false;
  await Promise.resolve(admin(req, response, () => { adminPassed = true; }));
  if (!adminPassed) return result;
  await Promise.resolve(handler(req, response, () => undefined));
  return result;
}

test("usage endpoints are registered behind both existing authentication guards", async () => {
  const routes = makeHarness({ authenticated: false });
  const getRoute = routes.get("GET /api/admin/ai-blog/usage")!;
  const putRoute = routes.get("PUT /api/admin/ai-blog/usage/limits")!;
  assert.equal(getRoute.handlers.length, 3);
  assert.equal(putRoute.handlers.length, 3);

  const visitor = await callRoute(getRoute, {});
  assert.equal(visitor.statusCode, 401);
  const ordinaryUserRoutes = makeHarness({ authenticated: true, admin: false });
  const ordinaryUser = await callRoute(ordinaryUserRoutes.get("PUT /api/admin/ai-blog/usage/limits")!, {
    body: { maxDailyArticles: 1, maxDailyRequests: 1 },
  });
  assert.equal(ordinaryUser.statusCode, 403);
  const nonAdmin = await callRoute(ordinaryUserRoutes.get("GET /api/admin/ai-blog/usage")!);
  assert.equal(nonAdmin.statusCode, 403);
});

test("usage endpoint returns real mock counters and explicit non-verification flags", async () => {
  const routes = makeHarness({
    query: async () => ({ rows: [{
      max_daily_articles: 4,
      max_daily_requests: 10,
      requests_used: 3,
      articles_completed: 1,
      articles_reserved: 1,
    }] }),
  });
  const response = await callRoute(routes.get("GET /api/admin/ai-blog/usage")!);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.configured, true);
  assert.equal(response.body.maxDailyArticles, 4);
  assert.equal(response.body.requestsUsed, 3);
  assert.equal(response.body.articlesReserved, 1);
  assert.equal(response.body.providerQuotaVerified, false);
  assert.equal(response.body.billingVerified, false);
  assert.equal(response.body.timezone, "Asia/Tbilisi");
});

test("missing usage tables produce a safe setup response without invented counts", async () => {
  const routes = makeHarness({
    query: async () => { throw Object.assign(new Error("relation missing"), { code: "42P01" }); },
  });
  const response = await callRoute(routes.get("GET /api/admin/ai-blog/usage")!);
  assert.equal(response.statusCode, 503);
  assert.equal(response.body.configured, false);
  assert.equal(response.body.code, "AI_BLOG_USAGE_SCHEMA_MISSING");
  assert.equal("requestsUsed" in response.body, false);
  assert.equal("remainingRequests" in response.body, false);
});

test("a missing settings row is reported as unconfigured, not as zero usage", async () => {
  const routes = makeHarness({ query: async () => ({ rows: [] }) });
  const response = await callRoute(routes.get("GET /api/admin/ai-blog/usage")!);
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.configured, false);
  assert.equal("maxDailyArticles" in response.body, false);
  assert.equal("articlesCompleted" in response.body, false);
});

test("limit updates validate bounds and successful saves cannot enable generation", async () => {
  let queryCount = 0;
  const routes = makeHarness({
    query: async (_sql, values) => {
      queryCount++;
      return { rows: [{ max_daily_articles: values?.[0], max_daily_requests: values?.[1] }] };
    },
  });
  const route = routes.get("PUT /api/admin/ai-blog/usage/limits")!;
  const invalid = await callRoute(route, { body: { maxDailyArticles: -1, maxDailyRequests: 2 } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(queryCount, 0);

  const valid = await callRoute(route, { body: { maxDailyArticles: 3, maxDailyRequests: 12 } });
  assert.equal(valid.statusCode, 200);
  assert.equal(valid.body.maxDailyArticles, 3);
  assert.equal(valid.body.maxDailyRequests, 12);
  assert.equal(valid.body.generationEnabled, false);
  assert.equal(valid.body.providerQuotaVerified, false);
});
