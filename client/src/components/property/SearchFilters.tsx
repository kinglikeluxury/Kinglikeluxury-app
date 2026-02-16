import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PROPERTY_TYPES } from "@shared/schema";
import { Label } from "@/components/ui/label";
import { Search, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

interface SearchFiltersProps {
  initialFilters?: {
    type?: string;
    location?: string;
    minPrice?: number;
    maxPrice?: number;
  };
}

const priceRangeOptions = [
  { value: "0-100000", label: "$0 - $100K", min: 0, max: 100000 },
  { value: "100000-200000", label: "$100K - $200K", min: 100000, max: 200000 },
  { value: "200000-500000", label: "$200K - $500K", min: 200000, max: 500000 },
  { value: "500000-1000000", label: "$500K - $1M", min: 500000, max: 1000000 },
  { value: "1000000+", label: "$1M+", min: 1000000, max: null as number | null },
];

const SearchFilters = ({ initialFilters }: SearchFiltersProps) => {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [propertyType, setPropertyType] = useState<string>(initialFilters?.type || "");
  const [location, setLocation] = useState<string>(initialFilters?.location || "");
  const [selectedPriceRanges, setSelectedPriceRanges] = useState<string[]>([]);
  const [priceDropdownOpen, setPriceDropdownOpen] = useState(false);
  const priceDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialFilters?.minPrice !== undefined || initialFilters?.maxPrice !== undefined) {
      const minP = initialFilters?.minPrice ?? 0;
      const maxP = initialFilters?.maxPrice ?? Infinity;
      const matching = priceRangeOptions.filter(o => {
        return o.min >= minP && (o.max === null ? true : o.max <= maxP);
      });
      if (matching.length > 0) {
        setSelectedPriceRanges(matching.map(m => m.value));
      }
    }
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (priceDropdownRef.current && !priceDropdownRef.current.contains(event.target as Node)) {
        setPriceDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const togglePriceRange = (value: string) => {
    setSelectedPriceRanges(prev =>
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const formatPrice = (p: number) =>
    p >= 1000000 ? `$${(p / 1000000).toFixed(1)}M` : p >= 1000 ? `$${(p / 1000).toFixed(0)}K` : `$${p}`;

  const getSelectedPriceSummary = () => {
    if (selectedPriceRanges.length === 0) return t('property.anyPrice', 'Any Price');
    const selected = priceRangeOptions.filter(o => selectedPriceRanges.includes(o.value));
    const allMins = selected.map(o => o.min);
    const allMaxes = selected.filter(o => o.max !== null).map(o => o.max as number);
    const hasUnlimited = selected.some(o => o.max === null);
    const minPrice = Math.min(...allMins);
    if (hasUnlimited) return `${formatPrice(minPrice)}+`;
    const maxPrice = Math.max(...allMaxes);
    return `${formatPrice(minPrice)} - ${formatPrice(maxPrice)}`;
  };

  const handleSearch = () => {
    const params = new URLSearchParams();
    
    if (propertyType && propertyType !== "all") {
      params.append("type", propertyType);
    }
    
    if (location && location !== "any") {
      params.append("location", location);
    }
    
    if (selectedPriceRanges.length > 0) {
      const selected = priceRangeOptions.filter(o => selectedPriceRanges.includes(o.value));
      const allMins = selected.map(o => o.min);
      const allMaxes = selected.filter(o => o.max !== null).map(o => o.max as number);
      const hasUnlimited = selected.some(o => o.max === null);
      const minPrice = Math.min(...allMins);
      if (minPrice > 0) params.append("minPrice", minPrice.toString());
      if (!hasUnlimited && allMaxes.length > 0) {
        params.append("maxPrice", Math.max(...allMaxes).toString());
      }
    }
    
    const url = `/properties?${params.toString()}`;
    window.history.pushState({}, '', url);
    window.dispatchEvent(new PopStateEvent('popstate'));
    navigate(url);
  };

  return (
    <>
      <Card className="w-full">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="property-type">{t('property.type', 'Property Type')}</Label>
              <Select value={propertyType} onValueChange={setPropertyType}>
                <SelectTrigger>
                  <SelectValue placeholder={t('common.all', 'All Types')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('common.all', 'All Types')}</SelectItem>
                  <SelectItem value={PROPERTY_TYPES.APARTMENT}>{t('propertyTypes.apartment', 'Apartments')}</SelectItem>
                  <SelectItem value={PROPERTY_TYPES.VILLA}>{t('propertyTypes.villa', 'Villas')}</SelectItem>
                  <SelectItem value={PROPERTY_TYPES.LAND}>{t('propertyTypes.land', 'Lands')}</SelectItem>
                  <SelectItem value={PROPERTY_TYPES.COMMERCIAL}>{t('propertyTypes.commercial', 'Commercial')}</SelectItem>
                  <SelectItem value={PROPERTY_TYPES.PROJECT}>{t('propertyTypes.project', 'Projects')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="location">{t('property.location', 'Location')}</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger>
                  <SelectValue placeholder={t('property.anyLocation', 'Any location')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t('property.anyLocation', 'Any location')}</SelectItem>
                  <SelectItem value="rustaveli-avenue">Rustaveli Avenue</SelectItem>
                  <SelectItem value="chavchavadze-avenue">Chavchavadze Avenue</SelectItem>
                  <SelectItem value="gogebashvili-street">Gogebashvili Street</SelectItem>
                  <SelectItem value="baratashvili-street">Baratashvili Street</SelectItem>
                  <SelectItem value="agmashenebeli-street">Agmashenebeli Street</SelectItem>
                  <SelectItem value="pushkin-street">Pushkin Street</SelectItem>
                  <SelectItem value="gorgiladze-street">Gorgiladze Street</SelectItem>
                  <SelectItem value="takaishvili-street">Takaishvili Street</SelectItem>
                  <SelectItem value="ninoshvili-street">Ninoshvili Street</SelectItem>
                  <SelectItem value="mazniashvili-street">Mazniashvili Street</SelectItem>
                  <SelectItem value="lermontov-street">Lermontov Street</SelectItem>
                  <SelectItem value="vazha-pshavela-avenue">Vazha-Pshavela Avenue</SelectItem>
                  <SelectItem value="aghmashenebeli-avenue">Aghmashenebeli Avenue</SelectItem>
                  <SelectItem value="sherif-khimshiashvili-street">Sherif Khimshiashvili Street</SelectItem>
                  <SelectItem value="grishashvili-street">Grishashvili Street</SelectItem>
                  <SelectItem value="kostava-street">Kostava Street</SelectItem>
                  <SelectItem value="parnavaz-mepe-street">Parnavaz Mepe Street</SelectItem>
                  <SelectItem value="zurab-gorgiladze-street">Zurab Gorgiladze Street</SelectItem>
                  <SelectItem value="batumi-boulevard">Batumi Boulevard</SelectItem>
                  <SelectItem value="europe-square">Europe Square</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="relative" ref={priceDropdownRef}>
              <Label>{t('property.priceRange', 'Price Range')}</Label>
              <button
                type="button"
                onClick={() => setPriceDropdownOpen(!priceDropdownOpen)}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <span className={selectedPriceRanges.length === 0 ? "text-muted-foreground" : "text-foreground truncate"}>
                  {getSelectedPriceSummary()}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50 shrink-0" />
              </button>
              {priceDropdownOpen && (
                <div className="absolute z-50 mt-1 w-full rounded-md border bg-white shadow-lg p-2">
                  {priceRangeOptions.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-100 cursor-pointer text-sm"
                    >
                      <Checkbox
                        checked={selectedPriceRanges.includes(option.value)}
                        onCheckedChange={() => togglePriceRange(option.value)}
                      />
                      <span>{option.label}</span>
                    </label>
                  ))}
                  {selectedPriceRanges.length > 0 && (
                    <div className="border-t mt-1 pt-1.5 px-2">
                      <div className="text-xs font-medium text-[#005476]">
                        {t('property.selectedRange', 'Selected')}: {getSelectedPriceSummary()}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            
            <div className="flex items-end">
              <Button className="w-full" onClick={handleSearch}>
                <Search className="mr-2 h-4 w-4" />
                {t('common.search', 'Search')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
      
    </>
  );
};

export default SearchFilters;
