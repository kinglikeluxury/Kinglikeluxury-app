import translate from "google-translate-api-x";

const SUPPORTED_LANGS: Record<string, string> = {
  en: "en",
  ar: "ar",
  fa: "fa",
  he: "iw",
  ru: "ru",
  ka: "ka",
  az: "az",
  tr: "tr",
  zh: "zh-CN",
  pl: "pl",
  it: "it",
  nl: "nl",
  de: "de",
  sv: "sv",
  fr: "fr",
};

/** Five primary SEO languages that are always generated and stored. */
export const PRIMARY_SEO_LANGS = ["ar", "en", "tr", "he", "ru"] as const;

/** All supported languages (primary + secondary). */
export const ALL_SUPPORTED_LANGS = Object.keys(SUPPORTED_LANGS);

/** Per-language translation data stored in the `translations` JSON column. */
export type BlogTranslationData = {
  title: string;
  content: string;
  excerpt: string;
  /** Generated SEO fields — undefined on legacy rows that pre-date this feature. */
  metaDescription?: string;
  keywords?: string;
  ogTitle?: string;
  ogDescription?: string;
  twitterTitle?: string;
  twitterDescription?: string;
  /** "original" = source language, "generated" = AI translated, "pending_translation" = failed */
  translationStatus?: "original" | "generated" | "pending_translation";
};

export async function translateText(text: string, targetLang: string, sourceLang?: string): Promise<string> {
  const googleTargetLang = SUPPORTED_LANGS[targetLang];
  if (!googleTargetLang) return text;

  try {
    const options: any = { to: googleTargetLang };
    if (sourceLang) {
      const googleSourceLang = SUPPORTED_LANGS[sourceLang];
      if (googleSourceLang) options.from = googleSourceLang;
    }
    const result = await translate(text, options);
    return result.text;
  } catch (error) {
    console.error(`Translation error for lang ${targetLang}:`, error);
    return text;
  }
}

export async function detectLanguage(text: string): Promise<string> {
  try {
    const result = await translate(text, { to: "en" });
    const detectedLang = result.from?.language?.iso;
    if (detectedLang) {
      const mapped = Object.entries(SUPPORTED_LANGS).find(([_, gLang]) => gLang === detectedLang || detectedLang === _);
      if (mapped) return mapped[0];
      if (detectedLang === "iw") return "he";
      if (detectedLang === "zh-CN" || detectedLang === "zh-TW") return "zh";
    }
    return "en";
  } catch (error) {
    console.error("Language detection error:", error);
    return "en";
  }
}

/**
 * Builds SEO metadata fields from a translated title and excerpt.
 * Uses only the content already translated — no extra API calls.
 */
export function buildSeoFields(title: string, excerpt: string): Omit<BlogTranslationData, "title" | "content" | "excerpt" | "translationStatus"> {
  // Strip emoji and extra whitespace
  const cleanTitle = title.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, "").replace(/\s+/g, " ").trim();
  const cleanExcerpt = excerpt.replace(/\s+/g, " ").replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, "").trim();

  // Meta description: first 155 chars of excerpt
  const metaDescription = cleanExcerpt.length > 155
    ? cleanExcerpt.substring(0, 152) + "..."
    : cleanExcerpt || cleanTitle;

  // Keywords: meaningful words from title (3+ chars, non-numeric), max 10
  const stopSet = new Set(["the","and","for","with","from","this","that","are","was","were","have","has","had","will","would","not","but","its","their","they","them","who","which","what","how","when","where","why"]);
  const keywords = cleanTitle
    .split(/[\s,،،]+/)
    .filter((w) => w.length >= 3 && !/^\d+$/.test(w) && !stopSet.has(w.toLowerCase()))
    .slice(0, 10)
    .join(", ");

  return {
    metaDescription,
    keywords: keywords || cleanTitle,
    ogTitle: cleanTitle || title,
    ogDescription: metaDescription,
    twitterTitle: cleanTitle || title,
    twitterDescription: metaDescription,
  };
}

/**
 * Translates a blog post into all supported languages and generates SEO fields.
 * Returns a map of lang → full BlogTranslationData including SEO metadata.
 * The source language gets status "original"; translated languages get "generated";
 * any failed language gets status "pending_translation" with original-language fallback text.
 */
export async function translateBlogPost(
  title: string,
  content: string,
  excerpt: string
): Promise<Record<string, BlogTranslationData>> {
  const translations: Record<string, BlogTranslationData> = {};

  const detectedLang = await detectLanguage(title + " " + content.substring(0, 200));
  console.log(`[Blog SEO] Detected source language: ${detectedLang}`);

  const allLangs = ALL_SUPPORTED_LANGS;

  for (const lang of allLangs) {
    if (lang === detectedLang) {
      // Original language — store as-is with "original" status
      translations[lang] = {
        title,
        content,
        excerpt,
        ...buildSeoFields(title, excerpt),
        translationStatus: "original",
      };
      continue;
    }

    try {
      const [translatedTitle, translatedContent, translatedExcerpt] = await Promise.all([
        translateText(title, lang, detectedLang),
        translateText(content, lang, detectedLang),
        translateText(excerpt, lang, detectedLang),
      ]);

      translations[lang] = {
        title: translatedTitle,
        content: translatedContent,
        excerpt: translatedExcerpt,
        ...buildSeoFields(translatedTitle, translatedExcerpt),
        translationStatus: "generated",
      };
    } catch (error) {
      console.error(`[Blog SEO] Failed to translate to ${lang}:`, error);
      translations[lang] = {
        title,
        content,
        excerpt,
        ...buildSeoFields(title, excerpt),
        translationStatus: "pending_translation",
      };
    }
  }

  return translations;
}

/**
 * Generates (or regenerates) only the SEO fields for existing translations
 * without re-translating content. Safe to run on existing posts.
 */
export function enrichTranslationsWithSeo(
  existing: Record<string, any>
): Record<string, BlogTranslationData> {
  const enriched: Record<string, BlogTranslationData> = {};
  for (const [lang, data] of Object.entries(existing)) {
    if (!data || typeof data !== "object") continue;
    const hasSeo = data.metaDescription || data.ogTitle;
    enriched[lang] = hasSeo
      ? data
      : {
          ...data,
          ...buildSeoFields(data.title || "", data.excerpt || ""),
          translationStatus: data.translationStatus ?? "generated",
        };
  }
  return enriched;
}
