import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useTranslation } from "react-i18next";
import { 
  MapPin, 
  Search, 
  Filter,
  Home,
  Building,
  TreePine,
  Calendar,
  DollarSign,
  Eye,
  Heart,
  SlidersHorizontal
} from "lucide-react";
import { useAuth } from "@/lib/auth";

interface Project {
  id: number;
  title: string;
  type: string;
  purpose: string;
  price: number;
  location: string;
  area: number;
  bedrooms?: number;
  bathrooms?: number;
  features: string[];
  amenities: string[];
  country: string;
  city: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  updatedAt: string;
  userId: number;
}

const Projects = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  
  // Filter states
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCountry, setSelectedCountry] = useState("");
  const [selectedCity, setSelectedCity] = useState("");
  const [selectedType, setSelectedType] = useState("");
  const [selectedPurpose, setSelectedPurpose] = useState("");
  const [priceRange, setPriceRange] = useState({ min: "", max: "" });
  const [bedroomCount, setBedroomCount] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  // Reset city when country changes
  useEffect(() => {
    if (selectedCountry !== "") {
      setSelectedCity("");
    }
  }, [selectedCountry]);

  // Fetch projects data
  const { data: projects = [], isLoading, error } = useQuery<Project[]>({
    queryKey: ['/api/projects'],
    refetchOnWindowFocus: false,
  });

  // Filter projects based on criteria
  const filteredProjects = projects.filter((project: Project) => {
    // Only show approved projects to regular users
    if (!user?.isAdmin && project.status !== 'approved') {
      return false;
    }

    // Text search
    if (searchTerm && !project.title.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !project.location.toLowerCase().includes(searchTerm.toLowerCase())) {
      return false;
    }

    // Location filter (checking if location contains country/city info)
    if (selectedCountry && selectedCountry !== 'all') {
      const countryName = selectedCountry === 'georgia' ? 'Georgia' : 
                         selectedCountry === 'uae' ? 'UAE' : selectedCountry;
      if (!project.location?.toLowerCase().includes(countryName.toLowerCase())) {
        return false;
      }
    }

    // City filter (checking if location contains city info)
    if (selectedCity && selectedCity !== 'all') {
      const cityName = selectedCity === 'batumi' ? 'Batumi' : 
                      selectedCity === 'tbilisi' ? 'Tbilisi' : 
                      selectedCity === 'dubai' ? 'Dubai' : selectedCity;
      if (!project.location?.toLowerCase().includes(cityName.toLowerCase())) {
        return false;
      }
    }

    // Skip type and purpose filters for now since they're not relevant for projects

    // Price range filter
    if (priceRange.min && project.price < parseInt(priceRange.min)) {
      return false;
    }
    if (priceRange.max && project.price > parseInt(priceRange.max)) {
      return false;
    }

    // Bedroom count filter
    if (bedroomCount && bedroomCount !== 'any' && project.bedrooms !== parseInt(bedroomCount)) {
      return false;
    }

    return true;
  });

  // Get cities based on selected country
  const getCitiesForCountry = (country: string) => {
    switch (country) {
      case 'georgia':
        return [
          { value: 'batumi', label: 'Batumi' },
          { value: 'tbilisi', label: 'Tbilisi' }
        ];
      case 'uae':
        return [
          { value: 'ras-al-khaimah', label: 'Ras Al Khaimah' },
          { value: 'dubai', label: 'Dubai' },
          { value: 'abu-dhabi', label: 'Abu Dhabi' }
        ];
      default:
        return [];
    }
  };

  // Get property type icon
  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'apartment': return <Home className="h-4 w-4" />;
      case 'villa': return <Building className="h-4 w-4" />;
      case 'land': return <TreePine className="h-4 w-4" />;
      case 'commercial': return <Building className="h-4 w-4" />;
      default: return <Home className="h-4 w-4" />;
    }
  };

  // Format price
  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(price);
  };

  const getPriceRange = (price: number) => {
    // Convert stored price value back to the range format used in the form
    const priceRanges: { [key: number]: string } = {
      25000: "$0 - $25,000",
      50000: "$25,000 - $50,000", 
      75000: "$50,000 - $75,000",
      100000: "$75,000 - $100,000",
      125000: "$100,000 - $125,000",
      150000: "$125,000 - $150,000",
      175000: "$150,000 - $175,000",
      200000: "$175,000 - $200,000",
      225000: "$200,000 - $225,000",
      250000: "$225,000 - $250,000",
      275000: "$250,000 - $275,000",
      300000: "$275,000 - $300,000",
      325000: "$300,000 - $325,000",
      350000: "$325,000 - $350,000",
      375000: "$350,000 - $375,000",
      400000: "$375,000 - $400,000",
      425000: "$400,000 - $425,000",
      450000: "$425,000 - $450,000",
      475000: "$450,000 - $475,000",
      500000: "$475,000 - $500,000",
      600000: "$500,000 - $600,000",
      700000: "$600,000 - $700,000",
      800000: "$700,000 - $800,000",
      900000: "$800,000 - $900,000",
      1000000: "$900,000 - $1,000,000",
      1100000: "$1,000,000 - $1,100,000",
      1200000: "$1,100,000 - $1,200,000",
      1300000: "$1,200,000 - $1,300,000",
      1400000: "$1,300,000 - $1,400,000",
      1500000: "$1,400,000 - $1,500,000",
      1600000: "$1,500,000 - $1,600,000",
      1700000: "$1,600,000 - $1,700,000",
      1800000: "$1,700,000 - $1,800,000",
      1900000: "$1,800,000 - $1,900,000",
      2000000: "$1,900,000 - $2,000,000"
    };
    
    // Return the range if found, otherwise fall back to single price format
    return priceRanges[price] || formatPrice(price);
  };

  // Clear all filters
  const clearFilters = () => {
    setSearchTerm("");
    setSelectedCountry("all");
    setSelectedCity("all");
    setSelectedType("all");
    setSelectedPurpose("all");
    setPriceRange({ min: "", max: "" });
    setBedroomCount("any");
  };

  // Count active filters
  const activeFiltersCount = [
    searchTerm,
    selectedCountry,
    selectedCity,
    selectedType,
    selectedPurpose,
    priceRange.min,
    priceRange.max,
    bedroomCount
  ].filter(Boolean).length;

  // Handle promotion banner click
  const handlePromotionClick = () => {
    let whatsappNumber = "";
    let message = "special Promotion 2% for the project|";

    // Set WhatsApp number based on selected country
    if (selectedCountry === 'georgia') {
      whatsappNumber = "995591000058";
    } else {
      // Default number or show alert if no country selected
      alert("Please select a country first to contact the appropriate office.");
      return;
    }

    // Encode the message for URL
    const encodedMessage = encodeURIComponent(message);
    
    // Create WhatsApp URL
    const whatsappURL = `https://wa.me/${whatsappNumber}?text=${encodedMessage}`;
    
    // Open WhatsApp
    window.open(whatsappURL, '_blank');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
            <p className="mt-2 text-gray-600">Loading off-plan projects...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 py-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center">
            <p className="text-red-600">Error loading projects. Please try again later.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-900 mb-4">
            🏗️ Off-Plan Projects
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            Discover exclusive off-plan luxury properties in Georgia and UAE. 
            Filter by location, price, and features to find your perfect investment.
          </p>
        </div>

        {/* Filter Section */}
        <Card className="mb-8">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold flex items-center">
                <SlidersHorizontal className="h-5 w-5 mr-2" />
                Smart Filters
                {activeFiltersCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {activeFiltersCount} active
                  </Badge>
                )}
              </CardTitle>
              <div className="flex items-center space-x-2">
                {activeFiltersCount > 0 && (
                  <Button variant="outline" size="sm" onClick={clearFilters}>
                    Clear All
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowFilters(!showFilters)}
                  className="sm:hidden"
                >
                  <Filter className="h-4 w-4 mr-1" />
                  {showFilters ? 'Hide' : 'Show'} Filters
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className={`${showFilters ? 'block' : 'hidden'} sm:block`}>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              
              {/* Search */}
              <div className="lg:col-span-2">
                <Label htmlFor="search">Search Projects</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-3 h-4 w-4 text-gray-400" />
                  <Input
                    id="search"
                    placeholder="Search by title or location..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              {/* Country */}
              <div>
                <Label htmlFor="country">Country</Label>
                <Select value={selectedCountry} onValueChange={setSelectedCountry}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Countries" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Countries</SelectItem>
                    <SelectItem value="georgia">🇬🇪 Georgia</SelectItem>
                    <SelectItem value="uae">🇦🇪 UAE</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* City */}
              <div>
                <Label htmlFor="city">City</Label>
                <Select 
                  value={selectedCity} 
                  onValueChange={setSelectedCity}
                  disabled={!selectedCountry}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="All Cities" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Cities</SelectItem>
                    {getCitiesForCountry(selectedCountry).map((city) => (
                      <SelectItem key={city.value} value={city.value}>
                        {city.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
              
              {/* Property Type */}
              <div>
                <Label htmlFor="type">Property Type</Label>
                <Select value={selectedType} onValueChange={setSelectedType}>
                  <SelectTrigger>
                    <SelectValue placeholder="All Types" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    <SelectItem value="apartment">🏢 Apartments</SelectItem>
                    <SelectItem value="villa">🏡 Villas</SelectItem>
                    <SelectItem value="land">🌳 Land</SelectItem>
                    <SelectItem value="commercial">🏬 Commercial</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Purpose */}
              <div>
                <Label htmlFor="purpose">Purpose</Label>
                <Select value={selectedPurpose} onValueChange={setSelectedPurpose}>
                  <SelectTrigger>
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="buy">For Sale</SelectItem>
                    <SelectItem value="rent">For Rent</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Min Price */}
              <div>
                <Label htmlFor="minPrice">Min Price ($)</Label>
                <Input
                  id="minPrice"
                  type="number"
                  placeholder="0"
                  value={priceRange.min}
                  onChange={(e) => setPriceRange({...priceRange, min: e.target.value})}
                />
              </div>

              {/* Max Price */}
              <div>
                <Label htmlFor="maxPrice">Max Price ($)</Label>
                <Input
                  id="maxPrice"
                  type="number"
                  placeholder="Any"
                  value={priceRange.max}
                  onChange={(e) => setPriceRange({...priceRange, max: e.target.value})}
                />
              </div>

              {/* Bedrooms */}
              <div>
                <Label htmlFor="bedrooms">Bedrooms</Label>
                <Select value={bedroomCount} onValueChange={setBedroomCount}>
                  <SelectTrigger>
                    <SelectValue placeholder="Any" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any</SelectItem>
                    <SelectItem value="1">1</SelectItem>
                    <SelectItem value="2">2</SelectItem>
                    <SelectItem value="3">3</SelectItem>
                    <SelectItem value="4">4</SelectItem>
                    <SelectItem value="5">5+</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Promotion Banner */}
        <Card className="mb-6 bg-gradient-to-r from-gray-50 to-slate-50 border-gray-200 cursor-pointer hover:shadow-lg transition-shadow duration-300" onClick={handlePromotionClick}>
          <CardContent className="py-8 px-8">
            <div className="flex items-center justify-center space-x-6">
              <div className="flex items-center space-x-4">
                <span className="text-3xl">🎉</span>
                <div className="text-center">
                  <p className="text-xl font-semibold text-gray-800 mb-2">
                    Special Promotion: 2% Less Than Construction Company Prices!
                  </p>
                  <p className="text-base text-gray-600 mb-1 underline">
                    Save more on your off-plan property investment with our exclusive pricing
                  </p>
                  <p className="text-sm text-[#3bcac4] font-medium">
                    Click to contact us via WhatsApp 💬
                  </p>
                </div>
                <span className="text-3xl">💰</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results Summary */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <h2 className="text-xl font-semibold text-gray-900">
              {filteredProjects.length} Projects Found
            </h2>
            {activeFiltersCount > 0 && (
              <Badge variant="outline">
                {activeFiltersCount} filter{activeFiltersCount > 1 ? 's' : ''} applied
              </Badge>
            )}
          </div>
          {/* Show Add Project button only for admin users */}
          {user?.isAdmin && (
            <div className="flex items-center space-x-2">
              <Button 
                onClick={() => window.location.href = '/submit-property'}
                className="flex items-center space-x-2"
              >
                <span className="text-sm">➕</span>
                <span>Add Project</span>
              </Button>
            </div>
          )}
        </div>

        {/* Projects Grid */}
        {filteredProjects.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="text-gray-400 mb-4">
              <Search className="h-16 w-16 mx-auto mb-4" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              No projects found
            </h3>
            <p className="text-gray-600 mb-4">
              Try adjusting your filters or search terms to find more projects.
            </p>
            {activeFiltersCount > 0 && (
              <Button variant="outline" onClick={clearFilters}>
                Clear All Filters
              </Button>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((project: Project) => (
              <Card key={project.id} className="overflow-hidden hover:shadow-lg transition-shadow duration-300">
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center space-x-2">
                      {getTypeIcon(project.type)}
                      <Badge variant="secondary" className="text-xs">
                        {project.type}
                      </Badge>
                      <Badge 
                        variant={project.purpose === 'buy' ? 'default' : 'outline'}
                        className="text-xs"
                      >
                        {project.purpose === 'buy' ? 'For Sale' : 'For Rent'}
                      </Badge>
                    </div>
                    <Button variant="ghost" size="sm" className="p-2">
                      <Heart className="h-4 w-4" />
                    </Button>
                  </div>
                  <CardTitle className="text-lg line-clamp-2">
                    {project.title}
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  
                  {/* Price */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1">
                      <DollarSign className="h-4 w-4 text-green-600" />
                      <span className="text-2xl font-bold text-green-600">
                        {getPriceRange(project.price)}
                      </span>
                    </div>
                    <span className="text-sm text-gray-500">
                      {project.area} m²
                    </span>
                  </div>

                  {/* Location */}
                  <div className="flex items-center space-x-2 text-gray-600">
                    <MapPin className="h-4 w-4" />
                    <span className="text-sm">
                      {project.location}, {project.city}
                    </span>
                  </div>

                  {/* Details */}
                  {(project.bedrooms || project.bathrooms) && (
                    <div className="flex items-center space-x-4 text-sm text-gray-600">
                      {project.bedrooms && (
                        <span>{project.bedrooms} beds</span>
                      )}
                      {project.bathrooms && (
                        <span>{project.bathrooms} baths</span>
                      )}
                    </div>
                  )}

                  {/* Features */}
                  {project.features && project.features.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {project.features.slice(0, 3).map((feature, index) => (
                        <Badge key={index} variant="outline" className="text-xs">
                          {feature}
                        </Badge>
                      ))}
                      {project.features.length > 3 && (
                        <Badge variant="outline" className="text-xs">
                          +{project.features.length - 3} more
                        </Badge>
                      )}
                    </div>
                  )}

                  <Separator />

                  {/* Actions */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1 text-xs text-gray-500">
                      <Calendar className="h-3 w-3" />
                      <span>
                        {new Date(project.createdAt).toLocaleDateString()}
                      </span>
                    </div>
                    <Button size="sm" className="flex items-center space-x-1">
                      <Eye className="h-4 w-4" />
                      <span>View Details</span>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default Projects;