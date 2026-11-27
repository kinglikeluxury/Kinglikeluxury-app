import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = new URL(process.env.QA_BASE || "");
if (
  base.protocol !== "http:" ||
  base.hostname !== "127.0.0.1" ||
  !base.port ||
  base.username ||
  base.password ||
  base.search ||
  base.hash
) {
  throw new Error("VIP flag browser test only accepts the exact loopback origin");
}
if (
  process.env.QA_VIP_EXPECT_ENABLED !== "false" ||
  process.env.KINGLIKE_VIP_QA_UI_ENABLED !== "false" ||
  process.env.KINGLIKE_VIP_ENABLED !== "false"
) {
  throw new Error("Both VIP flags must be explicitly disabled for this browser case");
}
const gateUser = process.env.QA_GATE_USER || "";
const gatePassword = process.env.QA_GATE_PASSWORD || "";
if (gateUser.length < 4 || gatePassword.length < 20) {
  throw new Error("Synthetic Basic-auth credentials are required");
}

const externalAttempts = [];
const localWebSocketAttempts = [];
const vipApiRequests = [];
const consoleCategories = {};
const cspViolations = [];

function addConsoleCategory(message) {
  const text = message.toLowerCase();
  const category = text.includes("content security policy") ? "csp" :
    /\b401\b/.test(text) ? "http-401" :
    /\b404\b/.test(text) ? "http-404" :
    text.includes("failed to load resource") ? "resource-load" :
    text.includes("failed to fetch") ? "fetch" :
    text.includes("net::err") ? "network" : "other";
  consoleCategories[category] = (consoleCategories[category] || 0) + 1;
}

function isQaLocalAuthority(url) {
  return url.hostname === "127.0.0.1" && url.port === base.port;
}

function installLocalGuard(context) {
  context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
      return;
    }
    if (url.origin !== base.origin) {
      externalAttempts.push({ host: url.hostname, method: request.method() });
      await route.abort("blockedbyclient");
      return;
    }
    if (!["GET", "HEAD"].includes(request.method()) &&
        !["/api/auth/login", "/api/auth/logout"].includes(url.pathname)) {
      await route.fulfill({ status: 403, body: "mutation blocked in flag-off QA" });
      return;
    }
    if (url.pathname.startsWith("/api/vip/") || url.pathname.startsWith("/api/admin/vip/")) {
      vipApiRequests.push({ path: url.pathname, method: request.method() });
    }
    await route.continue();
  });
  context.routeWebSocket("**/*", async (socket) => {
    const url = new URL(socket.url());
    if (isQaLocalAuthority(url)) localWebSocketAttempts.push({ path: url.pathname });
    else externalAttempts.push({ host: url.hostname, method: "WS" });
    await socket.close({ code: 1008, reason: "WebSocket disabled in flag-off QA" });
  });
}

async function login(page) {
  await page.goto(new URL("/login", base).href, { waitUntil: "domcontentloaded" });
  await page.locator('input[autocomplete="username"]').fill("qa_admin");
  await page.locator('input[type="password"]').fill("SyntheticQaOnly-Password-418!");
  const responsePromise = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/login",
  );
  await page.locator('button[type="submit"]').click();
  const response = await responsePromise;
  assert.equal(response.status(), 200, "synthetic administrator login");
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 10_000 });
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
  args: [
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--disable-default-apps",
    "--disable-extensions",
    "--no-first-run",
    "--disable-dns-prefetch",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1",
  ],
});

try {
  const guest = await browser.newContext({ serviceWorkers: "block", locale: "en-US" });
  installLocalGuard(guest);
  const guestPage = await guest.newPage();
  const denied = await guestPage.goto(new URL("/admin/vip", base).href, {
    waitUntil: "domcontentloaded",
  });
  assert.equal(denied?.status(), 401, "Basic Auth must guard the page");
  await guest.close();

  const context = await browser.newContext({
    httpCredentials: { username: gateUser, password: gatePassword, origin: base.origin, send: "always" },
    serviceWorkers: "block",
    locale: "en-US",
  });
  installLocalGuard(context);
  await context.addInitScript(() => {
    if (typeof URL.parse !== "function") {
      Object.defineProperty(URL, "parse", {
        configurable: true,
        value: (input, baseUrl) => {
          try { return new URL(input, baseUrl); } catch { return null; }
        },
      });
    }
    try { localStorage.setItem("i18nextLng", "en"); } catch {}
    window.__qaCspViolations = [];
    window.addEventListener("securitypolicyviolation", () => {
      window.__qaCspViolations.push("violation");
    });
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") addConsoleCategory(message.text());
  });
  const home = await page.goto(new URL("/login", base).href, { waitUntil: "domcontentloaded" });
  assert.equal(home?.status(), 200);
  await login(page);

  const profile = page.locator(
    'button:has(div[class*="bg-gradient-to-br"][class*="rounded-full"]):visible',
  ).first();
  if (await profile.count()) await profile.click();
  assert.equal(await page.locator('a[href="/admin/vip"]:visible').count(), 0, "VIP admin menu must be absent");

  const route = await page.goto(new URL("/admin/vip", base).href, { waitUntil: "domcontentloaded" });
  assert.equal(route?.status(), 200, "the SPA fallback may serve its shell");
  assert.equal(await page.getByText("KINGLIKE VIP administration", { exact: true }).count(), 0,
    "VIP admin page must not be mounted");

  const apiStatus = await page.evaluate(async () => {
    const response = await fetch("/api/admin/vip/overview", {
      credentials: "include",
      cache: "no-store",
    });
    return response.status;
  });
  assert.equal(apiStatus, 404, "backend VIP flag OFF must fail closed");
  assert.deepEqual(vipApiRequests.filter((item) => item.path !== "/api/admin/vip/overview"), [],
    "disabled UI must not query VIP APIs");
  assert.equal(externalAttempts.length, 0, "no external browser requests");
  const pageCspViolations = await page.evaluate(() => window.__qaCspViolations.length);
  assert.equal(pageCspViolations, 0, "no CSP violations");

  console.log(JSON.stringify({
    mode: "flags-off",
    guestBasicAuth: denied.status(),
    adminMenuItems: 0,
    vipPageMounted: false,
    overviewApi: apiStatus,
    otherVipApiRequests: 0,
    externalRequests: externalAttempts.length,
    localWebSocketRequestsBlocked: localWebSocketAttempts.length,
    cspViolations: pageCspViolations,
    consoleErrors: consoleCategories,
  }));
  await context.close();
} finally {
  await browser.close();
}
