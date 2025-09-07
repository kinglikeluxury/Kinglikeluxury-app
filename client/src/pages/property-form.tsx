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

const PropertyForm = () => {
  const { user, isLoading } = useAuth();
  const { t } = useTranslation();
  const [location] = useLocation();
  
  // Get property type from URL params
  const urlParams = new URLSearchParams(location.split('?')[1] || '');
  const propertyType = urlParams.get('type') || '';
  
  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    price: '',
    location: '',
    country: '',
    city: '',
    area: '',
    bedrooms: '',
    bathrooms: '',
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
    rentalTerms: ''
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
      // Prepare submission data
      const submissionData = {
        ...formData,
        propertyType,
        price: parseInt(formData.price),
        area: parseInt(formData.area),
        bedrooms: formData.bedrooms ? parseInt(formData.bedrooms) : null,
        bathrooms: formData.bathrooms ? parseInt(formData.bathrooms) : null,
        floorNumber: formData.floorNumber ? parseInt(formData.floorNumber) : null,
        images: [], // TODO: Add image upload functionality
        videos: []
      };

      // TODO: Submit to API
      console.log('Submitting property:', submissionData);
      
      // Simulate API call
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Redirect to success or properties page
      window.location.href = '/properties';
      
    } catch (error) {
      console.error('Error submitting property:', error);
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
                    <Label htmlFor="bedrooms">Property Type</Label>
                    <Select 
                      value={formData.bedrooms} 
                      onValueChange={(value) => handleInputChange('bedrooms', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select property type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="0">Studio</SelectItem>
                        <SelectItem value="1">One Bedroom</SelectItem>
                        <SelectItem value="2">Two Bedrooms</SelectItem>
                        <SelectItem value="3">Three Bedrooms</SelectItem>
                        <SelectItem value="penthouse">Penthouse</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label htmlFor="bathrooms">Bathrooms</Label>
                    <Input
                      id="bathrooms"
                      type="number"
                      value={formData.bathrooms}
                      onChange={(e) => handleInputChange('bathrooms', e.target.value)}
                      placeholder="Number of bathrooms"
                    />
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
                            const selectedUtilities = Array.isArray(formData.utilitiesIncluded) ? formData.utilitiesIncluded : (formData.utilitiesIncluded ? formData.utilitiesIncluded.toString().split(',') : []);
                            const isSelected = selectedUtilities.includes(utility);
                            
                            return (
                              <label key={utility} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={(e) => {
                                    const currentUtilities = Array.isArray(formData.utilitiesIncluded) ? formData.utilitiesIncluded : (formData.utilitiesIncluded ? formData.utilitiesIncluded.toString().split(',') : []);
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
                    '🌊 Sea View',
                    '🏔️ Mountain View',
                    '🏙️ City View',
                    '☀️ Terrace',
                    '🎾 Tennis Court',
                    '🛡️ Gated Community',
                    '🚿 Jacuzzi/Hot Tub',
                    '🌳 Private Garden',
                    '🚘 Garage',
                    '⚡ Generator',
                    '🔧 Storage Room',
                    '👨‍💼 Concierge',
                    '🎮 Game Room',
                    '📚 Library',
                    '🍸 Bar Area',
                    '🍖 BBQ Area',
                    '👶 Playground',
                    '🎬 Cinema Room',
                    '🍷 Wine Cellar',
                    '🏠 Maid Room',
                    '👮 24/7 Security',
                    '📷 CCTV',
                    '🚪 Smart Locks',
                    '🌡️ Smart Home System',
                    '🔌 Electric Car Charging',
                    '☂️ Covered Parking',
                    '🛁 Bathtub',
                    '🚿 Walk-in Shower',
                    '👔 Walk-in Closet',
                    '🍳 Modern Kitchen',
                    '🏢 Office Space',
                    '🎨 Art Studio',
                    '🧘 Yoga Room',
                    '🛏️ Guest Room',
                    '🌅 Rooftop Access',
                    '🎪 Event Space'
                  ].map((facility) => {
                    const selectedFacilities = Array.isArray(formData.features) ? formData.features : (formData.features ? formData.features.toString().split(',') : []);
                    const isSelected = selectedFacilities.includes(facility);
                    
                    return (
                      <label key={facility} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            const currentFacilities = Array.isArray(formData.features) ? formData.features : (formData.features ? formData.features.toString().split(',') : []);
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
                      {(Array.isArray(formData.features) ? formData.features : formData.features.toString().split(',')).filter((feature: string) => feature).map((feature: string) => (
                        <Badge key={feature} variant="secondary" className="text-xs flex items-center space-x-1">
                          <span>{feature}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const currentFacilities = Array.isArray(formData.features) ? formData.features : formData.features.toString().split(',');
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

          {/* Images Section */}
          <Card>
            <CardHeader>
              <CardTitle>Property Images</CardTitle>
              <p className="text-sm text-gray-600">Upload high-quality photos to showcase your property</p>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Image Upload Specifications */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-blue-900 mb-2">📸 Photo Requirements</h4>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-blue-800">
                  <div className="flex items-center space-x-2">
                    <span className="bg-blue-200 px-2 py-1 rounded font-medium">📊 Maximum Size:</span>
                    <span>5MB per image</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="bg-blue-200 px-2 py-1 rounded font-medium">🔢 Maximum Count:</span>
                    <span>20 photos total</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="bg-blue-200 px-2 py-1 rounded font-medium">📐 Recommended Size:</span>
                    <span>1920x1080px or higher</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="bg-blue-200 px-2 py-1 rounded font-medium">🖼️ Formats:</span>
                    <span>JPG, PNG, WebP</span>
                  </div>
                </div>
              </div>

              {/* Upload Area */}
              <div className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center hover:border-blue-400 hover:bg-blue-50/30 transition-colors">
                <div className="bg-gradient-to-br from-blue-100 to-indigo-100 w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Upload className="h-10 w-10 text-blue-600" />
                </div>
                <h3 className="text-lg font-semibold text-gray-700 mb-2">Upload Property Photos</h3>
                <p className="text-gray-500 mb-4">Drag and drop your photos here, or click to browse</p>
                
                {/* Upload Button */}
                <div className="space-y-3">
                  <button 
                    type="button"
                    className="bg-gradient-to-r from-blue-500 to-indigo-600 text-white px-6 py-3 rounded-lg font-medium hover:from-blue-600 hover:to-indigo-700 transition-colors shadow-lg"
                  >
                    📁 Choose Photos
                  </button>
                  <p className="text-xs text-gray-400">Maximum 20 photos, 5MB each</p>
                </div>
              </div>

              {/* Photo Categories */}
              <div className="bg-gradient-to-r from-green-50 to-emerald-50 border border-green-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-green-900 mb-3">📋 Recommended Photo Types</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                  {[
                    '🏠 Exterior Views',
                    '🛋️ Living Areas',
                    '🍳 Kitchen',
                    '🛏️ Bedrooms',
                    '🚿 Bathrooms',
                    '🌿 Outdoor Spaces',
                    '🚗 Parking Areas',
                    '🏢 Building/Complex'
                  ].map((category) => (
                    <div key={category} className="bg-white/70 rounded p-2 text-center font-medium text-green-800">
                      {category}
                    </div>
                  ))}
                </div>
              </div>

              {/* Photo Tips */}
              <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-lg p-4">
                <h4 className="text-sm font-semibold text-amber-900 mb-2">💡 Pro Photography Tips</h4>
                <div className="text-xs text-amber-800 space-y-1">
                  <div className="flex items-start space-x-2">
                    <span>🌅</span>
                    <span>Take photos during golden hour (morning/evening) for best lighting</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span>📐</span>
                    <span>Use wide-angle shots to showcase space and room dimensions</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span>🧹</span>
                    <span>Ensure all areas are clean, decluttered and well-staged</span>
                  </div>
                  <div className="flex items-start space-x-2">
                    <span>🎯</span>
                    <span>Highlight unique features, views, and luxury amenities</span>
                  </div>
                </div>
              </div>

              {/* Upload Status placeholder */}
              <div className="text-center text-gray-500 text-sm">
                <span className="bg-gray-100 px-3 py-2 rounded-full">
                  🚀 Advanced upload functionality coming soon
                </span>
              </div>
            </CardContent>
          </Card>

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