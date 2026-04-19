import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { PROPERTY_TYPES } from "@shared/schema";
import { Search, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";

const Hero = () => {
  const [, navigate] = useLocation();
  const [city, setCity] = useState<string>("any");
  const [propertyType, setPropertyType] = useState<string>("all");
  const [location, setLocation] = useState<string>("any");
  const [selectedPriceRanges, setSelectedPriceRanges] = useState<string[]>([]);
  const [priceDropdownOpen, setPriceDropdownOpen] = useState(false);
  const priceDropdownRef = useRef<HTMLDivElement>(null);
  const [purpose, setPurpose] = useState<string>("any");
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const priceRangeOptions = [
    { value: "0-100000", label: "$0 - $100K", min: 0, max: 100000 },
    { value: "100000-200000", label: "$100K - $200K", min: 100000, max: 200000 },
    { value: "200000-500000", label: "$200K - $500K", min: 200000, max: 500000 },
    { value: "500000-1000000", label: "$500K - $1M", min: 500000, max: 1000000 },
    { value: "1000000+", label: "$1M+", min: 1000000, max: null },
  ];

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

  const getSelectedPriceSummary = () => {
    if (selectedPriceRanges.length === 0) return t('property.anyPrice', 'Any Price');
    const selected = priceRangeOptions.filter(o => selectedPriceRanges.includes(o.value));
    const allMins = selected.map(o => o.min);
    const allMaxes = selected.filter(o => o.max !== null).map(o => o.max as number);
    const hasUnlimited = selected.some(o => o.max === null);
    const minPrice = Math.min(...allMins);
    const formatPrice = (p: number) => p >= 1000000 ? `$${(p / 1000000).toFixed(1)}M` : p >= 1000 ? `$${(p / 1000).toFixed(0)}K` : `$${p}`;
    if (hasUnlimited) return `${formatPrice(minPrice)}+`;
    const maxPrice = Math.max(...allMaxes);
    return `${formatPrice(minPrice)} - ${formatPrice(maxPrice)}`;
  };

  const getCitiesForCountry = (country: string) => {
    switch (country) {
      case "georgia":
        return [
          { value: "batumi", label: "Batumi" },
          { value: "tbilisi", label: "Tbilisi" }
        ];
      case "uae":
        return [
          { value: "dubai", label: "Dubai" },
          { value: "sharjah", label: "Sharjah" },
          { value: "rasAlKhaimah", label: "Ras Al Khaimah" }
        ];
      case "northern-cyprus":
        return [
          { value: "lefkosa", label: "Lefkoşa (Nicosia)" },
          { value: "gazimağusa", label: "Gazimağusa (Famagusta)" },
          { value: "girne", label: "Girne (Kyrenia)" },
          { value: "iskele", label: "İskele" },
          { value: "guzelyurt", label: "Güzelyurt" },
          { value: "esentepe", label: "Esentepe" }
        ];
      case "turkey":
        return [
          { value: "istanbul", label: "İstanbul" },
          { value: "trabzon", label: "Trabzon" }
        ];
      default:
        return [];
    }
  };
  const { t } = useTranslation();

  const handleCountryChange = (value: string) => {
    setCity(value);
    setLocation("any");
    setErrors(prev => ({ ...prev, country: false, city: false }));
  };

  const handleSearch = () => {
    const isProject = propertyType === PROPERTY_TYPES.PROJECT;
    const newErrors: Record<string, boolean> = {};
    
    if (!city || city === "any") newErrors.country = true;
    if (!propertyType || propertyType === "all") newErrors.propertyType = true;
    if (!isProject && (!purpose || purpose === "any")) newErrors.purpose = true;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    setErrors({});
    const params = new URLSearchParams();

    // For Off Plan Projects route to /projects page with country/city params
    if (isProject) {
      if (city && city !== "any") params.append("country", city);
      if (location && location !== "any") params.append("city", location);
      navigate(`/projects?${params.toString()}`);
      return;
    }

    // For regular property types route to /properties
    if (location && location !== "any") {
      params.append("city", location);
    } else if (city && city !== "any") {
      params.append("city", city);
    }
    
    if (propertyType && propertyType !== "all") {
      params.append("type", propertyType);
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
    
    if (purpose && purpose !== "any") {
      params.append("purpose", purpose);
    }
    
    navigate(`/properties?${params.toString()}`);
  };


  return (
    <div className="relative bg-primary-600">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="py-12 md:py-20">
          <div className="text-center">
            <h1 className="text-3xl md:text-5xl font-bold text-white">
              <span className="text-[#005476] drop-shadow-md">{t('property.heroTitle', 'Find Your Perfect Property')}</span>
            </h1>
            <p className="mt-3 max-w-md mx-auto text-base sm:text-lg font-bold text-[#005476] drop-shadow-md">
              {t('property.heroSubtitle', 'Discover apartments, villas, lands and construction projects that match your needs')}
            </p>
          </div>
          <div className="mt-10">
            <Card className="max-w-4xl mx-auto">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-6 gap-4">
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${errors.country ? 'text-red-500' : 'text-gray-700'}`}>{t('home.hero.country', 'Country')}</label>
                    <Select value={city} onValueChange={handleCountryChange}>
                      <SelectTrigger className={errors.country ? 'border-red-500 ring-red-500' : ''}>
                        <SelectValue placeholder={t('home.hero.anyCountry', 'Any Country')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">{t('home.hero.anyCountry', 'Any Country')}</SelectItem>
                        <SelectItem value="georgia">🇬🇪 {t('countries.georgia', 'Georgia')}</SelectItem>
                        <SelectItem value="uae">🇦🇪 {t('countries.uae', 'United Arab Emirates')}</SelectItem>
                        <SelectItem value="northern-cyprus">🇨🇾 {t('countries.northernCyprus', 'Northern Cyprus (TRNC)')}</SelectItem>
                        <SelectItem value="turkey">🇹🇷 {t('countries.turkey', 'Turkey')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium mb-1 text-gray-700">{t('home.hero.city', 'City')}</label>
                    <Select value={location} onValueChange={setLocation}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('property.anyLocation', 'Any location')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">{t('property.anyLocation', 'Any location')}</SelectItem>
                        {getCitiesForCountry(city).map((cityOption) => (
                          <SelectItem key={cityOption.value} value={cityOption.value}>
                            {t(`cities.${cityOption.value}`, cityOption.label)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${errors.propertyType ? 'text-red-500' : 'text-gray-700'}`}>{t('property.type', 'Property Type')}</label>
                    <Select value={propertyType} onValueChange={(v) => { setPropertyType(v); setErrors(prev => ({ ...prev, propertyType: false })); }}>
                      <SelectTrigger className={errors.propertyType ? 'border-red-500 ring-red-500' : ''}>
                        <SelectValue placeholder={t('common.all', 'All Types')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('common.all', 'All Types')}</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.APARTMENT}>{t('propertyTypes.apartment', 'Apartments')}</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.VILLA}>{t('propertyTypes.villa', 'Villas')}</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.LAND}>{t('propertyTypes.land', 'Lands')}</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.COMMERCIAL}>{t('propertyTypes.commercial', 'Commercial Spaces')}</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.PROJECT}>{t('propertyTypes.project', 'Off Plan Projects')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  {propertyType !== PROPERTY_TYPES.PROJECT && (
                  <div>
                    <label className={`block text-sm font-medium mb-1 ${errors.purpose ? 'text-red-500' : 'text-gray-700'}`}>{t('home.hero.purpose', 'What for')}</label>
                    <Select value={purpose} onValueChange={(v) => { setPurpose(v); setErrors(prev => ({ ...prev, purpose: false })); }}>
                      <SelectTrigger className={errors.purpose ? 'border-red-500 ring-red-500' : ''}>
                        <SelectValue placeholder={t('home.hero.anyPurpose', 'Any Purpose')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">{t('home.hero.anyPurpose', 'Any Purpose')}</SelectItem>
                        <SelectItem value="buy">{t('home.hero.toBuy', 'To buy')}</SelectItem>
                        <SelectItem value="rent">{t('home.hero.forRent', 'For rent')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  )}
                  
                  <div className="relative" ref={priceDropdownRef}>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('property.priceRange', 'Price Range')}</label>
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero;
