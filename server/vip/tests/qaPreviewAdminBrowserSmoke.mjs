import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = new URL(process.env.QA_BASE || "");
const gateUser = process.env.QA_GATE_USER || "";
const gatePassword = process.env.QA_GATE_PASSWORD || "";
const fixture = {
  unitA: Number(process.env.QA_UNIT_A_ID),
  installment: Number(process.env.QA_INSTALLMENT_ID),
  buyerAEmail: process.env.QA_BUYER_A_EMAIL || "",
  buyerBEmail: process.env.QA_BUYER_B_EMAIL || "",
  sellerEmail: process.env.QA_SELLER_EMAIL || "",
  financeEmail: process.env.QA_FINANCE_EMAIL || "",
  approverEmail: process.env.QA_APPROVER_EMAIL || "",
  password: "SyntheticQaOnly-Password-418!",
};
if (
  base.protocol !== "http:" ||
  base.hostname !== "127.0.0.1" ||
  !base.port ||
  base.username ||
  base.password ||
  base.search ||
  base.hash
) {
  throw new Error("VIP admin browser test only accepts the exact loopback origin");
}
if (
  process.env.QA_VIP_EXPECT_ENABLED !== "true" ||
  process.env.KINGLIKE_VIP_QA_UI_ENABLED !== "true" ||
  process.env.KINGLIKE_VIP_ENABLED !== "true" ||
  gateUser.length < 4 ||
  gatePassword.length < 20 ||
  !Number.isSafeInteger(fixture.unitA) ||
  !Number.isSafeInteger(fixture.installment) ||
  !fixture.buyerAEmail.endsWith("@fixture.test") ||
  !fixture.buyerBEmail.endsWith("@fixture.test") ||
  !fixture.sellerEmail.endsWith("@fixture.test") ||
  !fixture.financeEmail.endsWith("@fixture.test") ||
  !fixture.approverEmail.endsWith("@fixture.test")
) {
  throw new Error("Enabled UI, server, and synthetic fixture flags are required");
}

const externalAttempts = [];
const externalBlocked = [];
const localWebSocketAttempts = [];
const blockedWrites = [];
const requestLog = [];
const apiStatuses = [];
const failedResponses = [];
const consoleCategories = {};
const consoleErrors = [];
const cspViolations = [];
const pageErrors = [];
const allowedWrites = [
  ["POST", /^\/api\/auth\/(?:login|logout)$/],
  ["PUT", /^\/api\/admin\/vip\/units\/[1-9]\d*\/seller$/],
  ["DELETE", /^\/api\/admin\/vip\/units\/[1-9]\d*\/seller$/],
  ["POST", /^\/api\/vip\/installments\/[1-9]\d*\/receipts$/],
  ["POST", /^\/api\/admin\/vip\/finance-permissions$/],
  ["DELETE", /^\/api\/admin\/vip\/finance-permissions$/],
  ["POST", /^\/api\/admin\/vip\/receipts\/[1-9]\d*\/review$/],
];

function isAllowedWrite(method, pathname) {
  return allowedWrites.some(([allowedMethod, pattern]) =>
    method === allowedMethod && pattern.test(pathname),
  );
}

function isQaLocalAuthority(url) {
  return url.hostname === "127.0.0.1" && url.port === base.port;
}

function installGuards(context) {
  context.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === "data:" || url.protocol === "blob:") {
      await route.continue();
      return;
    }
    if (url.origin !== base.origin) {
      if (!isQaLocalAuthority(url)) {
        externalAttempts.push({ host: url.hostname, method: request.method() });
      }
      await route.abort("blockedbyclient");
      if (!isQaLocalAuthority(url)) {
        externalBlocked.push({ host: url.hostname, method: request.method() });
      }
      return;
    }
    if (!["GET", "HEAD"].includes(request.method()) &&
        !isAllowedWrite(request.method(), url.pathname)) {
      blockedWrites.push({ method: request.method(), path: url.pathname });
      await route.fulfill({ status: 403, body: "mutation blocked by synthetic QA allowlist" });
      return;
    }
    requestLog.push({ method: request.method(), path: url.pathname });
    await route.continue();
  });
  context.routeWebSocket("**/*", async (socket) => {
    const url = new URL(socket.url());
    if (isQaLocalAuthority(url)) {
      localWebSocketAttempts.push({ path: url.pathname });
    } else {
      externalAttempts.push({ host: url.hostname, method: "WS" });
    }
    await socket.close({ code: 1008, reason: "WebSocket disabled in VIP browser QA" });
    if (!isQaLocalAuthority(url)) {
      externalBlocked.push({ host: url.hostname, method: "WS" });
    }
  });
  context.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === base.origin && response.status() >= 400) {
      failedResponses.push({
        path: url.pathname.replace(/\d+/g, ":id"),
        status: response.status(),
        type: response.request().resourceType(),
      });
    }
    if (url.origin === base.origin && url.pathname.startsWith("/api/")) {
      apiStatuses.push({ path: url.pathname, status: response.status() });
    }
  });
}

async function login(page, username, path) {
  const target = new URL(path, base);
  await page.goto(new URL("/login?redirect=" + encodeURIComponent(path), base).href, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[type="password"]').fill(fixture.password);
  const responseWait = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/login",
  );
  await page.locator('button[type="submit"]').click();
  const response = await responseWait;
  assert.equal(response.status(), 200, `${username} synthetic login`);
  await page.waitForURL((url) => url.pathname === target.pathname, { timeout: 10_000 });
}

async function logout(page) {
  const trigger = page.locator(
    'button:has(div[class*="bg-gradient-to-br"][class*="rounded-full"]):visible',
  ).first();
  await trigger.click();
  const responseWait = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/logout",
  );
  await page.getByRole("menuitem", { name: /sign out|logout/i }).click();
  assert.equal((await responseWait).status(), 200, "QA UI logout");
  const status = await page.evaluate(async () =>
    (await fetch("/api/auth/me", { credentials: "include", cache: "no-store" })).status,
  );
  assert.equal(status, 401, "logout invalidates the browser session");
}

async function postStatus(page, path, body) {
  return page.evaluate(async ({ path, body }) => {
    const response = await fetch(path, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return response.status;
  }, { path, body });
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
  const guestContext = await browser.newContext({ serviceWorkers: "block", locale: "en-US" });
  installGuards(guestContext);
  const guestPage = await guestContext.newPage();
  const guestResponse = await guestPage.goto(new URL("/admin/vip", base).href, {
    waitUntil: "domcontentloaded",
  });
  assert.equal(guestResponse?.status(), 401, "Basic Auth must guard the entire QA site");
  await guestContext.close();

  const contextOptions = {
    httpCredentials: { username: gateUser, password: gatePassword, origin: base.origin, send: "always" },
    serviceWorkers: "block",
    locale: "en-US",
  };
  const adminContext = await browser.newContext(contextOptions);
  const buyerContext = await browser.newContext(contextOptions);
  const sellerContext = await browser.newContext(contextOptions);
  const otherSellerContext = await browser.newContext(contextOptions);
  const financeContext = await browser.newContext(contextOptions);
  const approverContext = await browser.newContext(contextOptions);
  for (const context of [adminContext, buyerContext, sellerContext, otherSellerContext, financeContext, approverContext]) {
    installGuards(context);
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
      window.addEventListener("securitypolicyviolation", () => {
        window.__vipQaCspViolations = (window.__vipQaCspViolations || 0) + 1;
      });
    });
  }
  const adminPage = await adminContext.newPage();
  const buyerPage = await buyerContext.newPage();
  const sellerPage = await sellerContext.newPage();
  const otherSellerPage = await otherSellerContext.newPage();
  const financePage = await financeContext.newPage();
  const approverPage = await approverContext.newPage();
  for (const page of [adminPage, buyerPage, sellerPage, otherSellerPage, financePage, approverPage]) {
    page.on("console", (message) => {
      if (message.type() === "error") {
        const text = message.text().toLowerCase();
        const category = text.includes("content security policy") ? "csp" :
          /\b401\b/.test(text) ? "http-401" :
          /\b404\b/.test(text) ? "http-404" :
          text.includes("failed to load resource") ? "resource-load" :
          text.includes("failed to fetch") ? "fetch" :
          text.includes("net::err") ? "network" : "other";
        consoleCategories[category] = (consoleCategories[category] || 0) + 1;
        consoleErrors.push(message.text().split("\n")[0].slice(0, 180)
          .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
          .replace(/https?:\/\/[^\s"'<>]+/gi, "<url>")
          .replace(/\b(password|token|cookie|authorization)\s*[:=]\s*\S+/gi, "$1=<redacted>"));
      }
    });
    page.on("pageerror", (error) => pageErrors.push({
      name: error.name,
      message: error.message.split("\n")[0].slice(0, 140)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<email>")
        .replace(/https?:\/\/[^\s"'<>]+/gi, "<url>")
        .replace(/\b(password|token|cookie|authorization)\s*[:=]\s*\S+/gi, "$1=<redacted>"),
      stack: (error.stack || "").split("\n").slice(1, 3).join(" | ").slice(0, 240)
        .replace(/https?:\/\/[^\s"'<>]+/gi, "<url>"),
    }));
  }

  const home = await adminPage.goto(new URL("/login", base).href, { waitUntil: "domcontentloaded" });
  assert.equal(home?.status(), 200);
  assert.match(home?.headers()["content-security-policy"] || "", /frame-src[^;]*'none'/);
  const workerStatus = await adminPage.evaluate(async () =>
    (await fetch("/sw.js", { cache: "no-store" })).status,
  );
  assert.equal(workerStatus, 404, "QA must not expose a service worker");
  assert.equal(await adminPage.evaluate(async () =>
    (await navigator.serviceWorker?.getRegistrations())?.length || 0,
  ), 0, "QA browser context has no service worker registrations");
  await login(adminPage, "qa_admin", "/admin/vip");
  const adminHeading = adminPage.getByRole("heading", { name: /KINGLIKE VIP administration/i });
  if (!(await adminHeading.count())) {
    const diagnostic = await adminPage.evaluate(() => ({
      path: location.pathname,
      readyState: document.readyState,
      title: document.title.slice(0, 80),
      h1: [...document.querySelectorAll("h1")].map((node) => (node.textContent || "").slice(0, 80)),
      rootText: (document.getElementById("root")?.innerText || "").slice(0, 160),
      rootChildren: document.getElementById("root")?.children.length || 0,
    }));
    console.log("admin_route_diagnostic=" + JSON.stringify({
      ...diagnostic,
      authMe: await adminPage.evaluate(async () => {
        const response = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
        const data = response.ok ? await response.json() : null;
        return { status: response.status, admin: data?.isAdmin === true };
      }),
      pageErrors: pageErrors.length,
      pageErrorTypes: pageErrors,
      consoleMessages: consoleErrors,
      consoleCategories,
      apiStatuses: apiStatuses.filter((item) => item.path.startsWith("/api/auth/") || item.path.includes("/admin/vip/overview")),
      failedResponses,
    }));
  }
  await adminHeading.waitFor();
  const adminOverviewStatus = await adminPage.evaluate(async () =>
    (await fetch("/api/admin/vip/overview", { credentials: "include", cache: "no-store" })).status,
  );
  assert.equal(adminOverviewStatus, 200, "admin overview must load via actual route");

  const profile = adminPage.locator(
    'button:has(div[class*="bg-gradient-to-br"][class*="rounded-full"]):visible',
  ).first();
  await profile.click();
  const adminMenu = adminPage.locator('a[href="/admin/vip"]:visible');
  await adminMenu.waitFor({ state: "visible", timeout: 5_000 });
  const adminMenuCount = await adminMenu.count();
  if (adminMenuCount !== 1) {
    console.log("admin_menu_missing=" + JSON.stringify({
      path: new URL(adminPage.url()).pathname,
      adminMenuCount,
      adminMe: await adminPage.evaluate(async () => {
        const response = await fetch("/api/auth/me", { credentials: "include", cache: "no-store" });
        const data = response.ok ? await response.json() : null;
        return { status: response.status, isAdmin: data?.isAdmin === true };
      }),
      visibleNavPaths: await adminPage.locator("a:visible").evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute("href")).filter(Boolean).slice(0, 24)),
      relevantApiStatuses: apiStatuses
        .filter((item) => /auth\/me|admin\/vip\/overview/.test(item.path))
        .map((item) => ({ path: item.path, status: item.status })),
    }));
  }
  assert.equal(adminMenuCount, 1,
    "admin VIP menu appears only after server overview authorization");
  await adminPage.locator('a[href="/admin/vip"]:visible').click();
  await adminPage.getByRole("heading", { name: /KINGLIKE VIP administration/i }).waitFor();

  const assignmentEmail = adminPage.getByLabel("Verified staff email").first();
  await assignmentEmail.waitFor({ state: "visible", timeout: 5_000 });
  if (!(await assignmentEmail.count())) {
    console.log("admin_assignment_form_missing=" + JSON.stringify({
      path: new URL(adminPage.url()).pathname,
      adminHeading: await adminPage.getByRole("heading", { name: /KINGLIKE VIP administration/i }).count(),
      visibleLabels: await adminPage.locator("label:visible").allTextContents(),
      relevantApiStatuses: apiStatuses
        .filter((item) => /admin\/vip\/(?:overview|projects|seller-assignments)/.test(item.path))
        .map((item) => ({ path: item.path, status: item.status })),
      pageErrors: pageErrors.map((item) => item.name),
    }));
    assert.fail("Seller assignment form is not rendered in the admin view");
  }
  await assignmentEmail.fill(fixture.sellerEmail);
  await adminPage.getByLabel(/Reason for assignment or transfer/).fill("Synthetic UI assignment test");
  const saveButton = adminPage.getByRole("button", { name: "Save access" });
  const assignFormState = {
    saveDisabled: await saveButton.isDisabled(),
    unitOptions: await adminPage.locator('select option').count(),
    visibleSellerInputs: await adminPage.locator('input[type="email"]:visible').count(),
    relevantApiStatuses: apiStatuses
      .filter((item) => /admin\/vip\/(?:overview|projects|seller-assignments)/.test(item.path))
      .map((item) => ({ path: item.path, status: item.status })),
  };
  const assignResponse = adminPage.waitForResponse(
    (response) => response.request().method() === "PUT" &&
      new URL(response.url()).pathname.endsWith("/seller"),
    { timeout: 5000 },
  ).catch(() => null);
  await saveButton.click();
  const assignmentResult = await assignResponse;
  if (!assignmentResult) {
    console.log("admin_assignment_request_missing=" + JSON.stringify(assignFormState));
    assert.fail("Seller assignment action did not reach its API");
  }
  assert.equal(assignmentResult.status(), 200, "UI seller assignment");
  await adminPage.getByRole("status").filter({ hasText: "Permission saved and audited." }).waitFor();

  await login(sellerPage, "qa_seller", "/vip/sales");
  await sellerPage.getByRole("heading", { name: /My clients/i }).waitFor();
  await sellerPage.getByRole("heading", { name: /Synthetic QA Project · QA-A/ }).waitFor();
  await sellerPage.getByText(fixture.buyerAEmail, { exact: true }).waitFor();
  const sellerAdminApi = await sellerPage.evaluate(async () =>
    (await fetch("/api/admin/vip/overview", { credentials: "include" })).status,
  );
  assert.equal(sellerAdminApi, 403, "seller cannot access admin overview");

  await adminPage.getByLabel("Verified staff email").first().fill(fixture.sellerEmail);
  await adminPage.getByLabel(/Reason for assignment or transfer/).fill("Synthetic UI revocation test");
  adminPage.once("dialog", (dialog) => dialog.accept());
  const revokeResponse = adminPage.waitForResponse((response) =>
    response.request().method() === "DELETE" &&
    new URL(response.url()).pathname.endsWith("/seller"),
  );
  await adminPage.getByRole("button", { name: "Revoke staff access" }).click();
  assert.equal((await revokeResponse).status(), 200, "UI seller revocation");
  await adminPage.getByRole("status").filter({ hasText: "Permission saved and audited." }).waitFor();
  await sellerPage.reload({ waitUntil: "domcontentloaded" });
  await sellerPage.getByText(/No client units assigned yet/i).waitFor();
  assert.equal(await sellerPage.getByText(fixture.buyerAEmail, { exact: true }).count(), 0,
    "seller loses client visibility on the next request without replacing its session");

  await login(otherSellerPage, "qa_seller_other", "/vip/sales");
  await otherSellerPage.getByText(/No client units assigned yet/i).waitFor();

  await login(buyerPage, "qa_buyer_a", "/vip");
  await buyerPage.getByText("Synthetic QA Project", { exact: true }).waitFor();
  const fileInput = buyerPage.locator('input[type="file"][id^="vip-file-c-"]').first();
  await fileInput.setInputFiles({
    name: "synthetic-ui-receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n1 0 obj <<>> endobj\n%%EOF\n"),
  });
  const receiptResponse = buyerPage.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === `/api/vip/installments/${fixture.installment}/receipts`,
  );
  await buyerPage.getByRole("button", { name: "Submit receipt" }).click();
  assert.equal((await receiptResponse).status(), 201, "owner receipt upload through UI");
  await buyerPage.getByText("Receipt submitted, awaiting finance verification", { exact: true }).waitFor();
  const paymentBeforeReview = await buyerPage.evaluate(async (unitId) => {
    const data = await (await fetch(`/api/vip/units/${unitId}/installments`, {
      credentials: "include",
      cache: "no-store",
    })).json();
    return data.installments[0];
  }, fixture.unitA);
  assert.equal(Number(paymentBeforeReview.paid_amount), 0, "receipt upload cannot mark an installment paid");
  assert.equal(Number(paymentBeforeReview.remaining_amount), 120);

  const secondFileInput = buyerPage.locator('input[type="file"][id^="vip-file-c-"]').first();
  await secondFileInput.setInputFiles({
    name: "synthetic-ui-receipt-reject.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\n2 0 obj <<>> endobj\n%%EOF\n"),
  });
  const secondReceiptResponse = buyerPage.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === `/api/vip/installments/${fixture.installment}/receipts`,
  );
  await buyerPage.getByRole("button", { name: "Submit receipt" }).click();
  assert.equal((await secondReceiptResponse).status(), 201,
    "second synthetic receipt is accepted as a pending receipt");
  await buyerPage.getByText("Receipt submitted, awaiting finance verification", { exact: true }).waitFor();
  const paymentAfterSecondUpload = await buyerPage.evaluate(async (unitId) => {
    const data = await (await fetch(`/api/vip/units/${unitId}/installments`, {
      credentials: "include",
      cache: "no-store",
    })).json();
    return data.installments[0];
  }, fixture.unitA);
  assert.equal(Number(paymentAfterSecondUpload.paid_amount), 0,
    "neither receipt upload marks the installment paid");

  await adminPage.goto(new URL("/admin/vip", base).href, { waitUntil: "domcontentloaded" });
  await adminPage.getByRole("heading", { name: /KINGLIKE VIP administration/i }).waitFor();
  const adminReceiptApi = await adminPage.evaluate(async () => {
    const response = await fetch("/api/admin/vip/receipts", { credentials: "include", cache: "no-store" });
    const data = response.ok ? await response.json() : null;
    return {
      status: response.status,
      hasFirstReceipt: data?.receipts?.some((row) => row.file_name === "synthetic-ui-receipt.pdf") === true,
      hasSecondReceipt: data?.receipts?.some((row) => row.file_name === "synthetic-ui-receipt-reject.pdf") === true,
    };
  });
  if (!adminReceiptApi.hasFirstReceipt || !adminReceiptApi.hasSecondReceipt) {
    console.log("receipt_ui_diagnostic=" + JSON.stringify({
      api: adminReceiptApi,
      pageErrors: pageErrors.length,
      consoleCategories,
      visibleText: await adminPage.locator("#root").innerText().then((text) => text.slice(0, 300)),
      failedResponses,
    }));
  }
  assert.deepEqual(adminReceiptApi, { status: 200, hasFirstReceipt: true, hasSecondReceipt: true },
    "admin receipt API returns both synthetic pending receipts");
  await adminPage.getByText(/synthetic-ui-receipt\.pdf/).waitFor();
  await adminPage.getByText(/synthetic-ui-receipt-reject\.pdf/).waitFor();
  assert.equal(await adminPage.getByText("Pending", { exact: true }).count(), 2,
    "admin sees both receipts as pending before finance review");
  assert.equal(await adminPage.getByRole("button", { name: "Approve amount" }).count(), 0,
    "admin without explicit finance permission sees no approval control");
  await adminPage.locator(
    'button:has(div[class*="bg-gradient-to-br"][class*="rounded-full"]):visible',
  ).first().click();
  assert.equal(await adminPage.locator('a[href="/vip/finance-review"]').count(), 0,
    "admin without finance permission does not see the finance review link");
  await adminPage.keyboard.press("Escape");
  const receiptIds = await adminPage.evaluate(async () => {
    const response = await fetch("/api/admin/vip/receipts", {
      credentials: "include",
      cache: "no-store",
    });
    const data = await response.json();
    return {
      first: data.receipts.find((row) => row.file_name === "synthetic-ui-receipt.pdf")?.id,
      second: data.receipts.find((row) => row.file_name === "synthetic-ui-receipt-reject.pdf")?.id,
    };
  });
  const receiptId = receiptIds.first;
  const secondReceiptId = receiptIds.second;
  assert.ok(receiptId, "admin can read the synthetic pending receipt row");
  assert.ok(secondReceiptId, "admin can read the second synthetic pending receipt row");
  const adminDenied = await postStatus(adminPage,
    `/api/admin/vip/receipts/${receiptId}/review`,
    { decision: "approve", verifiedAmount: "25.00", note: "" });
  assert.equal(adminDenied, 403, "admin without explicit finance permission cannot approve");

  await login(financePage, "qa_finance", "/vip");
  const employeeDenied = await postStatus(financePage, `/api/admin/vip/receipts/${receiptId}/review`,
    { decision: "approve", verifiedAmount: "25.00", note: "" });
  assert.equal(employeeDenied, 403, "unapproved finance employee cannot approve");
  await financePage.goto(new URL("/admin/vip", base).href, { waitUntil: "domcontentloaded" });
  await financePage.getByText(/reserved for Kinglike Luxury administrators/i).waitFor();
  await financePage.goto(new URL("/vip/finance-review", base).href, { waitUntil: "domcontentloaded" });
  await financePage.getByText("This account does not have active financial review permission.", {
    exact: true,
  }).waitFor();
  await financePage.locator(
    'button:has(div[class*="bg-gradient-to-br"][class*="rounded-full"]):visible',
  ).first().click();
  assert.equal(await financePage.locator('a[href="/vip/finance-review"]').count(), 0,
    "unapproved finance employee does not see the finance review link");
  await financePage.keyboard.press("Escape");
  assert.equal(
    requestLog.filter((item) => item.path === "/api/admin/vip/finance/receipts").length,
    0,
    "unapproved staff do not request the finance receipt queue",
  );

  const financeGrantForm = adminPage.locator("form").filter({ hasText: "Grant finance permission" });
  const financeGrantEmail = financeGrantForm.locator('input[type="email"]');
  await financeGrantEmail.fill(fixture.financeEmail);
  const grantFinanceResponse = adminPage.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/api/admin/vip/finance-permissions",
  );
  await financeGrantForm.getByRole("button", { name: "Grant access", exact: true }).click();
  assert.equal((await grantFinanceResponse).status(), 200, "UI finance permission grant");
  const financeApiAccess = await financePage.evaluate(async () => {
    const status = await (await fetch("/api/admin/vip/receipts", {
      credentials: "include",
      cache: "no-store",
    })).status;
    const permission = await (await fetch("/api/admin/vip/finance/me", {
      credentials: "include",
      cache: "no-store",
    })).json();
    return { status, canApprove: permission.canApprove };
  });
  assert.equal(financeApiAccess.status, 403,
    "finance reviewer cannot access the administrator's complete receipt history");
  assert.equal(financeApiAccess.canApprove, true);
  const financeQueueCheck = await financePage.evaluate(async () => {
    const response = await fetch("/api/admin/vip/finance/receipts", {
      credentials: "include",
      cache: "no-store",
    });
    const data = response.ok ? await response.json() : null;
    return {
      status: response.status,
      pendingOnly: data?.receipts?.every((row) => row.review_status === "pending") === true,
      hasFirstReceipt: data?.receipts?.some((row) => row.file_name === "synthetic-ui-receipt.pdf") === true,
      hasSecondReceipt: data?.receipts?.some((row) => row.file_name === "synthetic-ui-receipt-reject.pdf") === true,
    };
  });
  assert.deepEqual(financeQueueCheck, {
    status: 200,
    pendingOnly: true,
    hasFirstReceipt: true,
    hasSecondReceipt: true,
  }, "finance reviewer receives only actionable pending receipts");
  await financePage.reload({ waitUntil: "domcontentloaded" });
  await financePage.goto(new URL("/vip", base).href, { waitUntil: "domcontentloaded" });
  await financePage.locator(
    'button:has(div[class*="bg-gradient-to-br"][class*="rounded-full"]):visible',
  ).first().click();
  const financeNavLink = financePage.locator('a[href="/vip/finance-review"]:visible');
  await financeNavLink.waitFor();
  await financeNavLink.click();
  await financePage.waitForURL((url) => url.pathname === "/vip/finance-review");
  await financePage.getByRole("heading", { name: "Financial receipt review" }).waitFor();
  await financePage.getByText("synthetic-ui-receipt.pdf", { exact: false }).waitFor();
  await financePage.getByText("synthetic-ui-receipt-reject.pdf", { exact: false }).waitFor();
  assert.equal(await financePage.locator("form").count(), 0,
    "finance-only page does not expose admin grant or upload forms");
  const financeQueueRows = await financePage.locator("[data-receipt-id]").count();
  assert.equal(financeQueueRows, 2, "finance reviewer sees both actionable receipt rows");
  const financeReceiptDetails = await financePage.locator(`[data-receipt-id="${receiptId}"]`).innerText();
  assert.match(financeReceiptDetails, /qa_buyer_a/,
    "reviewer sees who uploaded the receipt");
  assert.match(financeReceiptDetails, /Uploaded/,
    "reviewer sees the upload timestamp");
  assert.match(financeReceiptDetails, /Pending/,
    "reviewer sees the pending state before acting");
  const firstReceiptRow = financePage.locator(`[data-receipt-id="${receiptId}"]`);
  await firstReceiptRow.getByLabel("Verified amount").fill("25.00");
  const approvalResponse = financePage.waitForResponse((response) =>
    response.request().method() === "POST" &&
    /\/api\/admin\/vip\/receipts\/\d+\/review$/.test(new URL(response.url()).pathname),
  );
  await firstReceiptRow.getByRole("button", { name: "Approve amount" }).click();
  assert.equal((await approvalResponse).status(), 200,
    "finance employee can approve through the limited UI");
  await financePage.getByRole("status").filter({ hasText: "Review recorded." }).waitFor();
  const secondReceiptRow = financePage.locator(`[data-receipt-id="${secondReceiptId}"]`);
  await secondReceiptRow.waitFor();
  await financePage.locator(`[data-receipt-id="${receiptId}"]`).waitFor({ state: "detached" });
  assert.equal(await financePage.locator(`[data-receipt-id="${receiptId}"]`).count(), 0,
    "approved receipt leaves the actionable queue");
  const duplicateReview = await postStatus(financePage,
    `/api/admin/vip/receipts/${receiptId}/review`,
    { decision: "approve", verifiedAmount: "25.00", note: "" });
  assert.equal(duplicateReview, 409, "duplicate approval is rejected by the API");
  const financePermissionAfterReview = await financePage.evaluate(async () => {
    const response = await fetch("/api/admin/vip/finance/me", {
      credentials: "include",
      cache: "no-store",
    });
    return response.ok && (await response.json()).canApprove === true;
  });
  assert.equal(financePermissionAfterReview, true,
    "reviewing one receipt does not revoke the employee's finance grant");

  await buyerPage.reload({ waitUntil: "domcontentloaded" });
  const paymentAfterReview = await buyerPage.evaluate(async (unitId) => {
    const data = await (await fetch(`/api/vip/units/${unitId}/installments`, {
      credentials: "include",
      cache: "no-store",
    })).json();
    return data.installments[0];
  }, fixture.unitA);
  assert.equal(Number(paymentAfterReview.paid_amount), 25, "posting appears only after finance approval");
  assert.equal(Number(paymentAfterReview.remaining_amount), 95);

  await secondReceiptRow.getByLabel("Reason for rejection").fill("Synthetic QA rejection reason");
  const rejectionResponse = financePage.waitForResponse((response) =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === `/api/admin/vip/receipts/${secondReceiptId}/review`,
  );
  await secondReceiptRow.getByRole("button", { name: "Reject receipt" }).click();
  assert.equal((await rejectionResponse).status(), 200,
    "finance employee can reject through the limited UI");
  await financePage.getByRole("status").filter({ hasText: "Review recorded." }).waitFor();
  await financePage.getByText("There are no pending receipts to review.", { exact: true }).waitFor();
  const paymentAfterRejection = await buyerPage.evaluate(async (unitId) => {
    const data = await (await fetch(`/api/vip/units/${unitId}/installments`, {
      credentials: "include",
      cache: "no-store",
    })).json();
    return data.installments[0];
  }, fixture.unitA);
  assert.equal(Number(paymentAfterRejection.paid_amount), 25,
    "rejecting another receipt leaves verified payments unchanged");

  const financeRevokeForm = adminPage.locator("form").filter({ hasText: "Grant finance permission" });
  await financeRevokeForm.locator('input[type="email"]').fill(fixture.financeEmail);
  const financeRevokeResponse = adminPage.waitForResponse((response) =>
    response.request().method() === "DELETE" &&
    new URL(response.url()).pathname === "/api/admin/vip/finance-permissions",
  );
  await financeRevokeForm.getByRole("button", { name: "Revoke access", exact: true }).click();
  assert.equal((await financeRevokeResponse).status(), 200,
    "admin can revoke only the explicit finance grant");
  await financePage.reload({ waitUntil: "domcontentloaded" });
  await financePage.getByText("This account does not have active financial review permission.", {
    exact: true,
  }).waitFor();
  const revokedQueueStatus = await financePage.evaluate(async () =>
    (await fetch("/api/admin/vip/finance/receipts", {
      credentials: "include",
      cache: "no-store",
    })).status,
  );
  assert.equal(revokedQueueStatus, 403, "revoked reviewer cannot read the finance queue");
  await financePage.goto(new URL("/vip", base).href, { waitUntil: "domcontentloaded" });
  await financePage.locator(
    'button:has(div[class*="bg-gradient-to-br"][class*="rounded-full"]):visible',
  ).first().click();
  assert.equal(await financePage.locator('a[href="/vip/finance-review"]').count(), 0,
    "revoked finance permission removes the navigation link");
  await financePage.keyboard.press("Escape");

  const switchContext = await browser.newContext(contextOptions);
  installGuards(switchContext);
  const switchPage = await switchContext.newPage();
  await login(switchPage, "qa_buyer_a", "/vip");
  await switchPage.getByText(/QA-A/).waitFor();
  await switchPage.getByText("synthetic-ui-receipt.pdf").waitFor();
  await logout(switchPage);
  await login(switchPage, "qa_buyer_b", "/vip");
  await switchPage.getByText(/QA-B/).waitFor();
  assert.equal(await switchPage.getByText(/QA-A/).count(), 0,
    "account switch clears the previous buyer's unit");
  assert.equal(await switchPage.getByText("synthetic-ui-receipt.pdf").count(), 0,
    "account switch clears the previous buyer's receipt metadata");

  const allCspViolations = await Promise.all(
    [adminPage, buyerPage, sellerPage, otherSellerPage, financePage, approverPage, switchPage].map((page) =>
      page.evaluate(() => window.__vipQaCspViolations || 0),
    ),
  );
  const totalCspViolations = allCspViolations.reduce((sum, count) => sum + count, 0);
  const failedResponseCategories = Object.entries(
    failedResponses.reduce((counts, item) => {
      const key = `${item.status} ${item.type} ${item.path}`;
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
  ).map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count).slice(0, 12);
  assert.equal(externalBlocked.length, externalAttempts.length,
    "every attempted external HTTP or WebSocket request was blocked before it could leave the browser");
  assert.equal(blockedWrites.length, 0, "all requested writes were in the explicit local allowlist");
  assert.equal(totalCspViolations, 0, "no CSP violations");
  assert.equal(pageErrors.length, 0, "no page runtime errors");

  console.log(JSON.stringify({
    mode: "flags-on-local-only",
    guestBasicAuth: guestResponse.status(),
    adminOverview: adminOverviewStatus,
    adminMenuVisible: true,
    sellerAssignment: 200,
    sellerRevocation: 200,
    sellerVisibleAfterGrant: true,
    sellerVisibleAfterRevocation: false,
    otherSellerUnits: 0,
    receiptUpload: 201,
    pendingReceiptVisible: true,
    paidBeforeReview: Number(paymentBeforeReview.paid_amount),
    adminWithoutFinanceReview: adminDenied,
    unapprovedEmployeeReview: employeeDenied,
    financePermissionGrant: 200,
    financeApiStatusAfterGrant: financeApiAccess.status,
    financeReviewMenuVisible: true,
    financeQueueRows,
    financeUiApproval: approvalResponse ? 200 : null,
    financeUiRejection: rejectionResponse ? 200 : null,
    duplicateFinanceReview: duplicateReview,
    financePermissionRevocation: financeRevokeResponse ? 200 : null,
    revokedFinanceQueue: revokedQueueStatus,
    paidAfterApproval: Number(paymentAfterReview.paid_amount),
    accountSwitchClearedVipData: true,
    externalRequestsBlocked: externalBlocked.length,
    externalRequestHosts: [...new Set(externalBlocked.map((item) => item.host))],
    localWebSocketRequestsBlocked: localWebSocketAttempts.length,
    blockedWrites,
    cspViolations: totalCspViolations,
    pageErrors: pageErrors.length,
    consoleErrors: consoleCategories,
    consoleErrorSamples: consoleErrors.slice(0, 20),
    failedResponseCategories,
  }));
  await Promise.all([
    adminContext.close(),
    buyerContext.close(),
    sellerContext.close(),
    otherSellerContext.close(),
    financeContext.close(),
    approverContext.close(),
    switchContext.close(),
  ]);
} finally {
  await browser.close();
}
