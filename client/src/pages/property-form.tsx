import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/lib/auth";
import { Redirect, useLocation, useRoute } from "wouter";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import LocationSelector from "@/components/property/LocationSelector";
import { PROPERTY_TYPES, type Property } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { ArrowLeft, Upload, X, Plus, Map, List, MapPin, Star } from "lucide-react";
import { Link } from "wouter";
import { PhotoUploader } from "@/components/PhotoUploader";
import { VideoUploader } from "@/components/VideoUploader";
import ListingTypePopup from "@/components/ListingTypePopup";
import PaymentPopup from "@/components/PaymentPopup";
import { PostPaymentChoicesPopup } from "@/components/PostPaymentChoicesPopup";
import { SubmissionSuccessPopup } from "@/components/SubmissionSuccessPopup";
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const toEnglishDigits = (str: string): string => {
  const digitMaps: Record<string, string> = {
    '٠':'0','١':'1','٢':'2','٣':'3','٤':'4','٥':'5','٦':'6','٧':'7','٨':'8','٩':'9',
    '۰':'0','۱':'1','۲':'2','۳':'3','۴':'4','۵':'5','۶':'6','۷':'7','۸':'8','۹':'9',
    '०':'0','१':'1','२':'2','३':'3','४':'4','५':'5','६':'6','७':'7','८':'8','९':'9',
    '০':'0','১':'1','২':'2','৩':'3','৪':'4','৫':'5','৬':'6','৭':'7','৮':'8','৯':'9',
    '〇':'0','一':'1','二':'2','三':'3','四':'4','五':'5','六':'6','七':'7','八':'8','九':'9',
    '零':'0','壹':'1','贰':'2','叁':'3','肆':'4','伍':'5','陆':'6','柒':'7','捌':'8','玖':'9',
  };
  return str.replace(/[^\d.]/g, (ch) => digitMaps[ch] || '').replace(/[^0-9.]/g, '');
};

const PropertyForm = () => {
  const { user, isLoading } = useAuth();
  const { t } = useTranslation();
  const [location] = useLocation();
  const { toast } = useToast();
  
  // Check if we're in edit mode
  const [, params] = useRoute("/property/:id/edit");
  const propertyId = params?.id ? parseInt(params.id) : null;
  const isEditMode = !!propertyId;
  
  // Get property type from URL params
  const urlParams = new URLSearchParams(location.split('?')[1] || '');
  const urlPropertyType = urlParams.get('type') || '';
  
  // Property type state (can be set from URL or form selection)
  const [propertyType, setPropertyType] = useState(urlPropertyType);
  
  // Fetch existing property data if editing
  const { data: existingProperty, isLoading: isLoadingProperty } = useQuery<Property>({
    queryKey: [`/api/properties/${propertyId}`],
    enabled: isEditMode && !!propertyId,
  });

  console.log('🔍 DEBUG EditMode:', isEditMode, 'PropertyID:', propertyId);
  console.log('📄 Existing property:', existingProperty);
  console.log('⏳ Loading:', isLoadingProperty);
  
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
    videos: [] as string[],
    // Project details for project type properties
    projectDetails: {
      developer: '',
      completionDate: '',
      projectStatus: 'Now Selling'
    },
    // Delivery date
    deliveryDate: '',
    // Ready status
    readyStatus: '',
    // Top rated for off-plan projects
    topRated: false
  });
  
  const [newFeature, setNewFeature] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [newAmenity, setNewAmenity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [useMapSelection, setUseMapSelection] = useState(false);
  
  // Popup states for payment flow
  const [showListingTypePopup, setShowListingTypePopup] = useState(false);
  const [showPaymentPopup, setShowPaymentPopup] = useState(false);
  const [showPostPaymentChoices, setShowPostPaymentChoices] = useState(false);
  const [showSubmissionSuccess, setShowSubmissionSuccess] = useState(false);
  const [selectedListingType, setSelectedListingType] = useState<'free' | 'featured'>('free');
  const [paymentSuccessDetails, setPaymentSuccessDetails] = useState<{
    propertyId: string;
    propertyTitle: string;
    durationDays: number;
    amount: number;
  } | null>(null);

  // Load existing property data when in edit mode
  useEffect(() => {
    if (isEditMode && existingProperty && !isLoadingProperty) {
      console.log('✅ Loading existing property data:', existingProperty);
      
      // Check ownership
      if (!user?.isAdmin && existingProperty.ownerId !== user?.id) {
        toast({
          variant: "destructive",
          title: "Access denied",
          description: "You can only edit your own properties.",
        });
        window.location.href = '/properties';
        return;
      }

      // Parse location into country/city
      const location = existingProperty.location || '';
      let country = '';
      let city = '';
      if (location.includes('Georgia')) {
        country = 'georgia';
        if (location.includes('Batumi')) city = 'batumi';
        else if (location.includes('Tbilisi')) city = 'tbilisi';
      } else if (location.includes('UAE')) {
        country = 'uae';
        if (location.includes('Dubai')) city = 'dubai';
      }

      // Update all form data
      setFormData({
        title: existingProperty.title || '',
        description: existingProperty.description || '',
        price: existingProperty.price?.toString() || '',
        location: existingProperty.location || '',
        country,
        city,
        area: existingProperty.area?.toString() || '',
        bedrooms: existingProperty.bedrooms ? [existingProperty.bedrooms.toString()] : [],
        bathrooms: existingProperty.bathrooms ? [existingProperty.bathrooms.toString()] : [],
        floorNumber: existingProperty.floorNumber?.toString() || '',
        features: existingProperty.features || [],
        amenities: existingProperty.amenities || [],
        purpose: 'buy',
        coordinates: { lat: 0, lng: 0 },
        rentalPeriod: '',
        furnished: '',
        securityDeposit: '',
        availableFrom: '',
        utilitiesIncluded: [],
        petPolicy: '',
        leaseDuration: '',
        rentalTerms: '',
        images: existingProperty.images || [],
        videos: existingProperty.videos || [],
        projectDetails: {
          developer: '',
          completionDate: '',
          projectStatus: 'Now Selling'
        },
        deliveryDate: '',
        readyStatus: (existingProperty as any).readyStatus || '',
        topRated: existingProperty.topRated || false
      });
      
      // Set property type
      setPropertyType(existingProperty.propertyType || '');
    }
  }, [existingProperty, isEditMode, isLoadingProperty, user?.id, user?.isAdmin, toast]);

  useEffect(() => {
    if (!isEditMode) {
      localStorage.removeItem('propertyFormDraft');
    }
  }, [isEditMode]);
  
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
      case "northern-cyprus":
        return [
          { value: "lefkosa", label: "Lefkoşa (Nicosia)" },
          { value: "gazimağusa", label: "Gazimağusa (Famagusta)" },
          { value: "girne", label: "Girne (Kyrenia)" },
          { value: "iskele", label: "İskele" },
          { value: "guzelyurt", label: "Güzelyurt" }
        ];
      default:
        return [];
    }
  };

  const getCityLocations = (cityKey: string): { value: string; label: string }[] => {
    const locations: Record<string, { value: string; label: string }[]> = {
      batumi: [
        { value: "batumi-boulevard", label: "Batumi Boulevard" },
        { value: "old-boulevard", label: "Old Boulevard" },
        { value: "new-boulevard", label: "New Boulevard" },
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
        { value: "gorgiladze-str", label: "Gorgiladze Street" },
        { value: "sherif-khimshiashvili-str", label: "Sherif Khimshiashvili Street" },
        { value: "kostava-str", label: "Kostava Street" },
        { value: "javakhishvili-str", label: "Javakhishvili Street" },
        { value: "batumi-old-town", label: "Old Town (Batumi)" },
        { value: "batumi-port", label: "Batumi Port Area" },
        { value: "batumi-airport-area", label: "Airport Area" },
        { value: "gonio", label: "Gonio" },
        { value: "kvariati", label: "Kvariati" },
        { value: "makhinjauri", label: "Makhinjauri" },
        { value: "green-cape", label: "Green Cape (Mtsvane Kontskhi)" },
        { value: "chakvi", label: "Chakvi" },
        { value: "kobuleti", label: "Kobuleti" },
        { value: "sarpi", label: "Sarpi" },
        { value: "alphabetic-tower", label: "Alphabetic Tower Area" },
        { value: "ardagani-lake", label: "Ardagani Lake Area" },
        { value: "batumi-central-park", label: "Central Park Area" },
        { value: "university-area", label: "University Area" },
        { value: "bagrationi-str", label: "Bagrationi Street" },
        { value: "inasaridze-str", label: "Inasaridze Street" },
        { value: "kobaladze-str", label: "Kobaladze Street" },
        { value: "zubalashvili-str", label: "Zubalashvili Street" },
      ],
      tbilisi: [
        { value: "vake", label: "Vake" },
        { value: "saburtalo", label: "Saburtalo" },
        { value: "old-tbilisi", label: "Old Tbilisi" },
        { value: "mtatsminda", label: "Mtatsminda" },
        { value: "vera", label: "Vera" },
        { value: "sololaki", label: "Sololaki" },
        { value: "avlabari", label: "Avlabari" },
        { value: "didube", label: "Didube" },
        { value: "nadzaladevi", label: "Nadzaladevi" },
        { value: "gldani", label: "Gldani" },
        { value: "isani", label: "Isani" },
        { value: "samgori", label: "Samgori" },
        { value: "varketili", label: "Varketili" },
        { value: "dighomi", label: "Dighomi" },
        { value: "ortachala", label: "Ortachala" },
        { value: "chugureti", label: "Chugureti" },
        { value: "krtsanisi", label: "Krtsanisi" },
        { value: "temqa", label: "Temqa" },
        { value: "didi-dighomi", label: "Didi Dighomi" },
        { value: "lisi-lake", label: "Lisi Lake Area" },
        { value: "turtle-lake", label: "Turtle Lake Area" },
        { value: "tbilisi-hills", label: "Tbilisi Hills" },
        { value: "rustaveli-ave-tbilisi", label: "Rustaveli Avenue" },
        { value: "marjanishvili", label: "Marjanishvili" },
        { value: "aghmashenebeli-ave-tbilisi", label: "Aghmashenebeli Avenue" },
        { value: "freedom-square", label: "Freedom Square Area" },
        { value: "heroes-square", label: "Heroes Square Area" },
        { value: "tbilisi-airport-area", label: "Airport Area" },
      ],
      dubai: [
        { value: "downtown-dubai", label: "Downtown Dubai" },
        { value: "dubai-marina", label: "Dubai Marina" },
        { value: "palm-jumeirah", label: "Palm Jumeirah" },
        { value: "jumeirah-beach", label: "Jumeirah Beach Residence (JBR)" },
        { value: "business-bay", label: "Business Bay" },
        { value: "dubai-hills", label: "Dubai Hills Estate" },
        { value: "arabian-ranches", label: "Arabian Ranches" },
        { value: "emirates-living", label: "Emirates Living" },
        { value: "springs", label: "The Springs" },
        { value: "meadows", label: "The Meadows" },
        { value: "lakes", label: "The Lakes" },
        { value: "greens", label: "The Greens" },
        { value: "views", label: "The Views" },
        { value: "jumeirah-lake-towers", label: "Jumeirah Lake Towers (JLT)" },
        { value: "jumeirah-village", label: "Jumeirah Village Circle (JVC)" },
        { value: "dubai-creek-harbour", label: "Dubai Creek Harbour" },
        { value: "dubai-south", label: "Dubai South" },
        { value: "damac-hills", label: "DAMAC Hills" },
        { value: "al-barsha", label: "Al Barsha" },
        { value: "al-quoz", label: "Al Quoz" },
        { value: "al-sufouh", label: "Al Sufouh" },
        { value: "difc", label: "DIFC" },
        { value: "city-walk", label: "City Walk" },
        { value: "dubai-sports-city", label: "Dubai Sports City" },
        { value: "motor-city", label: "Motor City" },
        { value: "silicon-oasis", label: "Dubai Silicon Oasis" },
        { value: "international-city", label: "International City" },
        { value: "mirdif", label: "Mirdif" },
        { value: "deira", label: "Deira" },
        { value: "bur-dubai", label: "Bur Dubai" },
        { value: "al-nahda-dubai", label: "Al Nahda" },
        { value: "dubai-land", label: "Dubailand" },
        { value: "dubai-world-central", label: "Dubai World Central" },
        { value: "emaar-beachfront", label: "Emaar Beachfront" },
        { value: "bluewaters-island", label: "Bluewaters Island" },
        { value: "tilal-al-ghaf", label: "Tilal Al Ghaf" },
        { value: "town-square", label: "Town Square" },
        { value: "sobha-hartland", label: "Sobha Hartland" },
        { value: "mohammed-bin-rashid-city", label: "Mohammed Bin Rashid City" },
        { value: "pearl-jumeirah", label: "Pearl Jumeirah" },
      ],
      sharjah: [
        { value: "al-majaz", label: "Al Majaz" },
        { value: "al-khan", label: "Al Khan" },
        { value: "al-taawun", label: "Al Taawun" },
        { value: "al-nahda-sharjah", label: "Al Nahda" },
        { value: "al-qasimia", label: "Al Qasimia" },
        { value: "al-mamzar-sharjah", label: "Al Mamzar" },
        { value: "muwaileh", label: "Muwaileh" },
        { value: "university-city-sharjah", label: "University City" },
        { value: "sharjah-waterfront", label: "Sharjah Waterfront City" },
        { value: "al-jada", label: "Aljada" },
        { value: "al-zahia", label: "Al Zahia" },
        { value: "tilal-city", label: "Tilal City" },
        { value: "al-raha-sharjah", label: "Al Raha" },
        { value: "al-tai", label: "Al Tai" },
        { value: "al-suyoh", label: "Al Suyoh" },
        { value: "sharjah-old-city", label: "Old City / Heritage Area" },
        { value: "al-khaledia", label: "Al Khaledia" },
        { value: "al-bu-daniq", label: "Al Bu Daniq" },
        { value: "industrial-area-sharjah", label: "Industrial Area" },
        { value: "al-mujarrah", label: "Al Mujarrah" },
        { value: "halwan", label: "Halwan" },
        { value: "al-ghaphia", label: "Al Ghaphia" },
      ],
      rasAlKhaimah: [
        { value: "al-hamra-village", label: "Al Hamra Village" },
        { value: "al-marjan-island", label: "Al Marjan Island" },
        { value: "mina-al-arab", label: "Mina Al Arab" },
        { value: "rak-downtown", label: "RAK Downtown" },
        { value: "rak-corniche", label: "RAK Corniche" },
        { value: "al-nakheel", label: "Al Nakheel" },
        { value: "al-dhait", label: "Al Dhait" },
        { value: "khuzam", label: "Khuzam" },
        { value: "yasmin-village", label: "Yasmin Village" },
        { value: "al-jazeera-rak", label: "Al Jazeera Al Hamra" },
        { value: "julphar", label: "Julphar" },
        { value: "rak-tower-area", label: "RAK Tower Area" },
        { value: "al-qurm", label: "Al Qurm" },
        { value: "al-seer", label: "Al Seer" },
        { value: "ghalilah", label: "Ghalilah" },
        { value: "seih-al-uraibi", label: "Seih Al Uraibi" },
        { value: "al-rams", label: "Al Rams" },
        { value: "dafan-al-khor", label: "Dafan Al Khor" },
      ],
    };
    return locations[cityKey] || [];
  };

  const getBatumiStreets = () => getCityLocations('batumi');

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

  // Handle form submission - Show listing type popup first
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isSubmitting) return;
    
    if (!propertyType) {
      console.error('Property type missing. Location:', location, 'Parsed type:', propertyType);
      alert(`Property type is required. Current URL: ${location}. Please go back and select a property type.`);
      return;
    }
    
    if (!user?.id) {
      alert('User authentication required. Please log in again.');
      return;
    }

    if (!formData.title || !formData.description || !formData.price) {
      alert('Please fill in all required fields (title, description, price).');
      return;
    }
    
    setShowListingTypePopup(true);
  };

  const submitLockRef = useRef(false);
  const submitProperty = async (listingType: 'free' | 'featured' = 'free', expirationDate?: string) => {
    if (isSubmitting || submitLockRef.current) return;
    submitLockRef.current = true;
    setIsSubmitting(true);
    
    try {
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
            case 'northern-cyprus': return 'Northern Cyprus (TRNC)';
            default: return country;
          }
        });

        // Combine city and country (e.g., "Batumi, Georgia" or "Dubai, UAE")
        return `${cityNames.join(', ')}, ${countryNames.join(', ')}`;
      };
      
      // Validate required fields
      if (!propertyType) {
        throw new Error('Property type is required');
      }
      
      if (!formData.area && !formData.price) {
        throw new Error('Area or price range must be specified');
      }


      // Prepare property data
      const propertyData = {
        title: formData.title,
        description: formData.description,
        propertyType: propertyType, // Ensure propertyType is set
        ownerId: user.id,
        location: getLocationString() || (isEditMode && existingProperty ? existingProperty.location : 'Not specified'),
        price: parseInt(String(formData.price).replace(/[^0-9]/g, '')) || 0,
        area: formData.area || String(parseInt(formData.price) || 100),
        bedrooms: Array.isArray(formData.bedrooms) ? Math.max(...formData.bedrooms.map(Number)) : (formData.bedrooms || 1),
        bathrooms: Array.isArray(formData.bathrooms) ? Math.max(...formData.bathrooms.map(Number)) : (formData.bathrooms || 1),
        floorNumber: formData.floorNumber ? parseInt(formData.floorNumber) : null,
        images: formData.images || [],
        videos: formData.videos || [],
        features: formData.features || [],
        amenities: formData.amenities || [],
        listingType: isEditMode && existingProperty ? existingProperty.listingType : (listingType === 'featured' ? 'vip' : 'regular'),
        listingExpiresAt: isEditMode && existingProperty ? existingProperty.listingExpiresAt : (expirationDate || null),
        readyStatus: formData.readyStatus || null
      };

      // Add project details if it's a project type
      const submissionData = {
        ...propertyData,
        ...(propertyType === 'project' ? {
          projectDetails: {
            developer: formData.projectDetails?.developer || formData.title,
            completionDate: formData.projectDetails?.completionDate || formData.deliveryDate || 'Q4 2024',
            projectStatus: formData.projectDetails?.projectStatus || 'Now Selling'
          },
          topRated: formData.topRated || false
        } : {})
      };

      console.log('🚀 Submitting property with data:', {
        propertyType: submissionData.propertyType,
        area: submissionData.area,
        price: submissionData.price,
        title: submissionData.title,
        listingType: submissionData.listingType
      });
      
      // Submit to API
      const apiUrl = isEditMode ? `/api/properties/${propertyId}` : '/api/properties';
      const method = isEditMode ? 'PATCH' : 'POST';
      const response = await fetch(apiUrl, {
        method,
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
      console.log(`Property ${isEditMode ? 'updated' : 'created'} successfully:`, result);
      
      if (result.pendingReview) {
        // Show branded popup instead of toast
        setShowSubmissionSuccess(true);
        return result;
      } else {
        const listingTypeMessage = listingType === 'featured' ? 'as Featured Listing' : '';
        toast({
          title: `Property ${isEditMode ? 'Updated' : 'Created'}`,
          description: `Your property has been ${isEditMode ? 'updated' : 'created'} successfully ${listingTypeMessage}.`,
        });
      }
      
      if (listingType === 'featured') {
        return result;
      }
      
      const redirectUrl = isEditMode ? `/property/${propertyId}` : `/property/${result.id}`;
      window.location.href = redirectUrl;
      
    } catch (error) {
      console.error('Error submitting property:', error);
      alert('Failed to create property. Please try again.');
      throw error; // Re-throw for payment handler to catch
    } finally {
      setIsSubmitting(false);
      submitLockRef.current = false;
    }
  };
  
  // Handle free listing submission
  const handleFreeListingSubmit = async () => {
    setSelectedListingType('free');
    setShowListingTypePopup(false);
    
    // Submit as free listing
    await submitProperty('free');
  };
  
  // Handle featured listing selection - show payment popup
  const handleFeaturedListingSelect = () => {
    setSelectedListingType('featured');
    setShowListingTypePopup(false);
    setShowPaymentPopup(true);
  };
  
  // Handle payment processing
  const handlePayment = async (amount: number, days: number, method: string) => {
    setShowPaymentPopup(false);
    
    try {
      // Calculate expiration date
      const expirationDate = new Date();
      expirationDate.setDate(expirationDate.getDate() + days);
      
      // Submit property as featured listing
      const propertyResult = await submitProperty('featured', expirationDate.toISOString());
      
      // Create payment record (this is for demo purposes)
      const propertyId = propertyResult?.id || Date.now();
      const paymentData = {
        propertyId: propertyId,
        userId: user.id,
        amount: amount * 100, // Convert to cents
        currency: 'USD',
        paymentMethod: method,
        status: 'completed', // For demo, mark as completed
        durationDays: days,
      };
      
      await apiRequest('POST', '/api/payments', paymentData);
      
      // Set payment success details and show choices popup
      setPaymentSuccessDetails({
        propertyId: propertyId.toString(),
        propertyTitle: formData.title,
        durationDays: days,
        amount: amount
      });
      
      setShowPostPaymentChoices(true);
      
    } catch (error) {
      console.error('Error processing payment:', error);
      toast({
        title: 'Payment Failed',
        description: 'Unable to process payment. Please try again.',
        variant: 'destructive',
      });
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
              {isEditMode ? 'Edit' : 'Add'} {getPropertyTypeTitle(propertyType)}
            </h1>
            <p className="text-lg text-gray-600">
              {isEditMode ? 'Update the details for your' : 'Fill in the details for your'} {getPropertyTypeTitle(propertyType).toLowerCase()}
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
                      {value === 'project' ? 'Off-Plan Projects' : value.charAt(0).toUpperCase() + value.slice(1)}
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
                Property Type: {propertyType === 'project' ? 'Off-Plan Projects' : propertyType.charAt(0).toUpperCase() + propertyType.slice(1)}
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
                <Label htmlFor="customPrice">Or enter price manually (USD)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                  <Input
                    id="customPrice"
                    type="text"
                    inputMode="numeric"
                    placeholder="e.g. 350000"
                    className="pl-7"
                    value={customPrice}
                    onChange={(e) => {
                      const converted = toEnglishDigits(e.target.value);
                      setCustomPrice(converted);
                      if (converted) {
                        handleInputChange('price', converted);
                      }
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">This will override the selected price range above</p>
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
                    <div className="text-sm text-gray-600 mb-2">Select a country:</div>
                    <div className="grid grid-cols-1 gap-2">
                      {[
                        { value: 'georgia', label: '🇬🇪 Georgia' },
                        { value: 'uae', label: '🇦🇪 United Arab Emirates' },
                        { value: 'northern-cyprus', label: '🇨🇾 Northern Cyprus (TRNC)' }
                      ].map((countryOption) => {
                        const currentCountries = Array.isArray(formData.country) ? formData.country : (formData.country ? [formData.country] : []);
                        const isSelected = currentCountries.includes(countryOption.value);
                        const isDisabled = currentCountries.length > 0 && !isSelected;
                        
                        return (
                          <label key={countryOption.value} className={`flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded ${isDisabled ? 'opacity-50 cursor-not-allowed' : ''}`}>
                            <input
                              type="checkbox"
                              checked={isSelected}
                              disabled={isDisabled}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  // When selecting a country, replace any existing country selection
                                  handleInputChange('country', countryOption.value);
                                  
                                  // Clear cities when switching countries
                                  handleInputChange('city', '');
                                } else {
                                  // When unchecking, just remove this country
                                  handleInputChange('country', '');
                                }
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
                              {country === 'georgia' ? '🇬🇪 Georgia' : country === 'uae' ? '🇦🇪 UAE' : country}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div>
                  <div className="mb-2">
                    <Label htmlFor="city">City *</Label>
                  </div>

                  <div className="border border-gray-300 rounded-md p-3 bg-white">
                    <div className="text-sm text-gray-600 mb-2">Select cities:</div>
                    <div className="space-y-2">
                      {[
                        { value: 'batumi', label: '🇬🇪 Batumi, Georgia' },
                        { value: 'tbilisi', label: '🇬🇪 Tbilisi, Georgia' },
                        { value: 'dubai', label: '🇦🇪 Dubai, UAE' },
                        { value: 'sharjah', label: '🇦🇪 Sharjah, UAE' },
                        { value: 'rasAlKhaimah', label: '🇦🇪 Ras Al Khaimah, UAE' }
                      ].filter((cityOption) => {
                        // Filter cities based on selected country
                        const selectedCountry = formData.country;
                        
                        // If Georgia is selected, only show Georgian cities
                        if (selectedCountry === 'georgia') {
                          return cityOption.value === 'batumi' || cityOption.value === 'tbilisi';
                        }
                        
                        // If UAE is selected, only show UAE cities
                        if (selectedCountry === 'uae') {
                          return ['dubai', 'sharjah', 'rasAlKhaimah'].includes(cityOption.value);
                        }
                        
                        // If no country is selected, show all cities
                        return true;
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
                                  const georgianCities = ['batumi', 'tbilisi'];
                                  const uaeCities = ['dubai', 'sharjah', 'rasAlKhaimah'];
                                  
                                  if (georgianCities.includes(cityOption.value)) {
                                    newCities = [...currentCities.filter(c => !uaeCities.includes(c)), cityOption.value];
                                  }
                                  else if (uaeCities.includes(cityOption.value)) {
                                    newCities = [...currentCities.filter(c => !georgianCities.includes(c)), cityOption.value];
                                  }
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
                            const cityName = 
                              cityValue === 'batumi' ? '🇬🇪 Batumi, Georgia' : 
                              cityValue === 'tbilisi' ? '🇬🇪 Tbilisi, Georgia' : 
                              cityValue === 'dubai' ? '🇦🇪 Dubai, UAE' :
                              cityValue === 'sharjah' ? '🇦🇪 Sharjah, UAE' :
                              cityValue === 'rasAlKhaimah' ? '🇦🇪 Ras Al Khaimah, UAE' :
                              cityValue;
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
                </div>

                <div>
                  <Label htmlFor="area">Area (m²) *</Label>
                  <div className="border border-gray-300 rounded-md p-3 bg-white">
                    <div className="text-sm text-gray-600 mb-2">Select multiple areas:</div>
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                      {[
                        ...Array.from({length: 76}, (_, i) => 25 + i),
                        ...Array.from({length: 40}, (_, i) => 100 + (i + 1) * 10),
                        ...Array.from({length: 10}, (_, i) => 500 + (i + 1) * 50),
                        ...Array.from({length: 40}, (_, i) => 1000 + (i + 1) * 100),
                      ].map((num) => String(num)).map((areaValue) => {
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
                    {formData.area && (formData.area.includes(',') || formData.area.length > 0) && (() => {
                      const selectedAreas = (Array.isArray(formData.area) ? formData.area : formData.area.split(',')).filter(a => a);
                      const numericAreas = selectedAreas.map(v => parseInt(v)).filter(v => !isNaN(v));
                      return (
                        <div className="mt-2 pt-2 border-t border-gray-200">
                          {numericAreas.length > 1 ? (
                            <div className="flex items-center gap-2">
                              <div className="text-xs text-gray-500">Users will see:</div>
                              <Badge variant="default" className="bg-[#005476] text-white text-sm">
                                {Math.min(...numericAreas)} - {Math.max(...numericAreas)} m²
                              </Badge>
                              <span className="text-xs text-gray-400">({numericAreas.length} selected)</span>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <div className="text-xs text-gray-500">Selected:</div>
                              <Badge variant="secondary" className="text-xs">{selectedAreas[0]} m²</Badge>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label htmlFor="location">Location / Street *</Label>
                  {formData.city && (
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
                        📍 Pin from Map
                      </Button>
                    </div>
                  )}
                </div>
                
                {formData.city && useMapSelection ? (
                  <div className="space-y-4">
                    <div className="text-center bg-gradient-to-r from-[#005476]/10 to-[#3bcac4]/10 p-3 rounded-lg border border-[#3bcac4]/30">
                      <h3 className="text-lg font-semibold text-[#005476] mb-1">📍 Pin Location on Map</h3>
                      <p className="text-sm text-gray-600">Click on the map to pin the exact property location</p>
                    </div>

                    <div className="relative rounded-xl overflow-hidden border-2 border-[#005476]/20 shadow-lg">
                      <div className="h-[450px]">
                        <LocationSelector
                          onLocationSelect={(location, coordinates) => {
                            setFormData(prev => ({
                              ...prev,
                              location: location,
                              coordinates: coordinates
                            }));
                          }}
                          selectedLocation={formData.location}
                          city={formData.city}
                          className="h-full w-full"
                        />
                      </div>
                      
                      <div className="absolute bottom-3 left-3 right-3 z-[1000] bg-white/95 backdrop-blur-sm rounded-lg p-2 shadow-md">
                        <div className="flex items-center justify-between text-xs">
                          <div className="flex items-center space-x-3">
                            <span className="text-[#005476] font-medium">🖱️ Click to pin</span>
                            <span className="text-[#3bcac4] font-medium">🔄 Scroll to zoom</span>
                            <span className="text-gray-600 font-medium">🖐️ Drag to move</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {formData.location && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                        <div className="flex items-center space-x-2">
                          <span className="text-green-600 text-lg">📍</span>
                          <div className="flex-1">
                            <p className="text-sm text-green-800 font-semibold">
                              Location pinned: {formData.location}
                            </p>
                            {formData.coordinates && (formData.coordinates as any).lat !== 0 && (
                              <p className="text-xs text-green-600 mt-1 font-mono">
                                {(formData.coordinates as any).lat?.toFixed(6)}, {(formData.coordinates as any).lng?.toFixed(6)}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => setFormData(prev => ({ ...prev, location: '', coordinates: { lat: 0, lng: 0 } }))}
                            className="text-red-500 hover:text-red-700 p-1 rounded"
                          >
                            ❌
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ) : formData.city ? (
                  <div className="border border-gray-300 rounded-md p-3 bg-white">
                    <div className="text-sm text-gray-600 mb-2">Select locations:</div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-48 overflow-y-auto">
                      {(() => {
                        const cities = formData.city.split(',').filter(c => c);
                        const allLocations: { value: string; label: string; city: string }[] = [];
                        cities.forEach(c => {
                          getCityLocations(c).forEach(loc => allLocations.push({ ...loc, city: c }));
                        });
                        return allLocations.map((loc) => {
                          const selectedLocations = formData.location ? formData.location.split(',') : [];
                          const isSelected = selectedLocations.includes(loc.value);
                          return (
                            <label key={loc.value} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={(e) => {
                                  const currentLocations = formData.location ? formData.location.split(',').filter(l => l) : [];
                                  let newLocations;
                                  if (e.target.checked) {
                                    newLocations = [...currentLocations, loc.value];
                                  } else {
                                    newLocations = currentLocations.filter(l => l !== loc.value);
                                  }
                                  handleInputChange('location', newLocations.join(','));
                                }}
                                className="rounded border-gray-300"
                              />
                              <span className="text-sm">{loc.label}</span>
                            </label>
                          );
                        });
                      })()}
                    </div>
                    {formData.location && formData.location.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-gray-200">
                        <div className="text-xs text-gray-500 mb-1">Selected locations:</div>
                        <div className="flex flex-wrap gap-1">
                          {formData.location.split(',').filter(loc => loc).map((locationValue) => {
                            const cities = formData.city.split(',').filter(c => c);
                            let label = locationValue;
                            for (const c of cities) {
                              const found = getCityLocations(c).find(s => s.value === locationValue);
                              if (found) { label = found.label; break; }
                            }
                            return (
                              <Badge key={locationValue} variant="secondary" className="text-xs">
                                {label}
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
                      🏙️ Please select a city first to choose a location
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
                            '🏢 High-rise Unit',
                            '🏡 Villa'
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
                  {propertyType === PROPERTY_TYPES.PROJECT || propertyType === PROPERTY_TYPES.LAND ? (
                    <div className="border border-gray-300 rounded-md p-3 bg-gray-50">
                      <span className="text-sm font-medium">🏠 For Buy</span>
                    </div>
                  ) : (
                    <Select 
                      value={formData.purpose} 
                      onValueChange={(value) => handleInputChange('purpose', value)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select purpose" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="buy">🏠 For Buy</SelectItem>
                        <SelectItem value="rent">🏡 For Rent</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
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

              <div>
                <Label htmlFor="customPrice2">Or enter price manually (USD)</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                  <Input
                    id="customPrice2"
                    type="text"
                    inputMode="numeric"
                    placeholder="e.g. 350000"
                    className="pl-7"
                    value={customPrice}
                    onChange={(e) => {
                      const converted = toEnglishDigits(e.target.value);
                      setCustomPrice(converted);
                      if (converted) {
                        handleInputChange('price', converted);
                      }
                    }}
                  />
                </div>
                <p className="text-xs text-gray-500 mt-1">This will override the selected price range above</p>
              </div>
              
              {formData.purpose === 'rent' && (
                <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
                  💡 <strong>Tip:</strong> Include utilities, parking, or other costs in the description if they're separate from the base rent.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Ready Status Section */}
          <Card>
            <CardHeader>
              <CardTitle>{t('readyStatus.title', 'Ready Status')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="readyStatus">{t('readyStatus.label', 'Select property ready status')}</Label>
                <Select 
                  value={formData.readyStatus || ''} 
                  onValueChange={(value) => handleInputChange('readyStatus', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder={t('readyStatus.placeholder', 'Select ready status...')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="turnkey">🔑 {t('readyStatus.turnkey', 'Ready to move in as Turnkey')}</SelectItem>
                    <SelectItem value="white_frame">🏗️ {t('readyStatus.whiteFrame', 'Ready to move in as White Frame')}</SelectItem>
                    <SelectItem value="green_frame">🌿 {t('readyStatus.greenFrame', 'Ready to move in as Green Frame')}</SelectItem>
                    <SelectItem value="black_frame">⬛ {t('readyStatus.blackFrame', 'Ready to move in as Black Frame')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          {/* Delivery Date Section - Only for Off-Plan Projects */}
          {propertyType === 'project' && (
          <Card>
            <CardHeader>
              <CardTitle>Delivery Date</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="deliveryDate">Expected Delivery Date</Label>
                <Select 
                  value={formData.deliveryDate || ''} 
                  onValueChange={(value) => handleInputChange('deliveryDate', value)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select delivery quarter..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-64 overflow-y-auto">
                    {/* Generate quarters for years 2024-2035 */}
                    {Array.from({ length: 12 }, (_, yearIndex) => {
                      const year = 2024 + yearIndex;
                      return ['Q1', 'Q2', 'Q3', 'Q4'].map(quarter => (
                        <SelectItem key={`${quarter} ${year}`} value={`${quarter} ${year}`}>
                          {quarter} {year}
                        </SelectItem>
                      ));
                    }).flat()}
                  </SelectContent>
                </Select>
              </div>
              
              <div className="text-sm text-gray-600 bg-blue-50 p-3 rounded-lg">
                💡 <strong>Info:</strong> This represents the expected completion and delivery date for the property.
              </div>
            </CardContent>
          </Card>
          )}

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
                    '🎰 Casino',
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
                    const selectedAmenities = formData.amenities || [];
                    const isSelected = selectedAmenities.includes(amenity);
                    
                    return (
                      <label key={amenity} className="flex items-center space-x-2 cursor-pointer hover:bg-gray-50 p-2 rounded">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            const currentAmenities = formData.amenities || [];
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
                      {(formData.amenities || []).filter((amenity: string) => amenity).map((amenity: string) => (
                        <Badge key={amenity} variant="secondary" className="text-xs flex items-center space-x-1">
                          <span>{amenity}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const currentAmenities = formData.amenities || [];
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

          {/* Top Rated Option - Only for Off-Plan Projects */}
          {propertyType === 'project' && (
            <div className="rounded-lg border p-4 bg-gradient-to-r from-[#3bcac4]/5 to-[#005476]/5">
              <label className="flex items-center space-x-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={formData.topRated}
                  onChange={(e) => setFormData(prev => ({ ...prev, topRated: e.target.checked }))}
                  className="h-5 w-5 rounded border-gray-300 text-[#3bcac4] focus:ring-[#3bcac4]"
                />
                <span className="font-medium text-gray-900">Top Rated Project</span>
                <div className="flex items-center gap-0.5">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star key={star} className="h-4 w-4 fill-[#3bcac4] text-[#3bcac4]" />
                  ))}
                </div>
              </label>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex justify-end space-x-4">
            <Link href={isEditMode ? `/property/${propertyId}` : "/submit-property"}>
              <Button type="button" variant="outline">
                Cancel
              </Button>
            </Link>
            {isEditMode ? (
              <Button 
                type="button" 
                disabled={isSubmitting}
                onClick={async () => {
                  if (isSubmitting) return;
                  if (!formData.title || !formData.description || !formData.price) {
                    alert('Please fill in all required fields (title, description, price).');
                    return;
                  }
                  await submitProperty('free');
                }}
                className={`bg-[#3bcac4] hover:bg-[#3bcac4]/90 text-white ${isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                {isSubmitting ? 'Saving...' : 'Save Changes'}
              </Button>
            ) : (
              <Button 
                type="button" 
                disabled={isSubmitting}
                onClick={() => { if (!isSubmitting) setShowListingTypePopup(true); }}
                data-testid="button-submit-property"
                className={isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}
              >
                {isSubmitting ? 'Submitting...' : `Submit ${getPropertyTypeTitle(propertyType)}`}
              </Button>
            )}
          </div>
        </form>
        
        {/* Listing Type Selection Popup */}
        <ListingTypePopup
          open={showListingTypePopup}
          onClose={() => setShowListingTypePopup(false)}
          onSelectFree={handleFreeListingSubmit}
          onSelectFeatured={handleFeaturedListingSelect}
          propertyType={getPropertyTypeTitle(propertyType)}
        />
        
        {/* Payment Popup */}
        <PaymentPopup
          open={showPaymentPopup}
          onClose={() => setShowPaymentPopup(false)}
          onPayment={handlePayment}
          propertyType={getPropertyTypeTitle(propertyType)}
        />

        {/* Submission Success Popup (pending admin approval) */}
        <SubmissionSuccessPopup
          open={showSubmissionSuccess}
          onClose={() => {
            setShowSubmissionSuccess(false);
            window.location.href = '/properties';
          }}
        />

        {/* Post-Payment Choices Popup */}
        {paymentSuccessDetails && (
          <PostPaymentChoicesPopup
            open={showPostPaymentChoices}
            onClose={() => {
              setShowPostPaymentChoices(false);
              setPaymentSuccessDetails(null);
            }}
            propertyId={paymentSuccessDetails.propertyId}
            propertyTitle={paymentSuccessDetails.propertyTitle}
            durationDays={paymentSuccessDetails.durationDays}
            amount={paymentSuccessDetails.amount}
          />
        )}
      </div>
    </div>
  );
};

export default PropertyForm;