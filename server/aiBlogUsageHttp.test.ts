import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import express, { type RequestHandler } from "express";
import type { Pool } from "pg";
import { registerAiBlogDraftRoutes } from "./aiBlogDraftRoutes";

const app = express();
app.use(express.json());

const mockPool = {
  async query() {
    throw Object.assign(new Error("mock: usage table is absent"), { code: "42P01" });
  },
  async connect() {
    throw new Error("Unexpected connection() call: all database access must stay mocked.");
  },
} as unknown as Pick<Pool, "query" | "connect">;

const mockAuthentication: RequestHandler = (req, res, next) => {
  if (req.header("x-test-user") !== "authenticated") {
    return res.status(401).json({ message: "Mock authentication required" });
  }
  next();
};
const mockAdminAuthorization: RequestHandler = (req, res, next) => {
  if (req.header("x-test-role") !== "admin") {
    return res.status(403).json({ message: "Mock administrator role required" });
  }
  next();
};

registerAiBlogDraftRoutes(app, {
  pool: mockPool,
  isAuthenticated: mockAuthentication,
  isAdmin: mockAdminAuthorization,
  getUser: async () => ({ id: 1, isAdmin: true }),
});

// Mirror only the generic API fallback so a misspelled/unregistered route
// cannot accidentally look like the expected schema-missing response.
app.use("/api", (_req, res) => res.status(404).json({ message: "API endpoint not found" }));

let baseUrl = "";
let server: ReturnType<typeof app.listen>;

before(async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Local mock server did not bind a TCP port");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function request(path: string, method = "GET", headers: Record<string, string> = {}, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const getPath = "/api/admin/ai-blog/usage";
const putPath = "/api/admin/ai-blog/usage/limits";
const authenticated = { "x-test-user": "authenticated" };
const nonAdmin = { ...authenticated, "x-test-role": "user" };
const admin = { ...authenticated, "x-test-role": "admin" };

test("registered GET usage route rejects an unauthenticated visitor with 401", async () => {
  const response = await request(getPath);
  assert.equal(response.status, 401);
  assert.notEqual((await response.json()).message, "API endpoint not found");
});

test("registered PUT limits route rejects an unauthenticated visitor with 401", async () => {
  const response = await request(putPath, "PUT", {}, { maxDailyArticles: 1, maxDailyRequests: 1 });
  assert.equal(response.status, 401);
  assert.notEqual((await response.json()).message, "API endpoint not found");
});

test("GET usage denies an authenticated non-admin with 403", async () => {
  const response = await request(getPath, "GET", nonAdmin);
  assert.equal(response.status, 403);
});

test("PUT limits denies an authenticated non-admin with 403", async () => {
  const response = await request(putPath, "PUT", nonAdmin, { maxDailyArticles: 1, maxDailyRequests: 1 });
  assert.equal(response.status, 403);
});

test("GET usage reaches the registered route and returns the safe missing-schema 503", async () => {
  const response = await request(getPath, "GET", admin);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "AI_BLOG_USAGE_SCHEMA_MISSING");
  assert.notEqual(body.message, "API endpoint not found");
});

test("PUT limits reaches the registered route and returns the safe missing-schema 503", async () => {
  const response = await request(putPath, "PUT", admin, { maxDailyArticles: 2, maxDailyRequests: 5 });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.code, "AI_BLOG_USAGE_SCHEMA_MISSING");
  assert.notEqual(body.message, "API endpoint not found");
});

test("an unrelated API path is the only case that receives the generic fallback 404", async () => {
  const response = await request("/api/admin/ai-blog/not-a-registered-route");
  assert.equal(response.status, 404);
  assert.equal((await response.json()).message, "API endpoint not found");
});
