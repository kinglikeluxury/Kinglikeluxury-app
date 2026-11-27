import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const base = new URL(process.env.QA_BASE || "");
const gateUser = process.env.QA_GATE_USER || "";
const gatePassword = process.env.QA_GATE_PASSWORD || "";
const fixture = {
  projectId: Number(process.env.QA_PROJECT_ID),
  unitA: Number(process.env.QA_UNIT_A_ID),
  unitB: Number(process.env.QA_UNIT_B_ID),
  buyerAEmail: process.env.QA_BUYER_A_EMAIL || "",
  buyerBEmail: process.env.QA_BUYER_B_EMAIL || "",
  sellerEmail: process.env.QA_SELLER_EMAIL || "",
  financeEmail: process.env.QA_FINANCE_EMAIL || "",
  invitedToken: process.env.QA_INVITATION_TOKEN || "",
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
  throw new Error("VIP page browser test accepts only the QA loopback origin");
}
if (
  process.env.QA_VIP_EXPECT_ENABLED !== "true" ||
  process.env.KINGLIKE_VIP_QA_UI_ENABLED !== "true" ||
  process.env.KINGLIKE_VIP_ENABLED !== "true" ||
  gateUser.length < 4 ||
  gatePassword.length < 20 ||
  !Number.isSafeInteger(fixture.projectId) ||
  !Number.isSafeInteger(fixture.unitA) ||
  !Number.isSafeInteger(fixture.unitB) ||
  !fixture.buyerAEmail.endsWith("@fixture.test") ||
  !fixture.buyerBEmail.endsWith("@fixture.test") ||
  !fixture.sellerEmail.endsWith("@fixture.test") ||
  !fixture.financeEmail.endsWith("@fixture.test") ||
  !/^[0-9a-f]{64}$/.test(fixture.invitedToken)
) {
  throw new Error("Enabled VIP flags and synthetic fixtures are required");
}

const checks = [];
const coverage = [];
const externalBlocked = [];
const websocketBlocked = [];
const blockedWrites = [];
const consoleErrors = [];
const pageErrors = [];
const cspViolations = [];
const cspEventDetails = [];
const apiErrors = [];
const requestMethods = [];
const tempDownloads = [];
const passwordPattern = /password|token|cookie|authorization/i;
const allowedWrites = [
  ["POST", /^\/api\/auth\/login$/],
  ["POST", /^\/api\/vip\/card\/issue$/],
  ["POST", /^\/api\/vip\/referral-link$/],
  ["POST", /^\/api\/vip\/referral-share\/KLR-[A-F0-9]{32}$/],
  ["POST", /^\/api\/vip\/services$/],
  ["POST", /^\/api\/vip\/statement-requests$/],
  ["POST", /^\/api\/vip\/units\/[1-9]\d*\/handover\/appointments$/],
  ["POST", /^\/api\/vip\/units\/[1-9]\d*\/handover\/snags$/],
  ["POST", /^\/api\/vip\/units\/[1-9]\d*\/keys\/acknowledge$/],
  ["POST", /^\/api\/vip\/support$/],
  ["POST", /^\/api\/vip\/support\/[1-9]\d*\/reply$/],
  ["POST", /^\/api\/vip\/notifications\/[1-9]\d*\/read$/],
  ["PUT", /^\/api\/vip\/notification-preferences$/],
  ["POST", /^\/api\/admin\/vip\/units\/[1-9]\d*\/notifications$/],
  ["POST", /^\/api\/admin\/vip\/projects\/[1-9]\d*\/photos$/],
  ["PATCH", /^\/api\/admin\/vip\/projects\/[1-9]\d*\/photos\/[1-9]\d*$/],
  ["PATCH", /^\/api\/admin\/vip\/units\/[1-9]\d*\/handover\/appointments\/[1-9]\d*$/],
  ["POST", /^\/api\/vip\/invitations\/accept$/],
];

function check(name, condition) {
  checks.push({ name, pass: condition === true });
  assert.equal(condition, true, name);
}

async function visible(page, text, name = text) {
  const node = page.getByText(text, { exact: true }).first();
  await node.waitFor({ state: "visible", timeout: 10_000 });
  check(name, await node.isVisible());
}

async function visibleMatching(page, pattern, name) {
  const node = page.getByText(pattern).first();
  await node.waitFor({ state: "visible", timeout: 10_000 });
  check(name, await node.isVisible());
}

async function heading(page, text, name = text) {
  const node = page.getByRole("heading", { name: text, exact: true }).first();
  await node.waitFor({ state: "visible", timeout: 10_000 });
  check(name, await node.isVisible());
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
      externalBlocked.push({ host: url.hostname, method: request.method() });
      await route.abort("blockedbyclient");
      return;
    }
    if (!["GET", "HEAD"].includes(request.method()) &&
        !allowedWrites.some(([method, pattern]) =>
          method === request.method() && pattern.test(url.pathname))) {
      blockedWrites.push({ method: request.method(), path: url.pathname });
      await route.fulfill({ status: 403, body: "outside synthetic VIP QA write allowlist" });
      return;
    }
    requestMethods.push({ method: request.method(), path: url.pathname });
    await route.continue();
  });
  context.routeWebSocket("**/*", async (socket) => {
    const url = new URL(socket.url());
    websocketBlocked.push({
      local: url.hostname === "127.0.0.1" && url.port === base.port,
      host: url.hostname,
    });
    await socket.close({ code: 1008, reason: "WebSockets disabled in isolated VIP QA" });
  });
  context.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === base.origin && response.status() >= 400) {
      apiErrors.push({
        method: response.request().method(),
        path: url.pathname.replace(/\d+/g, ":id"),
        status: response.status(),
      });
    }
  });
}

async function observePage(page, label) {
  await page.exposeFunction("__vipQaRecordCsp", (event) => {
    if (!event || typeof event !== "object") return;
    cspEventDetails.push({
      page: label,
      directive: String(event.directive || "unknown").slice(0, 80),
      blockedSource: String(event.blockedSource || "unknown").slice(0, 120),
    });
  });
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const first = message.text().split("\n")[0].slice(0, 160);
    if (passwordPattern.test(first)) {
      consoleErrors.push("sensitive-looking console message redacted");
    } else {
      consoleErrors.push(first.replace(/https?:\/\/[^\s"'<>]+/gi, "<url>"));
    }
  });
  page.on("pageerror", (error) => {
    const message = error.message.split("\n")[0].slice(0, 160);
    pageErrors.push(passwordPattern.test(message) ? "message redacted" : message);
  });
  page.on("console", async (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (text.toLowerCase().includes("security policy")) {
      const first = text.split("\n")[0].slice(0, 240);
      cspViolations.push({
        page: label,
        message: passwordPattern.test(first)
          ? "CSP console message redacted"
          : first.replace(/https?:\/\/[^\s"'<>]+/gi, "<url>"),
      });
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (url.origin !== base.origin) externalBlocked.push({ host: url.hostname, method: request.method() });
  });
}

async function login(page, username, path) {
  await page.goto(new URL("/login?redirect=" + encodeURIComponent(path), base).href, {
    waitUntil: "domcontentloaded",
  });
  await page.locator('input[autocomplete="username"]').fill(username);
  await page.locator('input[type="password"]').fill(fixture.password);
  const responseWait = page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/auth/login",
  );
  await page.locator('button[type="submit"]').click();
  check(`${username} synthetic login HTTP 200`, (await responseWait).status() === 200);
  await page.waitForURL((url) => url.pathname === new URL(path, base).pathname, { timeout: 10_000 });
}

async function writeResponse(page, method, pattern, action, label) {
  const responsePromise = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return response.request().method() === method && pattern.test(url.pathname);
  }, { timeout: 5_000 }).catch(() => null);
  await action();
  const response = await responsePromise;
  if (!response) {
    const pathPattern = pattern.toString();
    const observedWrites = requestMethods
      .filter((item) => item.method === method && item.path.includes("/api/"))
      .slice(-8);
    const blocked = blockedWrites.slice(-8);
    throw new Error(
      `${label}: expected ${method} ${pathPattern}; ` +
      `observed=${JSON.stringify(observedWrites)} blocked=${JSON.stringify(blocked)}`,
    );
  }
  check(label, response.ok());
  return response;
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

let failure;
try {
  const guest = await browser.newContext({ serviceWorkers: "block", locale: "en-US" });
  installGuards(guest);
  const guestPage = await guest.newPage();
  await observePage(guestPage, "guest");
  await guest.addInitScript(() => {
    window.addEventListener("securitypolicyviolation", (event) => {
      let blockedSource = "other";
      const raw = String(event.blockedURI || "");
      if (raw === "inline" || raw === "eval") blockedSource = raw;
      else if (raw) {
        try {
          const parsed = new URL(raw, location.href);
          blockedSource = parsed.origin === location.origin
            ? "same-origin"
            : `${parsed.protocol}//${parsed.hostname}`;
        } catch {
          blockedSource = raw.slice(0, 24);
        }
      }
      window.__vipQaRecordCsp?.({
        directive: String(event.violatedDirective || "unknown"),
        blockedSource,
      });
    });
  });
  const guestVip = await guestPage.goto(new URL("/vip", base).href, { waitUntil: "domcontentloaded" });
  check("guest cannot open customer VIP page without Basic Auth", guestVip?.status() === 401);
  const guestApi = await fetch(new URL("/api/vip/me", base), {
    cache: "no-store",
    redirect: "error",
  });
  check("guest cannot call VIP API without Basic Auth", guestApi.status === 401);
  await guest.close();

  const contextOptions = {
    httpCredentials: {
      username: gateUser,
      password: gatePassword,
      origin: base.origin,
      send: "always",
    },
    serviceWorkers: "block",
    locale: "en-US",
    acceptDownloads: true,
  };
  const adminContext = await browser.newContext(contextOptions);
  const buyerAContext = await browser.newContext(contextOptions);
  const buyerBContext = await browser.newContext(contextOptions);
  const sellerContext = await browser.newContext(contextOptions);
  const financeContext = await browser.newContext(contextOptions);
  const publicContext = await browser.newContext(contextOptions);
  const activationContext = await browser.newContext(contextOptions);
  const contexts = [
    adminContext,
    buyerAContext,
    buyerBContext,
    sellerContext,
    financeContext,
    publicContext,
    activationContext,
  ];
  for (const context of contexts) {
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
      window.addEventListener("securitypolicyviolation", (event) => {
        window.__vipQaCspViolations = (window.__vipQaCspViolations || 0) + 1;
        let blockedSource = "other";
        const raw = String(event.blockedURI || "");
        if (raw === "inline" || raw === "eval") {
          blockedSource = raw;
        } else if (raw) {
          try {
            const parsed = new URL(raw, location.href);
            blockedSource = parsed.origin === location.origin
              ? "same-origin"
              : `${parsed.protocol}//${parsed.hostname}`;
          } catch {
            blockedSource = raw.slice(0, 24);
          }
        }
        window.__vipQaRecordCsp?.({
          directive: String(event.violatedDirective || "unknown"),
          blockedSource,
        });
      });
    });
  }
  const admin = await adminContext.newPage();
  const buyerA = await buyerAContext.newPage();
  const buyerB = await buyerBContext.newPage();
  const seller = await sellerContext.newPage();
  const finance = await financeContext.newPage();
  const publicPage = await publicContext.newPage();
  const activation = await activationContext.newPage();
  for (const [page, label] of [
    [admin, "admin"],
    [buyerA, "buyer-a"],
    [buyerB, "buyer-b"],
    [seller, "seller"],
    [finance, "finance"],
    [publicPage, "public"],
    [activation, "activation"],
  ]) {
    await observePage(page, label);
  }

  await login(admin, "qa_admin", "/admin/vip");
  await heading(admin, "KINGLIKE VIP Executive Overview");
  const adminPanels = [
    "KINGLIKE VIP Executive Overview",
    "VIP customer support desk",
    "Projects & units control",
    "Invite a VIP client",
    "Investment journey management",
    "Approved VIP benefits",
    "Customer service requests",
    "Financial records and adjustments",
    "Exchange rates and internal commissions",
    "Associate VIP property with documented CRM sale",
    "Official developer statement requests",
    "KINGLIKE VIP card management",
    "Referral and reward review",
    "Project photo updates",
    "Project live camera",
    "Receipts & finance verification",
    "Manage handovers",
    "Send private unit notification",
  ];
  for (const text of adminPanels) {
    const node = admin.getByRole("heading", { name: text, exact: true }).first();
    await node.waitFor({ state: "visible", timeout: 10_000 });
    check(`admin panel rendered: ${text}`, await node.isVisible());
  }
  coverage.push("/admin/vip (admin overview, support, projects, invitations, seller assignment, experience, finance, CRM read-only stub, statements, cards, referrals, photos, camera empty-state, handover, in-app notification)");

  const photoSection = admin.locator("section").filter({
    has: admin.getByRole("heading", { name: "Project photo updates", exact: true }),
  }).first();
  const adminPhotoInput = admin.getByLabel("Choose JPG or PNG");
  await photoSection.getByLabel("Caption (optional)").fill("Synthetic QA construction image");
  await adminPhotoInput.setInputFiles({
    name: "synthetic-qa-construction.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await admin.waitForFunction(
    () => [...document.querySelectorAll("button")].some((button) =>
      button.textContent?.trim() === "Upload as draft" && !button.disabled),
    null,
    { timeout: 3_000 },
  ).catch(() => {});
  const uploadButton = photoSection.getByRole("button", { name: "Upload as draft" });
  const uploadState = await adminPhotoInput.evaluate((input) => ({
    selectedFiles: input.files?.length ?? 0,
    bytes: input.files?.[0]?.size ?? 0,
    projectSelected: Boolean(input.closest("form")?.querySelector("select")?.value),
  }));
  if (!(await uploadButton.isEnabled())) {
    throw new Error(
      `Synthetic photo form is not ready: ${JSON.stringify(uploadState)}`,
    );
  }
  await writeResponse(
    admin,
    "POST",
    /^\/api\/admin\/vip\/projects\/[1-9]\d*\/photos$/,
    () => uploadButton.click(),
    "synthetic project photo uploads as an unpublished draft",
  );
  await visible(admin, "Saved as draft. Publish after review.", "photo upload gives a draft-only confirmation");
  await visible(admin, "Draft", "photo remains unpublished before explicit publication");
  await writeResponse(
    admin,
    "PATCH",
    /^\/api\/admin\/vip\/projects\/[1-9]\d*\/photos\/[1-9]\d*$/,
    () => admin.getByRole("button", { name: "Publish to owners" }).click(),
    "admin explicitly publishes synthetic project photo",
  );

  await admin.getByLabel("Notification title").fill("Synthetic admin notice");
  await admin.getByLabel("Message").fill("Synthetic in-app notification only.");
  await writeResponse(
    admin,
    "POST",
    /^\/api\/admin\/vip\/units\/[1-9]\d*\/notifications$/,
    () => admin.getByRole("button", { name: "Send within VIP" }).click(),
    "admin sends an in-app-only VIP notice",
  );
  check(
    "notification UI explicitly excludes email, SMS, and WhatsApp",
    (await admin.getByText(/no email, SMS or WhatsApp is sent/i).count()) === 1,
  );

  await login(buyerA, "qa_buyer_a", "/vip");
  await heading(buyerA, "Your private investment portal");
  await visible(buyerA, "Synthetic QA Project");
  const customerSections = [
    "Your investment journey",
    "Synthetic QA milestone",
    "Construction timeline",
    "Synthetic QA progress",
    "Project live camera",
    "No live camera is currently available for this project.",
    "Construction photo updates",
    "Your property financial summary",
    "Installment schedule",
    "Transfer receipts",
    "Request official statement",
    "After-sales services",
    "KINGLIKE VIP digital card",
    "Approved KINGLIKE VIP benefits",
    "Synthetic QA benefit",
    "Reference exchange rates",
    "Your personal referral link",
    "KINGLIKE VIP notifications",
  ];
  for (const text of customerSections) {
    await visible(buyerA, text, `customer section/data rendered: ${text}`);
  }
  coverage.push("/vip (journey, progress, empty camera, photos, handover, finance summary, installments, receipts, statements, services, membership, benefits, FX reference, referrals, notifications)");
  check("live-camera page has no iframe or external stream configured",
    await buyerA.locator("iframe").count() === 0);
  check("customer page has no registered service worker",
    await buyerA.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.length || 0) === 0);

  const image = buyerA.getByRole("img", { name: "Synthetic QA construction image" });
  await image.waitFor({ state: "visible", timeout: 10_000 });
  await buyerA.waitForFunction(() => {
    const image = [...document.images].find((item) => item.alt === "Synthetic QA construction image");
    return !!image && image.naturalWidth > 0;
  });
  check("published synthetic photo is viewable through local private-storage adapter", true);

  const downloadLink = buyerA.getByRole("link", { name: /Download receipt/i }).first();
  await downloadLink.waitFor({ state: "visible", timeout: 10_000 });
  const [download] = await Promise.all([
    buyerA.waitForEvent("download"),
    downloadLink.click(),
  ]);
  const downloadedPath = await download.path();
  check("buyer can download an authorized synthetic receipt", Boolean(downloadedPath));
  if (downloadedPath) {
    tempDownloads.push(downloadedPath);
    const bytes = await readFile(downloadedPath);
    check("downloaded receipt is the synthetic PDF fixture", bytes.subarray(0, 8).toString() === "%PDF-1.7");
  }

  const installmentData = await buyerA.evaluate(async (unitId) => {
    const response = await fetch(`/api/vip/units/${unitId}/installments`, {
      credentials: "include",
      cache: "no-store",
    });
    const result = await response.json();
    return {
      status: response.status,
      paid: Number(result.installments?.[0]?.paid_amount ?? 0),
      due: Number(result.installments?.[0]?.remaining_amount ?? 0),
    };
  }, fixture.unitA);
  check("installment balance endpoint returns only the buyer's synthetic account", installmentData.status === 200);
  check("receipt upload remains separate from payment confirmation", installmentData.paid === 25 && installmentData.due === 95);

  const serviceSection = buyerA.locator("section").filter({
    has: buyerA.getByRole("heading", { name: "After-sales services", exact: true }),
  }).first();
  await serviceSection.getByLabel("Describe your request").fill("Synthetic QA service request, no vendor contact.");
  await writeResponse(
    buyerA,
    "POST",
    /^\/api\/vip\/services$/,
    () => serviceSection.getByRole("button", { name: "Send request", exact: true }).click(),
    "buyer submits an in-app after-sales request",
  );
  await visible(buyerA, "Request received for review.", "service request is explicitly pending review");

  await writeResponse(
    buyerA,
    "POST",
    /^\/api\/vip\/statement-requests$/,
    () => buyerA.getByRole("button", { name: "Request official statement" }).click(),
    "buyer requests an official statement for the synthetic unit",
  );
  await visible(buyerA, "Already requested this month", "statement request is recorded without an external developer call");

  const preferredAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  const preferredLocal = new Date(preferredAt.getTime() - preferredAt.getTimezoneOffset() * 60_000)
    .toISOString().slice(0, 16);
  await buyerA.getByLabel("Preferred time").fill(preferredLocal);
  await buyerA.getByLabel("Additional notes").fill("Synthetic QA appointment request.");
  await writeResponse(
    buyerA,
    "POST",
    /^\/api\/vip\/units\/[1-9]\d*\/handover\/appointments$/,
    () => buyerA.getByRole("button", { name: "Send appointment request" }).click(),
    "buyer requests a handover inspection appointment",
  );
  await visible(buyerA, "Request received, awaiting confirmation", "handover request remains pending admin confirmation");

  const notificationCard = buyerA.locator("article").filter({ hasText: "Synthetic admin notice" }).first();
  await notificationCard.waitFor({ state: "visible" });
  await writeResponse(
    buyerA,
    "POST",
    /^\/api\/vip\/notifications\/[1-9]\d*\/read$/,
    () => notificationCard.getByRole("button", { name: "Mark read" }).click(),
    "customer marks only their own in-app notification read",
  );
  const preference = buyerA.getByLabel("Send me in-app reminders two days before installments");
  await writeResponse(
    buyerA,
    "PUT",
    /^\/api\/vip\/notification-preferences$/,
    () => preference.click(),
    "customer updates only their in-app notification preference",
  );
  const preferenceState = await buyerA.evaluate(async () =>
    (await (await fetch("/api/vip/notification-preferences", { credentials: "include" })).json()).inAppDueReminders,
  );
  check("notification preferences are per-user and persisted in the synthetic database", preferenceState === false);

  await writeResponse(
    buyerA,
    "POST",
    /^\/api\/vip\/card\/issue$/,
    () => buyerA.getByRole("button", { name: "Activate digital card" }).click(),
    "buyer issues a synthetic VIP membership card",
  );
  await visible(buyerA, "Active membership");
  const membershipSection = buyerA.locator("section").filter({
    has: buyerA.getByRole("heading", { name: "KINGLIKE VIP digital card", exact: true }),
  }).first();
  await membershipSection.getByRole("img", { name: "KINGLIKE VIP membership QR" }).waitFor({ state: "visible" });
  const memberCode = await membershipSection.locator("p.font-mono").first().innerText();
  check("membership code uses the synthetic card-code format", /^KLV-[A-F0-9]{24}$/.test(memberCode));
  await publicPage.goto(
    new URL("/vip/card/verify?code=" + encodeURIComponent(memberCode), base).href,
    { waitUntil: "domcontentloaded" },
  );
  await heading(publicPage, "Verify KINGLIKE VIP membership");
  await visible(publicPage, "Active VIP card", "public card verifier exposes validity only");
  coverage.push("/vip/card/verify (synthetic active card validity; no customer identity returned)");

  await writeResponse(
    buyerA,
    "POST",
    /^\/api\/vip\/referral-link$/,
    () => buyerA.getByRole("button", { name: "Create personal referral link" }).click(),
    "buyer creates a synthetic referral link",
  );
  const referralUrl = await buyerA.getByLabel("Your personal referral link").inputValue();
  const referral = new URL(referralUrl);
  check("referral URL remains on the exact QA origin", referral.origin === base.origin);
  check("referral URL uses the bounded synthetic code format", /^\/vip\/refer\/KLR-[A-F0-9]{32}$/.test(referral.pathname));
  await publicPage.goto(referral.href, { waitUntil: "domcontentloaded" });
  await heading(publicPage, "Explore real estate opportunities");
  await publicPage.getByLabel("Full name").fill("Synthetic QA Referral");
  await publicPage.getByLabel("International phone number").fill("+995555000001");
  await publicPage.getByLabel(/I consent to sharing my name and phone number/).check();
  await writeResponse(
    publicPage,
    "POST",
    /^\/api\/vip\/referral-share\/KLR-[A-F0-9]{32}$/,
    () => publicPage.getByRole("button", { name: "Request contact" }).click(),
    "public referral form stores only the synthetic consented lead locally",
  );
  await visible(publicPage, "Thank you, our team has received your request.");
  coverage.push("/vip/refer/:code (synthetic consented form, local referral table only; no CRM or messaging)");

  await buyerA.goto(new URL("/vip/support", base).href, { waitUntil: "domcontentloaded" });
  await heading(buyerA, "KINGLIKE VIP Support Center");
  await buyerA.getByLabel("Subject").fill("Synthetic QA support request");
  await buyerA.getByLabel("Describe your request").fill("Synthetic support message; no email or staff dispatch.");
  await writeResponse(
    buyerA,
    "POST",
    /^\/api\/vip\/support$/,
    () => buyerA.getByRole("button", { name: "Submit request" }).click(),
    "buyer creates a private VIP support ticket",
  );
  await visible(buyerA, "Request created. Our team will review it.");
  const ticketButton = buyerA.getByRole("button", { name: /Synthetic QA support request/ }).first();
  await ticketButton.waitFor({ state: "visible", timeout: 10_000 });
  await ticketButton.click();
  await buyerA.getByLabel("New message").fill("Synthetic follow-up for the QA ticket.");
  await writeResponse(
    buyerA,
    "POST",
    /^\/api\/vip\/support\/[1-9]\d*\/reply$/,
    () => buyerA.getByRole("button", { name: "Send", exact: true }).click(),
    "buyer replies within their own support ticket",
  );
  coverage.push("/vip/support (synthetic ticket and in-app reply)");

  await login(buyerB, "qa_buyer_b", "/vip");
  await heading(buyerB, "Your private investment portal");
  await visibleMatching(buyerB, /Unit:\s*QA-B/, "second buyer sees their own synthetic unit");
  check("second buyer does not see the other buyer's unit", await buyerB.getByText(/Unit:\s*QA-A/).count() === 0);
  const crossOwner = await buyerB.evaluate(async (unitId) =>
    (await fetch(`/api/vip/units/${unitId}/installments`, { credentials: "include" })).status,
  fixture.unitA);
  check("second buyer cannot read first buyer's installment endpoint", crossOwner === 404);
  await buyerB.getByLabel("Keys physically received").fill("2");
  const tbilisiDate = await buyerB.evaluate(() =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Tbilisi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date()),
  );
  await buyerB.getByLabel("Date you received the keys").fill(tbilisiDate);
  await buyerB.getByLabel(/I confirm that I physically received the stated keys/).check();
  await writeResponse(
    buyerB,
    "POST",
    /^\/api\/vip\/units\/[1-9]\d*\/keys\/acknowledge$/,
    () => buyerB.getByRole("button", { name: "Record my key receipt" }).click(),
    "synthetic buyer key acknowledgment is recorded only after the test fixture's management approval",
  );
  await visible(buyerB, "Acknowledgment recorded, awaiting management verification");
  const replayAcknowledgment = await buyerB.evaluate(async ({ unitId, receivedDate }) =>
    (await fetch(`/api/vip/units/${unitId}/keys/acknowledge`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receivedKeys: true, keyCount: 2, receivedDate, note: "" }),
    })).status,
  { unitId: fixture.unitB, receivedDate: tbilisiDate });
  check("replayed buyer key acknowledgment is rejected", replayAcknowledgment === 409);
  const otherOwnerAcknowledgment = await buyerA.evaluate(async ({ unitId, receivedDate }) =>
    (await fetch(`/api/vip/units/${unitId}/keys/acknowledge`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receivedKeys: true, keyCount: 1, receivedDate, note: "" }),
    })).status,
  { unitId: fixture.unitB, receivedDate: tbilisiDate });
  check("another buyer cannot acknowledge this unit's keys",
    otherOwnerAcknowledgment === 404);
  coverage.push("/vip (separate buyer record and synthetic key acknowledgment; UI explicitly states this is not a legal handover)");

  await login(seller, "qa_seller", "/vip/sales");
  await heading(seller, "My clients — KINGLIKE VIP");
  await visible(seller, "No client units assigned yet. Admin must assign you after buyer activation.");
  check("revoked seller session has no customer file data", await seller.getByText(fixture.buyerAEmail, { exact: true }).count() === 0);
  coverage.push("/vip/sales (revoked seller empty-state; assignment/revocation and immediate loss were exercised by the existing admin browser test)");

  await login(finance, "qa_finance", "/vip");
  await finance.goto(new URL("/vip/finance-review", base).href, { waitUntil: "domcontentloaded" });
  await heading(finance, "Financial receipt review");
  await visible(finance, "This account does not have active financial review permission.");
  check("unapproved finance staff cannot retrieve the review queue",
    await finance.evaluate(async () =>
      (await fetch("/api/admin/vip/finance/receipts", { credentials: "include" })).status,
    ) === 403);
  coverage.push("/vip/finance-review (unapproved finance role is denied; approved reviewer path is covered by the financial browser smoke)");

  await activation.goto(
    new URL("/vip/activate?token=" + encodeURIComponent(fixture.invitedToken), base).href,
    { waitUntil: "domcontentloaded" },
  );
  await heading(activation, "Activate KINGLIKE VIP");
  await visible(activation, "Synthetic QA Project", "activation preview identifies only the synthetic project");
  await visible(activation, "QA-C", "activation preview identifies only the synthetic unassigned unit");
  check("activation removes the bearer token from the address bar",
    new URL(activation.url()).searchParams.get("token") === null);
  await activation.getByLabel("Password", { exact: true }).fill("SyntheticInvitee-Password-517!");
  await activation.getByLabel("Confirm password", { exact: true }).fill("SyntheticInvitee-Password-517!");
  await writeResponse(
    activation,
    "POST",
    /^\/api\/vip\/invitations\/accept$/,
    () => activation.getByRole("button", { name: "Activate account" }).click(),
    "synthetic invitation acceptance creates a local-only QA account",
  );
  try {
    await activation.waitForURL(
      (url) => url.pathname === "/vip",
      { timeout: 10_000, waitUntil: "domcontentloaded" },
    );
  } catch {
    throw new Error(`Invite activation navigation ended at ${new URL(activation.url()).pathname}`);
  }
  await visibleMatching(activation, /Unit:\s*QA-C/, "activated invitee sees only the invited synthetic unit");
  check("activated synthetic invitee does not see another owner's unit",
    await activation.getByText(/Unit:\s*QA-A|Unit:\s*QA-B/).count() === 0);
  coverage.push("/vip/activate (synthetic pre-seeded invitation token; no invitation email sent)");

  const appCspEvents = cspEventDetails.filter((event) => event.page !== "guest");
  const appCspConsole = cspViolations.filter((event) => event.page !== "guest");
  check("no CSP violation occurred in authenticated VIP flows",
    appCspEvents.length === 0 && appCspConsole.length === 0);
  check("no browser page exception was raised", pageErrors.length === 0);
  check("no unapproved external request was attempted", externalBlocked.length === 0);
  check("no browser write escaped the synthetic test allowlist", blockedWrites.length === 0);
  check("no content was sent through a non-loopback WebSocket", websocketBlocked.every((item) => item.local));
  check("service worker stayed disabled in all browser contexts",
    (await buyerA.evaluate(async () => (await navigator.serviceWorker?.getRegistrations())?.length || 0)) === 0);
} catch (error) {
  failure = error;
} finally {
  for (const file of tempDownloads) await rm(file, { force: true }).catch(() => {});
  await browser.close().catch(() => {});
}

const summary = {
  checks: checks.length,
  passed: checks.filter((item) => item.pass).length,
  failed: checks.filter((item) => !item.pass).map((item) => item.name),
  coverage,
  externalRequestsBlocked: externalBlocked.length,
  externalHosts: [...new Set(externalBlocked.map((item) => item.host))],
  blockedWebSockets: websocketBlocked.length,
  nonLoopbackWebSockets: websocketBlocked.filter((item) => !item.local).length,
  blockedWrites: blockedWrites.length,
  cspViolations: cspViolations.length,
  cspViolationSources: cspEventDetails,
  cspConsoleMessages: cspViolations,
  expectedGuestCspBlocks: cspEventDetails.filter((event) => event.page === "guest").length,
  unexpectedAppCspViolations: cspEventDetails.filter((event) => event.page !== "guest").length +
    cspViolations.filter((event) => event.page !== "guest").length,
  pageErrors: pageErrors.length,
  consoleErrors: consoleErrors.length,
  apiErrorStatuses: apiErrors.reduce((result, item) => {
    const key = `${item.status} ${item.method} ${item.path}`;
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {}),
};
console.log("vip_pages_browser_qa=" + JSON.stringify(summary));
if (failure) {
  console.error("vip_pages_browser_qa_failure=" +
    String(failure?.message || failure).replace(/https?:\/\/[^\s"'<>]+/gi, "<url>").slice(0, 240));
  process.exitCode = 1;
}
