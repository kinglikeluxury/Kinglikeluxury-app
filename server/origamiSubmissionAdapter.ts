/**
 * Origami Submission Adapter
 *
 * Uses Playwright (headless Chromium) to fill and submit the public
 * Origami Bitrix24 CRM form at https://origami.bitrix24.site/en/
 *
 * No authentication required — the form is publicly accessible.
 *
 * Selectors verified from live DOM inspection on 2026-07-04:
 *   input[name="name"]        → First Name (field 0)
 *   input[name="lastname"]    → Last Name (field 1)
 *   input[name="phone"]       → Phone (field 2)
 *   input[name="email"]       → E-mail (field 3)
 *   .b24-form-control nth(4)  → Comments (textarea, no name attr)
 *   .b24-form-control nth(5)  → Agency Name (no name attr — custom field)
 *   .b24-form-control nth(6)  → Sales manager's Name (no name attr — custom field)
 *   button[type="submit"].b24-form-btn → "Send" submit button
 *   Success indicator: .b24-form-state.b24-form-success visible, or
 *     page text containing "sent"/"success"/"thank you" (English form)
 *
 * Mirrors the architecture of server/petraSubmissionAdapter.ts exactly.
 */

import { pool } from "./db";

export const ORIGAMI_FORM_URL = "https://origami.bitrix24.site/en/";

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

export interface OrigamiSubmitResult {
  success:       boolean;
  outcome:       "success" | "needs_review" | "failed";
  errorMessage?: string;
  evidence?:     string;
}

// ── Playwright loader (dynamic import — missing module doesn't crash server) ──

async function loadPlaywright() {
  try { return await import("playwright"); } catch { /* try core */ }
  try { return await import("playwright-core"); } catch { /* none */ }
  return null;
}

// ── Chromium resolver (mirrors petraSubmissionAdapter pattern) ────────────────

const NIX_CHROMIUM_FALLBACK =
  "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";

async function resolveChromiumPath(): Promise<string | undefined> {
  const envPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (envPath) return envPath;

  try {
    const { execSync } = await import("child_process");
    const result = execSync(
      "which chromium 2>/dev/null || which chromium-browser 2>/dev/null || echo ''",
      { encoding: "utf-8", timeout: 3000 }
    ).trim();
    if (result) return result;
  } catch { /* ignore */ }

  try {
    const fs = await import("fs");
    if (fs.existsSync(NIX_CHROMIUM_FALLBACK)) return NIX_CHROMIUM_FALLBACK;
  } catch { /* ignore */ }

  return undefined;
}

// ── Main submission function ──────────────────────────────────────────────────

export async function submitLeadToOrigami(
  recordId: number,
  _adminId: number,
  attemptType = "manual"
): Promise<OrigamiSubmitResult> {

  // ── 0. Load playwright ────────────────────────────────────────────────────
  const pw = await loadPlaywright();
  if (!pw) {
    return {
      success:      false,
      outcome:      "failed",
      errorMessage: "Playwright not installed. Run: npx playwright install chromium",
    };
  }

  // ── 1. Load lead record from DB ───────────────────────────────────────────
  const client = await pool.connect();
  let rec: any;
  try {
    const r = await client.query(`
      SELECT drr.id, drr.crm_lead_id, drr.developer_company_id,
             cl.first_name, cl.last_name, cl.full_name, cl.phone
        FROM developer_registration_records drr
        JOIN crm_leads cl ON cl.id = drr.crm_lead_id
       WHERE drr.id = $1
    `, [recordId]);
    if (r.rows.length === 0) {
      return { success: false, outcome: "failed", errorMessage: `Record ${recordId} not found` };
    }
    rec = r.rows[0];
  } finally {
    client.release();
  }

  // Build name parts
  const firstName = (rec.first_name ?? rec.full_name?.split(" ")[0] ?? "").trim();
  // Last name: if empty, Origami's form requires a single dot per the
  // developer's own submission instructions.
  const lastName  = (rec.last_name  ?? rec.full_name?.split(" ").slice(1).join(" ") ?? "").trim() || ".";
  const rawPhone  = rec.phone ?? "";
  const phone     = rawPhone.startsWith("+") ? rawPhone : `+${rawPhone.replace(/\D/g, "")}`;

  // ── Validate required fields before ever opening a browser ────────────────
  if (!firstName) {
    return { success: false, outcome: "needs_review", errorMessage: "Missing required field: first name" };
  }
  if (!phone || phone === "+") {
    return { success: false, outcome: "needs_review", errorMessage: "Missing required field: phone" };
  }

  console.log(`[OrigamiBrowser] Starting recordId=${recordId} lead="${firstName} ${lastName}" phone=${phone}`);

  // ── 2. Launch browser ─────────────────────────────────────────────────────
  const chromiumExe = await resolveChromiumPath();
  let browser: any = null;
  let outcome: OrigamiSubmitResult["outcome"] = "failed";
  let errorMessage: string | undefined;
  let evidence: string | undefined;

  try {
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
          errorMessage: "Chromium binary not found. Install: npx playwright install chromium or nix-env -i chromium",
        };
      }
      return { success: false, outcome: "failed", errorMessage: `Browser launch failed: ${e.message}` };
    }

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      viewport:  { width: 1280, height: 900 },
    });
    const page = await context.newPage();

    // ── 3. Navigate to Origami form ────────────────────────────────────────
    console.log("[OrigamiBrowser] Navigating to Origami form...");
    await page.goto(ORIGAMI_FORM_URL, { waitUntil: "networkidle", timeout: 30_000 });
    await page.waitForTimeout(2500);

    // Verify form rendered
    const formVisible = await page.locator("input.b24-form-control").first().isVisible().catch(() => false);
    if (!formVisible) {
      return {
        success:      false,
        outcome:      "failed",
        errorMessage: "Origami form did not render — page may be down or selectors changed",
      };
    }

    // ── 4. Fill named fields ──────────────────────────────────────────────
    console.log("[OrigamiBrowser] Filling form fields...");

    // First Name
    await page.locator('input[name="name"]').fill(firstName);

    // Last Name (or "." if the lead has none)
    await page.locator('input[name="lastname"]').fill(lastName);

    // Phone (with + prefix preserved)
    await page.locator('input[name="phone"]').fill(phone);

    // E-mail (fixed agency email)
    await page.locator('input[name="email"]').fill("info@kinglikeluxury.app");

    // ── 5. Fill unnamed custom fields (nth-based, order verified from DOM) ──
    const unnamed = page.locator(".b24-form-control");

    // Comments (index 4 — textarea)
    await unnamed.nth(4).fill("we are in touch with the client");

    // Agency Name (index 5)
    await unnamed.nth(5).fill("Kinglike Luxury");

    // Sales manager's Name (index 6)
    await unnamed.nth(6).fill("Tarik Imam");

    await page.waitForTimeout(500);

    // ── 6. Click Submit button ────────────────────────────────────────────
    console.log("[OrigamiBrowser] Clicking Submit...");
    const submitBtn = page.locator('button[type="submit"].b24-form-btn');
    const submitVisible = await submitBtn.isVisible().catch(() => false);

    if (!submitVisible) {
      return {
        success:      false,
        outcome:      "needs_review",
        errorMessage: "Submit button not found — form structure may have changed",
      };
    }

    await submitBtn.click();
    await page.waitForTimeout(2500);

    // ── 7. Handle confirmation popup, if any (mirrors Petra flow) ──────────
    const confirmPopup = page.locator(".b24-window-popup").filter({ hasText: /accept|confirm/i });
    const popupVisible = await confirmPopup.isVisible().catch(() => false);

    if (popupVisible) {
      console.log("[OrigamiBrowser] Confirmation/consent popup appeared — accepting...");
      const acceptBtn = page.locator("button.b24-form-btn", { hasText: /^I accept$/i });
      await acceptBtn.click().catch(() => {});
      await page.waitForTimeout(2500);
    }

    // ── 8. Verify success ────────────────────────────────────────────────
    const successEl = page.locator(".b24-form-state.b24-form-success");
    const isSuccess = await successEl.isVisible().catch(() => false);

    const pageText = await page.innerText("body").catch(() => "");
    const englishSuccess = /sent|success|thank you/i.test(pageText);

    evidence = `successEl=${isSuccess} text_snippet="${pageText.slice(0, 200)}"`;

    if (isSuccess || englishSuccess) {
      outcome = "success";
      console.log(`[OrigamiBrowser] \u2713 Form submitted successfully for recordId=${recordId}`);
    } else {
      outcome      = "needs_review";
      errorMessage = "Form submitted but no success confirmation detected. Manual verification needed.";
      console.warn("[OrigamiBrowser] Submitted but no confirmation detected — needs_review");
    }

  } catch (err: any) {
    outcome      = "failed";
    errorMessage = err.message ?? "Unexpected browser error";
    console.error(`[OrigamiBrowser] Error: ${errorMessage}`);
  } finally {
    await browser?.close().catch(() => {});
  }

  // ── 9. Write audit record to DB ───────────────────────────────────────────
  const client2 = await pool.connect();
  try {
    const isSuccess = outcome === "success";

    // next_registration_at = 45 days from now on success (matching registration_interval_days)
    const nextRegAt = isSuccess
      ? new Date(Date.now() + 45 * 86_400_000).toISOString()
      : null;

    await client2.query(`
      UPDATE developer_registration_records
         SET status               = $1,
             last_error           = $2,
             last_registered_at   = CASE WHEN $3 THEN NOW() ELSE last_registered_at END,
             next_registration_at = $4::timestamptz,
             attempt_count        = COALESCE(attempt_count, 0) + 1,
             updated_at           = NOW()
       WHERE id = $5
    `, [
      isSuccess ? "success" : outcome,
      errorMessage ?? null,
      isSuccess,
      nextRegAt,
      recordId,
    ]);

    // Insert attempt audit row
    const payload    = { firstName, lastName, phone, outcome, evidence };
    const resultMsg  = isSuccess
      ? "Origami form auto-filled and submitted \u2713"
      : outcome === "needs_review"
        ? `Submitted but no confirmation: ${errorMessage ?? "unknown"}`
        : `Browser submission failed: ${errorMessage ?? "unknown"}`;

    await client2.query(`
      INSERT INTO developer_registration_attempts
        (registration_record_id, crm_lead_id, developer_company_id,
         attempt_type, status, payload_json, result_message, created_by, created_at)
      SELECT drr.id, drr.crm_lead_id, drr.developer_company_id,
             $1, $2, $3, $4, NULL, NOW()
        FROM developer_registration_records drr
       WHERE drr.id = $5
    `, [
      attemptType,
      isSuccess ? "success" : outcome,
      JSON.stringify(payload),
      resultMsg,
      recordId,
    ]);

  } finally {
    client2.release();
  }

  return { success: outcome === "success", outcome, errorMessage, evidence };
}
