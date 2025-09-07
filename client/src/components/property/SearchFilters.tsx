import { useState, useEffect } from "react";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { PROPERTY_TYPES } from "@shared/schema";
import { Label } from "@/components/ui/label";
import { Search } from "lucide-react";
import PropertyMap from "./PropertyMap";

interface SearchFiltersProps {
  initialFilters?: {
    type?: string;
    location?: string;
    minPrice?: number;
    maxPrice?: number;
  };
}

const SearchFilters = ({ initialFilters }: SearchFiltersProps) => {
  const [, navigate] = useLocation();
  const [propertyType, setPropertyType] = useState<string>(initialFilters?.type || "");
  const [location, setLocation] = useState<string>(initialFilters?.location || "");
  const [priceRange, setPriceRange] = useState<[number, number]>([
    initialFilters?.minPrice || 0,
    initialFilters?.maxPrice || 1000000,
  ]);
  const [priceLabel, setPriceLabel] = useState<string>("");

  // Update price label when range changes
  useEffect(() => {
    const formatPrice = (price: number) => {
      if (price >= 1000000) {
        return `$${(price / 1000000).toFixed(1)}M`;
      } else if (price >= 1000) {
        return `$${(price / 1000).toFixed(0)}K`;
      } else {
        return `$${price}`;
      }
    };

    setPriceLabel(`${formatPrice(priceRange[0])} - ${formatPrice(priceRange[1])}`);
  }, [priceRange]);

  const handleSearch = () => {
    const params = new URLSearchParams();
    
    if (propertyType && propertyType !== "all") {
      params.append("type", propertyType);
    }
    
    if (location) {
      params.append("location", location);
    }
    
    if (priceRange[0] > 0) {
      params.append("minPrice", priceRange[0].toString());
    }
    
    if (priceRange[1] < 1000000) {
      params.append("maxPrice", priceRange[1].toString());
    }
    
    navigate(`/properties?${params.toString()}`);
  };

  const handleLocationSelect = (lat: number, lng: number, address: string) => {
    setLocation(address);
  };

  return (
    <>
      <Card className="w-full">
        <CardContent className="p-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label htmlFor="property-type">Property Type</Label>
              <Select value={propertyType} onValueChange={setPropertyType}>
                <SelectTrigger>
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="studio">Studio</SelectItem>
                  <SelectItem value="one-bedroom">One bedroom</SelectItem>
                  <SelectItem value="two-bedrooms">Two bedrooms</SelectItem>
                  <SelectItem value="three-bedrooms">Three bedrooms</SelectItem>
                  <SelectItem value="doublex">Doublex</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label htmlFor="location">Location</Label>
              <Select value={location} onValueChange={setLocation}>
                <SelectTrigger>
                  <SelectValue placeholder="Any location" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any location</SelectItem>
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
            
            <div>
              <Label htmlFor="price-range">Price Range</Label>
              <div className="mt-6">
                <Slider
                  id="price-range"
                  defaultValue={priceRange}
                  min={0}
                  max={1000000}
                  step={10000}
                  value={priceRange}
                  onValueChange={(value) => setPriceRange(value as [number, number])}
                />
                <div className="mt-2 text-sm text-gray-500">{priceLabel}</div>
              </div>
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
      
      {/* Interactive Map Section */}
      <Card className="w-full mt-4">
        <CardContent className="p-4">
          <div className="mb-2">
            <h3 className="text-lg font-semibold">Select Location on Map</h3>
            <p className="text-sm text-gray-600">Click anywhere on the map to select your preferred location</p>
          </div>
          <PropertyMap 
            location={location || "Dubai, UAE"} 
            title="Search Area" 
            className="w-full"
            interactive={true}
            onLocationSelect={handleLocationSelect}
          />
        </CardContent>
      </Card>
    </>
  );
};

export default SearchFilters;
