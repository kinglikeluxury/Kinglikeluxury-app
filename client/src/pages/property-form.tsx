import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { Redirect, useLocation } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PROPERTY_TYPES } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Upload, X, Plus, Map, List } from "lucide-react";
import { Link } from "wouter";
import PropertyMap from "@/components/property/PropertyMap";
import { PhotoUploader } from "@/components/PhotoUploader";
import { VideoUploader } from "@/components/VideoUploader";

const PropertyForm = () => {
  const { user, isLoading } = useAuth();
  const { t } = useTranslation();
  const [location] = useLocation();
  
  // Get property type from URL params
  const urlParams = new URLSearchParams(location.split('?')[1] || '');
  const urlPropertyType = urlParams.get('type') || '';
  
  // Property type state (can be set from URL or form selection)
  const [propertyType, setPropertyType] = useState(urlPropertyType);
  
  // Debug URL parsing
  console.log('Current location:', location);
  console.log('URL params:', urlParams.toString());
  console.log('Property type from URL:', urlPropertyType);
  console.log('Current property type state:', propertyType);
  
  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    location: '',
    country: '',
    city: '',
    area: '',
    bedrooms: [] as string[],
    bathrooms: [] as string[],
    floorNumber: '',
    features: [] as string[],
    amenities: [] as string[],
    purpose: 'buy',
    coordinates: { lat: 0, lng: 0 },
    // Rental-specific fields
    rentalPeriod: '',
    furnished: '',
    securityDeposit: '',
    availableFrom: '',
    utilitiesIncluded: [] as string[],
    petPolicy: '',
    leaseDuration: '',
    rentalTerms: '',
    // Media files
    images: [] as string[],
    videos: [] as string[]
  });
  
  const [newFeature, setNewFeature] = useState('');
  const [newAmenity, setNewAmenity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [useMapSelection, setUseMapSelection] = useState(false);
  const [useCityMapSelection, setUseCityMapSelection] = useState(false);
  
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

  // Check if user can access this property type
  const canAddOffPlan = user.email === "info@kinglikeluxury.com" || user.email === "tarekalimam@gmail.com";
  if (propertyType === PROPERTY_TYPES.PROJECT && !canAddOffPlan) {
    return <Redirect to="/submit-property" />;
  }

  // Get property type title
  const getPropertyTypeTitle = (type: string) => {
    switch (type) {
      case PROPERTY_TYPES.APARTMENT:
        return t('propertyTypes.apartment', 'Apartment');
      case PROPERTY_TYPES.VILLA:
        return t('propertyTypes.villa', 'Villa');
      case PROPERTY_TYPES.LAND:
        return t('propertyTypes.land', 'Land');
      case PROPERTY_TYPES.COMMERCIAL:
        return t('propertyTypes.commercial', 'Commercial');
      case PROPERTY_TYPES.PROJECT:
        return t('propertyTypes.project', 'Off-Plan Project');
      default:
        return 'Property';
    }
  };

  // Handle form input changes
  const handleInputChange = (field: string, value: string) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  // Add feature
  const addFeature = () => {
    if (newFeature.trim() && !formData.features.includes(newFeature.trim())) {
      setFormData(prev => ({
        ...prev,
        features: [...prev.features, newFeature.trim()]
      }));
      setNewFeature('');
    }
  };

  // Remove feature
  const removeFeature = (feature: string) => {
    setFormData(prev => ({
      ...prev,
      features: prev.features.filter((f: string) => f !== feature)
    }));
  };

  // Add amenity
  const addAmenity = () => {
    if (newAmenity.trim() && !formData.amenities.includes(newAmenity.trim())) {
      setFormData(prev => ({
        ...prev,
        amenities: [...prev.amenities, newAmenity.trim()]
      }));
      setNewAmenity('');
    }
  };

  // Remove amenity
  const removeAmenity = (amenity: string) => {
    setFormData(prev => ({
      ...prev,
      amenities: prev.amenities.filter((a: string) => a !== amenity)
    }));
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
          { value: "ras-al-khaimah", label: "Ras Al Khaimah" }
        ];
      default:
        return [];
    }
  };

  const getBatumiStreets = () => {
    return [
      { value: "rustaveli-ave", label: "Rustaveli Avenue" },
      { value: "gogebashvili-str", label: "Gogebashvili Street" },
      { value: "chavchavadze-str", label: "Chavchavadze Street" },
      { value: "parnavaz-mepe-str", label: "Parnavaz Mepe Street" },
      { value: "agmashenebeli-str", label: "Agmashenebeli Street" },
      { value: "ninoshvili-str", label: "Ninoshvili Street" },
      { value: "lermontov-str", label: "Lermontov Street" },
      { value: "pushkin-str", label: "Pushkin Street" },
      { value: "tabidze-str", label: "Tabidze Street" },
      { value: "vazha-pshavela-ave", label: "Vazha Pshavela Avenue" },
      { value: "melikishvili-str", label: "Melikishvili Street" },
      { value: "batumi-boulevard", label: "Batumi Boulevard" },
      { value: "gorgiladze-str", label: "Gorgiladze Street" },
      { value: "sherif-khimshiashvili-str", label: "Sherif Khimshiashvili Street" },
      { value: "kostava-str", label: "Kostava Street" }
    ];
  };

  const handleCountryChange = (value: string) => {
    setFormData(prev => ({ ...prev, country: value, city: '', location: '' }));
  };

  const handleCityChange = (value: string) => {
    setFormData(prev => ({ ...prev, city: value, location: '', coordinates: { lat: 0, lng: 0 } }));
    setUseMapSelection(false); // Reset to dropdown when city changes
  };

  // Handle location selection from map (multi-select)
  const handleMapLocationSelect = (lat: number, lng: number, address: string) => {
    setFormData(prev => {
      // Parse existing locations
      const currentLocations = prev.location ? prev.location.split(',') : [];
      
      // Add new location
      const newLocations = [...currentLocations, address];
      
      return {
        ...prev,
        location: newLocations.join(','),
        coordinates: { lat, lng }
      };
    });
  };

  // Handle city selection from map (multi-select)
  const handleCityMapSelect = (lat: number, lng: number, address: string) => {
    // Determine city based on coordinates
    let cityValue = '';
    if (lat >= 41.0 && lat <= 42.0 && lng >= 39.0 && lng <= 47.0) {
      cityValue = 'batumi'; // Georgia coordinates range
    } else if (lat >= 22.0 && lat <= 26.5 && lng >= 51.0 && lng <= 56.5) {
      cityValue = 'dubai'; // UAE coordinates range
    } else {
      // Default based on address or manual detection
      if (address.toLowerCase().includes('georgia') || address.toLowerCase().includes('batumi')) {
        cityValue = 'batumi';
      } else if (address.toLowerCase().includes('uae') || address.toLowerCase().includes('dubai')) {
        cityValue = 'dubai';
      }
    }

    setFormData(prev => {
      // Parse existing cities
      const currentCities = Array.isArray(prev.city) ? prev.city : (prev.city ? prev.city.split(',') : []);
      
      // Add new city if not already selected
      const newCities = currentCities.includes(cityValue) ? currentCities : [...currentCities, cityValue];
      
      return {
        ...prev,
        city: newCities.join(','),
        location: '', // Reset location when city changes
        coordinates: { lat: 0, lng: 0 }
      };
    });
  };

  // Handle form submission
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    
    try {
      // Validate required fields before submission
      if (!propertyType) {
        console.error('Property type missing. Location:', location, 'Parsed type:', propertyType);
        alert(`Property type is required. Current URL: ${location}. Please go back and select a property type.`);
        return;
      }
      
      if (!user?.id) {
        alert('User authentication required. Please log in again.');
        return;
      }
      
      // Transform location data: combine country+city into location format for database
      const getLocationString = () => {
        const cities = formData.city ? formData.city.split(',') : [];
        const countries = formData.country ? formData.country.split(',') : [];
        
        if (cities.length === 0 || countries.length === 0) {
          return formData.location || 'Not specified';
        }

        // Map city codes to full names
        const cityNames = cities.map(city => {
          switch (city) {
            case 'batumi': return 'Batumi';
            case 'tbilisi': return 'Tbilisi'; 
            case 'dubai': return 'Dubai';
            default: return city;
          }
        });

        // Map country codes to full names
        const countryNames = countries.map(country => {
          switch (country) {
            case 'georgia': return 'Georgia';
            case 'uae': return 'UAE';
            default: return country;
          }
        });

        // Combine city and country (e.g., "Batumi, Georgia" or "Dubai, UAE")
        return `${cityNames.join(', ')}, ${countryNames.join(', ')}`;
      };
      
      // Prepare submission data
      const submissionData = {
        ...formData,
        propertyType,
        ownerId: user.id,
        location: getLocationString(), // Transform country+city to location string
        price: parseInt(formData.price),
        area: parseInt(formData.area),
        bedrooms: Array.isArray(formData.bedrooms) ? Math.max(...formData.bedrooms.map(Number)) : formData.bedrooms,
        bathrooms: Array.isArray(formData.bathrooms) ? Math.max(...formData.bathrooms.map(Number)) : formData.bathrooms,
        floorNumber: formData.floorNumber ? parseInt(formData.floorNumber) : null,
        images: formData.images || [],
        videos: formData.videos || [],
        features: formData.features || [],
        amenities: formData.amenities || [],
        // For project types, add project details
        ...(propertyType === 'project' ? {
          projectDetails: {
            developer: formData.title, // Use title as developer name
            completionDate: 'Q4 2024', // Default completion
            projectStatus: 'Now Selling' // Default status
          }
        } : {})
      };

      console.log('Submitting property:', submissionData);
      
      // Submit to API
      const response = await fetch('/api/properties', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(submissionData)
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Validation errors:', errorData);
        alert(`Failed to create property: ${JSON.stringify(errorData.errors || errorData.message)}`);
        throw new Error(`Failed to create property: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log('Property created successfully:', result);
      
      // Redirect to success or properties page
      window.location.href = '/properties';
      
    } catch (error) {
      console.error('Error submitting property:', error);
      alert('Failed to create property. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen py-8">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <Link href="/submit-property">
            <Button variant="ghost" className="mb-4">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Property Types
            </Button>
          </Link>
          
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Add {getPropertyTypeTitle(propertyType)}
            </h1>
            <p className="text-lg text-gray-600">
              Fill in the details for your {getPropertyTypeTitle(propertyType).toLowerCase()}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Property Type Selection - Show if not provided via URL */}
          {!propertyType && (
            <Card>
              <CardHeader>
                <CardTitle>Select Property Type</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {Object.entries(PROPERTY_TYPES).map(([key, value]) => (
                    <Button
                      key={value}
                      type="button"
                      variant={propertyType === value ? "default" : "outline"}
                      onClick={() => setPropertyType(value)}
                      className="h-12 text-sm"
                    >
                      {value.charAt(0).toUpperCase() + value.slice(1)}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Show selected property type */}
          {propertyType && (
            <div className="p-3 bg-green-50 rounded-lg">
              <Badge variant="secondary" className="text-green-700 bg-green-100">
                Property Type: {propertyType.charAt(0).toUpperCase() + propertyType.slice(1)}
              </Badge>
              {!urlPropertyType && (
                <Button 
                  type="button"
                  variant="link" 
                  onClick={() => setPropertyType('')}
                  className="ml-2 h-auto p-0 text-green-600 hover:text-green-700"
                >
                  Change
                </Button>
              )}
            </div>
          )}

          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="title">Project Name *</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => handleInputChange('title', e.target.value)}
                    placeholder="Enter property title"
                    required
                  />
                </div>
                
                <div>
                  <Label htmlFor="price">Price Range (USD) *</Label>
                  <Select 
                    value={formData.price} 
                    onValueChange={(value) => handleInputChange('price', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select price range" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="25000">$0 - $25,000</SelectItem>
                      <SelectItem value="50000">$25,000 - $50,000</SelectItem>
                      <SelectItem value="75000">$50,000 - $75,000</SelectItem>
                      <SelectItem value="100000">$75,000 - $100,000</SelectItem>
                      <SelectItem value="125000">$100,000 - $125,000</SelectItem>
                      <SelectItem value="150000">$125,000 - $150,000</SelectItem>
                      <SelectItem value="175000">$150,000 - $175,000</SelectItem>
                      <SelectItem value="200000">$175,000 - $200,000</SelectItem>
                      <SelectItem value="225000">$200,000 - $225,000</SelectItem>
                      <SelectItem value="250000">$225,000 - $250,000</SelectItem>
                      <SelectItem value="275000">$250,000 - $275,000</SelectItem>
                      <SelectItem value="300000">$275,000 - $300,000</SelectItem>
                      <SelectItem value="325000">$300,000 - $325,000</SelectItem>
                      <SelectItem value="350000">$325,000 - $350,000</SelectItem>
                      <SelectItem value="375000">$350,000 - $375,000</SelectItem>
                      <SelectItem value="400000">$375,000 - $400,000</SelectItem>
                      <SelectItem value="425000">$400,000 - $425,000</SelectItem>
                      <SelectItem value="450000">$425,000 - $450,000</SelectItem>
                      <SelectItem value="475000">$450,000 - $475,000</SelectItem>
                      <SelectItem value="500000">$475,000 - $500,000</SelectItem>
                      <SelectItem value="600000">$500,000 - $600,000</SelectItem>
                      <SelectItem value="700000">$600,000 - $700,000</SelectItem>
                      <SelectItem value="800000">$700,000 - $800,000</SelectItem>
                      <SelectItem value="900000">$800,000 - $900,000</SelectItem>
                      <SelectItem value="1000000">$900,000 - $1,000,000</SelectItem>
                      <SelectItem value="1100000">$1,000,000 - $1,100,000</SelectItem>
                      <SelectItem value="1200000">$1,100,000 - $1,200,000</SelectItem>
                      <SelectItem value="1300000">$1,200,000 - $1,300,000</SelectItem>
                      <SelectItem value="1400000">$1,300,000 - $1,400,000</SelectItem>
                      <SelectItem value="1500000">$1,400,000 - $1,500,000</SelectItem>
                      <SelectItem value="1600000">$1,500,000 - $1,600,000</SelectItem>
                      <SelectItem value="1700000">$1,600,000 - $1,700,000</SelectItem>
                      <SelectItem value="1800000">$1,700,000 - $1,800,000</SelectItem>
                      <SelectItem value="1900000">$1,800,000 - $1,900,000</SelectItem>
                      <SelectItem value="2000000">$1,900,000 - $2,000,000</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label htmlFor="description">Description *</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  placeholder="Describe your property..."
                  rows={4}
                  required
                />
              </div>
            </CardContent>
          </Card>

          {/* Location */}
          <Card>
            <CardHeader>
              <CardTitle>Location</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor="country">Country *</Label>
                  <div className="border border-gray-300 rounded-md p-3 bg-white">
                    <div className="text-sm text-gray-600 mb-2">Select multiple countries:</div>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { value: 'georgia', label: '🇬🇪 Georgia' },
                        { value: 'uae', label: '🇦🇪 United Arab Emirates' }
                      ].map((countryOption) => {
                        const selectedCountries = Array.isArray(formData.country) ? formData.country : (formData.country ? [formData.country] : []);
                        const isSelected = selectedCountries.includes(countryOption.value);
                        
                        return (
                          <label key={countryOption.value} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                const currentCountries = Array.isArray(formData.country) ? formData.country : (formData.country ? [formData.country] : []);
                                let newCountries;
                                if (e.target.checked) {
                                  newCountries = [...currentCountries, countryOption.value];
                                } else {
                                  newCountries = currentCountries.filter(country => country !== countryOption.value);
                                }
                                handleInputChange('country', newCountries.join(','));
                              }}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm">{countryOption.label}</span>
                          </label>
                        );
                      })}
                    </div>
                    {Array.isArray(formData.country) || (formData.country && formData.country.includes(',')) ? (
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Selected countries:</div>
                        <div className="flex flex-wrap gap-1">
                          {(Array.isArray(formData.country) ? formData.country : formData.country?.split(',') || []).map((country) => (
                            <Badge key={country} variant="secondary" className="text-xs">
                              {country === 'georgia' ? '🇬🇪 Georgia' : '🇦🇪 UAE'}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <Label htmlFor="city">City *</Label>
                    <div className="flex items-center space-x-2">
                      <button
                        type="button"
                        onClick={() => setUseCityMapSelection(false)}
                        className={`px-3 py-1 text-xs rounded-md transition-colors ${
                          !useCityMapSelection 
                            ? 'bg-blue-500 text-white' 
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      >
                        📋 List View
                      </button>
                      <button
                        type="button"
                        onClick={() => setUseCityMapSelection(true)}
                        className={`px-3 py-1 text-xs rounded-md transition-colors ${
                          useCityMapSelection 
                            ? 'bg-emerald-500 text-white' 
                            : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                        }`}
                      >
                        🌍 3D Map View
                      </button>
                    </div>
                  </div>

                  {useCityMapSelection ? (
                    <div className="space-y-4">
                      {/* Enhanced City Map Header */}
                      <div className="text-center bg-gradient-to-r from-purple-50 to-pink-50 p-3 rounded-lg border border-purple-100">
                        <h4 className="text-sm font-semibold text-purple-900 mb-1">🌍 Global City Selector</h4>
                        <p className="text-xs text-purple-700">Click on Georgia or UAE regions to select cities</p>
                      </div>

                      {/* Premium City Map Container */}
                      <div className="relative bg-gradient-to-br from-purple-900 via-indigo-800 to-blue-900 p-4 rounded-xl shadow-xl">
                        <div className="absolute top-4 left-4 z-[1000] bg-gradient-to-r from-pink-500 to-purple-600 text-white px-3 py-2 rounded-full text-xs font-bold shadow-lg animate-pulse">
                          ✨ Global 3D View ✨
                        </div>

                        <div className="h-[300px] rounded-xl overflow-hidden border-4 border-white/30 shadow-inner bg-white/10 backdrop-blur-sm">
                          <PropertyMap
                            location="global"
                            title="Select City/Country"
                            interactive={true}
                            onLocationSelect={handleCityMapSelect}
                            className="h-full w-full rounded-lg"
                          />
                        </div>
                        
                        {/* City Map Controls Info */}
                        <div className="absolute bottom-4 left-4 right-4 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg p-2 shadow-lg border border-white/50">
                          <div className="flex items-center justify-between text-xs">
                            <div className="flex items-center space-x-3">
                              <span className="text-purple-600 font-medium">🖱️ Click regions</span>
                              <span className="text-pink-600 font-medium">🔄 Zoom</span>
                            </div>
                            <div className="text-gray-500 font-medium">Global View</div>
                          </div>
                        </div>
                      </div>

                      {/* City Selection Confirmation */}
                      {formData.city && (
                        <div className="bg-gradient-to-r from-purple-50 to-pink-50 border-2 border-purple-200 rounded-lg p-3 shadow-lg">
                          <div className="flex items-center space-x-2 mb-2">
                            <div className="w-6 h-6 bg-purple-500 rounded-full flex items-center justify-center text-white text-xs font-bold">
                              🏙️
                            </div>
                            <p className="text-sm text-purple-800 font-bold">
                              {(formData.city.split(',').length)} Cit{formData.city.split(',').length > 1 ? 'ies' : 'y'} Selected
                            </p>
                          </div>
                          
                          <div className="flex flex-wrap gap-1">
                            {formData.city.split(',').map((city, index) => {
                              const cityName = city === 'batumi' ? 'Batumi, Georgia' : 
                                              city === 'tbilisi' ? 'Tbilisi, Georgia' : 
                                              city === 'dubai' ? 'Dubai, UAE' : city;
                              return (
                                <div key={index} className="bg-white/70 rounded px-2 py-1 flex items-center space-x-1">
                                  <span className="text-xs text-purple-800 font-medium">{cityName}</span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const currentCities = formData.city.split(',');
                                      const newCities = currentCities.filter((_, i) => i !== index);
                                      
                                      setFormData(prev => ({
                                        ...prev,
                                        city: newCities.join(','),
                                        location: '',
                                        coordinates: { lat: 0, lng: 0 }
                                      }));
                                    }}
                                    className="text-red-500 hover:text-red-700 text-xs"
                                  >
                                    ❌
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="border border-gray-300 rounded-md p-3 bg-white">
                      <div className="text-sm text-gray-600 mb-2">Select cities:</div>
                      <div className="space-y-2">
                        {[
                          { value: 'batumi', label: '🇬🇪 Batumi, Georgia' },
                          { value: 'tbilisi', label: '🇬🇪 Tbilisi, Georgia' },
                          { value: 'dubai', label: '🇦🇪 Dubai, UAE' }
                        ].filter((cityOption) => {
                          // Hide Dubai if any Georgian city is selected
                          const currentCities = Array.isArray(formData.city) ? formData.city : (formData.city ? formData.city.split(',') : []);
                          const hasGeorgianCity = currentCities.some(city => city === 'batumi' || city === 'tbilisi');
                          
                          if (cityOption.value === 'dubai' && hasGeorgianCity) {
                            return false; // Hide Dubai option
                          }
                          
                          // Hide Georgian cities if Dubai is selected
                          const hasDubai = currentCities.includes('dubai');
                          if ((cityOption.value === 'batumi' || cityOption.value === 'tbilisi') && hasDubai) {
                            return false; // Hide Georgian options
                          }
                          
                          return true; // Show the option
                        }).map((cityOption) => {
                          const isSelected = Array.isArray(formData.city) 
                            ? formData.city.includes(cityOption.value)
                            : formData.city ? formData.city.split(',').includes(cityOption.value) : false;
                          
                          return (
                            <label key={cityOption.value} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const currentCities = Array.isArray(formData.city) ? formData.city : (formData.city ? formData.city.split(',') : []);
                                  let newCities;
                                  
                                  if (e.target.checked) {
                                    // If selecting a Georgian city, remove Dubai
                                    if (cityOption.value === 'batumi' || cityOption.value === 'tbilisi') {
                                      newCities = [...currentCities.filter(c => c !== 'dubai'), cityOption.value];
                                    }
                                    // If selecting Dubai, remove Georgian cities
                                    else if (cityOption.value === 'dubai') {
                                      newCities = [...currentCities.filter(c => c !== 'batumi' && c !== 'tbilisi'), cityOption.value];
                                    }
                                    // For other cities (future expansion)
                                    else {
                                      newCities = [...currentCities, cityOption.value];
                                    }
                                  } else {
                                    newCities = currentCities.filter(c => c !== cityOption.value);
                                  }
                                  
                                  handleInputChange('city', newCities.join(','));
                                  setUseMapSelection(false); // Reset location map when city changes
                                }}
                                className="rounded border-gray-300"
                              />
                              <span className="text-sm font-medium">{cityOption.label}</span>
                            </label>
                          );
                        })}
                      </div>
                      {formData.city && (formData.city.includes(',') || formData.city.length > 0) && (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          <div className="text-xs text-gray-500 mb-1">Selected cities:</div>
                          <div className="flex flex-wrap gap-1">
                            {(Array.isArray(formData.city) ? formData.city : formData.city.split(',')).filter(city => city).map((cityValue) => {
                              const cityName = cityValue === 'batumi' ? '🇬🇪 Batumi, Georgia' : 
                                              cityValue === 'tbilisi' ? '🇬🇪 Tbilisi, Georgia' : 
                                              cityValue === 'dubai' ? '🇦🇪 Dubai, UAE' : cityValue;
                              return (
                                <Badge key={cityValue} variant="secondary" className="text-xs">
                                  {cityName}
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="area">Area (m²) *</Label>
                  <div className="border border-gray-300 rounded-md p-3 bg-white">
                    <div className="text-sm text-gray-600 mb-2">Select multiple areas:</div>
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-2 max-h-32 overflow-y-auto">
                      {Array.from({length: 91}, (_, i) => String(30 + i)).map((areaValue) => {
                        const selectedAreas = Array.isArray(formData.area) ? formData.area : (formData.area ? formData.area.split(',') : []);
                        const isSelected = selectedAreas.includes(areaValue);
                        
                        return (
                          <label key={areaValue} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-1 rounded">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                const currentAreas = Array.isArray(formData.area) ? formData.area : (formData.area ? formData.area.split(',') : []);
                                let newAreas;
                                if (e.target.checked) {
                                  newAreas = [...currentAreas, areaValue];
                                } else {
                                  newAreas = currentAreas.filter(area => area !== areaValue);
                                }
                                handleInputChange('area', newAreas.join(','));
                              }}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm">{areaValue} m²</span>
                          </label>
                        );
                      })}
                    </div>
                    {formData.area && (formData.area.includes(',') || formData.area.length > 0) && (
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Selected areas:</div>
                        <div className="flex flex-wrap gap-1">
                          {(Array.isArray(formData.area) ? formData.area : formData.area.split(',')).filter(area => area).map((area) => (
                            <Badge key={area} variant="secondary" className="text-xs">
                              {area} m²
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="location">
                    {formData.city === 'batumi' ? 'Street *' : 'Specific Location *'}
                  </Label>
                  {formData.city === 'batumi' && (
                    <div className="flex items-center space-x-2">
                      <Button
                        type="button"
                        variant={!useMapSelection ? "default" : "outline"}
                        size="sm"
                        onClick={() => setUseMapSelection(false)}
                        className="h-8"
                      >
                        <List className="h-4 w-4 mr-1" />
                        Dropdown
                      </Button>
                      <Button
                        type="button"
                        variant={useMapSelection ? "default" : "outline"}
                        size="sm"
                        onClick={() => setUseMapSelection(true)}
                        className="h-8"
                      >
                        <Map className="h-4 w-4 mr-1" />
                        Map
                      </Button>
                    </div>
                  )}
                </div>
                
                {formData.city === 'batumi' && useMapSelection ? (
                  <div className="space-y-6">
                    {/* Enhanced Map Header */}
                    <div className="text-center bg-gradient-to-r from-blue-50 to-cyan-50 p-4 rounded-lg border border-blue-100">
                      <h3 className="text-lg font-semibold text-blue-900 mb-2">🌍 Multi-Location Selector</h3>
                      <p className="text-sm text-blue-700">Click multiple points on the map to select all relevant property locations</p>
                    </div>

                    {/* Premium Map Container */}
                    <div className="relative bg-gradient-to-br from-blue-900 via-blue-800 to-cyan-900 p-6 rounded-2xl shadow-2xl">
                      <div className="absolute top-6 left-6 z-[1000] bg-gradient-to-r from-emerald-500 to-teal-600 text-white px-4 py-3 rounded-full text-sm font-bold shadow-lg animate-pulse">
                        ✨ Premium 3D Satellite View ✨
                      </div>
                      
                      <div className="absolute top-6 right-6 z-[1000] bg-white/90 backdrop-blur-sm px-3 py-2 rounded-lg text-xs text-gray-700 font-medium shadow-md">
                        🔍 Zoom & Click to Select
                      </div>

                      <div className="h-[500px] rounded-2xl overflow-hidden border-4 border-white/30 shadow-inner bg-white/10 backdrop-blur-sm transform transition-all duration-500 hover:scale-[1.005] hover:shadow-3xl">
                        <PropertyMap
                          location={formData.location || 'batumi'}
                          title="Select Location"
                          interactive={true}
                          onLocationSelect={handleMapLocationSelect}
                          className="h-full w-full rounded-xl"
                        />
                      </div>
                      
                      {/* Map Controls Info */}
                      <div className="absolute bottom-6 left-6 right-6 z-[1000] bg-white/95 backdrop-blur-sm rounded-xl p-3 shadow-lg border border-white/50">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center space-x-4">
                            <span className="text-blue-600 font-medium">🖱️ Click multiple points</span>
                            <span className="text-purple-600 font-medium">🔄 Scroll to zoom</span>
                            <span className="text-green-600 font-medium">🖐️ Drag to explore</span>
                          </div>
                          <div className="text-gray-500 font-medium">Multi-Location Satellite View</div>
                        </div>
                      </div>
                    </div>

                    {/* Enhanced Multi-Location Confirmation */}
                    {formData.location && (
                      <div className="bg-gradient-to-r from-green-50 to-emerald-50 border-2 border-green-200 rounded-xl p-4 shadow-lg">
                        <div className="flex items-center space-x-3 mb-3">
                          <div className="w-10 h-10 bg-green-500 rounded-full flex items-center justify-center text-white text-lg font-bold">
                            📍
                          </div>
                          <div className="flex-1">
                            <p className="text-lg text-green-800 font-bold">
                              Perfect! {(formData.location.split(',').length)} Location{formData.location.split(',').length > 1 ? 's' : ''} Selected
                            </p>
                            <p className="text-sm text-green-700 font-medium">
                              🎯 Click more points to add additional locations
                            </p>
                          </div>
                          <div className="text-2xl">✅</div>
                        </div>
                        
                        {/* List of Selected Locations */}
                        <div className="space-y-2">
                          {formData.location.split(',').map((location, index) => {
                            const coords = Array.isArray(formData.coordinates) ? formData.coordinates[index] : formData.coordinates;
                            return (
                              <div key={index} className="bg-white/70 rounded-lg p-3 flex items-center justify-between">
                                <div className="flex-1">
                                  <p className="text-sm text-green-800 font-medium">
                                    📌 Location {index + 1}: {location}
                                  </p>
                                  {coords && coords.lat !== 0 && (
                                    <p className="text-xs text-green-600 mt-1 font-mono bg-green-100 px-2 py-1 rounded inline-block">
                                      📊 {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                                    </p>
                                  )}
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const currentLocations = formData.location.split(',');
                                    const currentCoords = Array.isArray(formData.coordinates) ? formData.coordinates : [formData.coordinates];
                                    
                                    const newLocations = currentLocations.filter((_, i) => i !== index);
                                    const newCoords = currentCoords.filter((_, i) => i !== index);
                                    
                                    setFormData(prev => ({
                                      ...prev,
                                      location: newLocations.join(','),
                                      coordinates: newCoords.length === 1 ? newCoords[0] : newCoords
                                    }));
                                  }}
                                  className="text-red-500 hover:text-red-700 hover:bg-red-50 p-2 rounded-full transition-colors"
                                >
                                  ❌
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Interactive Guide */}
                    <div className="bg-gradient-to-r from-indigo-50 to-purple-50 border-2 border-indigo-200 rounded-xl p-5 shadow-lg">
                      <div className="flex items-center space-x-3 mb-3">
                        <div className="w-8 h-8 bg-indigo-500 rounded-full flex items-center justify-center text-white font-bold">
                          💡
                        </div>
                        <h4 className="text-lg font-bold text-indigo-900">Quick Guide</h4>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div className="flex items-center space-x-2 bg-white/70 rounded-lg p-3">
                          <span className="text-lg">🎯</span>
                          <span className="text-sm text-indigo-800 font-medium">Click multiple points to select areas</span>
                        </div>
                        <div className="flex items-center space-x-2 bg-white/70 rounded-lg p-3">
                          <span className="text-lg">🔍</span>
                          <span className="text-sm text-indigo-800 font-medium">Zoom for precise positioning</span>
                        </div>
                        <div className="flex items-center space-x-2 bg-white/70 rounded-lg p-3">
                          <span className="text-lg">❌</span>
                          <span className="text-sm text-indigo-800 font-medium">Remove unwanted locations easily</span>
                        </div>
                        <div className="flex items-center space-x-2 bg-white/70 rounded-lg p-3">
                          <span className="text-lg">⚡</span>
                          <span className="text-sm text-indigo-800 font-medium">Real-time satellite imagery</span>
                        </div>
                      </div>
                    </div>
                  </div>
                ) : formData.city === 'batumi' ? (
                  <div className="border border-gray-300 rounded-md p-3 bg-white">
                    <div className="text-sm text-gray-600 mb-2">Select multiple Batumi locations:</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                      {getBatumiStreets().map((street) => {
                        const selectedLocations = Array.isArray(formData.location) ? formData.location : (formData.location ? formData.location.split(',') : []);
                        const isSelected = selectedLocations.includes(street.value);
                        
                        return (
                          <label key={street.value} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                const currentLocations = Array.isArray(formData.location) ? formData.location : (formData.location ? formData.location.split(',') : []);
                                let newLocations;
                                if (e.target.checked) {
                                  newLocations = [...currentLocations, street.value];
                                } else {
                                  newLocations = currentLocations.filter(loc => loc !== street.value);
                                }
                                handleInputChange('location', newLocations.join(','));
                              }}
                              className="rounded border-gray-300"
                            />
                            <span className="text-sm">{street.label}</span>
                          </label>
                        );
                      })}
                    </div>
                    {formData.location && (formData.location.includes(',') || formData.location.length > 0) && (
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Selected locations:</div>
                        <div className="flex flex-wrap gap-1">
                          {(Array.isArray(formData.location) ? formData.location : formData.location.split(',')).filter(loc => loc).map((locationValue) => {
                            const streetData = getBatumiStreets().find(s => s.value === locationValue);
                            return (
                              <Badge key={locationValue} variant="secondary" className="text-xs">
                                {streetData ? streetData.label : locationValue}
                              </Badge>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="border border-gray-300 rounded-md p-3 bg-gray-50">
                    <div className="text-sm text-gray-500 text-center py-4">
                      🏙️ Location selection is only available for Batumi
                      <br />
                      <span className="text-xs">Please select Batumi as your city to choose specific locations</span>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Property Details */}
          {propertyType !== PROPERTY_TYPES.LAND && (
            <Card>
              <CardHeader>
                <CardTitle>Property Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <Label>Property Configuration</Label>
                    <div className="border border-gray-300 rounded-md p-3 bg-white">
                      <div className="text-sm text-gray-600 mb-2">Select property types/configurations:</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {
                          [
                            '🏠 Studio Apartment',
                            '🛏️ One Bedroom',
                            '🛏️ Two Bedrooms', 
                            '🛏️ Three Bedrooms',
                            '🛏️ Four Bedrooms',
                            '🛏️ Five+ Bedrooms',
                            '🏰 Penthouse',
                            '🏡 Duplex',
                            '🏘️ Townhouse',
                            '🏛️ Loft',
                            '🌿 Garden Apartment',
                            '🏢 High-rise Unit'
                          ].map((bedroomType) => {
                            const selectedBedrooms = formData.bedrooms;
                            const isSelected = selectedBedrooms.includes(bedroomType);
                            
                            return (
                              <label key={bedroomType} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    const currentBedrooms = formData.bedrooms;
                                    let newBedrooms;
                                    if (e.target.checked) {
                                      newBedrooms = [...currentBedrooms, bedroomType];
                                    } else {
                                      newBedrooms = currentBedrooms.filter((b: string) => b !== bedroomType);
                                    }
                                    setFormData(prev => ({ ...prev, bedrooms: newBedrooms }));
                                  }}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-xs font-medium">{bedroomType}</span>
                              </label>
                            );
                          })
                        }
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label>Bathroom Types</Label>
                    <div className="border border-gray-300 rounded-md p-3 bg-white">
                      <div className="text-sm text-gray-600 mb-2">Select multiple bathroom types:</div>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {[
                          '🚿 Full Bathroom',
                          '🚽 Half Bathroom',
                          '🛁 Master Bathroom',
                          '💄 Powder Room',
                          '♨️ Guest Bathroom',
                          '♿ Accessible Bathroom',
                          '🧖 En-suite Bathroom',
                          '🏊 Pool Bathroom',
                          '🌿 Garden Bathroom',
                          '⭐ Luxury Bathroom'
                        ].map((bathroom) => {
                          const selectedBathrooms = formData.bathrooms;
                          const isSelected = selectedBathrooms.includes(bathroom);
                          
                          return (
                            <label key={bathroom} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const currentBathrooms = formData.bathrooms;
                                  let newBathrooms;
                                  if (e.target.checked) {
                                    newBathrooms = [...currentBathrooms, bathroom];
                                  } else {
                                    newBathrooms = currentBathrooms.filter((b: string) => b !== bathroom);
                                  }
                                  setFormData(prev => ({ ...prev, bathrooms: newBathrooms }));
                                }}
                                className="rounded border-gray-300"
                              />
                              <span className="text-xs font-medium">{bathroom}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {propertyType === PROPERTY_TYPES.APARTMENT && (
                    <div>
                      <Label htmlFor="floorNumber">Floor Number</Label>
                      <Input
                        id="floorNumber"
                        type="number"
                        value={formData.floorNumber}
                        onChange={(e) => handleInputChange('floorNumber', e.target.value)}
                        placeholder="Which floor"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="purpose">Purpose *</Label>
                  <Select 
                    value={formData.purpose} 
                    onValueChange={(value) => handleInputChange('purpose', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select purpose" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="buy">🏠 For Sale</SelectItem>
                      <SelectItem value="rent">🏡 For Rent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Rental-specific fields */}
                {formData.purpose === 'rent' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="rentalPeriod">Rental Period</Label>
                        <Select 
                          value={formData.rentalPeriod || ''} 
                          onValueChange={(value) => handleInputChange('rentalPeriod', value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select rental period" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="monthly">📅 Monthly</SelectItem>
                            <SelectItem value="quarterly">📅 Quarterly (3 months)</SelectItem>
                            <SelectItem value="semi-annual">📅 Semi-Annual (6 months)</SelectItem>
                            <SelectItem value="annual">📅 Annual (12 months)</SelectItem>
                            <SelectItem value="long-term">📅 Long-term (2+ years)</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div>
                        <Label htmlFor="furnished">Furnished Status</Label>
                        <Select 
                          value={formData.furnished || ''} 
                          onValueChange={(value) => handleInputChange('furnished', value)}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Select furnished status" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="furnished">🛋️ Fully Furnished</SelectItem>
                            <SelectItem value="semi-furnished">🪑 Semi-Furnished</SelectItem>
                            <SelectItem value="unfurnished">📦 Unfurnished</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="securityDeposit">Security Deposit</Label>
                        <Input
                          id="securityDeposit"
                          type="text"
                          value={formData.securityDeposit || ''}
                          onChange={(e) => handleInputChange('securityDeposit', e.target.value)}
                          placeholder="e.g., $2,000 or 1 month rent"
                        />
                      </div>

                      <div>
                        <Label htmlFor="availableFrom">Available From</Label>
                        <Input
                          id="availableFrom"
                          type="date"
                          value={formData.availableFrom || ''}
                          onChange={(e) => handleInputChange('availableFrom', e.target.value)}
                        />
                      </div>
                    </div>

                    <div>
                      <Label>Utilities Included</Label>
                      <div className="border border-gray-300 rounded-md p-3 bg-white">
                        <div className="text-sm text-gray-600 mb-2">Select included utilities:</div>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          {[
                            '💡 Electricity',
                            '🚰 Water',
                            '🔥 Gas',
                            '🌐 Internet/WiFi',
                            '📺 Cable TV',
                            '🗑️ Trash Collection',
                            '❄️ Heating',
                            '❄️ Air Conditioning'
                          ].map((utility) => {
                            const selectedUtilities = formData.utilitiesIncluded;
                            const isSelected = selectedUtilities.includes(utility);
                            
                            return (
                              <label key={utility} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    const currentUtilities = formData.utilitiesIncluded;
                                    let newUtilities;
                                    if (e.target.checked) {
                                      newUtilities = [...currentUtilities, utility];
                                    } else {
                                      newUtilities = currentUtilities.filter((u: string) => u !== utility);
                                    }
                                    setFormData(prev => ({ ...prev, utilitiesIncluded: newUtilities }));
                                  }}
                                  className="rounded border-gray-300"
                                />
                                <span className="text-xs font-medium">{utility}</span>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    </div>

                    <div>
                      <Label>Pet Policy</Label>
                      <Select 
                        value={formData.petPolicy || ''} 
                        onValueChange={(value) => handleInputChange('petPolicy', value)}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select pet policy" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pets-allowed">🐕 Pets Allowed</SelectItem>
                          <SelectItem value="cats-only">🐱 Cats Only</SelectItem>
                          <SelectItem value="dogs-only">🐕 Dogs Only</SelectItem>
                          <SelectItem value="small-pets">🐹 Small Pets Only</SelectItem>
                          <SelectItem value="no-pets">🚫 No Pets</SelectItem>
                          <SelectItem value="negotiable">💬 Negotiable</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          )}

          {/* Rental Terms - Only for rental properties */}
          {formData.purpose === 'rent' && (
            <Card>
              <CardHeader>
                <CardTitle>Rental Terms & Conditions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="leaseDuration">Minimum Lease Duration</Label>
                  <Select 
                    value={formData.leaseDuration || ''} 
                    onValueChange={(value) => handleInputChange('leaseDuration', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select minimum lease duration" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1-month">1 Month</SelectItem>
                      <SelectItem value="3-months">3 Months</SelectItem>
                      <SelectItem value="6-months">6 Months</SelectItem>
                      <SelectItem value="12-months">12 Months</SelectItem>
                      <SelectItem value="24-months">24 Months</SelectItem>
                      <SelectItem value="flexible">Flexible</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="rentalTerms">Additional Rental Terms</Label>
                  <textarea
                    id="rentalTerms"
                    className="w-full min-h-[100px] p-3 border border-gray-300 rounded-md resize-vertical"
                    value={formData.rentalTerms || ''}
                    onChange={(e) => handleInputChange('rentalTerms', e.target.value)}
                    placeholder="Enter any additional rental terms, conditions, or requirements..."
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {/* Price Section - Updated for rental/sale context */}
          <Card>
            <CardHeader>
              <CardTitle>
                {formData.purpose === 'rent' ? 'Rental Price' : 'Sale Price'}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="price">
                  {formData.purpose === 'rent' ? 'Monthly Rental Price *' : 'Sale Price *'}
                </Label>
                <Select value={formData.price} onValueChange={(value) => handleInputChange('price', value)}>
                  <SelectTrigger>
                    <SelectValue placeholder={formData.purpose === 'rent' ? "Select monthly rent..." : "Select price range..."} />
                  </SelectTrigger>
                  <SelectContent className="max-h-64 overflow-y-auto">
                    {formData.purpose === 'rent' ? (
                      // Rental prices (monthly)
                      <>
                        <SelectItem value="500">$500/month</SelectItem>
                        <SelectItem value="750">$750/month</SelectItem>
                        <SelectItem value="1000">$1,000/month</SelectItem>
                        <SelectItem value="1250">$1,250/month</SelectItem>
                        <SelectItem value="1500">$1,500/month</SelectItem>
                        <SelectItem value="1750">$1,750/month</SelectItem>
                        <SelectItem value="2000">$2,000/month</SelectItem>
                        <SelectItem value="2500">$2,500/month</SelectItem>
                        <SelectItem value="3000">$3,000/month</SelectItem>
                        <SelectItem value="3500">$3,500/month</SelectItem>
                        <SelectItem value="4000">$4,000/month</SelectItem>
                        <SelectItem value="4500">$4,500/month</SelectItem>
                        <SelectItem value="5000">$5,000/month</SelectItem>
                        <SelectItem value="6000">$6,000/month</SelectItem>
                        <SelectItem value="7000">$7,000/month</SelectItem>
                        <SelectItem value="8000">$8,000/month</SelectItem>
                        <SelectItem value="9000">$9,000/month</SelectItem>
                        <SelectItem value="10000">$10,000/month</SelectItem>
                        <SelectItem value="12500">$12,500/month</SelectItem>
                        <SelectItem value="15000">$15,000/month</SelectItem>
                        <SelectItem value="20000">$20,000/month</SelectItem>
                        <SelectItem value="25000">$25,000+/month</SelectItem>
                      </>
                    ) : (
                      // Sale prices
                      <>
                        <SelectItem value="5000">$5,000</SelectItem>
                        <SelectItem value="10000">$10,000</SelectItem>
                        <SelectItem value="15000">$15,000</SelectItem>
                        <SelectItem value="20000">$20,000</SelectItem>
                        <SelectItem value="25000">$25,000</SelectItem>
                        <SelectItem value="30000">$30,000</SelectItem>
                        <SelectItem value="35000">$35,000</SelectItem>
                        <SelectItem value="40000">$40,000</SelectItem>
                        <SelectItem value="45000">$45,000</SelectItem>
                        <SelectItem value="50000">$50,000</SelectItem>
                        <SelectItem value="60000">$60,000</SelectItem>
                        <SelectItem value="70000">$70,000</SelectItem>
                        <SelectItem value="80000">$80,000</SelectItem>
                        <SelectItem value="90000">$90,000</SelectItem>
                        <SelectItem value="100000">$100,000</SelectItem>
                        <SelectItem value="125000">$125,000</SelectItem>
                        <SelectItem value="150000">$150,000</SelectItem>
                        <SelectItem value="175000">$175,000</SelectItem>
                        <SelectItem value="200000">$200,000</SelectItem>
                        <SelectItem value="225000">$225,000</SelectItem>
                        <SelectItem value="250000">$250,000</SelectItem>
                        <SelectItem value="275000">$275,000</SelectItem>
                        <SelectItem value="300000">$300,000</SelectItem>
                        <SelectItem value="325000">$325,000</SelectItem>
                        <SelectItem value="350000">$350,000</SelectItem>
                        <SelectItem value="375000">$375,000</SelectItem>
                        <SelectItem value="400000">$400,000</SelectItem>
                        <SelectItem value="425000">$425,000</SelectItem>
                        <SelectItem value="450000">$450,000</SelectItem>
                        <SelectItem value="475000">$475,000</SelectItem>
                        <SelectItem value="500000">$500,000</SelectItem>
                        <SelectItem value="550000">$550,000</SelectItem>
                        <SelectItem value="600000">$600,000</SelectItem>
                        <SelectItem value="650000">$650,000</SelectItem>
                        <SelectItem value="700000">$700,000</SelectItem>
                        <SelectItem value="750000">$750,000</SelectItem>
                        <SelectItem value="800000">$800,000</SelectItem>
                        <SelectItem value="850000">$850,000</SelectItem>
                        <SelectItem value="900000">$900,000</SelectItem>
                        <SelectItem value="950000">$950,000</SelectItem>
                        <SelectItem value="1000000">$1,000,000</SelectItem>
                        <SelectItem value="1100000">$1,100,000</SelectItem>
                        <SelectItem value="1200000">$1,200,000</SelectItem>
                        <SelectItem value="1300000">$1,300,000</SelectItem>
                        <SelectItem value="1400000">$1,400,000</SelectItem>
                        <SelectItem value="1500000">$1,500,000</SelectItem>
                        <SelectItem value="1600000">$1,600,000</SelectItem>
                        <SelectItem value="1700000">$1,700,000</SelectItem>
                        <SelectItem value="1800000">$1,800,000</SelectItem>
                        <SelectItem value="1900000">$1,900,000</SelectItem>
                        <SelectItem value="2000000">$2,000,000</SelectItem>
                      </>
                    )}
                  </SelectContent>
                </Select>
              </div>
              
              {formData.purpose === 'rent' && (
                <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
                  💡 <strong>Tip:</strong> Include utilities, parking, or other costs in the description if they're separate from the base rent.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Facilities */}
          <Card>
            <CardHeader>
              <CardTitle>Facilities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border border-gray-300 rounded-md p-3 bg-white">
                <div className="text-sm text-gray-600 mb-3">Select multiple facilities:</div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
                  {[
                    // Basic Amenities
                    '🏊 Swimming Pool',
                    '💪 Gym/Fitness Center',
                    '🚗 Parking',
                    '🌿 Balcony',
                    '🌺 Garden',
                    '❄️ Air Conditioning',
                    '🔥 Heating',
                    '🔒 Security System',
                    '🛗 Elevator',
                    '📶 WiFi',
                    '👔 Laundry Room',
                    '🍽️ Dishwasher',
                    '🔥 Fireplace',
                    
                    // Views & Outdoor Spaces
                    '🌊 Sea View',
                    '🏔️ Mountain View',
                    '🏙️ City View',
                    '🌲 Forest View',
                    '🌾 Garden View',
                    '🌅 Sunrise View',
                    '🌇 Sunset View',
                    '🌉 Bridge View',
                    '⛰️ Valley View',
                    '🏞️ Lake View',
                    '🌸 Courtyard View',
                    '☀️ Terrace',
                    '🏛️ Balcony with Columns',
                    '🌴 Palm Tree Garden',
                    '🌿 Zen Garden',
                    '🌺 Tropical Garden',
                    '🍃 Herb Garden',
                    '🌹 Rose Garden',
                    '🌻 Flower Garden',
                    '🌳 Private Garden',
                    '🌲 Pine Garden',
                    '🎋 Bamboo Garden',
                    
                    // Recreational Facilities
                    '🎾 Tennis Court',
                    '🏸 Badminton Court',
                    '🏐 Volleyball Court',
                    '⚽ Football Field',
                    '🏀 Basketball Court',
                    '🏓 Ping Pong Table',
                    '🎱 Billiards Room',
                    '🎯 Dart Board',
                    '🎮 Game Room',
                    '🎬 Cinema Room',
                    '🎭 Theater Room',
                    '🎨 Art Studio',
                    '🎵 Music Room',
                    '🎹 Piano Room',
                    '🥁 Drum Room',
                    '📚 Library',
                    '📖 Reading Nook',
                    '🧩 Puzzle Room',
                    '🎪 Event Space',
                    '💃 Dance Studio',
                    '🎤 Karaoke Room',
                    
                    // Water Features
                    '🚿 Jacuzzi/Hot Tub',
                    '💦 Indoor Pool',
                    '🏊 Outdoor Pool',
                    '♨️ Hot Springs',
                    '⛲ Fountain',
                    '🌊 Infinity Pool',
                    '🏊 Lap Pool',
                    '👶 Kids Pool',
                    '🦆 Koi Pond',
                    '🌊 Water Slide',
                    '💧 Waterfall Feature',
                    '🛁 Bathtub',
                    '🚿 Walk-in Shower',
                    '🚿 Rain Shower',
                    '💨 Steam Room',
                    '❄️ Sauna',
                    '🧊 Cold Plunge Pool',
                    
                    // Security & Safety
                    '🛡️ Gated Community',
                    '👮 24/7 Security',
                    '📷 CCTV',
                    '🚪 Smart Locks',
                    '🔐 Biometric Access',
                    '🚨 Alarm System',
                    '🚪 Intercom System',
                    '🛡️ Panic Room',
                    '🔥 Fire Sprinkler System',
                    '💨 Smoke Detection',
                    '⚠️ Emergency Exit',
                    '🚑 Emergency Response',
                    
                    // Technology & Smart Features
                    '🌡️ Smart Home System',
                    '📱 Home Automation',
                    '🔌 Electric Car Charging',
                    '⚡ Tesla Charging Station',
                    '🔌 USB Outlets',
                    '📺 Smart TV',
                    '🎵 Surround Sound',
                    '💡 LED Lighting',
                    '🌈 Color-changing Lights',
                    '📡 Satellite Internet',
                    '🖥️ Built-in Monitors',
                    '🎮 Gaming Setup',
                    '💻 Work Station',
                    '📞 Video Conferencing',
                    '🔊 Intercom System',
                    
                    // Storage & Utility
                    '🚘 Garage',
                    '☂️ Covered Parking',
                    '🔧 Storage Room',
                    '🧰 Tool Shed',
                    '📦 Package Room',
                    '🍷 Wine Cellar',
                    '❄️ Cold Storage',
                    '🗄️ File Storage',
                    '👗 Walk-in Closet',
                    '👠 Shoe Closet',
                    '🧥 Coat Closet',
                    '🧴 Linen Closet',
                    '📚 Book Storage',
                    '🎿 Sports Equipment Storage',
                    '⚡ Generator',
                    '🔋 Solar Panels',
                    '💡 Backup Power',
                    '🌬️ Wind Power',
                    
                    // Kitchen & Dining
                    '🍳 Modern Kitchen',
                    "👨‍🍳 Chef's Kitchen",
                    '🍰 Baking Kitchen',
                    '🍷 Wine Bar',
                    '🍸 Cocktail Bar',
                    '☕ Coffee Bar',
                    '🧊 Ice Maker',
                    '🍖 BBQ Area',
                    '🔥 Outdoor Kitchen',
                    '🍕 Pizza Oven',
                    '🍞 Bread Oven',
                    '🍯 Pantry',
                    '❄️ Walk-in Freezer',
                    '🥘 Spice Kitchen',
                    '🍣 Sushi Counter',
                    '🥗 Salad Bar',
                    '🍽️ Dining Room',
                    '🕯️ Formal Dining',
                    '🌅 Breakfast Nook',
                    
                    // Bedrooms & Living
                    '🛏️ Master Suite',
                    '🛏️ Guest Room',
                    '👶 Nursery',
                    '🧒 Kids Room',
                    '👦 Teen Room',
                    '🛋️ Living Room',
                    '🛋️ Family Room',
                    '🛋️ Sitting Room',
                    '☕ Morning Room',
                    '🌅 Sunroom',
                    '🪟 Bay Window',
                    '🛏️ Murphy Bed',
                    '🛏️ Bunk Beds',
                    '🛏️ Canopy Bed',
                    '💺 Reading Chair',
                    '🪑 Rocking Chair',
                    
                    // Wellness & Health
                    '🧘 Yoga Room',
                    '🏋️ Weight Room',
                    '🤸 Pilates Studio',
                    '💆 Massage Room',
                    '🧘 Meditation Room',
                    '💨 Oxygen Bar',
                    '🌿 Aromatherapy Room',
                    '💎 Crystal Healing Room',
                    '🌡️ Infrared Sauna',
                    '❄️ Cryotherapy Chamber',
                    '💧 Float Tank',
                    '🌺 Spa Room',
                    '💅 Beauty Salon',
                    '✂️ Barber Shop',
                    '🦷 Dental Care Room',
                    '⚕️ Medical Room',
                    '💊 Pharmacy',
                    '🏥 First Aid Station',
                    
                    // Work & Business
                    '🏢 Office Space',
                    '💼 Executive Office',
                    '👥 Meeting Room',
                    '📊 Conference Room',
                    '📞 Phone Booth',
                    '💻 Computer Lab',
                    '🖨️ Print Center',
                    '📠 Communication Center',
                    '📋 Reception Area',
                    '☕ Business Lounge',
                    '📈 Presentation Room',
                    '🎓 Training Room',
                    '📚 Study Room',
                    '✍️ Writing Desk',
                    '📝 Drafting Table',
                    
                    // Cultural & Religious
                    '🕌 Prayer Room',
                    '⛪ Chapel',
                    '🕯️ Meditation Space',
                    '🧘 Buddhist Shrine',
                    '✡️ Synagogue Room',
                    '🕉️ Hindu Temple',
                    '☪️ Islamic Prayer Room',
                    '🛕 Spiritual Center',
                    '🎭 Cultural Hall',
                    '🏮 Tea Ceremony Room',
                    '🎌 Japanese Room',
                    '🐉 Chinese Garden',
                    '🌸 Cherry Blossom View',
                    '🏛️ Roman Columns',
                    '🗿 Sculpture Garden',
                    
                    // Climate Control
                    '🌬️ Central Air',
                    '❄️ Zone Cooling',
                    '🔥 Radiant Heating',
                    '🌡️ Underfloor Heating',
                    '🌊 Geothermal System',
                    '💨 Ventilation System',
                    '🌪️ Air Purification',
                    '💧 Humidity Control',
                    '🌡️ Climate Control',
                    '☀️ Solar Heating',
                    '🔥 Wood Burning Stove',
                    '⚡ Electric Heating',
                    '🌊 Water Cooling',
                    '❄️ Evaporative Cooling',
                    
                    // Service Areas
                    '🏠 Maid Room',
                    '👨‍💼 Concierge',
                    '🧹 Housekeeping Service',
                    "👔 Butler's Pantry",
                    '🛎️ Service Elevator',
                    '🚪 Service Entrance',
                    '🧺 Laundry Chute',
                    '🧽 Cleaning Station',
                    '🗂️ Utility Room',
                    '🔧 Maintenance Room',
                    '⚙️ Mechanical Room',
                    '💧 Water Treatment',
                    '🔌 Electrical Room',
                    '📡 Telecom Room',
                    
                    // Accessibility Features
                    '♿ Wheelchair Access',
                    '🛗 Accessible Elevator',
                    '🚿 Roll-in Shower',
                    '🚽 Accessible Bathroom',
                    '🔊 Audio Assistance',
                    '👁️ Visual Assistance',
                    '🤝 Mobility Assistance',
                    '📱 Communication Aid',
                    '🛏️ Adjustable Bed',
                    '🪑 Lift Chair',
                    '🚪 Wide Doorways',
                    '🛤️ Ramp Access',
                    '🔊 Emergency Alert',
                    
                    // Children & Family
                    '👶 Playground',
                    '🎨 Art Room',
                    '🧸 Toy Room',
                    '📚 Homework Station',
                    '🎮 Gaming Den',
                    '🍼 Feeding Room',
                    '🛁 Baby Bath',
                    '👶 Diaper Station',
                    '🍼 Bottle Warmer',
                    '🛏️ Crib Room',
                    '🎪 Play Area',
                    '🎠 Indoor Playground',
                    '🏰 Playhouse',
                    '🌈 Colorful Rooms',
                    
                    // Luxury Features
                    '🌅 Rooftop Access',
                    '🛩️ Helipad',
                    '⛵ Private Dock',
                    '🛥️ Boat House',
                    '🏰 Tower Room',
                    '👑 Royal Suite',
                    '💎 Jewelry Vault',
                    '🏛️ Grand Entrance',
                    '🕯️ Chandelier Hall',
                    '🏺 Antique Display',
                    '🖼️ Art Gallery',
                    '🎭 Performance Stage',
                    '🍾 Champagne Cellar',
                    '🥂 Tasting Room',
                    '💍 Dressing Room',
                    
                    // Unique Global Features
                    '🏔️ Alpine Cabin Style',
                    '🏖️ Beach House Deck',
                    '🌴 Tropical Veranda',
                    '🏜️ Desert Courtyard',
                    '❄️ Snow Room',
                    '🌋 Lava Rock Features',
                    '🌊 Tidal Pool',
                    '🦋 Butterfly Garden',
                    '🐦 Bird Watching Area',
                    '🌙 Astronomy Deck',
                    '⭐ Star Gazing Room',
                    '🌿 Greenhouse',
                    '🍄 Mushroom Farm',
                    '🐝 Bee Hives',
                    '🐟 Fish Farm',
                    '🍇 Vineyard',
                    '🌾 Grain Storage',
                    '🚁 Landing Pad',
                    '🎪 Circus Room',
                    '🎡 Ferris Wheel View'
                  ].map((facility) => {
                    const selectedFacilities = formData.features;
                    const isSelected = selectedFacilities.includes(facility);
                    
                    return (
                      <label key={facility} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            const currentFacilities = formData.features;
                            let newFacilities;
                            if (e.target.checked) {
                              newFacilities = [...currentFacilities, facility];
                            } else {
                              newFacilities = currentFacilities.filter((f: string) => f !== facility);
                            }
                            setFormData(prev => ({ ...prev, features: newFacilities }));
                          }}
                          className="rounded border-gray-300"
                        />
                        <span className="text-xs font-medium">{facility}</span>
                      </label>
                    );
                  })}
                </div>
                {formData.features && formData.features.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="text-xs text-gray-500 mb-2">Selected facilities:</div>
                    <div className="flex flex-wrap gap-1">
                      {formData.features.filter((feature: string) => feature).map((feature: string) => (
                        <Badge key={feature} variant="secondary" className="text-xs flex items-center space-x-1">
                          <span>{feature}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const currentFacilities = formData.features;
                              const newFacilities = currentFacilities.filter((f: string) => f !== feature);
                              setFormData(prev => ({ ...prev, features: newFacilities }));
                            }}
                            className="ml-1 hover:text-red-500"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Custom facility input */}
              <div className="border-t border-gray-200 pt-4">
                <div className="text-sm text-gray-600 mb-2">Add custom facility:</div>
                <div className="flex space-x-2">
                  <Input
                    value={newFeature}
                    onChange={(e) => setNewFeature(e.target.value)}
                    placeholder="Add a custom facility..."
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())}
                  />
                  <Button type="button" onClick={addFeature}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Amenities */}
          <Card>
            <CardHeader>
              <CardTitle>Amenities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="border border-gray-300 rounded-md p-3 bg-white">
                <div className="text-sm text-gray-600 mb-3">Select multiple luxury amenities:</div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-64 overflow-y-auto">
                  {[
                    '💎 Concierge Service',
                    '🍾 Private Chef Service',
                    '🧹 Housekeeping Service',
                    '🚗 Valet Parking',
                    '🛩️ Helipad Access',
                    '⛵ Private Marina',
                    '🎭 Private Theater',
                    '🍸 Wine Tasting Room',
                    '💆 Private Spa',
                    '🏌️ Golf Simulator',
                    '🎳 Bowling Alley',
                    '🏊 Infinity Pool',
                    '🌊 Private Beach Access',
                    '🏔️ Mountain Retreat',
                    '🛥️ Yacht Club Access',
                    '🎯 Private Club Membership',
                    '🥂 Butler Service',
                    '💼 Business Center',
                    '🎪 Event Planning Service',
                    '🌺 Landscaping Service',
                    '🚁 Private Transport',
                    '🍰 Personal Chef Kitchen',
                    '🍷 Climate-controlled Wine Cellar',
                    '🎵 Professional Music Studio',
                    '📸 Photography Studio',
                    '🏋️ Personal Trainer Access',
                    '🧘 Meditation Garden',
                    '🌿 Herb Garden',
                    '🦢 Private Lake',
                    '⛲ Water Features',
                    '🌙 Observatory Deck',
                    '🔥 Fire Pit Area',
                    '🏰 Castle-style Architecture',
                    '🎨 Art Gallery Space',
                    '📚 Private Library',
                    '🎹 Grand Piano Room',
                    '💍 Jewelry Safe Room',
                    '🛡️ Panic Room',
                    '🌡️ Climate Control System',
                    '💨 Air Purification System',
                    '🚿 Steam Room',
                    '❄️ Sauna',
                    '🧊 Ice Room',
                    '🍀 Indoor Garden',
                    '🦋 Butterfly Conservatory',
                    '🐠 Aquarium Room',
                    '🕊️ Aviary',
                    '🏺 Antique Collection Display',
                    '💎 Crystal Chandelier Collection',
                    '🏛️ Marble Features Throughout',
                    '✨ Gold-plated Fixtures',
                    '🌟 Swarovski Crystal Details',
                    '🎆 LED Light Show System',
                    '🎪 Automated Home Features',
                    '📱 Smart Home Integration'
                  ].map((amenity) => {
                    const selectedAmenities = Array.isArray(formData.amenities) ? formData.amenities : (formData.amenities ? formData.amenities.toString().split(',') : []);
                    const isSelected = selectedAmenities.includes(amenity);
                    
                    return (
                      <label key={amenity} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            const currentAmenities = Array.isArray(formData.amenities) ? formData.amenities : (formData.amenities ? formData.amenities.toString().split(',') : []);
                            let newAmenities;
                            if (e.target.checked) {
                              newAmenities = [...currentAmenities, amenity];
                            } else {
                              newAmenities = currentAmenities.filter((a: string) => a !== amenity);
                            }
                            setFormData(prev => ({ ...prev, amenities: newAmenities }));
                          }}
                          className="rounded border-gray-300"
                        />
                        <span className="text-xs font-medium">{amenity}</span>
                      </label>
                    );
                  })}
                </div>
                {formData.amenities && formData.amenities.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-gray-200">
                    <div className="text-xs text-gray-500 mb-2">Selected amenities:</div>
                    <div className="flex flex-wrap gap-1">
                      {(Array.isArray(formData.amenities) ? formData.amenities : formData.amenities.toString().split(',')).filter((amenity: string) => amenity).map((amenity: string) => (
                        <Badge key={amenity} variant="secondary" className="text-xs flex items-center space-x-1">
                          <span>{amenity}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const currentAmenities = Array.isArray(formData.amenities) ? formData.amenities : formData.amenities.toString().split(',');
                              const newAmenities = currentAmenities.filter((a: string) => a !== amenity);
                              setFormData(prev => ({ ...prev, amenities: newAmenities }));
                            }}
                            className="ml-1 hover:text-red-500"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Custom amenity input */}
              <div className="border-t border-gray-200 pt-4">
                <div className="text-sm text-gray-600 mb-2">Add custom amenity:</div>
                <div className="flex space-x-2">
                  <Input
                    value={newAmenity}
                    onChange={(e) => setNewAmenity(e.target.value)}
                    placeholder="Add a custom luxury amenity..."
                    onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addAmenity())}
                  />
                  <Button type="button" onClick={addAmenity}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Photos & Videos Section */}
          <div className="space-y-6">
            <PhotoUploader
              maxPhotos={30}
              onPhotosChange={(photos) => setFormData(prev => ({ ...prev, images: photos }))}
              initialPhotos={formData.images}
            />
            
            <VideoUploader
              onVideosChange={(videos) => setFormData(prev => ({ ...prev, videos: videos }))}
              initialVideos={formData.videos}
            />
          </div>

          {/* Submit Button */}
          <div className="flex justify-end space-x-4">
            <Link href="/submit-property">
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Submitting...' : `Submit ${getPropertyTypeTitle(propertyType)}`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default PropertyForm;