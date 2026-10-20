/**
 * Provider boundaries for the future editorial pipeline.
 * Intentionally contains no SDK clients or network calls: service activation,
 * source search, text generation, image generation, and Cloudinary upload need
 * a separate cost approval and an explicitly enabled implementation.
 */
export type VerifiedSource = { url: string; title: string; accessedAt: string; excerpt: string };
export type ArabicArticleRequest = { country: string; topic: string; sources: VerifiedSource[] };
export type ArabicArticleDraft = {
  country: string;
  title: string;
  content: string;
  keywords: string[];
  seoDescription: string;
  slug: string;
  suggestedImage: string;
  sources: VerifiedSource[];
};
export type GeneratedCover = { bytes: Uint8Array; mimeType: "image/jpeg" | "image/png" | "image/webp"; width: number; height: number };

export interface PropertyResearchProvider {
  search(request: { country: string; query: string }): Promise<VerifiedSource[]>;
}
export interface ArabicArticleProvider {
  write(request: ArabicArticleRequest): Promise<ArabicArticleDraft>;
}
export interface ArticleCoverProvider {
  generate(request: { country: string; topic: string }): Promise<GeneratedCover>;
}
export interface PersistentCoverStorage {
  upload(cover: GeneratedCover): Promise<{ url: string }>;
}

export function validateGeneratedCover(cover: GeneratedCover): boolean {
  return cover.width === 1200 && cover.height === 630 &&
    ["image/jpeg", "image/png", "image/webp"].includes(cover.mimeType) &&
    cover.bytes.byteLength < 10 * 1024 * 1024;
}
