export const AI_BLOG_MARKETS = [
  { country: "georgia", label: "جورجيا", flag: "🇬🇪" },
  { country: "turkey", label: "تركيا", flag: "🇹🇷" },
  { country: "syria", label: "سوريا", flag: "🇸🇾" },
  { country: "azerbaijan", label: "أذربيجان — باكو فقط", flag: "🇦🇿" },
  { country: "northern-cyprus", label: "شمال قبرص", flag: "🇨🇾" },
] as const;

export function isAllowedAiBlogMarket(country: string): boolean {
  return AI_BLOG_MARKETS.some((market) => market.country === country);
}
