/**
 * English-only SEO slug utilities.
 * All blog post slugs must contain only ASCII letters, digits, and hyphens.
 */

/**
 * Transliteration map — covers Turkish, German, French, Spanish,
 * Scandinavian, Eastern-European and other common Latin-extended characters.
 */
const TRANSLITERATE: Record<string, string> = {
  // Turkish
  ü: "u", Ü: "u",
  ş: "s", Ş: "s",
  ğ: "g", Ğ: "g",
  ı: "i", İ: "i",
  ö: "o", Ö: "o",
  ç: "c", Ç: "c",
  // German / Nordic
  ä: "a", Ä: "a",
  å: "a", Å: "a",
  æ: "ae", Æ: "ae",
  ø: "o", Ø: "o",
  ß: "ss",
  // French / Spanish / Portuguese
  à: "a", â: "a", á: "a", ã: "a", ā: "a",
  À: "a", Â: "a", Á: "a", Ã: "a",
  é: "e", è: "e", ê: "e", ë: "e", ē: "e",
  É: "e", È: "e", Ê: "e", Ë: "e",
  î: "i", ï: "i", í: "i", ì: "i", ī: "i",
  Î: "i", Ï: "i", Í: "i", Ì: "i",
  ô: "o", ó: "o", õ: "o", ò: "o", ō: "o",
  Ô: "o", Ó: "o", Õ: "o", Ò: "o",
  ù: "u", û: "u", ú: "u", ū: "u",
  Ù: "u", Û: "u", Ú: "u",
  ý: "y", ÿ: "y", Ý: "y",
  ñ: "n", Ñ: "n",
  ć: "c", č: "c", ĉ: "c", Ć: "c", Č: "c",
  đ: "d", ď: "d", Đ: "d", Ď: "d",
  ě: "e", Ě: "e",
  ĝ: "g",
  ĥ: "h",
  ĵ: "j",
  ĺ: "l", ľ: "l", ļ: "l", ł: "l", Ł: "l",
  ń: "n", ň: "n", ņ: "n",
  ŕ: "r", ř: "r", Ř: "r",
  ś: "s", š: "s", ŝ: "s", Ś: "s", Š: "s",
  ţ: "t", ť: "t", Ţ: "t", Ť: "t",
  ű: "u", ů: "u", Ű: "u", Ů: "u",
  ź: "z", ż: "z", ž: "z", Ź: "z", Ż: "z", Ž: "z",
};

/** Apply transliteration: replace known special chars before stripping. */
function transliterate(text: string): string {
  return text
    .split("")
    .map((ch) => TRANSLITERATE[ch] ?? ch)
    .join("");
}

/** Returns true if the string contains any non-ASCII character. */
export function hasNonAscii(str: string): boolean {
  return /[^\x00-\x7F]/.test(str);
}

/**
 * Words that add no SEO value and should be stripped from slugs.
 * "in", "at", "on" are intentionally kept — they add location context
 * (e.g. "real-estate-in-georgia" is better SEO than "real-estate-georgia").
 */
const STOP_WORDS = new Set([
  // Articles
  "a", "an", "the",
  // Conjunctions
  "and", "or", "but",
  // Filler prepositions (keep "in", "on", "at" for location value)
  "to", "for", "of", "with", "by", "through", "from", "into", "about",
  // Pronouns
  "i", "you", "we", "he", "she", "it", "they", "them",
  "your", "my", "our", "its",
  // Question / intro words
  "how", "why", "what", "when", "where", "which", "who",
  // Auxiliary verbs
  "is", "are", "was", "were", "can", "do", "does",
  // Filler action verbs
  "need", "know", "get", "make", "buy", "change",
  // Vague superlatives / quantifiers
  "most", "least",
  "everything", "something", "anything", "nothing",
  "all", "any", "some",
  "very", "just", "only", "also", "even",
  // Time fillers
  "today", "now",
  // Demonstratives
  "this", "that", "these", "those",
  // Common English filler words found in blog titles
  "considered", "thanks",
]);

/**
 * Target countries Kinglike Luxury operates in.
 * When a title mentions one of these, its canonical slug keyword is guaranteed
 * to appear in the generated slug (appended at the end if not already present).
 */
const COUNTRY_KEYWORDS: Record<string, string> = {
  georgia:      "georgia",
  georgian:     "georgia",
  tbilisi:      "georgia",
  batumi:       "georgia",
  turkey:       "turkey",
  turkiye:      "turkey",
  turkish:      "turkey",
  istanbul:     "turkey",
  ankara:       "turkey",
  uae:          "uae",
  dubai:        "uae",
  "abu dhabi":  "uae",
  emirates:     "uae",
  cyprus:       "north-cyprus",
  "north cyprus": "north-cyprus",
};

/**
 * Detect the target country in a normalised word list.
 * Returns the canonical country slug keyword or null.
 */
function detectCountry(words: string[]): string | null {
  const sentence = words.join(" ");
  // Check two-word phrases first
  for (const [phrase, canonical] of Object.entries(COUNTRY_KEYWORDS)) {
    if (phrase.includes(" ") && sentence.includes(phrase)) return canonical;
  }
  for (const word of words) {
    if (COUNTRY_KEYWORDS[word]) return COUNTRY_KEYWORDS[word];
  }
  return null;
}

/**
 * Maximum slug length (characters). Slugs are never cut mid-word.
 * Google treats the first ~60-70 chars as most significant; beyond ~80
 * extra words dilute keyword relevance.
 */
const MAX_SLUG_LENGTH = 72;

/**
 * Converts a string to a clean, SEO-optimised ASCII slug:
 * 1. Transliterates special Latin characters.
 * 2. Removes stop words (filler words with no SEO value).
 * 3. Removes duplicate words (preserves first occurrence).
 * 4. Ensures target country keyword appears if title mentions one.
 * 5. Truncates at a whole-word boundary at ≤ MAX_SLUG_LENGTH characters.
 */
export function toEnglishSlug(text: string): string {
  if (!text) return "";

  // Step 1: transliterate, lowercase, collapse to plain words
  const normalized = transliterate(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const allWords = normalized.split(" ").filter((w) => w.length > 0);

  // Step 2: detect country before stop-word removal (stop words may strip location context)
  const country = detectCountry(allWords);

  // Step 3: remove stop words; fall back to all words if result too short
  const filtered = allWords.filter((w) => !STOP_WORDS.has(w));
  const baseWords = filtered.length >= 3 ? filtered : allWords;

  // Step 4: remove duplicate words (keep first occurrence)
  const seen = new Set<string>();
  const deduped = baseWords.filter((w) => {
    if (seen.has(w)) return false;
    seen.add(w);
    return true;
  });

  // Step 5: accumulate words up to MAX_SLUG_LENGTH — never cut mid-word
  const parts: string[] = [];
  let len = 0;
  for (const word of deduped) {
    const addition = (len === 0 ? 0 : 1) + word.length;
    if (len > 0 && len + addition > MAX_SLUG_LENGTH) break;
    parts.push(word);
    len += addition;
  }

  // Guarantee at least one word even if the first word alone exceeds the limit
  if (parts.length === 0 && deduped.length > 0) parts.push(deduped[0]);

  // Step 6: ensure country keyword is present (append only if truncation dropped it)
  if (country) {
    const countryParts = country.split("-");
    const slugHasCountry = countryParts.every((cp) => parts.includes(cp));
    if (!slugHasCountry) {
      // Try to append; if it exceeds limit, it still gets added (country > keyword dilution)
      for (const cp of countryParts) {
        if (!parts.includes(cp)) parts.push(cp);
      }
    }
  }

  return parts.join("-");
}

/**
 * Generates the best English slug for a post title.
 * - If enTitle (English translation) is provided, always prefer it.
 * - Otherwise, if the title is already ASCII-safe, slugify it directly.
 * - If title is non-ASCII and no English translation is available,
 *   returns "" — the caller must use a timestamp fallback.
 */
export function generateEnglishSlug(title: string, enTitle?: string | null): string {
  const source = enTitle || (!hasNonAscii(title) ? title : "");
  return toEnglishSlug(source);
}

/** Generates a unique timestamp-based fallback slug. */
export function timestampSlug(): string {
  return `post-${Date.now()}`;
}
