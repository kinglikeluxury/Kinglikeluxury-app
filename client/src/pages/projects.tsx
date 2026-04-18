import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  SlidersHorizontal,
  ArrowRight,
  User,
  ChevronDown
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { Link } from "wouter";
import { useFavorites } from "@/hooks/use-favorites";

interface Project {
  id: number | string;
  propertyId: number;
  developer?: string;
  completionDate?: string;
  projectStatus?: string;
  title: string;
  description: string;
  price: number;
  location: string;
  area: number;
  bedrooms?: number;
  bathrooms?: number;
  features: string[];
  amenities: string[];
  images: string[];
  videos?: string[];
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
  property?: {
    id: number;
    title: string;
    description: string;
    price: number;
    location: string;
    area: number;
    bedrooms?: number;
    bathrooms?: number;
    images: string[];
    status: 'pending' | 'approved' | 'rejected';
  };
}

const Projects = () => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { toggleFavorite, isFavorite } = useFavorites();

  const urlParams = new URLSearchParams(window.location.search);
  const urlCountry = urlParams.get('country') || '';
  const urlCity = urlParams.get('city') || '';
  const urlDeliveryYear = urlParams.get('deliveryYear') || '';
  
  // Filter states
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCountry, setSelectedCountry] = useState(urlCountry);
  const [selectedCity, setSelectedCity] = useState(urlCity);
  const [selectedType, setSelectedType] = useState("");
  const [selectedPurpose, setSelectedPurpose] = useState("");
  const [selectedDeliveryYear, setSelectedDeliveryYear] = useState(urlDeliveryYear);
  const [selectedPriceRanges, setSelectedPriceRanges] = useState<string[]>([]);
  const [priceExpanded, setPriceExpanded] = useState(false);
  const [bedroomCount, setBedroomCount] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [filterErrors, setFilterErrors] = useState<Record<string, boolean>>({});
  const resultsRef = useRef<HTMLDivElement>(null);

  // Reset city when country changes
  useEffect(() => {
    if (selectedCountry !== "") {
      setSelectedCity("");
      setFilterErrors(prev => ({ ...prev, country: false }));
    }
  }, [selectedCountry]);

  useEffect(() => {
    if (selectedCity && selectedCity !== "") {
      setFilterErrors(prev => ({ ...prev, city: false }));
    }
  }, [selectedCity]);

  useEffect(() => {
    if (selectedType && selectedType !== "" && selectedType !== "all") {
      setFilterErrors(prev => ({ ...prev, type: false }));
    }
  }, [selectedType]);

  useEffect(() => {
    if (selectedPriceRanges.length > 0) {
      setFilterErrors(prev => ({ ...prev, priceRange: false }));
    }
  }, [selectedPriceRanges]);


  const priceRangeOptions = [
    { value: "50000-100000", label: "$50,000 - $100,000" },
    { value: "100001-150000", label: "$100,000 - $150,000" },
    { value: "150001-200000", label: "$150,000 - $200,000" },
    { value: "200001-300000", label: "$200,000 - $300,000" },
    { value: "300001-400000", label: "$300,000 - $400,000" },
    { value: "400001-500000", label: "$400,000 - $500,000" },
    { value: "500001-750000", label: "$500,000 - $750,000" },
    { value: "750001-1000000", label: "$750,000 - $1,000,000" },
    { value: "1000001-2000000", label: "$1,000,000 - $2,000,000" },
  ];

  const togglePriceRange = (value: string) => {
    setSelectedPriceRanges(prev => 
      prev.includes(value) ? prev.filter(v => v !== value) : [...prev, value]
    );
  };

  const getPriceDisplayText = () => {
    if (selectedPriceRanges.length === 0) return t('projects.fromPrice', 'From');
    const allMins: number[] = [];
    const allMaxs: number[] = [];
    selectedPriceRanges.forEach(range => {
      const [min, max] = range.split('-').map(Number);
      allMins.push(min);
      allMaxs.push(max);
    });
    const globalMin = Math.min(...allMins);
    const globalMax = Math.max(...allMaxs);
    return `$${globalMin.toLocaleString()} - $${globalMax.toLocaleString()}`;
  };

  // Fetch projects data
  const { data: projects = [], isLoading, error } = useQuery<Project[]>({
    queryKey: ['/api/projects'],
    refetchOnWindowFocus: false,
  });

  const requiredFieldsFilled = selectedCountry && selectedCountry !== '' && selectedCountry !== 'all';

  // Filter projects based on criteria
  const filteredProjects = !requiredFieldsFilled ? [] : projects.filter((project: Project) => {
    const propertyData = project.property || project;
    const projectStatus = propertyData.status || project.status;
    if (!user?.isAdmin && projectStatus !== 'approved') {
      return false;
    }

    const projectLocation = (propertyData.location || project.location || '').toLowerCase();
    const projectTitle = (propertyData.title || project.title || '').toLowerCase();

    if (searchTerm && !projectTitle.includes(searchTerm.toLowerCase()) &&
        !projectLocation.includes(searchTerm.toLowerCase())) {
      return false;
    }

    if (selectedCountry && selectedCountry !== 'all' && selectedCountry !== 'any') {
      const countryName = selectedCountry === 'georgia' ? 'georgia' : 
                         selectedCountry === 'uae' ? 'uae' : selectedCountry;
      if (!projectLocation.includes(countryName)) {
        return false;
      }
    }

    if (selectedCity && selectedCity !== 'all' && selectedCity !== 'any') {
      const cityMap: Record<string, string> = {
        'batumi': 'batumi', 'tbilisi': 'tbilisi',
        'dubai': 'dubai', 'sharjah': 'sharjah',
        'rasAlKhaimah': 'ras al khaimah', 'ras-al-khaimah': 'ras al khaimah',
        'abu-dhabi': 'abu dhabi'
      };
      const cityName = cityMap[selectedCity] || selectedCity.toLowerCase();
      if (!projectLocation.includes(cityName)) {
        return false;
      }
    }

    const projectPrice = propertyData.price || project.price || 0;
    if (selectedPriceRanges.length > 0) {
      const allMins = selectedPriceRanges.map(r => parseInt(r.split('-')[0]));
      const allMaxs = selectedPriceRanges.map(r => parseInt(r.split('-')[1]));
      const globalMin = Math.min(...allMins);
      const globalMax = Math.max(...allMaxs);
      if (projectPrice < globalMin || projectPrice > globalMax) {
        return false;
      }
    }

    const projectBedrooms = propertyData.bedrooms || project.bedrooms;
    if (bedroomCount && bedroomCount !== 'any' && projectBedrooms !== parseInt(bedroomCount)) {
      return false;
    }

    if (selectedDeliveryYear && selectedDeliveryYear !== 'any') {
      const completionDate = project.completionDate || '';
      const yearMatch = completionDate.match(/\d{4}/);
      if (yearMatch) {
        const projectYear = parseInt(yearMatch[0]);
        const [rangeStart, rangeEnd] = selectedDeliveryYear.split('-').map(Number);
        if (rangeEnd) {
          if (projectYear < rangeStart || projectYear > rangeEnd) return false;
        } else {
          if (projectYear !== rangeStart) return false;
        }
      } else {
        return false;
      }
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
    setSelectedCountry("");
    setSelectedCity("");
    setSelectedDeliveryYear("");
  };

  // Count active filters
  const activeFiltersCount = [
    selectedCountry,
    selectedCity,
    selectedDeliveryYear && selectedDeliveryYear !== 'any' ? selectedDeliveryYear : '',
  ].filter(Boolean).length;

  // Handle promotion banner click
  const handlePromotionClick = () => {
    let whatsappNumber = "";
    let message = t('projects.whatsappMessage', 'special Promotion 2% for the project|');

    // Set WhatsApp number based on selected country
    if (selectedCountry === 'georgia') {
      whatsappNumber = "995591000058";
    } else {
      alert(t('projects.selectCountryFirst', 'Please select a country first to contact the appropriate office.'));
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
            <p className="mt-2 text-gray-600">{t('projects.loading', 'Loading off-plan projects...')}</p>
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
            <p className="text-red-600">{t('projects.error', 'Error loading projects. Please try again later.')}</p>
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
            🏗️ {t('projects.title', 'Off-Plan Projects')}
          </h1>
          <p className="text-lg text-gray-600 max-w-2xl mx-auto">
            {t('projects.subtitle', 'Discover exclusive off-plan luxury properties in Georgia and UAE. Filter by location, price, and features to find your perfect investment.')}
          </p>
        </div>

        {/* Filter Section */}
        <Card className="mb-8">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-semibold flex items-center">
                <SlidersHorizontal className="h-5 w-5 mr-2" />
                {t('projects.smartFilters', 'Smart Filters')}
                {activeFiltersCount > 0 && (
                  <Badge variant="secondary" className="ml-2">
                    {activeFiltersCount} {t('projects.active', 'active')}
                  </Badge>
                )}
              </CardTitle>
              {activeFiltersCount > 0 && (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  {t('projects.clearAll', 'Clear All')}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">

              {/* Country */}
              <div>
                <Label htmlFor="country" className={`flex items-center ${filterErrors.country ? 'text-red-500' : ''}`}>
                  {t('home.hero.country', 'Country')} <span className="text-red-500 ml-1">*</span>
                </Label>
                <Select value={selectedCountry} onValueChange={(v) => { setSelectedCountry(v); setSelectedCity(""); setFilterErrors(prev => ({ ...prev, country: false })); }}>
                  <SelectTrigger className={filterErrors.country ? 'border-2 !border-red-500 ring-2 ring-red-200 bg-red-50' : ''}>
                    <SelectValue placeholder={t('projects.selectCountry', 'Select Country')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="georgia">🇬🇪 {t('countries.georgia', 'Georgia')}</SelectItem>
                    <SelectItem value="uae">🇦🇪 {t('countries.uae', 'United Arab Emirates')}</SelectItem>
                    <SelectItem value="northern-cyprus">🇨🇾 {t('countries.northernCyprus', 'Northern Cyprus (TRNC)')}</SelectItem>
                  </SelectContent>
                </Select>
                {filterErrors.country && (
                  <p className="text-red-500 text-xs mt-1">{t('projects.countryRequired', 'Please select a country')}</p>
                )}
              </div>

              {/* City */}
              <div>
                <Label htmlFor="city">
                  {t('home.hero.city', 'City')}
                </Label>
                <Select 
                  value={selectedCity} 
                  onValueChange={setSelectedCity}
                  disabled={!selectedCountry || selectedCountry === 'all'}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('property.anyLocation', 'Any City')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{t('property.anyLocation', 'Any City')}</SelectItem>
                    {getCitiesForCountry(selectedCountry).map((city) => (
                      <SelectItem key={city.value} value={city.value}>
                        {t(`cities.${city.value}`, city.label)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Delivery Date */}
              <div>
                <Label htmlFor="deliveryDate">
                  {t('projects.deliveryDate', 'Delivery Date')}
                </Label>
                <Select value={selectedDeliveryYear} onValueChange={setSelectedDeliveryYear}>
                  <SelectTrigger>
                    <SelectValue placeholder={t('projects.selectDeliveryDate', 'Select delivery date...')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{t('projects.allDate', 'All Date')}</SelectItem>
                    <SelectItem value="2026-2027">2026 - 2027</SelectItem>
                    <SelectItem value="2028-2029">2028 - 2029</SelectItem>
                    <SelectItem value="2030-2031">2030 - 2031</SelectItem>
                    <SelectItem value="2032-2033">2032 - 2033</SelectItem>
                    <SelectItem value="2034-2035">2034 - 2035</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="flex justify-center">
              <Button 
                className="w-full md:w-auto px-8 bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:from-[#005476] hover:to-[#3bcac4] text-white font-semibold"
                onClick={() => {
                  const errors: Record<string, boolean> = {};
                  if (!selectedCountry || selectedCountry === '' || selectedCountry === 'all') errors.country = true;
                  setFilterErrors(errors);
                  if (Object.keys(errors).length === 0) {
                    setTimeout(() => {
                      resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    }, 100);
                  }
                }}
              >
                <Search className="h-4 w-4 mr-2" />
                {t('projects.searchButton', 'Search')}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Promotion Banner */}
        <Card className="mb-6 bg-[#005476] border-[#005476] cursor-pointer hover:shadow-lg transition-shadow duration-300" onClick={handlePromotionClick}>
          <CardContent className="py-8 px-8">
            <div className="flex items-center justify-center space-x-6">
              <div className="flex items-center space-x-4">
                <span className="text-3xl">🎉</span>
                <div className="text-center">
                  <p className="text-xl font-semibold text-white mb-2">
                    {t('projects.promoTitle', 'Special promotion: Choose your property & Get a special discount!')}
                  </p>
                  <p className="text-base text-white mb-2 underline">
                    {t('projects.promoSubtitle', 'Save more on your off-plan property investment with our exclusive pricing')}
                  </p>
                  <p className="text-sm text-[#3bcac4] font-medium mb-2">
                    {t('projects.promoWhatsapp', 'Click to contact us via WhatsApp')} 💬
                  </p>
                </div>
                <span className="text-3xl">💰</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Results Summary */}
        <div ref={resultsRef} className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-4">
            <h2 className="text-xl font-semibold text-gray-900">
              {filteredProjects.length} {t('projects.projectsFound', 'Projects Found')}
            </h2>
            {activeFiltersCount > 0 && (
              <Badge variant="outline">
                {activeFiltersCount} {t('projects.filtersApplied', 'filter(s) applied')}
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
                <span>{t('projects.addProject', 'Add Project')}</span>
              </Button>
            </div>
          )}
        </div>

        {/* Projects Grid */}
        {!requiredFieldsFilled ? (
          <Card className="p-12 text-center">
            <div className="text-gray-400 mb-4">
              <Filter className="h-16 w-16 mx-auto mb-4" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {t('projects.selectRequired', 'Please select the required filters')}
            </h3>
            <p className="text-gray-600 mb-4">
              {t('projects.selectRequiredHint', 'Select a country to view available projects.')}
            </p>
          </Card>
        ) : filteredProjects.length === 0 ? (
          <Card className="p-12 text-center">
            <div className="text-gray-400 mb-4">
              <Search className="h-16 w-16 mx-auto mb-4" />
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">
              {t('projects.noProjects', 'No projects found')}
            </h3>
            <p className="text-gray-600 mb-4">
              {t('projects.noProjectsHint', 'Try adjusting your filters or search terms to find more projects.')}
            </p>
            {activeFiltersCount > 0 && (
              <Button variant="outline" onClick={clearFilters}>
                {t('projects.clearAllFilters', 'Clear All Filters')}
              </Button>
            )}
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((project) => {
              // Get the actual property data - use property field if available, otherwise use project fields directly
              const propertyData = project.property || project;
              const projectImage = propertyData.images?.[0] || "https://images.unsplash.com/photo-1488972685288-c3fd157d7c7a?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80";
              
              return (
                <Card key={project.id} className="overflow-hidden flex flex-col">
                  <div className="flex-shrink-0 relative">
                    <Link href={`/property/${project.propertyId}`} className="block">
                      <img 
                        className="h-64 w-full object-cover cursor-pointer hover:opacity-95 transition-opacity" 
                        src={projectImage}
                        alt={propertyData.title}
                        data-testid={`img-project-${project.id}`}
                      />
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <img src="/watermark-logo.png" alt="" className="w-1/4 opacity-25" draggable={false} />
                      </div>
                    </Link>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleFavorite({ id: project.propertyId, title: propertyData.title, price: propertyData.price, type: (propertyData as any).propertyType || 'project' });
                      }}
                      className={`absolute top-2 right-2 z-10 p-2 rounded-full bg-white/80 backdrop-blur-sm hover:bg-white transition-all shadow-md`}
                    >
                      <Heart className={`h-5 w-5 transition-colors ${isFavorite(project.propertyId) ? 'text-[#3bcac4] fill-[#3bcac4]' : 'text-gray-600'}`} />
                    </button>
                  </div>
                  <CardContent className="p-6 flex-1 flex flex-col justify-between">
                    <div className="flex-1">
                      <div className="flex items-center flex-wrap gap-2 mb-3">
                        {project.projectStatus && (
                          <Badge variant="outline" className="border-[#3bcac4] text-[#3bcac4] bg-[#3bcac4]/10">
                            {project.projectStatus}
                          </Badge>
                        )}
                        {project.completionDate && (
                          <Badge variant="outline" className="bg-blue-100 text-blue-800 border-blue-300">
                            {t('projects.completion', 'Completion')}: {project.completionDate}
                          </Badge>
                        )}
                        <Badge variant="outline" className="bg-[#005476] text-white border-[#005476]">
                          {getPriceRange(propertyData.price)}
                        </Badge>
                      </div>
                      
                      <Link href={`/property/${project.propertyId}`}>
                        <a className="block" data-testid={`link-project-${project.id}`}>
                          <h3 className="text-xl font-semibold text-gray-900 mb-2 hover:text-blue-600 transition-colors">
                            {propertyData.title}
                          </h3>
                          <p className="text-base text-gray-600 mb-4 line-clamp-2">
                            {propertyData.description?.slice(0, 120)}...
                          </p>
                        </a>
                      </Link>
                      
                      <div className="space-y-2">
                        <div className="flex items-center text-sm text-gray-500">
                          <MapPin className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" />
                          {propertyData.location}
                        </div>
                        {project.developer && (
                          <div className="flex items-center text-sm text-gray-500">
                            <User className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" />
                            {t('projects.developer', 'Developer')}: {project.developer}
                          </div>
                        )}
                        {propertyData.area && (
                          <div className="flex items-center text-sm text-gray-500">
                            <Home className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" />
                            {propertyData.area} {t('projects.sqm', 'sqm')}
                          </div>
                        )}
                        {propertyData.bedrooms && (
                          <div className="flex items-center text-sm text-gray-500">
                            <Building className="flex-shrink-0 mr-1.5 h-4 w-4 text-gray-400" />
                            {propertyData.bedrooms} {t('projects.bed', 'bed')}, {propertyData.bathrooms || 0} {t('projects.bath', 'bath')}
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="mt-6 pt-4 border-t border-gray-100">
                      <Button asChild className="w-full" data-testid={`button-view-project-${project.id}`}>
                        <Link href={`/property/${project.propertyId}`}>
                          <span className="flex items-center justify-center">
                            {t('projects.viewDetails', 'View Project Details')}
                            <ArrowRight className="ml-2 h-4 w-4" />
                          </span>
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default Projects;