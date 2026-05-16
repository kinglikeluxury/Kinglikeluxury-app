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
    country?: string;
    city?: string;
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

const getCitiesForCountry = (country: string) => {
  switch (country) {
    case "georgia":
      return [
        { value: "tbilisi", label: "Tbilisi" },
        { value: "batumi", label: "Batumi" },
        { value: "kutaisi", label: "Kutaisi" },
        { value: "rustavi", label: "Rustavi" },
        { value: "zugdidi", label: "Zugdidi" },
        { value: "gori", label: "Gori" },
        { value: "poti", label: "Poti" },
        { value: "telavi", label: "Telavi" },
        { value: "mtskheta", label: "Mtskheta" },
        { value: "kobuleti", label: "Kobuleti" },
        { value: "borjomi", label: "Borjomi" },
        { value: "akhaltsikhe", label: "Akhaltsikhe" },
        { value: "senaki", label: "Senaki" },
        { value: "anaklia", label: "Anaklia" },
        { value: "sighnaghi", label: "Sighnaghi" },
        { value: "ambrolauri", label: "Ambrolauri" },
        { value: "khashuri", label: "Khashuri" },
        { value: "samtredia", label: "Samtredia" },
        { value: "zestafoni", label: "Zestafoni" },
        { value: "chiatura", label: "Chiatura" },
      ];
    case "uae":
      return [
        { value: "dubai", label: "Dubai" },
        { value: "sharjah", label: "Sharjah" },
        { value: "rasAlKhaimah", label: "Ras Al Khaimah" },
      ];
    case "northern-cyprus":
      return [
        { value: "lefkosa", label: "Lefkoşa (Nicosia)" },
        { value: "gazimağusa", label: "Gazimağusa (Famagusta)" },
        { value: "girne", label: "Girne (Kyrenia)" },
        { value: "iskele", label: "İskele" },
        { value: "guzelyurt", label: "Güzelyurt" },
        { value: "esentepe", label: "Esentepe" },
      ];
    case "turkey":
      return [
        { value: "istanbul", label: "İstanbul" },
        { value: "trabzon", label: "Trabzon" },
      ];
    default:
      return [];
  }
};

const SearchFilters = ({ initialFilters }: SearchFiltersProps) => {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [propertyType, setPropertyType] = useState<string>(initialFilters?.type || "");
  const [country, setCountry] = useState<string>(initialFilters?.country || "");
  const [city, setCity] = useState<string>(initialFilters?.city || "");
  const [location, setLocation] = useState<string>(initialFilters?.location || "");
  const [selectedPriceRanges, setSelectedPriceRanges] = useState<string[]>([]);
  const [priceDropdownOpen, setPriceDropdownOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, boolean>>({});
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

  const handleCountryChange = (value: string) => {
    setCountry(value);
    setCity("");
    setLocation("");
    setErrors(prev => ({ ...prev, country: false, city: false }));
  };

  const handleCityChange = (value: string) => {
    setCity(value);
    setLocation("");
    setErrors(prev => ({ ...prev, city: false }));
  };

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
    const newErrors: Record<string, boolean> = {};

    if (!country || country === "any") newErrors.country = true;
    if (!city || city === "any") newErrors.city = true;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    const params = new URLSearchParams();

    if (propertyType && propertyType !== "all") {
      params.append("type", propertyType);
    }

    // Pass city as the location filter (backend uses city param)
    if (city && city !== "any") {
      params.append("city", city);
    }

    // Pass neighborhood/location as location param
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

  const cities = getCitiesForCountry(country);

  return (
    <>
      <Card className="w-full">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">

            {/* Country — required */}
            <div className="lg:col-span-1">
              <Label className={errors.country ? "text-red-500" : ""}>
                {t('home.hero.country', 'Country')} <span className="text-red-500">*</span>
              </Label>
              <Select value={country} onValueChange={handleCountryChange}>
                <SelectTrigger className={errors.country ? "border-red-500 ring-red-500" : ""}>
                  <SelectValue placeholder={t('home.hero.anyCountry', 'Select country')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="georgia">🇬🇪 {t('countries.georgia', 'Georgia')}</SelectItem>
                  <SelectItem value="uae">🇦🇪 {t('countries.uae', 'UAE')}</SelectItem>
                  <SelectItem value="northern-cyprus">🇨🇾 {t('countries.northernCyprus', 'Northern Cyprus')}</SelectItem>
                  <SelectItem value="turkey">🇹🇷 {t('countries.turkey', 'Turkey')}</SelectItem>
                </SelectContent>
              </Select>
              {errors.country && (
                <p className="text-xs text-red-500 mt-1">{t('validation.required', 'Required')}</p>
              )}
            </div>

            {/* City — required */}
            <div className="lg:col-span-1">
              <Label className={errors.city ? "text-red-500" : ""}>
                {t('home.hero.city', 'City')} <span className="text-red-500">*</span>
              </Label>
              <Select
                value={city}
                onValueChange={handleCityChange}
                disabled={!country || cities.length === 0}
              >
                <SelectTrigger className={errors.city ? "border-red-500 ring-red-500" : ""}>
                  <SelectValue placeholder={
                    !country
                      ? t('home.hero.selectCountryFirst', 'Select country first')
                      : t('home.hero.city', 'Select city')
                  } />
                </SelectTrigger>
                <SelectContent>
                  {cities.map(c => (
                    <SelectItem key={c.value} value={c.value}>
                      {t(`cities.${c.value}`, c.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.city && (
                <p className="text-xs text-red-500 mt-1">{t('validation.required', 'Required')}</p>
              )}
            </div>

            {/* Property Type */}
            <div className="lg:col-span-1">
              <Label>{t('property.type', 'Property Type')}</Label>
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

            {/* Location / Neighborhood — optional */}
            <div className="lg:col-span-1">
              <Label>{t('property.location', 'Neighborhood')} <span className="text-gray-400 text-xs">({t('common.optional', 'optional')})</span></Label>
              <Select value={location} onValueChange={setLocation} disabled={!city}>
                <SelectTrigger>
                  <SelectValue placeholder={t('property.anyLocation', 'Any area')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t('property.anyLocation', 'Any area')}</SelectItem>
                  <SelectItem value="rustaveli-avenue">Rustaveli Avenue</SelectItem>
                  <SelectItem value="chavchavadze-avenue">Chavchavadze Avenue</SelectItem>
                  <SelectItem value="agmashenebeli-street">Agmashenebeli Street</SelectItem>
                  <SelectItem value="kostava-street">Kostava Street</SelectItem>
                  <SelectItem value="vazha-pshavela-avenue">Vazha-Pshavela Avenue</SelectItem>
                  <SelectItem value="batumi-boulevard">Batumi Boulevard</SelectItem>
                  <SelectItem value="europe-square">Europe Square</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Price Range — optional */}
            <div className="relative lg:col-span-1" ref={priceDropdownRef}>
              <Label>
                {t('property.priceRange', 'Price Range')} <span className="text-gray-400 text-xs">({t('common.optional', 'optional')})</span>
              </Label>
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

            {/* Search Button */}
            <div className="flex items-end lg:col-span-1">
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
