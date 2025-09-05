import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PROPERTY_TYPES } from "@shared/schema";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";

const Hero = () => {
  const [, navigate] = useLocation();
  const [city, setCity] = useState<string>("any");
  const [propertyType, setPropertyType] = useState<string>("all");
  const [location, setLocation] = useState<string>("any");
  const [priceRange, setPriceRange] = useState<string>("any");
  const [purpose, setPurpose] = useState<string>("any");

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
          { value: "ras-al-khaimah", label: "Ras Al Khaimah" }
        ];
      default:
        return [];
    }
  };
  const { t } = useTranslation();

  const handleCountryChange = (value: string) => {
    setCity(value);
    setLocation("any"); // Reset city when country changes
  };

  const handleSearch = () => {
    const params = new URLSearchParams();
    
    if (city && city !== "any") {
      params.append("city", city);
    }
    
    if (propertyType && propertyType !== "all") {
      params.append("type", propertyType);
    }
    
    if (location) {
      params.append("location", location);
    }
    
    if (priceRange && priceRange !== "any") {
      const [min, max] = getPriceRangeValues(priceRange);
      if (min) params.append("minPrice", min.toString());
      if (max) params.append("maxPrice", max.toString());
    }
    
    if (purpose && purpose !== "any") {
      params.append("purpose", purpose);
    }
    
    navigate(`/properties?${params.toString()}`);
  };

  const getPriceRangeValues = (range: string): [number | null, number | null] => {
    switch (range) {
      case "0-100000":
        return [0, 100000];
      case "100000-200000":
        return [100000, 200000];
      case "200000-500000":
        return [200000, 500000];
      case "500000-1000000":
        return [500000, 1000000];
      case "1000000+":
        return [1000000, null];
      default:
        return [null, null];
    }
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
                    <label className="block text-sm font-medium text-gray-700 mb-1">Country</label>
                    <Select value={city} onValueChange={handleCountryChange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Any Country" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any Country</SelectItem>
                        <SelectItem value="georgia">Georgia</SelectItem>
                        <SelectItem value="uae">United Arab Emirates</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                    <Select value={location} onValueChange={setLocation}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('property.anyLocation', 'Any location')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">{t('property.anyLocation', 'Any location')}</SelectItem>
                        {getCitiesForCountry(city).map((cityOption) => (
                          <SelectItem key={cityOption.value} value={cityOption.value}>
                            {cityOption.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('property.type', 'Property Type')}</label>
                    <Select value={propertyType} onValueChange={setPropertyType}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('common.all', 'All Types')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">{t('common.all', 'All Types')}</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.APARTMENT}>{t('propertyTypes.apartment', 'Apartments')}</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.VILLA}>{t('propertyTypes.villa', 'Villas')}</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.LAND}>{t('propertyTypes.land', 'Lands')}</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.COMMERCIAL}>{t('propertyTypes.commercial', 'Commercial Spaces')}</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.PROJECT}>{t('propertyTypes.project', 'Projects')}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">{t('property.priceRange', 'Price Range')}</label>
                    <Select value={priceRange} onValueChange={setPriceRange}>
                      <SelectTrigger>
                        <SelectValue placeholder={t('property.anyPrice', 'Any Price')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">{t('property.anyPrice', 'Any Price')}</SelectItem>
                        <SelectItem value="0-100000">$0 - $100K</SelectItem>
                        <SelectItem value="100000-200000">$100K - $200K</SelectItem>
                        <SelectItem value="200000-500000">$200K - $500K</SelectItem>
                        <SelectItem value="500000-1000000">$500K - $1M</SelectItem>
                        <SelectItem value="1000000+">$1M+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">What for</label>
                    <Select value={purpose} onValueChange={setPurpose}>
                      <SelectTrigger>
                        <SelectValue placeholder="Any Purpose" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any Purpose</SelectItem>
                        <SelectItem value="buy">To buy</SelectItem>
                        <SelectItem value="rent">For rent</SelectItem>
                      </SelectContent>
                    </Select>
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
