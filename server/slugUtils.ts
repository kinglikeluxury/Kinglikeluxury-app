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
  ĝ: "g", ğ: "g",
  ĥ: "h",
  ĵ: "j",
  ĺ: "l", ľ: "l", ļ: "l", ł: "l", Ł: "l",
  ń: "n", ň: "n", ņ: "n",
  ŕ: "r", ř: "r", Ř: "r",
  ś: "s", š: "s", ŝ: "s", ş: "s", Ś: "s", Š: "s",
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
 * Converts a string to a clean URL-safe ASCII slug.
 * Special Latin characters are transliterated; all remaining
 * non-ASCII characters (Arabic, CJK, etc.) are stripped.
 */
export function toEnglishSlug(text: string): string {
  if (!text) return "";
  return transliterate(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 80);
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
