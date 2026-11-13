export const BLOG_COUNTRY_OPTIONS = [
  { value: "georgia", flag: "🇬🇪", translationKey: "countries.georgia", fallback: "Georgia" },
  { value: "uae", flag: "🇦🇪", translationKey: "countries.uae", fallback: "UAE" },
  { value: "turkey", flag: "🇹🇷", translationKey: "countries.turkey", fallback: "Turkey" },
  { value: "northern-cyprus", flag: "🇨🇾", translationKey: "countries.northernCyprus", fallback: "N. Cyprus" },
  { value: "azerbaijan", flag: "🇦🇿", translationKey: "countries.azerbaijan", fallback: "Azerbaijan" },
] as const;

export function getBlogCountryOption(country: string | null | undefined) {
  return BLOG_COUNTRY_OPTIONS.find((option) => option.value === country) ?? BLOG_COUNTRY_OPTIONS[0];
}

export function filterBlogPostsByCountry<T extends { country?: string | null }>(
  posts: T[],
  country: string | undefined,
): T[] {
  return !country || country === "all"
    ? posts
    : posts.filter((post) => post.country === country);
}
