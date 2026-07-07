import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Search, Loader2, ArrowRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export interface AiSearchResult {
  originalQuery: string;
  parsedTerm: string;
  parsedCountry?: string;
  intentSummary: string;
  confidence: string;
  isRealEstateQuery: boolean;
  searchCategories: string[];
  searchResult: any;
}

interface MarketIntelligenceSearchProps {
  onSearchComplete: (result: AiSearchResult) => void;
  isExternallyBusy?: boolean;
}

const EXAMPLE_QUERIES = [
  "Batumi Island", "Ambassadori", "Petra project", "Arabic campaigns",
  "ROI 10%", "Sea View luxury", "WhatsApp CTA", "Drone videos",
  "Israeli investors", "Guaranteed income", "36 month installments", "UAE buyers",
];

export function MarketIntelligenceSearch({ onSearchComplete, isExternallyBusy }: MarketIntelligenceSearchProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");

  const searchMutation = useMutation({
    mutationFn: async (q: string) => {
      const res = await apiRequest("POST", "/api/admin/competitor-intelligence/ai-search", { query: q });
      return res.json();
    },
    onSuccess: (json) => {
      if (!json.ok) {
        toast({ title: "Search failed", description: json.error || "Unknown error", variant: "destructive" });
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/competitors"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/war-room"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/competitor-intelligence/search-runs"] });
      onSearchComplete(json.data as AiSearchResult);
    },
    onError: (err: any) => {
      toast({ title: "Search error", description: err.message, variant: "destructive" });
    },
  });

  function handleSubmit(q: string) {
    const trimmed = q.trim();
    if (!trimmed) return;
    searchMutation.mutate(trimmed);
  }

  const isBusy = searchMutation.isPending || !!isExternallyBusy;

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => { e.preventDefault(); handleSubmit(query); }}
      >
        <div className="relative flex items-center group">
          {isBusy ? (
            <Loader2 className="absolute left-4 w-5 h-5 text-[#3bcac4] animate-spin z-10" />
          ) : (
            <Search className="absolute left-4 w-5 h-5 text-slate-400 group-focus-within:text-[#3bcac4] transition-colors z-10" />
          )}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search anything about the real estate market..."
            disabled={isBusy}
            className="w-full h-14 pl-12 pr-14 text-base bg-white/8 border border-white/15 rounded-2xl text-white placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-[#3bcac4]/40 focus:border-[#3bcac4]/50 transition-all disabled:opacity-60"
            data-testid="input-ai-search"
            autoComplete="off"
          />
          <button
            type="submit"
            disabled={isBusy || !query.trim()}
            className="absolute right-3 w-9 h-9 bg-gradient-to-r from-[#3bcac4] to-[#005476] rounded-xl flex items-center justify-center text-white transition-all hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed shadow-lg shadow-[#3bcac4]/20"
            data-testid="button-ai-search-submit"
          >
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </form>

      <div className="flex flex-wrap gap-2">
        {EXAMPLE_QUERIES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => { setQuery(ex); handleSubmit(ex); }}
            disabled={isBusy}
            className="text-xs px-3 py-1.5 rounded-full bg-white/6 border border-white/10 text-slate-400 hover:bg-white/12 hover:text-slate-200 hover:border-[#3bcac4]/40 transition-all disabled:opacity-40 cursor-pointer"
            data-testid={`chip-example-${ex.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}
