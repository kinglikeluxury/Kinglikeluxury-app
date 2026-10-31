export type AiBlogPreviewInput = {
  title?: unknown;
  content?: unknown;
  cover_image?: unknown;
  seo_description?: unknown;
  keywords?: unknown;
  slug?: unknown;
  sources?: unknown;
};

export type AiBlogPreviewSource = {
  title: string | null;
  url: string | null;
  accessedAt: string | null;
};

export type AiBlogPreviewModel = {
  title: string | null;
  contentBlocks: Array<{ kind: "heading" | "paragraph" | "listItem" | "quote"; text: string }>;
  coverImage: string | null;
  seoDescription: string | null;
  keywords: string[];
  slug: string | null;
  sources: AiBlogPreviewSource[];
};

function safeHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_match, decimal: string) => {
      const codePoint = Number(decimal);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const codePoint = Number.parseInt(hex, 16);
      return codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : "";
    });
}

function toPlainText(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();
}

export function toSafePreviewBlocks(value: unknown): AiBlogPreviewModel["contentBlocks"] {
  if (typeof value !== "string" || !value.trim()) return [];
  const safeInput = value.replace(/<(script|style|iframe|object|svg)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
  const blockPattern = /<(h[1-6]|p|li|blockquote)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi;
  const blocks: AiBlogPreviewModel["contentBlocks"] = [];
  for (const match of Array.from(safeInput.matchAll(blockPattern))) {
    const tag = match[1].toLowerCase();
    const text = toPlainText(match[2]);
    if (!text) continue;
    const kind = tag[0] === "h" ? "heading" : tag === "li" ? "listItem" : tag === "blockquote" ? "quote" : "paragraph";
    blocks.push({ kind, text });
  }
  if (blocks.length) return blocks;

  return safeInput
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(?:div|section|article)\s*>/gi, "\n")
    .split(/\n+/)
    .map(toPlainText)
    .filter(Boolean)
    .map((text) => ({ kind: "paragraph" as const, text }));
}

export function buildAiBlogDraftPreview(input: AiBlogPreviewInput): AiBlogPreviewModel {
  const rawSources = Array.isArray(input.sources) ? input.sources : [];
  const sources = rawSources
    .filter((source): source is Record<string, unknown> => Boolean(source) && typeof source === "object")
    .filter((source) => source.kind !== "cover_image")
    .map((source) => ({
      title: typeof source.title === "string" && source.title.trim() ? source.title.trim() : null,
      url: safeHttpsUrl(source.url),
      accessedAt: typeof source.accessedAt === "string" && source.accessedAt.trim() ? source.accessedAt.trim() : null,
    }));

  return {
    title: typeof input.title === "string" && input.title.trim() ? input.title.trim() : null,
    contentBlocks: toSafePreviewBlocks(input.content),
    coverImage: safeHttpsUrl(input.cover_image),
    seoDescription: typeof input.seo_description === "string" && input.seo_description.trim()
      ? input.seo_description.trim()
      : null,
    keywords: Array.isArray(input.keywords)
      ? input.keywords.filter((keyword): keyword is string => typeof keyword === "string" && Boolean(keyword.trim())).map((keyword) => keyword.trim())
      : [],
    slug: typeof input.slug === "string" && input.slug.trim() ? input.slug.trim() : null,
    sources,
  };
}
