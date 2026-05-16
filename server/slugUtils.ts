/**
 * English-only SEO slug utilities.
 * All blog post slugs must contain only ASCII letters, digits, and hyphens.
 */

/** Returns true if the string contains any non-ASCII character. */
export function hasNonAscii(str: string): boolean {
  return /[^\x00-\x7F]/.test(str);
}

/**
 * Converts an English (ASCII) string to a URL-safe slug.
 * Non-ASCII input returns an empty string.
 */
export function toEnglishSlug(text: string): string {
  if (!text) return "";
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 80);
}

/**
 * Generates the best English slug for a post title.
 * - If enTitle (English translation) is provided, always use it.
 * - Otherwise, if the title is already ASCII, slugify it.
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
