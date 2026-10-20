import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import express from "express";
import session from "express-session";
import pg from "pg";
import { registerAiBlogDraftRoutes } from "../server/aiBlogDraftRoutes";
import { AI_BLOG_MARKETS } from "../server/aiBlogDraftPolicy";

const { Pool } = pg;
const DB_NAME = "ai_blog_drafts_local_test";
const DB_USER = "ai_blog_local_test";
const DB_PORT = 55439;
const HTTP_PORT = 43117;
const TEST_DATE = "2099-12-31";
const DUPLICATE_DATE = "2099-12-30";
const TEST_SLUG = "local-ai-blog-synthetic-2099";
const NO_DATABASE_FALLBACKS = [
  "NEON_DATABASE_URL",
  "DATABASE_URL",
  "KAY_TEST_DATABASE_URL",
  "PGHOST",
  "PGPORT",
  "PGUSER",
  "PGPASSWORD",
] as const;
const NO_EXTERNAL_CREDENTIALS = [
  "OPENAI_API_KEY",
  "AI_API_KEY",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "TAVILY_API_KEY",
  "SERPAPI_API_KEY",
  "RESEND_API_KEY",
  "GMAIL_APP_PASSWORD",
  "WHATSAPP_ACCESS_TOKEN",
  "META_ACCESS_TOKEN",
  "META_APP_SECRET",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "BOG_CLIENT_ID",
  "BOG_CLIENT_SECRET",
] as const;

for (const key of [...NO_DATABASE_FALLBACKS, ...NO_EXTERNAL_CREDENTIALS]) {
  if (process.env[key]) throw new Error(`Refusing local HTTP test: forbidden environment variable is present (${key}).`);
}
if (process.env.NODE_ENV !== "test") {
  throw new Error("Refusing local HTTP test: NODE_ENV must be test.");
}
if (process.env.REPLIT_DEPLOYMENT === "1" || process.env.REPLIT_DEPLOYMENT === "true") {
  throw new Error("Refusing local HTTP test in deployment.");
}

// Explicit local socket target only. This process never imports app db.ts.
const pool = new Pool({
  host: "127.0.0.1",
  port: DB_PORT,
  database: DB_NAME,
  user: DB_USER,
  password: "",
  ssl: false,
  max: 4,
  connectionTimeoutMillis: 1500,
});

type TestCase = { name: string; run: () => Promise<void> };
const results: Array<{ name: string; status: "PASS" | "FAIL"; detail?: string }> = [];
let server: ReturnType<express.Application["listen"]> | undefined;
let migrationApplied = false;

async function check(name: string, run: () => Promise<void>) {
  try {
    await run();
    results.push({ name, status: "PASS" });
    console.log(`PASS ${name}`);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    results.push({ name, status: "FAIL", detail });
    console.error(`FAIL ${name}: ${detail}`);
    throw error;
  }
}

async function run() {
  const client = await pool.connect();
  try {
    const identity = await client.query(
      "SELECT current_database() AS database, current_user AS role, host(inet_server_addr()) AS address, inet_server_port() AS port",
    );
    const row = identity.rows[0];
    assert.equal(row.database, DB_NAME);
    assert.equal(row.role, DB_USER);
    assert.equal(row.address, "127.0.0.1");
    assert.equal(Number(row.port), DB_PORT);
    const existing = await client.query(
      "SELECT COUNT(*)::int AS count FROM information_schema.tables WHERE table_schema='public'",
    );
    assert.equal(existing.rows[0].count, 0, "temporary test database must start empty");

    await client.query(`
      CREATE TABLE users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        is_admin BOOLEAN NOT NULL DEFAULT FALSE
      );
      CREATE TABLE blog_posts (
        id SERIAL PRIMARY KEY,
        title TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        content TEXT NOT NULL,
        excerpt TEXT NOT NULL,
        cover_image TEXT NOT NULL,
        author_id INTEGER NOT NULL REFERENCES users(id),
        categories JSONB NOT NULL DEFAULT '[]'::jsonb,
        country TEXT NOT NULL DEFAULT 'georgia',
        translations JSONB,
        published BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMP NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    const migration = await readFile(
      resolve(process.cwd(), "server/migrations/2026-10-20-ai-blog-drafts.sql"),
      "utf8",
    );
    await client.query(migration);
    migrationApplied = true;
    await client.query(
      "INSERT INTO users (username,is_admin) VALUES ('local-test-editor',FALSE),('local-test-admin',TRUE)",
    );
    const settings = await client.query(
      "SELECT enabled,time_georgia FROM ai_blog_schedule_settings WHERE id=1",
    );
    assert.equal(settings.rows[0]?.enabled, false);
    assert.equal(settings.rows[0]?.time_georgia, "09:00");
  } finally {
    client.release();
  }

  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "64kb" }));
  app.use(session({
    name: "ai_blog_local_test.sid",
    secret: randomBytes(32).toString("hex"),
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "strict", secure: false, maxAge: 5 * 60 * 1000 },
  }));

  async function getUser(id: number) {
    const { rows } = await pool.query(
      "SELECT id,is_admin AS \"isAdmin\" FROM users WHERE id=$1",
      [id],
    );
    return rows[0] as { id: number; isAdmin: boolean } | undefined;
  }

  app.post("/__test/login", async (req, res) => {
    if (req.socket.remoteAddress !== "127.0.0.1" && req.socket.remoteAddress !== "::ffff:127.0.0.1") {
      return res.sendStatus(403);
    }
    const username = req.body?.role === "admin" ? "local-test-admin"
      : req.body?.role === "user" ? "local-test-editor" : null;
    if (!username) return res.sendStatus(400);
    const { rows } = await pool.query("SELECT id FROM users WHERE username=$1", [username]);
    if (!rows[0]) return res.sendStatus(401);
    req.session.userId = rows[0].id;
    return res.sendStatus(204);
  });

  const isAuthenticated: express.RequestHandler = (req, res, next) => {
    if (req.session?.userId) return next();
    return res.status(401).json({ message: "Not authenticated" });
  };
  const isAdmin: express.RequestHandler = async (req, res, next) => {
    const user = req.session?.userId ? await getUser(req.session.userId) : undefined;
    if (user?.isAdmin) return next();
    return res.status(403).json({ message: "Not authorized" });
  };

  registerAiBlogDraftRoutes(app, {
    pool,
    isAuthenticated,
    isAdmin,
    getUser,
    onRouteError: (operation, error) => {
      const value = error as { code?: unknown; message?: unknown };
      console.error(`[local-test-diagnostic] ${operation} code=${String(value?.code ?? "unknown")} message=${String(value?.message ?? "unknown")}`);
    },
  });
  app.use((_req, res) => res.status(404).json({ message: "Test route not mounted" }));

  server = app.listen(HTTP_PORT, "127.0.0.1");
  await new Promise<void>((resolveListen, reject) => {
    server!.once("listening", resolveListen);
    server!.once("error", reject);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  assert.equal(address.port, HTTP_PORT);

  const baseUrl = `http://127.0.0.1:${HTTP_PORT}`;
  async function http(path: string, options: RequestInit = {}) {
    return fetch(`${baseUrl}${path}`, { ...options, redirect: "manual" });
  }
  async function login(role: "admin" | "user") {
    const response = await http("/__test/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ role }),
    });
    assert.equal(response.status, 204);
    const cookie = response.headers.get("set-cookie")?.split(";")[0];
    assert(cookie, "test login must create an isolated memory-session cookie");
    return cookie;
  }
  const adminCookie = await login("admin");
  const userCookie = await login("user");
  const adminHeaders = { cookie: adminCookie, "content-type": "application/json" };
  const userHeaders = { cookie: userCookie, "content-type": "application/json" };

  await check("visitor is denied AI blog administration", async () => {
    const response = await http("/api/admin/ai-blog/status");
    assert.equal(response.status, 401);
  });
  await check("authenticated non-admin is denied AI blog administration", async () => {
    const response = await http("/api/admin/ai-blog/status", { headers: userHeaders });
    assert.equal(response.status, 403);
  });
  await check("test admin is authorized and providers/scheduler remain disabled", async () => {
    const response = await http("/api/admin/ai-blog/status", { headers: adminHeaders });
    assert.equal(response.status, 200);
    const data = await response.json() as any;
    assert.equal(data.readiness.generationEnabled, false);
    assert.equal(data.readiness.schedulerEnabled, false);
    assert.equal(data.readiness.textReady, false);
    assert.equal(data.readiness.imageReady, false);
    assert.equal(data.schedule.enabled, false);
    assert.equal(data.schedule.time_georgia, "09:00");
  });
  await check("all five approved markets accept synthetic draft creation; Baku alias is rejected", async () => {
    assert.deepEqual(AI_BLOG_MARKETS.map(({ country }) => country), [
      "georgia", "turkey", "syria", "azerbaijan", "northern-cyprus",
    ]);
    const responses = await Promise.all(AI_BLOG_MARKETS.map(({ country }) =>
      http("/api/admin/ai-blog/drafts", {
        method: "POST",
        headers: adminHeaders,
        body: JSON.stringify({ businessDate: TEST_DATE, country, title: `[LOCAL TEST] ${country}` }),
      }),
    ));
    assert(responses.every((response) => response.status === 201));
    const rejected = await http("/api/admin/ai-blog/drafts", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ businessDate: TEST_DATE, country: "baku" }),
    });
    assert.equal(rejected.status, 400);
  });
  await check("concurrent duplicate market/date creation inserts exactly one draft", async () => {
    const create = () => http("/api/admin/ai-blog/drafts", {
      method: "POST",
      headers: adminHeaders,
      body: JSON.stringify({ businessDate: DUPLICATE_DATE, country: "turkey", title: "[LOCAL TEST] race" }),
    });
    const responses = await Promise.all([create(), create()]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
    const { rows } = await pool.query(
      "SELECT COUNT(*)::int AS count FROM ai_blog_drafts WHERE business_date=$1 AND country='turkey'",
      [DUPLICATE_DATE],
    );
    assert.equal(rows[0].count, 1);
  });
  const { rows: draftRows } = await pool.query(
    "SELECT id FROM ai_blog_drafts WHERE business_date=$1 AND country='georgia'",
    [TEST_DATE],
  );
  const draftId = Number(draftRows[0]?.id);
  assert(Number.isSafeInteger(draftId));

  await check("draft edit and manual review persist over HTTP; draft is absent from public post table", async () => {
    const response = await http(`/api/admin/ai-blog/drafts/${draftId}`, {
      method: "PUT",
      headers: adminHeaders,
      body: JSON.stringify({
        title: "مقال اصطناعي للاختبار فقط",
        content: "هذا محتوى ثابت للاختبار المحلي، وليس مولداً بالذكاء الاصطناعي ولا يتضمن معلومات سوقية حقيقية.",
        seoDescription: "وصف اختبار محلي",
        slug: TEST_SLUG,
        coverImage: "https://res.cloudinary.com/demo/image/upload/local-test.jpg",
        sources: [{ url: "https://example.com/local-test", title: "Synthetic fixture", accessedAt: "2099-01-01T00:00:00Z" }],
        reviewNote: "Reviewed in local HTTP test only",
        status: "ready_for_review",
      }),
    });
    assert.equal(response.status, 200);
    const data = await response.json() as any;
    assert.equal(data.draft.status, "ready_for_review");
    assert.equal(data.draft.title, "مقال اصطناعي للاختبار فقط");
    const posts = await pool.query("SELECT COUNT(*)::int AS count FROM blog_posts WHERE slug=$1", [TEST_SLUG]);
    assert.equal(posts.rows[0].count, 0);
  });
  await check("manual publish is atomic, concurrent/repeated publish cannot create a second post", async () => {
    const publish = () => http(`/api/admin/ai-blog/drafts/${draftId}/publish`, {
      method: "POST",
      headers: adminHeaders,
    });
    const responses = await Promise.all([publish(), publish()]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [200, 404]);
    const repeat = await publish();
    assert.equal(repeat.status, 404);
    const posts = await pool.query("SELECT id,published FROM blog_posts WHERE slug=$1", [TEST_SLUG]);
    assert.equal(posts.rows.length, 1);
    assert.equal(posts.rows[0].published, true);
    const draft = await pool.query(
      "SELECT status,published_post_id FROM ai_blog_drafts WHERE id=$1",
      [draftId],
    );
    assert.equal(draft.rows[0].status, "published");
    assert.equal(Number(draft.rows[0].published_post_id), Number(posts.rows[0].id));
  });
  await check("generation endpoint remains disabled and makes no provider call", async () => {
    const response = await http("/api/admin/ai-blog/run-now", {
      method: "POST",
      headers: adminHeaders,
    });
    assert.equal(response.status, 503);
    const body = await response.json() as any;
    assert.equal(body.code, "AI_BLOG_GENERATION_DISABLED");
  });
}

async function cleanup() {
  if (server) await new Promise<void>((resolveClose) => server!.close(() => resolveClose()));
  if (!migrationApplied) {
    await pool.end();
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("DELETE FROM ai_blog_drafts");
    await client.query("DELETE FROM blog_posts");
    await client.query("DELETE FROM users");
    await client.query("UPDATE ai_blog_schedule_settings SET enabled=FALSE,time_georgia='09:00' WHERE id=1");
    await client.query("COMMIT");
    const final = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM ai_blog_drafts) AS drafts,
        (SELECT COUNT(*)::int FROM blog_posts) AS posts,
        (SELECT COUNT(*)::int FROM users) AS users,
        (SELECT enabled FROM ai_blog_schedule_settings WHERE id=1) AS enabled,
        (SELECT time_georgia FROM ai_blog_schedule_settings WHERE id=1) AS time
    `);
    const row = final.rows[0];
    assert.equal(row.drafts, 0);
    assert.equal(row.posts, 0);
    assert.equal(row.users, 0);
    assert.equal(row.enabled, false);
    assert.equal(row.time, "09:00");
    console.log("PASS cleanup leaves zero fixture rows and scheduler disabled at 09:00");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("FAIL cleanup verification", error);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

try {
  await run();
} catch (error) {
  console.error("Local AI blog HTTP test failed.", error);
  process.exitCode = 1;
} finally {
  await cleanup();
}

if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;
