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
    coordinates: { lat: 0, lng: 0 }
  });
  
  const [newFeature, setNewFeature] = useState('');
  const [newAmenity, setNewAmenity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [useMapSelection, setUseMapSelection] = useState(false);
  
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
      features: prev.features.filter(f => f !== feature)
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
      amenities: prev.amenities.filter(a => a !== amenity)
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

  // Handle location selection from map
  const handleMapLocationSelect = (lat: number, lng: number, address: string) => {
    setFormData(prev => ({
      ...prev,
      location: address,
      coordinates: { lat, lng }
    }));
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
                  <Label htmlFor="city">City *</Label>
                  <Select 
                    value={formData.city} 
                    onValueChange={handleCityChange}
                    disabled={!formData.country}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select City" />
                    </SelectTrigger>
                    <SelectContent>
                      {getCitiesForCountry(formData.country).map((cityOption) => (
                        <SelectItem key={cityOption.value} value={cityOption.value}>
                          {cityOption.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="area">Area (m²) *</Label>
                  <div className="border border-gray-300 rounded-md p-3 bg-white">
                    <div className="text-sm text-gray-600 mb-2">Select multiple areas:</div>
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-2 max-h-32 overflow-y-auto">
                      {['39', '45', '50', '55', '60', '65', '70', '75', '80', '85', '90', '95', '100', '105', '110', '115', '120'].map((areaValue) => {
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
                  <div className="space-y-4">
                    <div className="relative">
                      <div className="absolute top-4 left-4 z-[1000] bg-black/80 text-white px-3 py-2 rounded-lg text-sm font-medium">
                        🗺️ Super 3D Map - Click to Select Location
                      </div>
                      <div className="h-96 rounded-xl overflow-hidden border-4 border-blue-200 shadow-2xl transform hover:scale-[1.01] transition-all duration-300">
                        <PropertyMap
                          location={formData.location || 'batumi'}
                          title="Select Location"
                          interactive={true}
                          onLocationSelect={handleMapLocationSelect}
                          className="h-full w-full"
                        />
                      </div>
                    </div>
                    {formData.location && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                        <p className="text-sm text-green-800 font-medium">
                          📍 Selected Location: {formData.location}
                        </p>
                        {formData.coordinates.lat !== 0 && (
                          <p className="text-xs text-green-600 mt-1">
                            Coordinates: {formData.coordinates.lat.toFixed(6)}, {formData.coordinates.lng.toFixed(6)}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <p className="text-sm text-blue-800 font-medium">🎯 How to use:</p>
                      <ul className="text-xs text-blue-600 mt-1 space-y-1">
                        <li>• Click anywhere on the satellite map to select exact location</li>
                        <li>• Zoom in/out using mouse wheel or map controls</li>
                        <li>• Click on street markers for predefined locations</li>
                        <li>• Drag to explore the area</li>
                      </ul>
                    </div>
                  </div>
                ) : formData.city === 'batumi' ? (
                  <Select 
                    value={formData.location} 
                    onValueChange={(value) => handleInputChange('location', value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select Street" />
                    </SelectTrigger>
                    <SelectContent>
                      {getBatumiStreets().map((street) => (
                        <SelectItem key={street.value} value={street.value}>
                          {street.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    id="location"
                    value={formData.location}
                    onChange={(e) => handleInputChange('location', e.target.value)}
                    placeholder="Street address or area name"
                    required
                  />
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
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="buy">For Sale</SelectItem>
                      <SelectItem value="rent">For Rent</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Features */}
          <Card>
            <CardHeader>
              <CardTitle>Features</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex space-x-2">
                <Input
                  value={newFeature}
                  onChange={(e) => setNewFeature(e.target.value)}
                  placeholder="Add a feature..."
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addFeature())}
                />
                <Button type="button" onClick={addFeature}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="flex flex-wrap gap-2">
                {formData.features.map((feature) => (
                  <Badge key={feature} variant="secondary" className="flex items-center space-x-1">
                    <span>{feature}</span>
                    <button
                      type="button"
                      onClick={() => removeFeature(feature)}
                      className="ml-1 hover:text-red-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Amenities */}
          <Card>
            <CardHeader>
              <CardTitle>Amenities</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex space-x-2">
                <Input
                  value={newAmenity}
                  onChange={(e) => setNewAmenity(e.target.value)}
                  placeholder="Add an amenity..."
                  onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addAmenity())}
                />
                <Button type="button" onClick={addAmenity}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              
              <div className="flex flex-wrap gap-2">
                {formData.amenities.map((amenity) => (
                  <Badge key={amenity} variant="secondary" className="flex items-center space-x-1">
                    <span>{amenity}</span>
                    <button
                      type="button"
                      onClick={() => removeAmenity(amenity)}
                      className="ml-1 hover:text-red-500"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Images Section - Placeholder for future implementation */}
          <Card>
            <CardHeader>
              <CardTitle>Images</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
                <Upload className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                <p className="text-gray-500">Image upload functionality coming soon</p>
                <p className="text-sm text-gray-400">You'll be able to upload property images here</p>
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