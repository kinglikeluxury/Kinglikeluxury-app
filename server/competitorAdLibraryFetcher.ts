// ── Competitor Intelligence — Public Meta Ad Library Fetcher (READ-ONLY) ────
//
// Safety contract (do not violate):
//   - Fully logged-out, read-only GET navigation to the PUBLIC Ad Library
//     page (facebook.com/ads/library). Never logs in, never submits forms,
//     never bypasses a captcha/consent wall (if one appears mid-run, the
//     attempt is recorded as blocked and retried later — it is not defeated).
//   - No Meta Graph API calls of any kind live in this file.
//   - This file owns zero database tables — it only returns parsed data to
//     the caller (competitorIntelligenceService.ts), which persists it into
//     the new competitor_* tables.
//   - Never runs on a schedule — every call here is triggered synchronously
//     by an on-demand admin search request.

import { execSync } from "node:child_process";

export interface RawCompetitorAd {
  libraryId: string | null;
  advertiserName: string | null;
  adText: string | null;
  status: "Active" | "Inactive" | "Unknown";
  startDate: string | null;
  endDate: string | null;
  platforms: string[];
  hasImage: boolean;
  hasVideo: boolean;
  landingUrl: string | null;
  language: string;
  rawCardText: string;
}

export interface AdLibrarySearchResult {
  term: string;
  url: string;
  success: boolean;
  blocked: boolean;
  httpStatus: number | null;
  attempts: number;
  ads: RawCompetitorAd[];
  error?: string;
}

const HEADLESS_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--no-first-run",
  "--disable-gpu",
];

const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 3000;

function resolveChromiumPath(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    const which = execSync("which chromium", { encoding: "utf8" }).trim();
    if (which) return which;
  } catch {
    // fall through to hardcoded nix path
  }
  const fallback =
    "/nix/store/zi4f80l169xlmivz8vja8wlphq74qqk0-chromium-125.0.6422.141/bin/chromium";
  return fallback;
}

async function loadPlaywright(): Promise<any> {
  try {
    return await import("playwright");
  } catch {
    return await import("playwright-core");
  }
}

function buildAdLibraryUrl(term: string, country?: string): string {
  const q = encodeURIComponent(term);
  const countryParam = country && country.trim() ? country.trim().toUpperCase() : "ALL";
  return `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=${countryParam}&q=${q}&search_type=keyword_unordered&media_type=all`;
}

function detectLanguage(text: string): string {
  if (/[\u0600-\u06FF]/.test(text)) return "ar";
  if (/[\u10A0-\u10FF]/.test(text)) return "ka";
  if (/[\u0400-\u04FF]/.test(text)) return "ru";
  if (/[a-zA-Z]/.test(text)) return "en";
  return "unknown";
}

/**
 * Runs inside the browser context (page.evaluate) — no access to outer
 * closures, must be fully self-contained.
 */
function extractAdsFromDom() {
  const results: any[] = [];
  const seenLibraryIds = new Set<string>();

  const libraryIdRegex = /Library ID:\s*(\d+)/;
  const allNodes = Array.from(document.querySelectorAll("div, span"));

  for (const node of allNodes) {
    const text = (node as HTMLElement).innerText || "";
    if (text.length > 6000 || text.length < 10) continue;
    const match = text.match(libraryIdRegex);
    if (!match) continue;
    const libraryId = match[1];
    if (seenLibraryIds.has(libraryId)) continue;

    // Walk up to find a reasonably-sized card container that mentions
    // "Library ID:" exactly once (the whole individual ad card, not the
    // full results list).
    let el: HTMLElement | null = node as HTMLElement;
    let card: HTMLElement | null = null;
    for (let i = 0; i < 12 && el; i++) {
      const t = el.innerText || "";
      const occurrences = (t.match(/Library ID:/g) || []).length;
      if (occurrences === 1 && t.length > 40 && t.length < 8000) {
        card = el;
      }
      if (occurrences > 1) break;
      el = el.parentElement;
    }
    if (!card) continue;

    seenLibraryIds.add(libraryId);
    const cardText = card.innerText || "";

    const images = Array.from(card.querySelectorAll("img")).filter(
      (img: any) => img.src && img.src.includes("scontent"),
    ).length;
    const videos = card.querySelectorAll("video").length;

    const outboundLinks = Array.from(card.querySelectorAll("a[href]"))
      .map((a: any) => a.getAttribute("href") || "")
      .filter((h: string) => h.includes("l.facebook.com/l.php"));

    results.push({ libraryId, cardText, images, videos, outboundLinks });
  }

  return results;
}

function parseCard(raw: {
  libraryId: string;
  cardText: string;
  images: number;
  videos: number;
  outboundLinks: string[];
}): RawCompetitorAd {
  const text = raw.cardText;

  const status: "Active" | "Inactive" | "Unknown" = /(^|\n)Active(\n|$)/.test(text)
    ? "Active"
    : /(^|\n)Inactive(\n|$)/.test(text)
      ? "Inactive"
      : "Unknown";

  let startDate: string | null = null;
  let endDate: string | null = null;
  const startedMatch = text.match(/Started running on ([A-Za-z]+ \d{1,2}, \d{4})/);
  if (startedMatch) {
    startDate = startedMatch[1];
  } else {
    const rangeMatch = text.match(
      /([A-Za-z]+ \d{1,2}, \d{4})\s*-\s*([A-Za-z]+ \d{1,2}, \d{4})/,
    );
    if (rangeMatch) {
      startDate = rangeMatch[1];
      endDate = rangeMatch[2];
    }
  }

  // Advertiser name: heuristically the short line immediately preceding
  // "Sponsored" in the card text.
  let advertiserName: string | null = null;
  let adText: string | null = null;
  const sponsoredIdx = text.indexOf("Sponsored");
  if (sponsoredIdx > -1) {
    const before = text.slice(0, sponsoredIdx).trim().split("\n").filter(Boolean);
    advertiserName = before.length ? before[before.length - 1].trim() : null;

    const after = text.slice(sponsoredIdx + "Sponsored".length);
    const stopMarkers = ["\nActive\n", "\nInactive\n", "This ad has multiple versions", "Library ID:"];
    let cutIdx = after.length;
    for (const marker of stopMarkers) {
      const idx = after.indexOf(marker);
      if (idx > -1 && idx < cutIdx) cutIdx = idx;
    }
    adText = after.slice(0, cutIdx).trim() || null;
  }

  const platforms: string[] = [];
  if (/Instagram/i.test(text)) platforms.push("Instagram");
  if (/Facebook/i.test(text) && !/Facebook\.com|About Facebook/i.test(text)) platforms.push("Facebook");
  if (/Messenger/i.test(text)) platforms.push("Messenger");
  if (/Audience Network/i.test(text)) platforms.push("Audience Network");

  let landingUrl: string | null = null;
  for (const link of raw.outboundLinks) {
    try {
      const url = new URL(link, "https://l.facebook.com");
      const target = url.searchParams.get("u");
      if (target && !target.includes("fb.me")) {
        landingUrl = decodeURIComponent(target);
        break;
      }
    } catch {
      // ignore malformed links
    }
  }

  return {
    libraryId: raw.libraryId,
    advertiserName,
    adText,
    status,
    startDate,
    endDate,
    platforms,
    hasImage: raw.images > 0,
    hasVideo: raw.videos > 0,
    landingUrl,
    language: detectLanguage(adText || advertiserName || ""),
    rawCardText: text.slice(0, 4000),
  };
}

async function attemptSearch(
  pw: any,
  chromiumExe: string | undefined,
  url: string,
): Promise<{ httpStatus: number | null; ads: RawCompetitorAd[]; blocked: boolean }> {
  let browser: any;
  try {
    browser = await pw.chromium.launch({
      headless: true,
      executablePath: chromiumExe,
      args: HEADLESS_ARGS,
    });
    const context = await browser.newContext({
      userAgent: USER_AGENT,
      locale: "en-US",
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
    const httpStatus = response ? response.status() : null;

    await page.waitForTimeout(4000);

    const bodyText: string = await page.evaluate(() => document.body.innerText || "");
    // A "shell" page has almost no content beyond the nav chrome — Meta did
    // not actually run the search (soft block / not-yet-hydrated response).
    const looksLikeShell = bodyText.length < 800 && !/No ads match your search criteria/i.test(bodyText);

    if (looksLikeShell) {
      return { httpStatus, ads: [], blocked: true };
    }

    const rawCards = await page.evaluate(extractAdsFromDom);
    const ads = (rawCards as any[]).map(parseCard);
    return { httpStatus, ads, blocked: false };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Searches the public Meta Ad Library for a term, with retry + exponential
 * backoff when Meta serves a soft-blocked "shell" page.
 */
export async function searchAdLibrary(
  term: string,
  country?: string,
): Promise<AdLibrarySearchResult> {
  const url = buildAdLibraryUrl(term, country);
  const pw = await loadPlaywright();
  const chromiumExe = resolveChromiumPath();

  let lastError: string | undefined;
  let lastHttpStatus: number | null = null;
  let wasBlocked = false;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { httpStatus, ads, blocked } = await attemptSearch(pw, chromiumExe, url);
      lastHttpStatus = httpStatus;
      if (!blocked) {
        return { term, url, success: true, blocked: false, httpStatus, attempts: attempt, ads };
      }
      wasBlocked = true;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, BASE_BACKOFF_MS * attempt));
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, BASE_BACKOFF_MS * attempt));
      }
    }
  }

  return {
    term,
    url,
    success: false,
    blocked: wasBlocked,
    httpStatus: lastHttpStatus,
    attempts: MAX_ATTEMPTS,
    ads: [],
    error: lastError || (wasBlocked ? "Meta returned a blocked/shell page after all retries" : "Unknown failure"),
  };
}
