import assert from "node:assert/strict";
import http from "node:http";

const base = new URL(process.env.QA_BASE || "");
const gateUser = process.env.QA_GATE_USER || "";
const gatePassword = process.env.QA_GATE_PASSWORD || "";
const syntheticBuyer = {
  username: process.env.QA_BUYER_USERNAME || "",
  password: process.env.QA_BUYER_PASSWORD || "",
};
const checks = [];

if (
  base.protocol !== "http:" ||
  base.hostname !== "127.0.0.1" ||
  !base.port ||
  base.username ||
  base.password ||
  base.search ||
  base.hash
) {
  throw new Error("Protection smoke test accepts only an exact loopback origin");
}
if (gateUser.length < 4 || gatePassword.length < 20) {
  throw new Error("Synthetic Basic Auth credentials are required");
}

const authority = `127.0.0.1:${base.port}`;
const basic = `Basic ${Buffer.from(`${gateUser}:${gatePassword}`).toString("base64")}`;

function check(name, passed) {
  checks.push({ name, pass: Boolean(passed) });
  assert.ok(passed, name);
}

function request(pathname, { method = "GET", authenticated = false, cookie, body } = {}) {
  if (!pathname.startsWith("/") || pathname.startsWith("//")) {
    throw new Error("Only origin-relative paths are allowed");
  }
  return new Promise((resolve, reject) => {
    const headers = { Host: authority, Connection: "close" };
    if (authenticated) headers.Authorization = basic;
    if (cookie) headers.Cookie = cookie;
    if (body !== undefined) {
      headers["Content-Type"] = "application/json";
      headers["Content-Length"] = Buffer.byteLength(body);
      headers.Origin = base.origin;
    }
    const req = http.request({
      hostname: "127.0.0.1",
      port: Number(base.port),
      method,
      path: pathname,
      headers,
      setHost: false,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function noSensitiveHeaders(response) {
  return !response.headers["set-cookie"] &&
    !response.headers.location &&
    !response.headers.server &&
    !response.headers["x-powered-by"] &&
    response.headers["cache-control"] === "no-store" &&
    response.headers["x-robots-tag"] === "noindex, nofollow, noarchive";
}

try {
  const publicPaths = [
    "/health",
    "/robots.txt",
    "/sw.js",
    "/api/auth/me",
    "/api/vip/me",
    "/api/admin/vip/overview",
    "/admin/vip",
    "/vip",
    "/index.html",
  ];
  for (const path of publicPaths) {
    const response = await request(path);
    check(`no Basic Auth blocks ${path}`, response.status === 401);
    check(`unauthorized ${path} discloses no response metadata`, noSensitiveHeaders(response));
    check(`unauthorized ${path} has only the generic Basic challenge`,
      response.headers["www-authenticate"] === 'Basic realm="KINGLIKE VIP Private QA"');
    check(`unauthorized ${path} body is generic`,
      response.body === "Private KINGLIKE VIP QA - login required");
  }
  const guestMutation = await request("/api/auth/login", { method: "POST", body: "{}" });
  check("no Basic Auth blocks POST", guestMutation.status === 401);
  check("unauthorized POST does not create a session", !guestMutation.headers["set-cookie"]);

  const health = await request("/health", { authenticated: true });
  check("Basic Auth permits the health endpoint", health.status === 200);
  check("health response contains only its non-sensitive QA status",
    JSON.stringify(JSON.parse(health.body)) === JSON.stringify({ ok: true, mode: "private-vip-qa" }));
  check("health response is not cacheable", health.headers["cache-control"] === "no-store");
  check("security headers are present on authorized health",
    Boolean(health.headers["content-security-policy"]) &&
    health.headers["x-content-type-options"] === "nosniff");

  const robots = await request("/robots.txt", { authenticated: true });
  check("Basic Auth permits robots.txt", robots.status === 200);
  check("robots.txt remains non-indexable", robots.body.includes("Disallow: /"));
  const sw = await request("/sw.js", { authenticated: true });
  check("service worker remains disabled", sw.status === 404);

  const vipPage = await request("/vip", { authenticated: true });
  const vipIsHtml = vipPage.status === 200 &&
    /^text\/html/i.test(String(vipPage.headers["content-type"] || "")) &&
    /<!doctype html/i.test(vipPage.body);
  check(`authenticated VIP SPA route returns HTML (status=${vipPage.status}, html=${vipIsHtml})`, vipIsHtml);
  check("VIP HTML is not cacheable", vipPage.headers["cache-control"] === "no-store");
  const assetPaths = [...vipPage.body.matchAll(/(?:src|href)=["'](\/[^"']+\.(?:js|css))["']/gi)]
    .map((match) => match[1]);
  check("QA HTML references at least one built local asset", assetPaths.length > 0);
  for (const path of [...new Set(assetPaths)]) {
    const asset = await request(path, { authenticated: true });
    check(`authenticated built asset returns 200 (${path.split("/").at(-1)})`, asset.status === 200);
    check(`built asset is not cacheable (${path.split("/").at(-1)})`,
      asset.headers["cache-control"] === "no-store");
    check(`built asset does not expose server headers (${path.split("/").at(-1)})`,
      !asset.headers.server && !asset.headers["x-powered-by"]);
  }

  const protectedPaths = [
    "/.env",
    "/.git/config",
    "/.replit",
    "/package.json",
    "/package-lock.json",
    "/server/index.ts",
    "/client/src/main.tsx",
    "/shared/schema.ts",
    "/mobile-app/signing-file",
    "/kinglike-twa/settings",
    "/node_modules/express/package.json",
    "/dist/server.mjs",
    "/%2e%2e/.env",
    "/%252e%252e%252fserver%252findex.ts",
    "/vip/%2e%2e/server/index.ts",
    "/vip/%5c..%5c.env",
  ];
  for (const path of protectedPaths) {
    const guest = await request(path);
    check(`unauthenticated private-path probe is blocked (${path})`, guest.status === 401);
    const authorized = await request(path, { authenticated: true });
    check(`authenticated private-path probe returns only 404 (${path})`,
      authorized.status === 404 && authorized.body === "Not found");
    check(`private-path response reveals no headers (${path})`, noSensitiveHeaders(authorized));
  }

  const missingApi = await request("/api/qa-protection-not-found", { authenticated: true });
  check("unknown authenticated API route is 404", missingApi.status === 404);
  const missingAsset = await request("/assets/not-a-real-asset.js", { authenticated: true });
  check("unknown authenticated static file is 404, not the SPA shell",
    missingAsset.status === 404 && missingAsset.body === "Not found");
  const meNoSession = await request("/api/auth/me", { authenticated: true });
  check("Basic Auth alone does not create an application session", meNoSession.status === 401);

  if (syntheticBuyer.username && syntheticBuyer.password) {
    const login = await request("/api/auth/login", {
      method: "POST",
      authenticated: true,
      body: JSON.stringify(syntheticBuyer),
    });
    const cookieHeader = login.headers["set-cookie"];
    const cookie = Array.isArray(cookieHeader) ? cookieHeader[0]?.split(";", 1)[0] : undefined;
    check("synthetic buyer login succeeds behind Basic Auth", login.status === 200 && Boolean(cookie));
    if (cookie) {
      const finance = await request("/api/admin/vip/overview", { authenticated: true, cookie });
      check("synthetic buyer cannot access the admin API", finance.status === 403);
      const financeCacheControl = String(finance.headers["cache-control"] || "").toLowerCase();
      const financeServerHeader = Boolean(finance.headers.server || finance.headers["x-powered-by"]);
      check(`role-denial response is non-cacheable and has no server header (no-store=${financeCacheControl.includes("no-store")},server-header=${financeServerHeader})`,
        financeCacheControl.includes("no-store") && !financeServerHeader);
      check("role-denial response contains no private project file data",
        !/BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY|DATABASE_URL|process\.env/i.test(finance.body));
    }
  } else {
    check("synthetic buyer login/403 role test is skipped without QA credentials", false);
  }

  console.log(JSON.stringify({
    checks: checks.length,
    passed: checks.filter((item) => item.pass).length,
    failed: checks.filter((item) => !item.pass).map((item) => item.name),
    testedPaths: publicPaths.length + protectedPaths.length,
    externalRequests: 0,
    note: "All requests use Node HTTP to the exact 127.0.0.1 origin; redirects are not followed.",
  }));
} catch (error) {
  console.error(JSON.stringify({
    checks: checks.length,
    passed: checks.filter((item) => item.pass).length,
    failed: checks.filter((item) => !item.pass).map((item) => item.name),
    error: error instanceof Error ? error.message : "QA protection smoke failed",
  }));
  process.exitCode = 1;
}
