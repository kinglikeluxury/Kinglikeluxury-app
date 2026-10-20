export const AI_BLOG_MARKETS = [
  { country: "georgia", label: "جورجيا", flag: "🇬🇪" },
  { country: "turkey", label: "تركيا", flag: "🇹🇷" },
  { country: "syria", label: "سوريا", flag: "🇸🇾" },
  { country: "azerbaijan", label: "أذربيجان — باكو فقط", flag: "🇦🇿" },
  { country: "northern-cyprus", label: "شمال قبرص", flag: "🇨🇾" },
] as const;

export type AiDraftStatus =
  | "waiting" | "needs_verification" | "ready_for_review"
  | "rejected" | "published" | "failed";

export function isAllowedAiBlogMarket(country: string): boolean {
  return AI_BLOG_MARKETS.some((market) => market.country === country);
}

export function getAiBlogProviderReadiness(env: NodeJS.ProcessEnv = process.env) {
  const researchReady = Boolean(env.TAVILY_API_KEY || env.SERPAPI_API_KEY);
  const textReady = Boolean(env.OPENAI_API_KEY);
  const imageReady = Boolean(env.OPENAI_API_KEY && env.CLOUDINARY_CLOUD_NAME);
  return {
    // No provider adapters or scheduler runner are wired yet. Environment flags
    // alone must never make the UI claim the feature can run.
    generationEnabled: false,
    schedulerEnabled: false,
    researchReady,
    textReady,
    imageReady,
    reason: "التوليد والبحث والصور والجدولة معطلة؛ لم تُوصل خدمات التنفيذ بعد ويلزم اعتماد التكلفة أولاً.",
  };
}

export function isPublishableAiDraft(draft: {
  status: string; title: string; content: string; slug: string; coverImage: string;
  sources?: Array<{ url?: string }>;
}): boolean {
  let imageIsSafe = false;
  try {
    const imageUrl = new URL(draft.coverImage);
    imageIsSafe = imageUrl.protocol === "https:" && imageUrl.hostname === "res.cloudinary.com";
  } catch { /* invalid URL remains non-publishable */ }
  const hasSource = Boolean(draft.sources?.some(source => {
    try { return new URL(source.url || "").protocol === "https:"; }
    catch { return false; }
  }));
  return draft.status === "ready_for_review" && imageIsSafe && hasSource &&
    Boolean(draft.title.trim() && draft.content.trim() && draft.slug.trim());
}

export function normalizeAiDraftUpdate(input: Record<string, unknown>) {
  const allowedStatuses = new Set<AiDraftStatus>([
    "needs_verification", "ready_for_review", "rejected",
  ]);
  const status = typeof input.status === "string" && allowedStatuses.has(input.status as AiDraftStatus)
    ? input.status as AiDraftStatus
    : undefined;
  const sources = Array.isArray(input.sources)
    ? input.sources.slice(0, 30).filter((item: any) =>
      item && typeof item.url === "string" && /^https?:\/\//i.test(item.url) &&
      typeof item.title === "string" && typeof item.accessedAt === "string")
    : undefined;
  return {
    title: typeof input.title === "string" ? input.title.slice(0, 300) : undefined,
    content: typeof input.content === "string" ? input.content.slice(0, 100_000) : undefined,
    keywords: Array.isArray(input.keywords)
      ? input.keywords.filter((v): v is string => typeof v === "string").slice(0, 30)
      : undefined,
    seo_description: typeof input.seoDescription === "string" ? input.seoDescription.slice(0, 500) : undefined,
    slug: typeof input.slug === "string" ? input.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 160) : undefined,
    cover_image: typeof input.coverImage === "string" ? input.coverImage.slice(0, 2000) : undefined,
    sources,
    review_note: typeof input.reviewNote === "string" ? input.reviewNote.slice(0, 2000) : undefined,
    status,
  };
}
