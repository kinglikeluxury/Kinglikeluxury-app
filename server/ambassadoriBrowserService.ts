/**
 * Ambassadori Browser Automation Service
 *
 * Uses Playwright (headless Chromium) to register leads on the
 * broker.islandambassadori.com portal exactly as a human operator would.
 *
 * Authentication:
 *   - Restores browser cookies + localStorage from ambassadori_session_store
 *   - Falls back to AMBASSADORI_SESSION_TOKEN env var as localStorage seed
 *   - If portal redirects to login → outcome = "login_required"
 *
 * Form flow (per task spec):
 *   1. Open deals/create
 *   2. Fill Name, Surname, Phone
 *   3. Set Property type = Apartments / Квартиры
 *   4. Set Project = Ambassadori Island Batumi
 *   5. Set Personal Expert = Aphina Martley
 *   6. Click "Check uniqueness"
 *   7. If duplicate → outcome = "protected"
 *   8. Submit / Create deal
 *   9. Verify: success confirmation OR deal ID captured
 */

import { pool } from "./db";
import {
  getSessionData,
  saveSessionData,
  buildEnvTokenSeed,
  SessionData,
  StoredCookie,
} from "./ambassadoriSessionStore";

export const AMBASSADORI_COMPANY_ID = 2;
const PORTAL_ORIGIN = "https://broker.islandambassadori.com";
const CREATE_URL    = `${PORTAL_ORIGIN}/deals/create`;
const LOGIN_PATHS   = ["/login", "/auth", "/signin", "/sign-in"];

const HEADLESS_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--no-first-run",
  "--no-zygote",
  "--single-process",
  "--disable-gpu",
];

export interface BrowserSubmitResult {
  success:      boolean;
  outcome:      "success" | "login_required" | "needs_review" | "protected" | "failed";
  dealId?:      string;
  errorMessage?: string;
  evidence?:    string;
}

// ── Playwright loader (dynamic import so missing module doesn't crash server) ──

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    try {
      return await import("playwright-core");
    } catch {
      return null;
    }
  }
}

// ── Resolve system Chromium executable path ───────────────────────────────────
// Prefer system (Nix-installed) Chromium to avoid downloading bundled browsers.
// Order of preference:
//   1. which chromium / chromium-browser (Nix PATH)
//   2. PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH env var override
//   3. Known Nix store path (hard fallback)

const NIX_CHROMIUM_FALLBACK = "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

async function resolveChromiumPath(): Promise<string | undefined> {
  // Env override
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (envPath) return envPath;

  // which search
  try {
    const { execSync } = await import("child_process");
    const result = execSync(
      "which chromium 2>/dev/null || which chromium-browser 2>/dev/null || echo ''",
      { encoding: "utf-8", timeout: 3000 }
    ).trim();
    if (result) {
      console.log(`[AmbBrowser] Using system Chromium: ${result}`);
      return result;
    }
  } catch { /* ignore */ }

  // Nix store fallback
  try {
    const fs = await import("fs");
    if (fs.existsSync(NIX_CHROMIUM_FALLBACK)) {
      console.log(`[AmbBrowser] Using Nix store Chromium: ${NIX_CHROMIUM_FALLBACK}`);
      return NIX_CHROMIUM_FALLBACK;
    }
  } catch { /* ignore */ }

  console.warn("[AmbBrowser] No system Chromium found — Playwright will try its bundled browser");
  return undefined;
}

// ── Cookie/storage helpers ───────────────────────────────────────────────────

function toPwCookies(stored: StoredCookie[]): any[] {
  return stored.map(c => ({
    name:     c.name,
    value:    c.value,
    domain:   c.domain  ?? "broker.islandambassadori.com",
    path:     c.path    ?? "/",
    expires:  c.expires ?? -1,
    httpOnly: c.httpOnly ?? false,
    secure:   c.secure   ?? true,
    sameSite: c.sameSite ?? "Lax",
  }));
}

function fromPwCookies(raw: any[]): StoredCookie[] {
  return raw.map(c => ({
    name: c.name, value: c.value, domain: c.domain, path: c.path,
    expires: c.expires, httpOnly: c.httpOnly, secure: c.secure,
    sameSite: c.sameSite,
  }));
}

// ── Main submission function ──────────────────────────────────────────────────

export async function submitLeadViaBrowser(
  recordId: number,
  adminId:  number
): Promise<BrowserSubmitResult> {

  // ── 0. Load playwright ────────────────────────────────────────────────────
  const pw = await loadPlaywright();
  if (!pw) {
    return {
      success:      false,
      outcome:      "failed",
      errorMessage: "Playwright not installed. Run: npx playwright install chromium",
    };
  }

  // ── 1. Load lead record ───────────────────────────────────────────────────
  const client = await pool.connect();
  let rec: any;
  try {
    const r = await client.query(`
      SELECT drr.id, drr.crm_lead_id, drr.developer_company_id,
             cl.first_name, cl.last_name, cl.full_name, cl.phone, cl.city
        FROM developer_registration_records drr
        JOIN crm_leads cl ON cl.id = drr.crm_lead_id
       WHERE drr.id = $1
    `, [recordId]);
    if (r.rows.length === 0) {
      return { success: false, outcome: "failed", errorMessage: `Record ${recordId} not found` };
    }
    rec = r.rows[0];
    if (rec.developer_company_id !== AMBASSADORI_COMPANY_ID) {
      return { success: false, outcome: "failed", errorMessage: "Record is not for Ambassadori" };
    }
  } finally {
    client.release();
  }

  const firstName = (rec.first_name ?? rec.full_name?.split(" ")[0] ?? "").trim() || "—";
  const lastName  = (rec.last_name  ?? rec.full_name?.split(" ").slice(1).join(" ") ?? "").trim() || "—";
  const rawPhone  = rec.phone ?? "";
  const phone     = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone.replace(/\D/g, "")}`;

  console.log(`[AmbBrowser] Starting recordId=${recordId} lead="${firstName} ${lastName}" phone=${phone}`);

  // ── 2. Load session ───────────────────────────────────────────────────────
  let sessionData: SessionData | null = await getSessionData();
  if (!sessionData) {
    sessionData = buildEnvTokenSeed();
    console.log("[AmbBrowser] No stored session — using env token seed");
  }

  // ── 3. Launch browser ─────────────────────────────────────────────────────
  const chromiumExe = await resolveChromiumPath();
  let browser: any = null;
  try {
    browser = await pw.chromium.launch({
      headless:       true,
      executablePath: chromiumExe,
      args:           HEADLESS_ARGS,
    });
  } catch (e: any) {
    if (e.message?.includes("Executable doesn't exist") || e.message?.includes("not found")) {
      return {
        success:      false,
        outcome:      "failed",
        errorMessage: "Chromium binary not found. Install: npx playwright install chromium  or  nix-env -i chromium",
      };
    }
    return { success: false, outcome: "failed", errorMessage: `Browser launch failed: ${e.message}` };
  }

  const context = await browser.newContext({
    userAgent: sessionData?.userAgent ??
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    viewport:  { width: 1280, height: 800 },
    locale:    "ru-RU",
  });
  const page = await context.newPage();

  let outcome:      BrowserSubmitResult["outcome"] = "failed";
  let dealId:       string | undefined;
  let errorMessage: string | undefined;
  let evidence:     string | undefined;

  try {
    // ── 4. Restore cookies ──────────────────────────────────────────────────
    if (sessionData?.cookies?.length) {
      await context.addCookies(toPwCookies(sessionData.cookies));
    }

    // ── 5. Inject localStorage token ────────────────────────────────────────
    if (sessionData?.localStorage) {
      const ls = sessionData.localStorage;
      await context.addInitScript((kvPairs: Record<string, string>) => {
        for (const [k, v] of Object.entries(kvPairs)) {
          localStorage.setItem(k, v);
        }
      }, ls as Record<string, string>);
    }

    // ── 6. Navigate to deals/create ─────────────────────────────────────────
    console.log("[AmbBrowser] Navigating to deals/create...");
    await page.goto(CREATE_URL, { waitUntil: "networkidle", timeout: 30_000 });

    const currentUrl = page.url();
    console.log(`[AmbBrowser] Current URL after nav: ${currentUrl}`);

    // ── 7. Check login state ─────────────────────────────────────────────────
    const isLoginPage = LOGIN_PATHS.some(p => currentUrl.includes(p)) ||
      !currentUrl.startsWith(PORTAL_ORIGIN);

    if (isLoginPage) {
      console.warn("[AmbBrowser] Redirected to login — session expired");
      outcome = "login_required";
      errorMessage = "Ambassadori session expired — please re-login via the portal and save cookies";
    } else {
      // ── 8. Fill form ───────────────────────────────────────────────────────
      console.log("[AmbBrowser] Logged in — filling form...");

      // Wait for form to render
      await page.waitForTimeout(2000);

      // Fill Name (Имя)
      await fillField(page, firstName, [
        'input[placeholder*="Имя"]',
        'input[placeholder*="Name"]',
        'input[name="name"]',
        'input[name="first_name"]',
        '//label[contains(., "Имя")]/following-sibling::*//input',
        '//label[contains(., "Name")]/following-sibling::*//input',
      ]);

      // Fill Surname (Фамилия)
      await fillField(page, lastName, [
        'input[placeholder*="Фамилия"]',
        'input[placeholder*="Surname"]',
        'input[name="surname"]',
        'input[name="last_name"]',
        '//label[contains(., "Фамилия")]/following-sibling::*//input',
        '//label[contains(., "Surname")]/following-sibling::*//input',
      ]);

      // Fill Phone (Телефон)
      await fillField(page, phone, [
        'input[placeholder*="Телефон"]',
        'input[placeholder*="Phone"]',
        'input[type="tel"]',
        'input[name="phone"]',
        '//label[contains(., "Телефон")]/following-sibling::*//input',
        '//label[contains(., "Phone")]/following-sibling::*//input',
      ]);

      await page.waitForTimeout(500);

      // Property type = Apartments / Квартиры
      await selectOption(page, "Квартиры", "Apartments", [
        'select[name="property_type"]',
        '//label[contains(., "Тип")]/following-sibling::*//select',
        '//label[contains(., "Type")]/following-sibling::*//select',
      ]);

      // Project = Ambassadori Island Batumi
      await typeIntoAutocomplete(page, "Ambassadori Island Batumi", [
        'input[placeholder*="Проект"]',
        'input[placeholder*="Project"]',
        '//label[contains(., "ЖК")]/following-sibling::*//input',
        '//label[contains(., "Project")]/following-sibling::*//input',
      ]);

      // Personal Expert = Aphina Martley
      await typeIntoAutocomplete(page, "Aphina Martley", [
        'input[placeholder*="Эксперт"]',
        'input[placeholder*="Expert"]',
        'input[placeholder*="expert"]',
        '//label[contains(., "Эксперт")]/following-sibling::*//input',
        '//label[contains(., "Expert")]/following-sibling::*//input',
      ]);

      await page.waitForTimeout(1000);

      // ── 9. Click "Check uniqueness" ────────────────────────────────────────
      const uniqueClicked = await clickButton(page, [
        'button:has-text("Проверить уникальность")',
        'button:has-text("Check uniqueness")',
        'button:has-text("Проверить")',
        'button[type="button"]:has-text("уникальн")',
      ]);

      if (uniqueClicked) {
        console.log("[AmbBrowser] Uniqueness check clicked — waiting for result...");
        await page.waitForTimeout(3000);

        // Check for duplicate message
        const pageText = await page.innerText("body").catch(() => "");
        const isDuplicate = /клиент занят|уже зарегистрир|duplicate|already exists/i.test(pageText);

        if (isDuplicate) {
          console.log("[AmbBrowser] Portal shows duplicate — marking protected");
          outcome      = "protected";
          errorMessage = "Portal confirmed this lead is already registered (duplicate)";
        } else {
          // ── 10. Submit / Create deal ───────────────────────────────────────
          console.log("[AmbBrowser] Unique — attempting to create deal...");
          const submitted = await clickButton(page, [
            'button:has-text("Создать сделку")',
            'button:has-text("Create deal")',
            'button:has-text("Создать")',
            'button:has-text("Submit")',
            'button[type="submit"]',
            'input[type="submit"]',
          ]);

          if (!submitted) {
            outcome      = "needs_review";
            errorMessage = "Could not find submit button — form structure may have changed";
          } else {
            await page.waitForTimeout(4000);

            const afterText = await page.innerText("body").catch(() => "");
            const afterUrl  = page.url();

            // ── 11. Verify success ─────────────────────────────────────────
            const successPatterns = [
              /сделка создана/i, /deal created/i, /успешно/i,
              /success/i, /сделка #\d+/i, /deal #\d+/i,
            ];
            const succeeded = successPatterns.some(p => p.test(afterText)) ||
              afterUrl.includes("/deals/") && !afterUrl.includes("create");

            // Try to extract deal ID
            const dealIdMatch = afterText.match(/#(\d+)/) ||
              afterUrl.match(/\/deals\/(\d+)/) ||
              afterText.match(/ID[:\s]+(\d+)/i);
            if (dealIdMatch) dealId = dealIdMatch[1];

            evidence = `URL: ${afterUrl} | Text snippet: ${afterText.slice(0, 300)}`;

            if (succeeded || dealId) {
              outcome = "success";
              console.log(`[AmbBrowser] ✓ Deal created dealId=${dealId ?? "(no ID)"}`);
            } else {
              outcome      = "needs_review";
              errorMessage = "Form submitted but no success confirmation detected. Manual verification needed.";
              console.warn("[AmbBrowser] Submitted but no confirmation — needs_review");
            }
          }
        }
      } else {
        outcome      = "needs_review";
        errorMessage = "Could not find 'Check uniqueness' button — form may need manual interaction";
        console.warn("[AmbBrowser] Check uniqueness button not found");
      }

      // ── 12. Save updated cookies back ──────────────────────────────────────
      const freshCookies = await context.cookies();
      const lsData       = await page.evaluate(() => {
        const out: Record<string, string> = {};
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k) out[k] = localStorage.getItem(k) ?? "";
        }
        return out;
      }).catch(() => ({} as Record<string, string>));

      await saveSessionData({
        cookies:      fromPwCookies(freshCookies),
        localStorage: lsData,
        userAgent:    sessionData?.userAgent,
        savedAt:      new Date().toISOString(),
      });
    }

  } catch (err: any) {
    outcome      = "failed";
    errorMessage = err.message ?? "Unexpected browser error";
    console.error(`[AmbBrowser] Error: ${errorMessage}`);
  } finally {
    await browser?.close().catch(() => {});
  }

  // ── 13. Write audit record ────────────────────────────────────────────────
  const client2 = await pool.connect();
  try {
    const newStatus  = outcome === "success" || outcome === "protected" ? "success" : outcome;
    const nextRegAt  = (outcome === "success" || outcome === "protected")
      ? new Date(Date.now() + 30 * 86_400_000).toISOString()
      : null;

    await client2.query(`
      UPDATE developer_registration_records
         SET status             = $1,
             last_error         = $2,
             last_registered_at = CASE WHEN $3 THEN NOW() ELSE last_registered_at END,
             next_registration_at = $4::timestamptz,
             attempt_count      = COALESCE(attempt_count, 0) + 1,
             updated_at         = NOW()
       WHERE id = $5
    `, [
      newStatus,
      errorMessage ?? null,
      outcome === "success" || outcome === "protected",
      nextRegAt,
      recordId,
    ]);

    const payload = { firstName, lastName, phone, dealId, evidence, outcome };
    const resultMsg = outcome === "success"
      ? `Browser deal created ✓${dealId ? ` dealId=${dealId}` : " (no ID returned)"}`
      : outcome === "protected"
        ? "Lead already registered in portal — protected"
        : outcome === "login_required"
          ? "Session expired — login required"
          : errorMessage ?? "Browser submission failed";

    // Insert audit attempt
    await client2.query(`
      INSERT INTO developer_registration_attempts
        (registration_record_id, crm_lead_id, developer_company_id,
         attempt_type, status, payload_json, result_message, created_by, created_at)
      VALUES (
        (SELECT id FROM developer_registration_records WHERE id=$1),
        $2, $3,
        'browser_automation',
        $4, $5, $6, $7, NOW()
      )
    `, [
      recordId, rec.crm_lead_id, AMBASSADORI_COMPANY_ID,
      outcome === "success" || outcome === "protected" ? "success" : "failed",
      JSON.stringify(payload), resultMsg,
      adminId || null,
    ]);

  } catch (dbErr: any) {
    console.error("[AmbBrowser] DB write error:", dbErr.message);
  } finally {
    client2.release();
  }

  return { success: outcome === "success" || outcome === "protected", outcome, dealId, errorMessage, evidence };
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

async function fillField(page: any, value: string, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const isXpath = sel.startsWith("//");
      const el = isXpath
        ? page.locator(`xpath=${sel}`).first()
        : page.locator(sel).first();

      const count = await el.count();
      if (!count) continue;

      await el.waitFor({ state: "visible", timeout: 3000 });
      await el.click({ force: true });
      await el.fill(value);
      return true;
    } catch { continue; }
  }
  console.warn(`[AmbBrowser] fillField: could not find field for value="${value}"`);
  return false;
}

async function selectOption(page: any, value1: string, value2: string, selectors: string[]): Promise<boolean> {
  const values = [value1, value2];
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (!await el.count()) continue;
      for (const val of values) {
        try { await el.selectOption({ label: val }); return true; } catch { }
        try { await el.selectOption({ value: val }); return true; } catch { }
      }
    } catch { continue; }
  }
  return false;
}

async function typeIntoAutocomplete(page: any, text: string, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const isXpath = sel.startsWith("//");
      const el = isXpath
        ? page.locator(`xpath=${sel}`).first()
        : page.locator(sel).first();

      if (!await el.count()) continue;
      await el.waitFor({ state: "visible", timeout: 3000 });
      await el.click({ force: true });
      await el.fill(text);
      await page.waitForTimeout(1500);

      // Click first dropdown option
      const option = page.locator(`.dropdown-item, .v-list-item, [role="option"]`).first();
      if (await option.count()) await option.click();
      return true;
    } catch { continue; }
  }
  console.warn(`[AmbBrowser] typeIntoAutocomplete: could not find field for "${text}"`);
  return false;
}

async function clickButton(page: any, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    try {
      const el = page.locator(sel).first();
      if (!await el.count()) continue;
      await el.waitFor({ state: "visible", timeout: 3000 });
      await el.click({ force: true });
      return true;
    } catch { continue; }
  }
  return false;
}

// ── False success fix ─────────────────────────────────────────────────────────
// Called at startup: converts Ambassadori "success" records that have no
// confirmed deal_id in their audit log → needs_review / clears next_registration_at.

export async function fixAmbassadoriUnverifiedSuccesses(): Promise<number> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE developer_registration_records drr
         SET status               = 'needs_review',
             last_error           = 'Converted from unverified success — no portal deal ID confirmed',
             next_registration_at = NULL,
             updated_at           = NOW()
       WHERE drr.developer_company_id = $1
         AND drr.status = 'success'
         AND NOT EXISTS (
           SELECT 1 FROM developer_registration_attempts dra
            WHERE dra.registration_record_id = drr.id
              AND dra.payload_json IS NOT NULL
              AND dra.payload_json->>'deal_id' IS NOT NULL
              AND dra.payload_json->>'deal_id' != ''
              AND dra.payload_json->>'deal_id' != 'null'
         )
    `, [AMBASSADORI_COMPANY_ID]);

    const count = result.rowCount ?? 0;
    if (count > 0) {
      console.log(`[AmbBrowser] Fixed ${count} unverified Ambassadori success record(s) → needs_review`);
    }
    return count;
  } catch (err: any) {
    console.error("[AmbBrowser] fixAmbassadoriUnverifiedSuccesses error:", err.message);
    return 0;
  } finally {
    client.release();
  }
}
