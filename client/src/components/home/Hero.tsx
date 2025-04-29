import { useState } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { PROPERTY_TYPES } from "@shared/schema";
import { Search } from "lucide-react";

const Hero = () => {
  const [, navigate] = useLocation();
  const [propertyType, setPropertyType] = useState<string>("");
  const [location, setLocation] = useState<string>("");
  const [priceRange, setPriceRange] = useState<string>("");

  const handleSearch = () => {
    const params = new URLSearchParams();
    
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
            <h1 className="text-3xl md:text-4xl font-bold text-white">
              Find Your Perfect Property
            </h1>
            <p className="mt-3 max-w-md mx-auto text-base text-primary-100 sm:text-lg">
              Discover apartments, villas, lands and construction projects that match your needs
            </p>
          </div>
          <div className="mt-10">
            <Card className="max-w-4xl mx-auto">
              <CardContent className="p-4">
                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Property Type</label>
                    <Select value={propertyType} onValueChange={setPropertyType}>
                      <SelectTrigger>
                        <SelectValue placeholder="All Types" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All Types</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.APARTMENT}>Apartments</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.VILLA}>Villas</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.LAND}>Lands</SelectItem>
                        <SelectItem value={PROPERTY_TYPES.PROJECT}>Projects</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Location</label>
                    <Input 
                      placeholder="Any location" 
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                    />
                  </div>
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Price Range</label>
                    <Select value={priceRange} onValueChange={setPriceRange}>
                      <SelectTrigger>
                        <SelectValue placeholder="Any Price" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any Price</SelectItem>
                        <SelectItem value="0-100000">$0 - $100K</SelectItem>
                        <SelectItem value="100000-200000">$100K - $200K</SelectItem>
                        <SelectItem value="200000-500000">$200K - $500K</SelectItem>
                        <SelectItem value="500000-1000000">$500K - $1M</SelectItem>
                        <SelectItem value="1000000+">$1M+</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  
                  <div className="flex items-end">
                    <Button className="w-full" onClick={handleSearch}>
                      <Search className="mr-2 h-4 w-4" />
                      Search
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
