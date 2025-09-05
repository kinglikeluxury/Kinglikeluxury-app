import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Redirect } from "wouter";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PROPERTY_TYPES } from "@shared/schema";
import { useTranslation } from "react-i18next";

const SubmitProperty = () => {
  const { user, isLoading } = useAuth();
  const { t } = useTranslation();
  
  // State for form filters
  const [country, setCountry] = useState("any");
  const [location, setLocation] = useState("any");
  const [propertyType, setPropertyType] = useState("all");
  const [purpose, setPurpose] = useState("any");
  const [priceRange, setPriceRange] = useState("any");
  
  // Show loading state while checking authentication
  if (isLoading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <span className="text-gray-500">Loading...</span>
      </div>
    );
  }
  
  // Redirect to login if not authenticated
  if (!user) {
    return <Redirect to="/login" />;
  }

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

  const handleCountryChange = (value: string) => {
    setCountry(value);
    setLocation("any"); // Reset location when country changes
  };
  
  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4">Upload Your Property</h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Fill in the property details below. All submissions require admin approval.
          </p>
        </div>
        
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="text-xl mb-6">Property Information</CardTitle>
            
            {/* Property Filters - Same as Hero component */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              
              {/* Country */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Country</label>
                <Select value={country} onValueChange={handleCountryChange}>
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

              {/* City */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">City</label>
                <Select value={location} onValueChange={setLocation}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('property.anyLocation', 'Any location')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{t('property.anyLocation', 'Any location')}</SelectItem>
                    {getCitiesForCountry(country).map((cityOption) => (
                      <SelectItem key={cityOption.value} value={cityOption.value}>
                        {cityOption.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Property Type */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Property Type</label>
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
                    <SelectItem value={PROPERTY_TYPES.PROJECT}>{t('propertyTypes.project', 'Off Plan Projects')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* What for (Purpose) */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">What for</label>
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

              {/* Price Range */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Price Range</label>
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
            </div>
          </CardHeader>
        </Card>
      </div>
    </div>
  );
};

export default SubmitProperty;
