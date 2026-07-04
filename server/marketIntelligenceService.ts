// ── Real Estate Market Intelligence — SAFE MODE (READ-ONLY) ─────────────────
//
// Safety contract (do not violate):
//   - This file NEVER creates/alters any database table. It only reads from
//     the existing competitor_ads, competitor_ai_analysis, and
//     competitor_profiles tables (owned by competitorIntelligenceService.ts).
//   - No writes of any kind happen here — no INSERT/UPDATE/DELETE.
//   - On-demand only. No scheduler/cron/interval ever calls into this file.
//   - Never triggers a new competitor search or scrape — it only reads data
//     that was already stored by a previous, explicitly admin-triggered search.
//   - Never touches CRM, WhatsApp, Email, Auth, Permissions, KQS, AI
//     Marketing Director, Meta Intelligence, or Developer Registration
//     tables/routes/logic.
//   - No Meta Graph API calls (writes or reads) live in this file.
//   - The single OpenAI call (analyzeMarket) is read-only analysis
//     generation over already-stored data — triggered only when an admin
//     explicitly clicks "Analyze Market". It never runs automatically.

import { pool } from "./db";
import OpenAI from "openai";

const apiKey = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
let openai: OpenAI | null = null;
if (apiKey) {
  openai = new OpenAI({ apiKey });
} else {
  console.warn("[MarketIntelligence] OPENAI_API_KEY not set — AI Market Analyst disabled");
}

// ── Real estate stop-word filter (Phase 5) ──────────────────────────────────
// Used only to clean up free-text fallbacks (e.g. the Smart Search "keyword"
// field) — Market Insights itself never shows raw word-frequency output, it
// only ever shows curated entity categories (see extractEntities below).

const CTA_PHRASES = [
  "learn more", "send message", "shop now", "contact us", "sign up",
  "book now", "get offer", "apply now", "watch video", "download now",
];

const STOP_WORDS = new Set([
  // English generic
  "first", "more", "from", "learn", "learn more", "message", "messages",
  "send", "click", "today", "now", "facebook", "instagram", "whatsapp",
  "http", "https", "www", "link", "page", "video", "photo", "image",
  "contact", "website", "and", "or", "the", "this", "that", "with",
  "your", "you", "our", "are", "for",
  // Arabic generic
  "هذا", "هذه", "ذلك", "اضغط", "تواصل", "الرابط", "اليوم", "الآن",
  "اعرف", "المزيد", "معنا", "ارسل", "رسالة", "واتساب", "فيسبوك", "انستغرام",
]);

/** Strips known CTA phrases (as whole units) and stop words from free text.
 *  Returns the remaining meaningful tokens only — used for the Smart Search
 *  free-keyword fallback, never for Market Insights (which is entity-driven). */
export function stripStopWordsAndCtas(text: string): string[] {
  if (!text) return [];
  let cleaned = text.toLowerCase();
  for (const cta of CTA_PHRASES) {
    cleaned = cleaned.split(cta).join(" ");
  }
  const tokens = cleaned
    .replace(/[^\w\u0600-\u06FF\u00C0-\uFFFF\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  return tokens;
}

// ── Real estate entity dictionaries (Phase 6) ───────────────────────────────
// Seed lists per the approved spec. Purely additive/manual — extend by
// editing these arrays, no database or schema involvement.

const PROJECTS = ["ambassadori", "batumi island", "petra", "silk tower", "rotana", "swissotel"];
const DEVELOPERS = ["ambassadori", "silk", "alliance", "archi", "orbi", "emaar"];
const COMPANIES = ["nino investment", "kinglike luxury", "m.a real estate", "point"];
const CITIES = ["batumi", "tbilisi", "gonio", "kobuleti", "sarpi"];
const COUNTRIES = ["georgia", "turkey", "uae", "saudi arabia", "kuwait", "qatar", "israel", "northern cyprus"];
const LANGUAGES = ["arabic", "english", "russian", "hebrew", "georgian", "turkish"];
const OFFERS = [
  "20% down payment", "down payment", "installments", "installment", "roi",
  "guaranteed income", "discount", "ready property", "off-plan", "off plan",
];
const INVESTMENT_ANGLES = [
  "luxury", "residence", "citizenship", "rental", "holiday home",
  "passive income", "sea view", "hotel apartment",
];
const PROPERTY_TERMS = [
  "apartment", "villa", "hotel apartment", "branded residence", "residence",
  "beachfront", "sea view", "marina", "yacht club", "artificial island",
];
const INVESTMENT_TERMS = [
  "investment", "roi", "rental income", "passive income",
  "guaranteed income", "capital growth",
];
const PAYMENT_TERMS = [
  "down payment", "installment", "discount", "cash", "financing", "payment plan",
];
const LUXURY_TERMS = [
  "luxury", "premium", "five star", "private beach", "spa", "concierge",
];
const BUYER_MOTIVATIONS = [
  "citizenship", "rental income", "passive income", "capital growth",
  "holiday home", "investment", "guaranteed income", "sea view", "luxury living",
];
const CTAS = [
  "learn more", "send message", "shop now", "contact us", "sign up",
  "book now", "get offer", "apply now",
];

const DICTIONARIES = {
  projects: PROJECTS,
  developers: DEVELOPERS,
  companies: COMPANIES,
  cities: CITIES,
  countries: COUNTRIES,
  languages: LANGUAGES,
  offers: OFFERS,
  investmentAngles: INVESTMENT_ANGLES,
  propertyTerms: PROPERTY_TERMS,
  investmentTerms: INVESTMENT_TERMS,
  paymentTerms: PAYMENT_TERMS,
  luxuryTerms: LUXURY_TERMS,
  buyerMotivations: BUYER_MOTIVATIONS,
  ctas: CTAS,
} as const;

type DictionaryKey = keyof typeof DICTIONARIES;

/** Case-insensitive substring match of a dictionary term inside normalized text. */
function textContainsTerm(normalizedText: string, term: string): boolean {
  return normalizedText.includes(term.toLowerCase());
}

/** Scans one piece of text against every dictionary category and returns the
 *  matched terms per category. Pure, read-only, no side effects. */
export function extractEntities(text: string): Record<DictionaryKey, string[]> {
  const normalized = (text || "").toLowerCase();
  const result = {} as Record<DictionaryKey, string[]>;
  for (const key of Object.keys(DICTIONARIES) as DictionaryKey[]) {
    result[key] = DICTIONARIES[key].filter((term) => textContainsTerm(normalized, term));
  }
  return result;
}

// ── Smart Search parser (Phase 2) ───────────────────────────────────────────
// Pure, deterministic, dictionary-based — no LLM call, no network call, no
// side effects. Only ever used to PRE-FILL the existing search form fields;
// it never triggers a search on its own.

export interface SmartSearchParseResult {
  project?: string;
  developer?: string;
  competitor?: string;
  city?: string;
  country?: string;
  language?: string;
  offer?: string;
  investmentAngle?: string;
  keyword?: string;
}

export function parseSmartSearch(query: string): SmartSearchParseResult {
  const normalized = (query || "").toLowerCase().trim();
  const result: SmartSearchParseResult = {};

  const firstMatch = (terms: string[]) => terms.find((t) => textContainsTerm(normalized, t));

  result.project = firstMatch(PROJECTS);
  result.developer = firstMatch(DEVELOPERS);
  result.competitor = firstMatch(COMPANIES);
  result.city = firstMatch(CITIES);
  result.country = firstMatch(COUNTRIES);
  result.language = firstMatch(LANGUAGES);
  result.offer = firstMatch(OFFERS);
  result.investmentAngle = firstMatch(INVESTMENT_ANGLES);

  const matchedAny = Object.values(result).some(Boolean);
  if (!matchedAny) {
    const tokens = stripStopWordsAndCtas(query);
    result.keyword = tokens.length > 0 ? tokens.join(" ") : query.trim();
  }

  return result;
}

/** Builds the single search-box term to feed into the existing, untouched
 *  search flow, from a Smart Search parse result. Pure string composition. */
export function smartSearchResultToTerm(parsed: SmartSearchParseResult): string {
  return (
    parsed.project || parsed.developer || parsed.competitor || parsed.city ||
    parsed.country || parsed.offer || parsed.investmentAngle || parsed.keyword || ""
  );
}

// ── Market Insights dashboard (Phase 4) ─────────────────────────────────────
// Reads ONLY from existing tables. No writes. No new tables. Replaces the
// raw "Top Keywords" word-frequency list with curated, entity-based counts.

interface CountedTerm {
  term: string;
  count: number;
}

function tallyDictionaryMatches(texts: string[], dictionary: readonly string[]): CountedTerm[] {
  const counts: Record<string, number> = {};
  for (const text of texts) {
    if (!text) continue;
    const normalized = text.toLowerCase();
    for (const term of dictionary) {
      if (textContainsTerm(normalized, term)) {
        counts[term] = (counts[term] || 0) + 1;
      }
    }
  }
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([term, count]) => ({ term, count }));
}

export interface MarketInsights {
  mostAdvertisedProjects: CountedTerm[];
  mostAdvertisedDevelopers: CountedTerm[];
  mostActiveCompetitors: CountedTerm[];
  mostAdvertisedCities: CountedTerm[];
  mostTargetedCountries: CountedTerm[];
  mostUsedLanguages: CountedTerm[];
  mostCommonOffers: CountedTerm[];
  mostCommonCtas: CountedTerm[];
  mostCommonInvestmentAngles: CountedTerm[];
  mostCommonPaymentPlans: CountedTerm[];
  mostCommonPropertyTypes: CountedTerm[];
  mostCommonLuxuryKeywords: CountedTerm[];
  mostCommonBuyerMotivations: CountedTerm[];
  sampleSize: number;
}

export async function getMarketInsights(): Promise<MarketInsights> {
  const adsRes = await pool.query(
    `SELECT ad_text, language FROM competitor_ads WHERE ad_text IS NOT NULL`,
  );
  const hooksRes = await pool.query(
    `SELECT hook, offer, positioning FROM competitor_ai_analysis`,
  );
  const competitorsRes = await pool.query(
    `SELECT p.page_name, COUNT(a.id) AS ad_count
     FROM competitor_profiles p
     LEFT JOIN competitor_ads a ON a.competitor_id = p.id
     GROUP BY p.page_name
     ORDER BY ad_count DESC
     LIMIT 15`,
  );

  const adTexts = adsRes.rows.map((r) => r.ad_text as string);
  const enrichedTexts = [
    ...adTexts,
    ...hooksRes.rows.map((r) => [r.hook, r.offer, r.positioning].filter(Boolean).join(" ")),
  ];

  const languageCounts: Record<string, number> = {};
  for (const row of adsRes.rows) {
    const lang = (row.language || "").trim();
    if (!lang) continue;
    languageCounts[lang] = (languageCounts[lang] || 0) + 1;
  }
  const mostUsedLanguages = Object.entries(languageCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([term, count]) => ({ term, count }));

  const mostActiveCompetitors = competitorsRes.rows
    .filter((r) => Number(r.ad_count) > 0)
    .map((r) => ({ term: r.page_name as string, count: Number(r.ad_count) }));

  return {
    mostAdvertisedProjects: tallyDictionaryMatches(enrichedTexts, PROJECTS),
    mostAdvertisedDevelopers: tallyDictionaryMatches(enrichedTexts, DEVELOPERS),
    mostActiveCompetitors,
    mostAdvertisedCities: tallyDictionaryMatches(enrichedTexts, CITIES),
    mostTargetedCountries: tallyDictionaryMatches(enrichedTexts, COUNTRIES),
    mostUsedLanguages,
    mostCommonOffers: tallyDictionaryMatches(enrichedTexts, OFFERS),
    mostCommonCtas: tallyDictionaryMatches(enrichedTexts, CTAS),
    mostCommonInvestmentAngles: tallyDictionaryMatches(enrichedTexts, INVESTMENT_ANGLES),
    mostCommonPaymentPlans: tallyDictionaryMatches(enrichedTexts, PAYMENT_TERMS),
    mostCommonPropertyTypes: tallyDictionaryMatches(enrichedTexts, PROPERTY_TERMS),
    mostCommonLuxuryKeywords: tallyDictionaryMatches(enrichedTexts, LUXURY_TERMS),
    mostCommonBuyerMotivations: tallyDictionaryMatches(enrichedTexts, BUYER_MOTIVATIONS),
    sampleSize: adTexts.length,
  };
}

// ── AI Market Analyst (Phase 7) ─────────────────────────────────────────────
// Strictly manual — only invoked by an explicit admin click on "Analyze
// Market". Reads only already-stored competitor data via getMarketInsights()
// plus top competitors/hooks (same tables the existing War Room already
// reads). Makes exactly one OpenAI call. No scraping. No Meta calls. No writes.

export interface MarketAnalystReport {
  risingCompetitors: string;
  projectFocus: string;
  commonOffers: string;
  overusedAngles: string;
  underusedAngles: string;
  unusedOpportunities: string;
  biggestThreat: string;
  dominantLanguage: string;
  dominantMarket: string;
  whatToLaunch: string;
  directorPlan: {
    campaignStrategy: string;
    creativeStrategy: string;
    audienceStrategy: string;
    offerStrategy: string;
    budgetSuggestion: string;
    expectedImpact: string;
    confidenceLevel: string;
  };
}

export async function analyzeMarket(): Promise<{ ok: true; report: MarketAnalystReport } | { ok: false; error: string }> {
  if (!openai) {
    return { ok: false, error: "AI Market Analyst is unavailable — OPENAI_API_KEY is not configured." };
  }

  const insights = await getMarketInsights();
  if (insights.sampleSize === 0) {
    return { ok: false, error: "No stored competitor data yet — run a search first." };
  }

  const hooksRes = await pool.query(
    `SELECT hook FROM competitor_ai_analysis WHERE hook IS NOT NULL AND hook <> '' LIMIT 20`,
  );
  const strongestHooks = hooksRes.rows.map((r) => r.hook as string);

  const summary = {
    mostActiveCompetitors: insights.mostActiveCompetitors.slice(0, 10),
    mostAdvertisedProjects: insights.mostAdvertisedProjects.slice(0, 10),
    mostAdvertisedDevelopers: insights.mostAdvertisedDevelopers.slice(0, 10),
    mostAdvertisedCities: insights.mostAdvertisedCities.slice(0, 10),
    mostTargetedCountries: insights.mostTargetedCountries.slice(0, 10),
    mostUsedLanguages: insights.mostUsedLanguages.slice(0, 10),
    mostCommonOffers: insights.mostCommonOffers.slice(0, 10),
    mostCommonInvestmentAngles: insights.mostCommonInvestmentAngles.slice(0, 10),
    mostCommonPaymentPlans: insights.mostCommonPaymentPlans.slice(0, 10),
    mostCommonLuxuryKeywords: insights.mostCommonLuxuryKeywords.slice(0, 10),
    strongestHooks: strongestHooks.slice(0, 10),
  };

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are Kinglike Luxury's AI Market Analyst for real estate competitor intelligence. " +
            "You are given ONLY aggregated, already-stored data about competitor ads (never raw scraping, never live data). " +
            "Respond ONLY with a JSON object with these exact keys: " +
            "risingCompetitors, projectFocus, commonOffers, overusedAngles, underusedAngles, unusedOpportunities, " +
            "biggestThreat, dominantLanguage, dominantMarket, whatToLaunch (each a concise 1-3 sentence answer), " +
            "and directorPlan (an object with keys: campaignStrategy, creativeStrategy, audienceStrategy, " +
            "offerStrategy, budgetSuggestion, expectedImpact, confidenceLevel — each a short, concrete recommendation). " +
            "The directorPlan section represents: \"If I were Kinglike Marketing Director, I would do the following this week.\"",
        },
        {
          role: "user",
          content: `Aggregated competitor market data (Kinglike Luxury real estate):\n${JSON.stringify(summary, null, 2)}`,
        },
      ],
    });

    const raw = completion.choices[0]?.message?.content;
    if (!raw) {
      return { ok: false, error: "AI Market Analyst returned an empty response." };
    }
    const parsed = JSON.parse(raw);
    const report: MarketAnalystReport = {
      risingCompetitors: parsed.risingCompetitors || "",
      projectFocus: parsed.projectFocus || "",
      commonOffers: parsed.commonOffers || "",
      overusedAngles: parsed.overusedAngles || "",
      underusedAngles: parsed.underusedAngles || "",
      unusedOpportunities: parsed.unusedOpportunities || "",
      biggestThreat: parsed.biggestThreat || "",
      dominantLanguage: parsed.dominantLanguage || "",
      dominantMarket: parsed.dominantMarket || "",
      whatToLaunch: parsed.whatToLaunch || "",
      directorPlan: {
        campaignStrategy: parsed.directorPlan?.campaignStrategy || "",
        creativeStrategy: parsed.directorPlan?.creativeStrategy || "",
        audienceStrategy: parsed.directorPlan?.audienceStrategy || "",
        offerStrategy: parsed.directorPlan?.offerStrategy || "",
        budgetSuggestion: parsed.directorPlan?.budgetSuggestion || "",
        expectedImpact: parsed.directorPlan?.expectedImpact || "",
        confidenceLevel: parsed.directorPlan?.confidenceLevel || "",
      },
    };
    return { ok: true, report };
  } catch (err: any) {
    console.error("[MarketIntelligence] AI Market Analyst failed:", err);
    return { ok: false, error: err.message || "AI Market Analyst failed" };
  }
}

// ── Search suggestion chips (Phase 3) ───────────────────────────────────────
// Pure static data — no DB read needed, no side effects. Exposed as a
// function (not a mutable export) to keep the module's public surface
// read-only/functional.

export function getSuggestionChips() {
  return {
    projects: ["Ambassadori", "Batumi Island", "Petra", "Silk Tower", "Swissotel"],
    cities: ["Batumi", "Tbilisi", "Gonio"],
    offers: ["20% Down Payment", "Installments", "ROI", "Guaranteed Income", "Sea View"],
    audiences: ["Investors", "Arabs in Israel", "Saudi Arabia", "Kuwait", "Qatar", "UAE"],
  };
}
