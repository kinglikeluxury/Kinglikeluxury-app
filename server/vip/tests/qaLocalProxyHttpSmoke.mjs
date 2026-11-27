import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";

const base = new URL(process.env.QA_PROXY_BASE || "");
const user = process.env.QA_GATE_USER || "";
const password = process.env.QA_GATE_PASSWORD || "";
const expectedOrigin = "http://127.0.0.1:54823";
const expectedAuthority = "127.0.0.1:54823";
const checks = [];

if (
  base.protocol !== "http:" ||
  base.hostname !== "127.0.0.1" ||
  base.port !== "54823" ||
  base.origin !== expectedOrigin ||
  base.username ||
  base.password ||
  base.search ||
  base.hash
) {
  throw new Error("Proxy smoke test accepts only the fixed QA loopback origin");
}
if (user.length < 4 || password.length < 20) {
  throw new Error("Synthetic Basic Auth credentials are required");
}

const basic = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
const authority = expectedAuthority;

function check(name, passed) {
  checks.push({ name, pass: Boolean(passed) });
  assert.ok(passed, name);
}

function request(path, {
  method = "GET",
  auth = false,
  host = authority,
  origin,
  headers = {},
  body,
} = {}) {
  if (typeof path !== "string") throw new Error("Path must be a string");
  return new Promise((resolve, reject) => {
    const requestHeaders = {
      Host: host,
      Connection: "close",
      ...headers,
    };
    if (auth) requestHeaders.Authorization = basic;
    if (origin !== undefined) requestHeaders.Origin = origin;
    if (body !== undefined) {
      requestHeaders["Content-Type"] ??= "application/json";
      requestHeaders["Content-Length"] = Buffer.byteLength(body);
    }
    const req = http.request({
      hostname: "127.0.0.1",
      port: 54823,
      method,
      path,
      headers: requestHeaders,
      setHost: false,
      timeout: 5000,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode || 0,
        headers: res.headers,
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
    req.on("timeout", () => req.destroy(new Error("local proxy request timed out")));
    req.on("error", reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function rawRequest(payload) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(54823, "127.0.0.1");
    let text = "";
    const timeout = setTimeout(() => socket.destroy(new Error("raw loopback probe timed out")), 5000);
    socket.on("connect", () => socket.write(payload));
    socket.on("data", (chunk) => { text += chunk.toString("latin1"); });
    socket.on("error", (error) => { clearTimeout(timeout); reject(error); });
    socket.on("end", () => { clearTimeout(timeout); resolve(text); });
    socket.on("close", () => clearTimeout(timeout));
  });
}

function statusLine(response) {
  return Number(response.split("\r\n", 1)[0].match(/^HTTP\/1\.[01] (\d{3})/)?.[1] || 0);
}

function basicResponseHasNoServerHeaders(response) {
  const headerBlock = response.split("\r\n\r\n", 1)[0].toLowerCase();
  return !/\r\nserver:/i.test(headerBlock) && !/\r\nx-powered-by:/i.test(headerBlock);
}

try {
  for (const path of ["/health", "/robots.txt", "/api/auth/me", "/vip", "/assets/"]) {
    const guest = await request(path);
    check(`proxy gates ${path} before routing`, guest.status === 401);
    check(`guest ${path} receives a Basic challenge without cookies`,
      guest.headers["www-authenticate"] === 'Basic realm="KINGLIKE VIP Private QA"' &&
      !guest.headers["set-cookie"] &&
      guest.headers["cache-control"] === "no-store");
  }

  const health = await request("/health", { auth: true });
  check("fixed loopback upstream returns synthetic health", health.status === 200);
  check("proxy overrides cache policy and strips server headers",
    health.headers["cache-control"] === "no-store" &&
    !health.headers.server &&
    !health.headers["x-powered-by"] &&
    health.headers["x-robots-tag"] === "noindex, nofollow, noarchive");
  check("proxy preserves the upstream CSP and nosniff policy",
    Boolean(health.headers["content-security-policy"]) &&
    health.headers["x-content-type-options"] === "nosniff");

  const root = await request("/", { auth: true });
  check("local redirect remains same-origin relative", root.status === 302 && root.headers.location === "/vip");
  const page = await request("/vip", { auth: true });
  check("authenticated VIP page is served through proxy",
    page.status === 200 && /<!doctype html/i.test(page.body));
  const privatePath = await request("/%252e%252e%252fserver%252findex.ts", { auth: true });
  check("double-encoded traversal returns generic 404",
    privatePath.status === 404 && privatePath.body === "Not found");
  const privateRoot = await request("/.replit", { auth: true });
  check("project configuration path is not served",
    privateRoot.status === 404 && privateRoot.body === "Not found");

  const hostMismatchGuest = await request("/health", { host: "outside.example" });
  check("invalid Host remains behind Basic Auth", hostMismatchGuest.status === 401);
  const hostMismatch = await request("/health", { auth: true, host: "outside.example" });
  check("authenticated invalid Host is rejected", hostMismatch.status === 421);
  const badOrigin = await request("/api/auth/me", {
    auth: true,
    origin: "https://outside.example",
  });
  check("untrusted Origin is rejected before upstream routing", badOrigin.status === 403);
  const unsafeNoOrigin = await request("/api/auth/login", {
    auth: true,
    method: "POST",
    body: "{}",
  });
  check("unsafe methods require the exact same-origin Origin", unsafeNoOrigin.status === 403);
  const goodOrigin = await request("/api/auth/me", {
    auth: true,
    origin: expectedOrigin,
  });
  check("same-origin request reaches the QA session gate", goodOrigin.status === 401);

  const forwardedSpoof = await request("/health", {
    auth: true,
    headers: {
      "X-Forwarded-Host": "outside.example",
      "X-Forwarded-For": "203.0.113.7",
      "X-Forwarded-Proto": "https",
    },
  });
  check("untrusted forwarding headers cannot change the fixed upstream", forwardedSpoof.status === 200);

  const oversized = await rawRequest([
    "POST /api/auth/login HTTP/1.1",
    `Host: ${authority}`,
    `Authorization: ${basic}`,
    `Origin: ${expectedOrigin}`,
    `Content-Length: ${12 * 1024 * 1024 + 1}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n"));
  check("oversized declared request body is rejected without upload", statusLine(oversized) === 413);
  check("oversized-body error response contains no server banner", basicResponseHasNoServerHeaders(oversized));

  const oversizedHeaders = await rawRequest([
    "GET /health HTTP/1.1",
    `Host: ${authority}`,
    `Authorization: ${basic}`,
    `X-Overlong: ${"a".repeat(10 * 1024)}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n"));
  check("oversized headers are rejected by the HTTP parser", statusLine(oversizedHeaders) === 431);
  check("oversized-header error response contains no server banner",
    basicResponseHasNoServerHeaders(oversizedHeaders));

  const absoluteNoAuth = await rawRequest([
    "GET http://outside.example/health HTTP/1.1",
    `Host: ${authority}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n"));
  check("absolute-form routing is still gated", statusLine(absoluteNoAuth) === 401);
  const absoluteAuth = await rawRequest([
    "GET http://outside.example/health HTTP/1.1",
    `Host: ${authority}`,
    `Authorization: ${basic}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n"));
  check("absolute-form external target is rejected", statusLine(absoluteAuth) === 400);

  const wsNoAuth = await rawRequest([
    "GET /health HTTP/1.1",
    `Host: ${authority}`,
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Version: 13",
    "Sec-WebSocket-Key: c3VudGhldGljLWtleQ==",
    "",
    "",
  ].join("\r\n"));
  check("unauthenticated WebSocket upgrade is gated", statusLine(wsNoAuth) === 401);
  const wsAuth = await rawRequest([
    "GET /health HTTP/1.1",
    `Host: ${authority}`,
    `Authorization: ${basic}`,
    "Connection: Upgrade",
    "Upgrade: websocket",
    "Sec-WebSocket-Version: 13",
    "Sec-WebSocket-Key: c3VudGhldGljLWtleQ==",
    "",
    "",
  ].join("\r\n"));
  check("authenticated WebSocket upgrade is rejected, not proxied", statusLine(wsAuth) === 426);

  const connectNoAuth = await rawRequest([
    "CONNECT outside.example:443 HTTP/1.1",
    `Host: ${authority}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n"));
  check("unauthenticated CONNECT is gated", statusLine(connectNoAuth) === 401);
  const connectAuth = await rawRequest([
    "CONNECT outside.example:443 HTTP/1.1",
    `Host: ${authority}`,
    `Authorization: ${basic}`,
    "Connection: close",
    "",
    "",
  ].join("\r\n"));
  check("authenticated CONNECT is rejected", statusLine(connectAuth) === 405);

  const badMethodGuest = await request("/health", { method: "OPTIONS" });
  check("disallowed methods are still gated", badMethodGuest.status === 401);
  const badMethod = await request("/health", { auth: true, method: "OPTIONS" });
  check("CORS preflight is not forwarded", badMethod.status === 405);

  const expectNoAuth = await rawRequest([
    "POST /api/auth/login HTTP/1.1",
    `Host: ${authority}`,
    `Origin: ${expectedOrigin}`,
    "Expect: 100-continue",
    "Content-Length: 2",
    "Connection: close",
    "",
    "",
  ].join("\r\n"));
  check("unauthenticated Expect request is challenged without 100 Continue",
    statusLine(expectNoAuth) === 401 && !expectNoAuth.includes("100 Continue"));
  const expectAuth = await rawRequest([
    "POST /api/auth/login HTTP/1.1",
    `Host: ${authority}`,
    `Authorization: ${basic}`,
    `Origin: ${expectedOrigin}`,
    "Expect: 100-continue",
    "Content-Length: 2",
    "Connection: close",
    "",
    "",
  ].join("\r\n"));
  check("authenticated Expect upload is refused before body transmission",
    statusLine(expectAuth) === 417 && !expectAuth.includes("100 Continue"));

  const result = {
    checks: checks.length,
    passed: checks.filter((item) => item.pass).length,
    failed: checks.filter((item) => !item.pass).map((item) => item.name),
    externalRequests: 0,
    rawSocketTarget: "127.0.0.1 only",
  };
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(JSON.stringify({
    checks: checks.length,
    passed: checks.filter((item) => item.pass).length,
    failed: checks.filter((item) => !item.pass).map((item) => item.name),
    error: error instanceof Error ? error.message : "unknown",
  }));
  process.exitCode = 1;
}
