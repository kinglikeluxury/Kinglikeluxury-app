import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Search, Loader2, Wand2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

// Search Type selector — purely a UX label for what the admin is searching
// for. It never changes the request shape sent to the existing, untouched
// POST /api/admin/competitor-intelligence/search route (term + country) —
// it only changes the input placeholder / helper copy shown to the admin.
const SEARCH_MODES = [
  { key: "project", label: "Project", examples: "Ambassadori, Batumi Island, Petra, Silk Tower, Swissotel, Rotana" },
  { key: "developer", label: "Developer", examples: "Ambassadori, Silk, Alliance, Archi, Orbi, Emaar" },
  { key: "company", label: "Competitor Company", examples: "Kinglike Luxury, Nino Investment, M.A Real Estate, Point" },
  { key: "city", label: "City", examples: "Batumi, Tbilisi, Gonio, Kobuleti, Sarpi" },
  { key: "country", label: "Country", examples: "Georgia, Turkey, UAE, Northern Cyprus" },
  { key: "language", label: "Language", examples: "Arabic, English, Russian, Hebrew, Georgian, Turkish" },
  { key: "offer", label: "Offer", examples: "20% Down Payment, Installments, ROI, Guaranteed Income, Discount" },
  { key: "angle", label: "Investment Angle", examples: "Luxury, Residence, Citizenship, Rental, Holiday Home, Sea View" },
  { key: "keyword", label: "Free Keyword", examples: "Any custom keyword or competitor name" },
  { key: "smart", label: "Smart Search", examples: "Describe what you want in plain language" },
] as const;

type SearchModeKey = typeof SEARCH_MODES[number]["key"];

interface SmartSearchParseResult {
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

interface SuggestionChips {
  projects: string[];
  cities: string[];
  offers: string[];
  audiences: string[];
}

// Local, dependency-free mirror of the server-side dictionary matcher used
// only to preview what Smart Search *would* fill in — this never calls the
// network and never triggers a search by itself. The authoritative parse
// still happens if/when the admin wires this into a real search (below we
// simply fill the existing search box; no separate parse endpoint needed).
function localSmartSearchPreview(query: string): SmartSearchParseResult {
  const q = query.toLowerCase();
  const dict = {
    project: ["ambassadori", "batumi island", "petra", "silk tower", "rotana", "swissotel"],
    developer: ["silk", "alliance", "archi", "orbi", "emaar"],
    competitor: ["nino investment", "kinglike luxury", "m.a real estate", "point"],
    city: ["batumi", "tbilisi", "gonio", "kobuleti", "sarpi"],
    country: ["georgia", "turkey", "uae", "saudi arabia", "kuwait", "qatar", "israel", "northern cyprus"],
    language: ["arabic", "english", "russian", "hebrew", "georgian", "turkish"],
    offer: ["20% down payment", "down payment", "installments", "roi", "guaranteed income", "discount", "ready property", "off-plan"],
    investmentAngle: ["luxury", "residence", "citizenship", "rental", "holiday home", "passive income", "sea view", "hotel apartment"],
  };
  const result: SmartSearchParseResult = {};
  for (const [key, terms] of Object.entries(dict)) {
    const hit = terms.find((t) => q.includes(t));
    if (hit) (result as any)[key] = hit;
  }
  if (!Object.values(result).some(Boolean)) {
    result.keyword = query.trim();
  }
  return result;
}

interface MarketIntelligenceSearchProps {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  country: string;
  setCountry: (value: string) => void;
  onSubmit: () => void;
  isSearching: boolean;
  lastResult: any | null;
}

export function MarketIntelligenceSearch({
  searchTerm, setSearchTerm, country, setCountry, onSubmit, isSearching, lastResult,
}: MarketIntelligenceSearchProps) {
  const [mode, setMode] = useState<SearchModeKey>("keyword");
  const [smartQuery, setSmartQuery] = useState("");
  const [smartPreview, setSmartPreview] = useState<SmartSearchParseResult | null>(null);

  const chipsQuery = useQuery<SuggestionChips>({
    queryKey: ["/api/admin/competitor-intelligence/market-insights", "chips"],
    queryFn: async () => {
      // Chips are static/local — no network call needed, but we still keep
      // this as a query for consistent loading semantics if a future admin
      // wants to move the list server-side without touching this component.
      return {
        projects: ["Ambassadori", "Batumi Island", "Petra", "Silk Tower", "Swissotel"],
        cities: ["Batumi", "Tbilisi", "Gonio"],
        offers: ["20% Down Payment", "Installments", "ROI", "Guaranteed Income", "Sea View"],
        audiences: ["Investors", "Arabs in Israel", "Saudi Arabia", "Kuwait", "Qatar", "UAE"],
      };
    },
    staleTime: Infinity,
  });

  const activeMode = SEARCH_MODES.find((m) => m.key === mode)!;

  // Suggestion chips only ever fill the input — they never call onSubmit().
  function fillChip(value: string) {
    if (mode === "smart") {
      setSmartQuery(value);
      setSmartPreview(null);
    } else {
      setSearchTerm(value);
    }
  }

  function handleSmartQueryChange(value: string) {
    setSmartQuery(value);
    // Parsing runs live as the admin types, purely to show a live preview.
    // It never fills the real search box and never triggers a search.
    setSmartPreview(value.trim() ? localSmartSearchPreview(value) : null);
  }

  // Applying the Smart Search preview only copies the parsed term into the
  // existing search field — it does not run a search by itself.
  function applySmartPreview() {
    if (!smartPreview) return;
    const term =
      smartPreview.project || smartPreview.developer || smartPreview.competitor ||
      smartPreview.city || smartPreview.country || smartPreview.offer ||
      smartPreview.investmentAngle || smartPreview.keyword || smartQuery;
    setSearchTerm(term);
    if (smartPreview.country) setCountry(smartPreview.country);
  }

  const chips = chipsQuery.data;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Search className="w-4 h-4 text-[#3bcac4]" /> Real Estate Market Intelligence Search
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Search Type selector */}
        <div className="flex gap-1.5 flex-wrap">
          {SEARCH_MODES.map((m) => (
            <button
              key={m.key}
              type="button"
              onClick={() => setMode(m.key)}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                mode === m.key
                  ? "bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white border-transparent"
                  : "bg-white text-slate-600 border-slate-200 hover:border-[#3bcac4]"
              }`}
              data-testid={`button-search-mode-${m.key}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-400">e.g. {activeMode.examples}</p>

        {mode === "smart" ? (
          <div className="space-y-2">
            <div className="flex flex-col sm:flex-row gap-3">
              <Input
                placeholder='e.g. "Show Arabic ads for Batumi" or "Show ads mentioning 20% down payment"'
                value={smartQuery}
                onChange={(e) => handleSmartQueryChange(e.target.value)}
                className="flex-1"
                data-testid="input-smart-search"
              />
              <Button
                type="button"
                variant="outline"
                onClick={applySmartPreview}
                disabled={!smartPreview}
                data-testid="button-apply-smart-search"
              >
                <Wand2 className="w-4 h-4 mr-2" /> Fill search box
              </Button>
            </div>
            {smartPreview && (
              <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-2 flex flex-wrap gap-2">
                <span className="font-semibold text-slate-600">Parsed as:</span>
                {Object.entries(smartPreview).filter(([, v]) => v).map(([k, v]) => (
                  <Badge key={k} variant="outline" className="bg-white">{k}: {v as string}</Badge>
                ))}
              </div>
            )}
            <p className="text-[11px] text-slate-400">
              Smart Search only fills the search box below — it never runs a search by itself. Review, then click Search.
            </p>
          </div>
        ) : null}

        <form
          className="flex flex-col sm:flex-row gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          <Input
            placeholder={mode === "smart" ? 'Search term (filled from Smart Search above, or type your own)' : `Search for a ${activeMode.label.toLowerCase()}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="flex-1"
            data-testid="input-search-term"
          />
          <Input
            placeholder="Country code (optional, e.g. GE)"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="sm:w-52"
            data-testid="input-country"
          />
          <Button
            type="submit"
            disabled={isSearching}
            className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white hover:opacity-90"
            data-testid="button-run-search"
          >
            {isSearching ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
            Search
          </Button>
        </form>

        {/* Suggestion chips — clicking only fills the relevant input, never runs a search */}
        {chips && (
          <div className="space-y-2 pt-2 border-t">
            <ChipRow label="Projects" items={chips.projects} onPick={fillChip} />
            <ChipRow label="Cities" items={chips.cities} onPick={fillChip} />
            <ChipRow label="Offers" items={chips.offers} onPick={fillChip} />
            <ChipRow label="Audiences / Markets" items={chips.audiences} onPick={fillChip} />
          </div>
        )}

        {lastResult && (
          <div className="mt-2 text-sm p-3 rounded-lg border bg-slate-50">
            <span className="font-medium">Last run:</span> "{lastResult.term}" — {lastResult.success ? "success" : "failed"}
            {lastResult.blocked ? " (blocked page detected)" : ""}, {lastResult.attempts} attempt(s), {lastResult.ads?.length ?? 0} ad(s) found
            {lastResult.error ? `, error: ${lastResult.error}` : ""}.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ChipRow({ label, items, onPick }: { label: string; items: string[]; onPick: (value: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div>
      <div className="text-[10px] font-semibold text-slate-400 uppercase mb-1">{label}</div>
      <div className="flex gap-1.5 flex-wrap">
        {items.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => onPick(item)}
            className="text-xs px-2.5 py-1 rounded-full border border-slate-200 bg-white text-slate-600 hover:border-[#3bcac4] hover:text-[#005476] transition-colors"
            data-testid={`chip-${item.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}
