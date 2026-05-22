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
  const [location, navigate] = useLocation();
  const { toast } = useToast();
  
  // Check if we're in edit mode
  const [, params] = useRoute("/property/:id/edit");
  const propertyId = params?.id ? parseInt(params.id) : null;
  const isEditMode = !!propertyId;
  
  // Get property type from URL params — use window.location.search because
  // wouter's useLocation() does not include the query string
  const urlParams = new URLSearchParams(window.location.search);
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
    titleEn: '',
    description: '',
    descriptionEn: '',
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
    topRated: false,
    bestPrice: false,
    acceptablePrice: false,
    highPrice: false,
    // Land-specific fields
    landType: '',
    landFeatures: [] as string[],
    // Payment method fields
    paymentMethod: '',
    downPaymentPercent: '',
    installmentDuration: '',
  });
  
  const [newFeature, setNewFeature] = useState('');
  const [customPrice, setCustomPrice] = useState('');
  const [newAmenity, setNewAmenity] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [useMapSelection, setUseMapSelection] = useState(false);
  

  // City dropdown states
  const [cityDropdownOpen, setCityDropdownOpen] = useState(false);
  const [citySearch, setCitySearch] = useState('');

  // Popup states for payment flow
  const [showListingTypePopup, setShowListingTypePopup] = useState(false);
  const [showPaymentPopup, setShowPaymentPopup] = useState(false);
  const [showPostPaymentChoices, setShowPostPaymentChoices] = useState(false);
  const [showSubmissionSuccess, setShowSubmissionSuccess] = useState(false);
  const [selectedListingType, setSelectedListingType] = useState<'free' | 'featured'>('free');
  const [paymentSuccessDetails, setPaymentSuccessDetails] = useState<{
    propertyId: string;
    propertyTitle: string;
    propertyLocation: string;
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
        if (location.includes('Tbilisi')) city = 'tbilisi';
        else if (location.includes('Batumi')) city = 'batumi';
        else if (location.includes('Kutaisi')) city = 'kutaisi';
        else if (location.includes('Rustavi')) city = 'rustavi';
        else if (location.includes('Zugdidi')) city = 'zugdidi';
        else if (location.includes('Gori')) city = 'gori';
        else if (location.includes('Poti')) city = 'poti';
        else if (location.includes('Telavi')) city = 'telavi';
        else if (location.includes('Mtskheta')) city = 'mtskheta';
        else if (location.includes('Kobuleti')) city = 'kobuleti';
        else if (location.includes('Borjomi')) city = 'borjomi';
        else if (location.includes('Akhaltsikhe')) city = 'akhaltsikhe';
        else if (location.includes('Senaki')) city = 'senaki';
        else if (location.includes('Anaklia')) city = 'anaklia';
        else if (location.includes('Sighnaghi')) city = 'sighnaghi';
        else if (location.includes('Ambrolauri')) city = 'ambrolauri';
        else if (location.includes('Khashuri')) city = 'khashuri';
        else if (location.includes('Samtredia')) city = 'samtredia';
        else if (location.includes('Zestafoni')) city = 'zestafoni';
        else if (location.includes('Chiatura')) city = 'chiatura';
      } else if (location.includes('UAE')) {
        country = 'uae';
        if (location.includes('Dubai')) city = 'dubai';
      } else if (location.includes('Turkey')) {
        country = 'turkey';
        if (location.includes('Istanbul')) city = 'istanbul';
        else if (location.includes('Trabzon')) city = 'trabzon';
      }

      // Update all form data
      setFormData({
        title: existingProperty.title || '',
        titleEn: (existingProperty as any).titleEn || '',
        description: existingProperty.description || '',
        descriptionEn: (existingProperty as any).descriptionEn || '',
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
        coordinates: {
          lat: parseFloat((existingProperty as any).latitude || '0') || 0,
          lng: parseFloat((existingProperty as any).longitude || '0') || 0,
        },
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
        topRated: existingProperty.topRated || false,
        bestPrice: (existingProperty as any).bestPrice || false,
        acceptablePrice: (existingProperty as any).acceptablePrice || false,
        highPrice: (existingProperty as any).highPrice || false,
        landType: (existingProperty as any).landType || '',
        landFeatures: (existingProperty as any).landFeatures || [],
        paymentMethod: (existingProperty as any).paymentMethod || '',
        downPaymentPercent: (existingProperty as any).downPaymentPercent?.toString() || '',
        installmentDuration: (existingProperty as any).installmentDuration || '',
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
          { value: "tbilisi", label: "Tbilisi" },
          { value: "batumi", label: "Batumi" },
          { value: "kutaisi", label: "Kutaisi" },
          { value: "rustavi", label: "Rustavi" },
          { value: "zugdidi", label: "Zugdidi" },
          { value: "gori", label: "Gori" },
          { value: "poti", label: "Poti" },
          { value: "telavi", label: "Telavi" },
          { value: "mtskheta", label: "Mtskheta" },
          { value: "kobuleti", label: "Kobuleti" },
          { value: "borjomi", label: "Borjomi" },
          { value: "akhaltsikhe", label: "Akhaltsikhe" },
          { value: "senaki", label: "Senaki" },
          { value: "anaklia", label: "Anaklia" },
          { value: "sighnaghi", label: "Sighnaghi" },
          { value: "ambrolauri", label: "Ambrolauri" },
          { value: "khashuri", label: "Khashuri" },
          { value: "samtredia", label: "Samtredia" },
          { value: "zestafoni", label: "Zestafoni" },
          { value: "chiatura", label: "Chiatura" },
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
          { value: "guzelyurt", label: "Güzelyurt" },
          { value: "esentepe", label: "Esentepe" }
        ];
      case "turkey":
        return [
          { value: "istanbul", label: "İstanbul" },
          { value: "trabzon", label: "Trabzon" }
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
      kutaisi: [
        { value: "kutaisi-center", label: "City Center" },
        { value: "kutaisi-white-bridge", label: "White Bridge Area" },
        { value: "kutaisi-bagrati", label: "Bagrati Cathedral Area" },
        { value: "kutaisi-gelati", label: "Gelati Area" },
        { value: "kutaisi-gora", label: "Gora District" },
        { value: "kutaisi-zugdidis-str", label: "Zugdidi Street" },
        { value: "kutaisi-chavchavadze", label: "Chavchavadze Street" },
        { value: "kutaisi-rustaveli", label: "Rustaveli Street" },
        { value: "kutaisi-tskaltubo", label: "Tskaltubo Road Area" },
        { value: "kutaisi-airport-area", label: "Airport Area" },
        { value: "kutaisi-industrial", label: "Industrial District" },
        { value: "kutaisi-old-town", label: "Old Town" },
      ],
      rustavi: [
        { value: "rustavi-center", label: "City Center" },
        { value: "rustavi-microdistrict-1", label: "Microdistrict 1" },
        { value: "rustavi-microdistrict-2", label: "Microdistrict 2" },
        { value: "rustavi-microdistrict-3", label: "Microdistrict 3" },
        { value: "rustavi-microdistrict-4", label: "Microdistrict 4" },
        { value: "rustavi-krtsanisi", label: "Krtsanisi District" },
        { value: "rustavi-1st-microdistrict", label: "New Rustavi" },
        { value: "rustavi-gardabani", label: "Gardabani Road Area" },
        { value: "rustavi-industrial", label: "Industrial Zone" },
      ],
      zugdidi: [
        { value: "zugdidi-center", label: "City Center" },
        { value: "zugdidi-dadiani-palace", label: "Dadiani Palace Area" },
        { value: "zugdidi-rustaveli", label: "Rustaveli Street" },
        { value: "zugdidi-jikia", label: "Jikia Street" },
        { value: "zugdidi-kostava", label: "Kostava Street" },
        { value: "zugdidi-gali-str", label: "Gali Street Area" },
        { value: "zugdidi-anaklia-road", label: "Anaklia Road Area" },
        { value: "zugdidi-senaki-road", label: "Senaki Road Area" },
      ],
      gori: [
        { value: "gori-center", label: "City Center" },
        { value: "gori-castle-area", label: "Gori Fortress Area" },
        { value: "gori-stalin-museum", label: "Stalin Museum Area" },
        { value: "gori-rustaveli", label: "Rustaveli Street" },
        { value: "gori-chavchavadze", label: "Chavchavadze Street" },
        { value: "gori-stalinis-gamziri", label: "Stalinis Gamziri Avenue" },
        { value: "gori-mtkvari", label: "Mtkvari River Area" },
        { value: "gori-tskhinvali-road", label: "Tskhinvali Road Area" },
      ],
      poti: [
        { value: "poti-center", label: "City Center" },
        { value: "poti-port-area", label: "Port Area" },
        { value: "poti-lighthouse", label: "Lighthouse Area" },
        { value: "poti-beach", label: "Beach Area" },
        { value: "poti-paliastomi-lake", label: "Paliastomi Lake Area" },
        { value: "poti-rustaveli", label: "Rustaveli Street" },
        { value: "poti-kostava", label: "Kostava Street" },
        { value: "poti-free-industrial-zone", label: "Free Industrial Zone" },
      ],
      telavi: [
        { value: "telavi-center", label: "City Center" },
        { value: "telavi-batonis-tsikhe", label: "Batonis Tsikhe Fortress Area" },
        { value: "telavi-rustaveli", label: "Rustaveli Street" },
        { value: "telavi-ikalto", label: "Ikalto Road Area" },
        { value: "telavi-alazani-valley", label: "Alazani Valley View" },
        { value: "telavi-kizikhi", label: "Kizikhi District" },
        { value: "telavi-kurdgelauri", label: "Kurdgelauri" },
        { value: "telavi-akura", label: "Akura Area" },
      ],
      mtskheta: [
        { value: "mtskheta-center", label: "City Center" },
        { value: "mtskheta-svetitskhoveli", label: "Svetitskhoveli Cathedral Area" },
        { value: "mtskheta-jvari", label: "Jvari Monastery Area" },
        { value: "mtskheta-armazi", label: "Armazi Area" },
        { value: "mtskheta-mtkvari-confluence", label: "River Confluence Area" },
        { value: "mtskheta-gori-road", label: "Gori Road Area" },
        { value: "mtskheta-old-town", label: "Old Town" },
      ],
      kobuleti: [
        { value: "kobuleti-center", label: "City Center" },
        { value: "kobuleti-beach", label: "Kobuleti Beach" },
        { value: "kobuleti-boulevard", label: "Boulevard Area" },
        { value: "kobuleti-north", label: "North Kobuleti" },
        { value: "kobuleti-south", label: "South Kobuleti" },
        { value: "kobuleti-sea-view", label: "Sea View Area" },
        { value: "kobuleti-rustaveli", label: "Rustaveli Street" },
      ],
      borjomi: [
        { value: "borjomi-center", label: "City Center" },
        { value: "borjomi-park", label: "Borjomi Central Park Area" },
        { value: "borjomi-mineral-springs", label: "Mineral Springs Area" },
        { value: "borjomi-mtkvari-bank", label: "Mtkvari River Bank" },
        { value: "borjomi-likani", label: "Likani Area" },
        { value: "borjomi-bakuriani-road", label: "Bakuriani Road" },
        { value: "borjomi-old-town", label: "Old Town" },
      ],
      akhaltsikhe: [
        { value: "akhaltsikhe-center", label: "City Center" },
        { value: "akhaltsikhe-rabati", label: "Rabati Castle Area" },
        { value: "akhaltsikhe-old-town", label: "Old Town" },
        { value: "akhaltsikhe-rustaveli", label: "Rustaveli Street" },
        { value: "akhaltsikhe-potskhovi-river", label: "Potskhovi River Area" },
        { value: "akhaltsikhe-vardzia-road", label: "Vardzia Road Area" },
      ],
      senaki: [
        { value: "senaki-center", label: "City Center" },
        { value: "senaki-rustaveli", label: "Rustaveli Street" },
        { value: "senaki-zugdidi-road", label: "Zugdidi Road Area" },
        { value: "senaki-poti-road", label: "Poti Road Area" },
        { value: "senaki-military-base-area", label: "New District" },
      ],
      anaklia: [
        { value: "anaklia-center", label: "City Center" },
        { value: "anaklia-beach", label: "Anaklia Beach" },
        { value: "anaklia-deep-sea-port", label: "Deep Sea Port Area" },
        { value: "anaklia-resort-zone", label: "Resort Zone" },
        { value: "anaklia-new-development", label: "New Development Zone" },
      ],
      sighnaghi: [
        { value: "sighnaghi-center", label: "City Center" },
        { value: "sighnaghi-old-town", label: "Old Town (Walled City)" },
        { value: "sighnaghi-alazani-view", label: "Alazani Valley View" },
        { value: "sighnaghi-bodbe", label: "Bodbe Monastery Area" },
        { value: "sighnaghi-walls-area", label: "City Walls Area" },
      ],
      ambrolauri: [
        { value: "ambrolauri-center", label: "City Center" },
        { value: "ambrolauri-rioni-river", label: "Rioni River Area" },
        { value: "ambrolauri-rustaveli", label: "Rustaveli Street" },
        { value: "ambrolauri-khvanchkara", label: "Khvanchkara Wine Area" },
      ],
      khashuri: [
        { value: "khashuri-center", label: "City Center" },
        { value: "khashuri-rustaveli", label: "Rustaveli Street" },
        { value: "khashuri-surami", label: "Surami Area" },
        { value: "khashuri-mtkvari", label: "Mtkvari River Area" },
      ],
      samtredia: [
        { value: "samtredia-center", label: "City Center" },
        { value: "samtredia-rustaveli", label: "Rustaveli Street" },
        { value: "samtredia-rioni-river", label: "Rioni River Area" },
        { value: "samtredia-industrial", label: "Industrial Zone" },
      ],
      zestafoni: [
        { value: "zestafoni-center", label: "City Center" },
        { value: "zestafoni-rustaveli", label: "Rustaveli Street" },
        { value: "zestafoni-qvirila-river", label: "Qvirila River Area" },
        { value: "zestafoni-industrial", label: "Industrial Zone" },
      ],
      chiatura: [
        { value: "chiatura-center", label: "City Center" },
        { value: "chiatura-cable-car", label: "Cable Car Area" },
        { value: "chiatura-qvirila-river", label: "Qvirila River Area" },
        { value: "chiatura-manganese-area", label: "Mining District" },
        { value: "chiatura-peristsvaleba", label: "Peristsvaleba Area" },
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
      istanbul: [
        { value: "sultanahmet", label: "Sultanahmet (Historic Peninsula)" },
        { value: "taksim", label: "Taksim / Beyoğlu" },
        { value: "besiktas", label: "Beşiktaş" },
        { value: "sisli", label: "Şişli" },
        { value: "nisantasi", label: "Nişantaşı" },
        { value: "kadikoy", label: "Kadıköy" },
        { value: "uskudar", label: "Üsküdar" },
        { value: "fatih", label: "Fatih" },
        { value: "bakirkoy", label: "Bakırköy" },
        { value: "sariyer", label: "Sarıyer" },
        { value: "levent", label: "Levent" },
        { value: "maslak", label: "Maslak" },
        { value: "atasehir", label: "Ataşehir" },
        { value: "umraniye", label: "Ümraniye" },
        { value: "pendik", label: "Pendik" },
        { value: "kartal", label: "Kartal" },
        { value: "maltepe", label: "Maltepe" },
        { value: "bagcilar", label: "Bağcılar" },
        { value: "avcilar", label: "Avcılar" },
        { value: "buyukcek mece", label: "Büyükçekmece" },
        { value: "kucukcekmece", label: "Küçükçekmece" },
        { value: "basaksehir", label: "Başakşehir" },
        { value: "beylikduzu", label: "Beylikdüzü" },
        { value: "esenyurt", label: "Esenyurt" },
        { value: "zeytinburnu", label: "Zeytinburnu" },
        { value: "eyupsultan", label: "Eyüpsultan" },
        { value: "gaziosmanpasa", label: "Gaziosmanpaşa" },
        { value: "bahcelievler", label: "Bahçelievler" },
        { value: "gungoren", label: "Güngören" },
        { value: "esenler", label: "Esenler" },
        { value: "cihangir", label: "Cihangir" },
        { value: "etiler", label: "Etiler" },
        { value: "ortakoy", label: "Ortaköy" },
        { value: "beykoz", label: "Beykoz" },
        { value: "cekmekoy", label: "Çekmeköy" },
        { value: "tuzla", label: "Tuzla" },
        { value: "silivri", label: "Silivri" },
        { value: "arnavutkoy", label: "Arnavutköy" },
        { value: "adalar", label: "Adalar (Princes Islands)" },
        { value: "florya", label: "Florya" },
        { value: "yesilkoy", label: "Yeşilköy" },
        { value: "bostanci", label: "Bostancı" },
      ],
      trabzon: [
        { value: "trabzon-merkez", label: "Trabzon Merkez (City Center)" },
        { value: "ortahisar", label: "Ortahisar" },
        { value: "akcaabat", label: "Akçaabat" },
        { value: "pelitli", label: "Pelitli" },
        { value: "arakli", label: "Araklı" },
        { value: "yomra", label: "Yomra" },
        { value: "degirmendere", label: "Değirmendere" },
        { value: "arsin", label: "Arsin" },
        { value: "of", label: "Of" },
        { value: "macka", label: "Maçka" },
        { value: "surmene", label: "Sürmene" },
        { value: "carsibasi", label: "Çarşıbaşı" },
        { value: "vakfıkebir", label: "Vakfıkebir" },
        { value: "tonya", label: "Tonya" },
        { value: "besikduzu", label: "Beşikdüzü" },
        { value: "hayrat", label: "Hayrat" },
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

  // Handle form submission
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

    if (propertyType === PROPERTY_TYPES.APARTMENT && !formData.floorNumber) {
      alert('Please enter the floor number.');
      return;
    }

    // In edit mode — save directly without asking for listing type again
    if (isEditMode) {
      await submitProperty('free');
      return;
    }
    
    setShowListingTypePopup(true);
  };

  const submitLockRef = useRef(false);
  const submitProperty = async (listingType: 'free' | 'featured' = 'free', expirationDate?: string) => {
    console.log('📋 submitProperty called. isSubmitting:', isSubmitting, 'lockRef:', submitLockRef.current);
    if (isSubmitting || submitLockRef.current) {
      console.log('⛔ submitProperty blocked by lock');
      return;
    }
    submitLockRef.current = true;
    setIsSubmitting(true);
    
    try {
      console.log('✅ Step 1: user check. user?.id =', user?.id, 'propertyType =', propertyType);
      // Transform location data: combine country+city into location format for database
      const getLocationString = () => {
        const cities = formData.city ? formData.city.split(',') : [];
        const countries = formData.country ? formData.country.split(',') : [];
        
        if (cities.length === 0 || countries.length === 0) {
          const loc = formData.location || 'Not specified';
          // Always append country name so location-based filtering works
          if (countries.length > 0) {
            const countryName = countries.map((c: string) => {
              switch (c) {
                case 'georgia': return 'Georgia';
                case 'uae': return 'UAE';
                case 'northern-cyprus': return 'Northern Cyprus (TRNC)';
                case 'turkey': return 'Turkey';
                default: return c;
              }
            }).join(', ');
            return `${loc}, ${countryName}`;
          }
          return loc;
        }

        // Map city codes to full names
        const cityNames = cities.map(city => {
          switch (city) {
            case 'tbilisi': return 'Tbilisi';
            case 'batumi': return 'Batumi';
            case 'kutaisi': return 'Kutaisi';
            case 'rustavi': return 'Rustavi';
            case 'zugdidi': return 'Zugdidi';
            case 'gori': return 'Gori';
            case 'poti': return 'Poti';
            case 'telavi': return 'Telavi';
            case 'mtskheta': return 'Mtskheta';
            case 'kobuleti': return 'Kobuleti';
            case 'borjomi': return 'Borjomi';
            case 'akhaltsikhe': return 'Akhaltsikhe';
            case 'senaki': return 'Senaki';
            case 'anaklia': return 'Anaklia';
            case 'sighnaghi': return 'Sighnaghi';
            case 'ambrolauri': return 'Ambrolauri';
            case 'khashuri': return 'Khashuri';
            case 'samtredia': return 'Samtredia';
            case 'zestafoni': return 'Zestafoni';
            case 'chiatura': return 'Chiatura';
            case 'dubai': return 'Dubai';
            case 'sharjah': return 'Sharjah';
            case 'rasAlKhaimah': return 'Ras Al Khaimah';
            case 'lefkosa': return 'Lefkoşa';
            case 'gazimağusa': return 'Gazimağusa';
            case 'girne': return 'Girne';
            case 'iskele': return 'İskele';
            case 'guzelyurt': return 'Güzelyurt';
            case 'esentepe': return 'Esentepe';
            case 'istanbul': return 'Istanbul';
            case 'trabzon': return 'Trabzon';
            default: return city;
          }
        });

        // Map country codes to full names
        const countryNames = countries.map(country => {
          switch (country) {
            case 'georgia': return 'Georgia';
            case 'uae': return 'UAE';
            case 'northern-cyprus': return 'Northern Cyprus (TRNC)';
            case 'turkey': return 'Turkey';
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
        titleEn: (formData as any).titleEn || null,
        description: formData.description,
        descriptionEn: (formData as any).descriptionEn || null,
        propertyType: propertyType, // Ensure propertyType is set
        ownerId: user.id,
        location: getLocationString() || (isEditMode && existingProperty ? existingProperty.location : 'Not specified'),
        price: (() => {
          const prices = String(formData.price).split(',').map(s => parseInt(s.replace(/[^0-9]/g, ''))).filter(Boolean);
          return prices.length ? Math.min(...prices) : 0;
        })(),
        priceMax: (() => {
          const prices = String(formData.price).split(',').map(s => parseInt(s.replace(/[^0-9]/g, ''))).filter(Boolean);
          return prices.length > 1 ? Math.max(...prices) : null;
        })(),
        area: formData.area || String(parseInt(String(formData.price).split(',')[0]) || 100),
        bedrooms: (() => {
          if (propertyType === 'land') return null;
          if (Array.isArray(formData.bedrooms) && formData.bedrooms.length > 0) {
            // Map text labels to numeric bedroom counts
            const bedroomCountMap: Record<string, number> = {
              '🏠 Studio Apartment': 0,
              '🛏️ One Bedroom': 1,
              '🛏️ Two Bedrooms': 2,
              '🛏️ Three Bedrooms': 3,
              '🛏️ Four Bedrooms': 4,
              '🛏️ Five+ Bedrooms': 5,
              '🏰 Penthouse': 4,
              '🏡 Duplex': 3,
              '🏘️ Townhouse': 3,
              '🏛️ Loft': 1,
              '🌿 Garden Apartment': 2,
              '🏢 High-rise Unit': 2,
              '🏡 Villa': 4,
            };
            const nums = formData.bedrooms
              .map(b => bedroomCountMap[b] ?? Number(b))
              .filter(n => !isNaN(n));
            return nums.length > 0 ? Math.max(...nums) : 1;
          }
          if (!Array.isArray(formData.bedrooms)) return (formData.bedrooms as any) || 1;
          return 1;
        })(),
        bathrooms: (() => {
          if (propertyType === 'land') return null;
          if (Array.isArray(formData.bathrooms) && formData.bathrooms.length > 0) {
            // Each selected bathroom type counts as 1
            return formData.bathrooms.length;
          }
          if (!Array.isArray(formData.bathrooms)) return (formData.bathrooms as any) || 1;
          return 1;
        })(),
        floorNumber: formData.floorNumber ? parseInt(formData.floorNumber) : null,
        images: formData.images || [],
        videos: formData.videos || [],
        features: [
          ...(formData.features || []),
          // Include the selected bedroom/bathroom configuration labels as features
          // so they appear on the property detail page
          ...(Array.isArray(formData.bedrooms) ? formData.bedrooms : []),
          ...(Array.isArray(formData.bathrooms) ? formData.bathrooms : []),
        ].filter(Boolean),
        amenities: formData.amenities || [],
        landType: propertyType === 'land' ? (formData.landType || null) : null,
        landFeatures: propertyType === 'land' ? (formData.landFeatures || []) : [],
        paymentMethod: formData.paymentMethod || null,
        downPaymentPercent: formData.paymentMethod === 'installments' && formData.downPaymentPercent
          ? parseInt(formData.downPaymentPercent) : null,
        installmentDuration: formData.paymentMethod === 'installments'
          ? (formData.installmentDuration || null) : null,
        listingType: isEditMode && existingProperty ? existingProperty.listingType : (listingType === 'featured' ? 'vip' : 'regular'),
        listingExpiresAt: isEditMode && existingProperty ? existingProperty.listingExpiresAt : (expirationDate || null),
        readyStatus: formData.readyStatus || null,
        topRated: formData.topRated === true,
        latitude: formData.coordinates?.lat && formData.coordinates.lat !== 0
          ? formData.coordinates.lat.toString()
          : (isEditMode && existingProperty ? (existingProperty as any).latitude : null),
        longitude: formData.coordinates?.lng && formData.coordinates.lng !== 0
          ? formData.coordinates.lng.toString()
          : (isEditMode && existingProperty ? (existingProperty as any).longitude : null),
      };

      // Add project details if it's a project type
      const submissionData = {
        ...propertyData,
        ...(propertyType === 'project' ? {
          projectDetails: {
            developer: formData.projectDetails?.developer || formData.title,
            completionDate: formData.projectDetails?.completionDate || formData.deliveryDate || 'Q4 2024',
            projectStatus: formData.projectDetails?.projectStatus || 'Now Selling'
          }
        } : {}),
      };

      console.log('🚀 Step 2: Submitting property with data:', {
        propertyType: submissionData.propertyType,
        area: submissionData.area,
        price: submissionData.price,
        bedrooms: submissionData.bedrooms,
        bathrooms: submissionData.bathrooms,
        title: submissionData.title,
        listingType: submissionData.listingType,
        location: submissionData.location,
      });
      
      // Submit to API
      const apiUrl = isEditMode ? `/api/properties/${propertyId}` : '/api/properties';
      const method = isEditMode ? 'PATCH' : 'POST';
      console.log('🌐 Step 3: About to fetch', method, apiUrl);
      const response = await fetch(apiUrl, {
        method,
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(submissionData),
      });
      console.log('📡 Step 4: fetch complete, status =', response.status);
      
      if (!response.ok) {
        const errorData = await response.json();
        console.error('Validation errors:', errorData);
        alert(`Failed to create property: ${JSON.stringify(errorData.errors || errorData.message)}`);
        throw new Error(`Failed to create property: ${response.statusText}`);
      }
      
      const result = await response.json();
      console.log(`Property ${isEditMode ? 'updated' : 'created'} successfully:`, result);

      // Always sync topRated and bestPrice via dedicated endpoints (bypasses schema complexity)
      const savedId = isEditMode ? propertyId : result?.id;
      if (savedId) {
        await fetch(`/api/properties/${savedId}/top-rated`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ topRated: formData.topRated === true }),
        });
        await fetch(`/api/properties/${savedId}/best-price`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ bestPrice: formData.bestPrice === true }),
        });
        await fetch(`/api/properties/${savedId}/acceptable-price`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ acceptablePrice: (formData as any).acceptablePrice === true }),
        });
        await fetch(`/api/properties/${savedId}/high-price`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ highPrice: (formData as any).highPrice === true }),
        });
      }
      
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
      
      const { slugifyProperty: sp } = await import('@/lib/slugify');
      const redirectUrl = isEditMode
        ? `/property/${propertyId}/edit`
        : `/property/${sp(result.title || '', result.location || '', result.id)}`;
      window.location.href = redirectUrl;
      
    } catch (error) {
      console.error('Error submitting property:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      alert(`Failed to create property: ${errMsg}`);
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
      
      // Submit property as featured listing (always first to get real ID)
      const propertyResult = await submitProperty('featured', expirationDate.toISOString());
      const savedPropertyId = propertyResult?.id;

      if (!savedPropertyId) {
        throw new Error('Failed to get property ID after submission');
      }

      // BOG — redirect to Bank of Georgia payment page
      if (method === 'bog') {
        const res = await apiRequest('POST', '/api/bog/create-order', {
          amount,
          currency: 'USD',
          propertyId: savedPropertyId,
          days,
        });
        const data = await res.json();
        if (data.redirectUrl) {
          window.location.href = data.redirectUrl;
          return;
        } else {
          throw new Error(data.message || 'Failed to get BOG redirect URL');
        }
      }

      // PayPal or other methods
      const paymentData = {
        propertyId: savedPropertyId,
        userId: user.id,
        amount: amount * 100,
        currency: 'USD',
        paymentMethod: method,
        status: 'completed',
        durationDays: days,
      };
      
      await apiRequest('POST', '/api/payments', paymentData);
      
      setPaymentSuccessDetails({
        propertyId: savedPropertyId.toString(),
        propertyTitle: formData.title,
        propertyLocation: formData.location || '',
        durationDays: days,
        amount: amount
      });
      
      setShowPostPaymentChoices(true);
      
    } catch (error: any) {
      console.error('Error processing payment:', error);
      toast({
        title: 'Payment Failed',
        description: error.message || 'Unable to process payment. Please try again.',
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


          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="title">{user?.isAdmin ? 'Project Name *' : 'main text *'}</Label>
                  <Input
                    id="title"
                    value={formData.title}
                    onChange={(e) => handleInputChange('title', e.target.value)}
                    placeholder="Enter property title"
                    required
                  />
                </div>
                
                {user?.isAdmin && <div>
                  <Label htmlFor="price">Price Points (USD) * — select all that apply</Label>
                  {(() => {
                    const priceOptions: number[] = [];
                    for (let v = 40000; v <= 500000; v += 5000) priceOptions.push(v);
                    for (let v = 550000; v <= 1000000; v += 50000) priceOptions.push(v);
                    for (let v = 1100000; v <= 2000000; v += 100000) priceOptions.push(v);

                    const fmtP = (n: number) =>
                      n >= 1000000
                        ? `$${(n / 1000000).toFixed(n % 1000000 === 0 ? 0 : 1)}M`
                        : `$${(n / 1000).toFixed(0)}K`;

                    const selectedPrices = formData.price
                      ? formData.price.split(',').map(Number).filter(Boolean)
                      : [];

                    const togglePrice = (val: number) => {
                      // Using checkboxes clears any manual price
                      if (customPrice) {
                        setCustomPrice('');
                      }
                      let next: number[];
                      if (selectedPrices.includes(val)) {
                        next = selectedPrices.filter(p => p !== val);
                      } else {
                        next = [...selectedPrices, val];
                      }
                      next.sort((a, b) => a - b);
                      handleInputChange('price', next.join(','));
                    };

                    // Full number formatter: 88000 → $88,000
                    const fmtFull = (n: number) =>
                      '$' + n.toLocaleString('en-US');

                    // Preview badge for whichever mode is active
                    const previewPrice = customPrice
                      ? (() => {
                          const n = parseInt(customPrice.replace(/[^0-9]/g, ''));
                          return isNaN(n) ? null : fmtFull(n);
                        })()
                      : selectedPrices.length > 0
                        ? selectedPrices.length === 1
                          ? fmtFull(selectedPrices[0])
                          : `${fmtFull(Math.min(...selectedPrices))} — ${fmtFull(Math.max(...selectedPrices))}`
                        : null;

                    return (
                      <div className="space-y-3">
                        {/* Checkbox price grid */}
                        <div className={`border border-gray-300 rounded-md p-3 bg-white ${customPrice ? 'opacity-40 pointer-events-none' : ''}`}>
                          <div className="text-xs text-gray-500 mb-2">Select one or more price points:</div>
                          <div className="grid grid-cols-3 md:grid-cols-4 gap-1 max-h-52 overflow-y-auto pr-1">
                            {priceOptions.map((val) => {
                              const checked = selectedPrices.includes(val);
                              return (
                                <label
                                  key={val}
                                  className={`flex items-center gap-1 cursor-pointer rounded px-2 py-1 text-xs hover:bg-gray-50 ${checked ? 'bg-[#3bcac4]/10 font-semibold text-[#005476]' : ''}`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => togglePrice(val)}
                                    className="rounded border-gray-300 accent-[#3bcac4]"
                                  />
                                  {fmtP(val)}
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        {/* Manual price input */}
                        <div className="flex items-center gap-2">
                          <div className="h-px flex-1 bg-gray-200" />
                          <span className="text-xs text-gray-400 shrink-0">or enter custom price</span>
                          <div className="h-px flex-1 bg-gray-200" />
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium text-sm">$</span>
                          <Input
                            type="text"
                            inputMode="numeric"
                            placeholder="e.g. 275000"
                            className="pl-7 text-sm"
                            value={customPrice}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^0-9]/g, '');
                              setCustomPrice(val);
                              // Custom price overrides the checkboxes — store directly in formData.price
                              handleInputChange('price', val);
                              // Clear checkbox selections
                              if (val) {
                                // no-op: selectedPrices computed from formData.price which is now just the number
                              }
                            }}
                          />
                        </div>

                        {/* Preview */}
                        {previewPrice && (
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-500">Users will see:</span>
                            <Badge className="bg-[#005476] text-white text-xs">{previewPrice}</Badge>
                            {!customPrice && selectedPrices.length > 1 && (
                              <span className="text-xs text-gray-400">({selectedPrices.length} selected)</span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </div>}
              </div>


              {!user?.isAdmin && (
                <div>
                  <Label htmlFor="userPrice">Property Price (USD) *</Label>
                  <div className="relative mt-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 font-medium">$</span>
                    <Input
                      id="userPrice"
                      type="text"
                      inputMode="numeric"
                      placeholder="e.g. 250000"
                      className="pl-7"
                      value={formData.price || ''}
                      onChange={(e) => {
                        const val = toEnglishDigits(e.target.value).replace(/[^0-9]/g, '');
                        handleInputChange('price', val);
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Price per m² — auto calculated */}
              {(() => {
                const prices = String(formData.price || '').split(',').map(s => parseInt(s.replace(/[^0-9]/g, ''))).filter(Boolean);
                const areas = String(formData.area || '').split(',').map(s => parseInt(s)).filter(Boolean);
                const minPrice = prices.length ? Math.min(...prices) : 0;
                const minArea = areas.length ? Math.min(...areas) : 0;
                if (minPrice > 0 && minArea > 0) {
                  const pricePerM2 = Math.round(minPrice / minArea);
                  return (
                    <div className="p-3 bg-gradient-to-r from-[#3bcac4]/10 to-[#005476]/10 rounded-lg border border-[#3bcac4]/30 flex items-center justify-between">
                      <span className="text-sm font-semibold text-gray-700">💡 سعر المتر / Price per m²</span>
                      <span className="text-base font-bold text-[#005476]">
                        ${pricePerM2.toLocaleString()} <span className="text-xs font-normal">/ m²</span>
                      </span>
                    </div>
                  );
                }
                return null;
              })()}

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
                        { value: 'northern-cyprus', label: '🇨🇾 Northern Cyprus (TRNC)' },
                        { value: 'turkey', label: '🇹🇷 Turkey' }
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
                              {country === 'georgia' ? '🇬🇪 Georgia' : country === 'uae' ? '🇦🇪 UAE' : country === 'northern-cyprus' ? '🇨🇾 TRNC' : country === 'turkey' ? '🇹🇷 Turkey' : country}
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

                  {(() => {
                    const allCities = [
                      { value: 'tbilisi', label: '🇬🇪 Tbilisi, Georgia', country: 'georgia' },
                      { value: 'batumi', label: '🇬🇪 Batumi, Georgia', country: 'georgia' },
                      { value: 'kutaisi', label: '🇬🇪 Kutaisi, Georgia', country: 'georgia' },
                      { value: 'rustavi', label: '🇬🇪 Rustavi, Georgia', country: 'georgia' },
                      { value: 'zugdidi', label: '🇬🇪 Zugdidi, Georgia', country: 'georgia' },
                      { value: 'gori', label: '🇬🇪 Gori, Georgia', country: 'georgia' },
                      { value: 'poti', label: '🇬🇪 Poti, Georgia', country: 'georgia' },
                      { value: 'telavi', label: '🇬🇪 Telavi, Georgia', country: 'georgia' },
                      { value: 'mtskheta', label: '🇬🇪 Mtskheta, Georgia', country: 'georgia' },
                      { value: 'kobuleti', label: '🇬🇪 Kobuleti, Georgia', country: 'georgia' },
                      { value: 'borjomi', label: '🇬🇪 Borjomi, Georgia', country: 'georgia' },
                      { value: 'akhaltsikhe', label: '🇬🇪 Akhaltsikhe, Georgia', country: 'georgia' },
                      { value: 'senaki', label: '🇬🇪 Senaki, Georgia', country: 'georgia' },
                      { value: 'anaklia', label: '🇬🇪 Anaklia, Georgia', country: 'georgia' },
                      { value: 'sighnaghi', label: '🇬🇪 Sighnaghi, Georgia', country: 'georgia' },
                      { value: 'ambrolauri', label: '🇬🇪 Ambrolauri, Georgia', country: 'georgia' },
                      { value: 'khashuri', label: '🇬🇪 Khashuri, Georgia', country: 'georgia' },
                      { value: 'samtredia', label: '🇬🇪 Samtredia, Georgia', country: 'georgia' },
                      { value: 'zestafoni', label: '🇬🇪 Zestafoni, Georgia', country: 'georgia' },
                      { value: 'chiatura', label: '🇬🇪 Chiatura, Georgia', country: 'georgia' },
                      { value: 'dubai', label: '🇦🇪 Dubai, UAE', country: 'uae' },
                      { value: 'abuDhabi', label: '🇦🇪 Abu Dhabi, UAE', country: 'uae' },
                      { value: 'sharjah', label: '🇦🇪 Sharjah, UAE', country: 'uae' },
                      { value: 'ajman', label: '🇦🇪 Ajman, UAE', country: 'uae' },
                      { value: 'rasAlKhaimah', label: '🇦🇪 Ras Al Khaimah, UAE', country: 'uae' },
                      { value: 'fujairah', label: '🇦🇪 Fujairah, UAE', country: 'uae' },
                      { value: 'ummAlQuwain', label: '🇦🇪 Umm Al Quwain, UAE', country: 'uae' },
                      { value: 'alAin', label: '🇦🇪 Al Ain, UAE', country: 'uae' },
                      { value: 'khorfakkan', label: '🇦🇪 Khor Fakkan, UAE', country: 'uae' },
                      { value: 'kalbaCity', label: '🇦🇪 Kalba City, UAE', country: 'uae' },
                      { value: 'dibbaAlHisn', label: '🇦🇪 Dibba Al Hisn, UAE', country: 'uae' },
                      { value: 'dhaid', label: '🇦🇪 Dhaid, UAE', country: 'uae' },
                      { value: 'madinatZayed', label: '🇦🇪 Madinat Zayed, UAE', country: 'uae' },
                      { value: 'ruwais', label: '🇦🇪 Ruwais, UAE', country: 'uae' },
                      { value: 'alMirfa', label: '🇦🇪 Al Mirfa, UAE', country: 'uae' },
                      { value: 'lefkosa', label: '🇨🇾 Lefkoşa (Nicosia), TRNC', country: 'northern-cyprus' },
                      { value: 'gazimağusa', label: '🇨🇾 Gazimağusa (Famagusta), TRNC', country: 'northern-cyprus' },
                      { value: 'girne', label: '🇨🇾 Girne (Kyrenia), TRNC', country: 'northern-cyprus' },
                      { value: 'iskele', label: '🇨🇾 İskele, TRNC', country: 'northern-cyprus' },
                      { value: 'guzelyurt', label: '🇨🇾 Güzelyurt, TRNC', country: 'northern-cyprus' },
                      { value: 'esentepe', label: '🇨🇾 Esentepe, TRNC', country: 'northern-cyprus' },
                      { value: 'istanbul', label: '🇹🇷 İstanbul, Turkey', country: 'turkey' },
                      { value: 'ankara', label: '🇹🇷 Ankara, Turkey', country: 'turkey' },
                      { value: 'izmir', label: '🇹🇷 İzmir, Turkey', country: 'turkey' },
                      { value: 'bursa', label: '🇹🇷 Bursa, Turkey', country: 'turkey' },
                      { value: 'antalya', label: '🇹🇷 Antalya, Turkey', country: 'turkey' },
                      { value: 'adana', label: '🇹🇷 Adana, Turkey', country: 'turkey' },
                      { value: 'konya', label: '🇹🇷 Konya, Turkey', country: 'turkey' },
                      { value: 'gaziantep', label: '🇹🇷 Gaziantep, Turkey', country: 'turkey' },
                      { value: 'mersin', label: '🇹🇷 Mersin, Turkey', country: 'turkey' },
                      { value: 'kocaeli', label: '🇹🇷 Kocaeli, Turkey', country: 'turkey' },
                      { value: 'trabzon', label: '🇹🇷 Trabzon, Turkey', country: 'turkey' },
                      { value: 'samsun', label: '🇹🇷 Samsun, Turkey', country: 'turkey' },
                      { value: 'kayseri', label: '🇹🇷 Kayseri, Turkey', country: 'turkey' },
                      { value: 'eskisehir', label: '🇹🇷 Eskişehir, Turkey', country: 'turkey' },
                      { value: 'diyarbakir', label: '🇹🇷 Diyarbakır, Turkey', country: 'turkey' },
                      { value: 'denizli', label: '🇹🇷 Denizli, Turkey', country: 'turkey' },
                      { value: 'sakarya', label: '🇹🇷 Sakarya, Turkey', country: 'turkey' },
                      { value: 'manisa', label: '🇹🇷 Manisa, Turkey', country: 'turkey' },
                      { value: 'tekirdag', label: '🇹🇷 Tekirdağ, Turkey', country: 'turkey' },
                      { value: 'mugla', label: '🇹🇷 Muğla, Turkey', country: 'turkey' },
                      { value: 'balikesir', label: '🇹🇷 Balıkesir, Turkey', country: 'turkey' },
                      { value: 'aydin', label: '🇹🇷 Aydın, Turkey', country: 'turkey' },
                      { value: 'hatay', label: '🇹🇷 Hatay, Turkey', country: 'turkey' },
                      { value: 'kahramanmaras', label: '🇹🇷 Kahramanmaraş, Turkey', country: 'turkey' },
                      { value: 'van', label: '🇹🇷 Van, Turkey', country: 'turkey' },
                      { value: 'malatya', label: '🇹🇷 Malatya, Turkey', country: 'turkey' },
                      { value: 'sanliurfa', label: '🇹🇷 Şanlıurfa, Turkey', country: 'turkey' },
                      { value: 'mardin', label: '🇹🇷 Mardin, Turkey', country: 'turkey' },
                      { value: 'erzurum', label: '🇹🇷 Erzurum, Turkey', country: 'turkey' },
                      { value: 'ordu', label: '🇹🇷 Ordu, Turkey', country: 'turkey' },
                      { value: 'zonguldak', label: '🇹🇷 Zonguldak, Turkey', country: 'turkey' },
                      { value: 'elazig', label: '🇹🇷 Elazığ, Turkey', country: 'turkey' },
                      { value: 'afyonkarahisar', label: '🇹🇷 Afyonkarahisar, Turkey', country: 'turkey' },
                      { value: 'batman', label: '🇹🇷 Batman, Turkey', country: 'turkey' },
                      { value: 'sivas', label: '🇹🇷 Sivas, Turkey', country: 'turkey' },
                      { value: 'tokat', label: '🇹🇷 Tokat, Turkey', country: 'turkey' },
                      { value: 'corum', label: '🇹🇷 Çorum, Turkey', country: 'turkey' },
                      { value: 'adiyaman', label: '🇹🇷 Adıyaman, Turkey', country: 'turkey' },
                      { value: 'rize', label: '🇹🇷 Rize, Turkey', country: 'turkey' },
                      { value: 'isparta', label: '🇹🇷 Isparta, Turkey', country: 'turkey' },
                      { value: 'burdur', label: '🇹🇷 Burdur, Turkey', country: 'turkey' },
                      { value: 'canakkale', label: '🇹🇷 Çanakkale, Turkey', country: 'turkey' },
                      { value: 'edirne', label: '🇹🇷 Edirne, Turkey', country: 'turkey' },
                      { value: 'kirklareli', label: '🇹🇷 Kırklareli, Turkey', country: 'turkey' },
                      { value: 'yalova', label: '🇹🇷 Yalova, Turkey', country: 'turkey' },
                      { value: 'bolu', label: '🇹🇷 Bolu, Turkey', country: 'turkey' },
                      { value: 'duzce', label: '🇹🇷 Düzce, Turkey', country: 'turkey' },
                      { value: 'karabuk', label: '🇹🇷 Karabük, Turkey', country: 'turkey' },
                      { value: 'bartin', label: '🇹🇷 Bartın, Turkey', country: 'turkey' },
                      { value: 'kastamonu', label: '🇹🇷 Kastamonu, Turkey', country: 'turkey' },
                      { value: 'sinop', label: '🇹🇷 Sinop, Turkey', country: 'turkey' },
                      { value: 'giresun', label: '🇹🇷 Giresun, Turkey', country: 'turkey' },
                      { value: 'gumushane', label: '🇹🇷 Gümüşhane, Turkey', country: 'turkey' },
                      { value: 'artvin', label: '🇹🇷 Artvin, Turkey', country: 'turkey' },
                      { value: 'ardahan', label: '🇹🇷 Ardahan, Turkey', country: 'turkey' },
                      { value: 'kars', label: '🇹🇷 Kars, Turkey', country: 'turkey' },
                      { value: 'igdir', label: '🇹🇷 Iğdır, Turkey', country: 'turkey' },
                      { value: 'agri', label: '🇹🇷 Ağrı, Turkey', country: 'turkey' },
                      { value: 'mus', label: '🇹🇷 Muş, Turkey', country: 'turkey' },
                      { value: 'bitlis', label: '🇹🇷 Bitlis, Turkey', country: 'turkey' },
                      { value: 'siirt', label: '🇹🇷 Siirt, Turkey', country: 'turkey' },
                      { value: 'sirnak', label: '🇹🇷 Şırnak, Turkey', country: 'turkey' },
                      { value: 'hakkari', label: '🇹🇷 Hakkari, Turkey', country: 'turkey' },
                      { value: 'bingol', label: '🇹🇷 Bingöl, Turkey', country: 'turkey' },
                      { value: 'tunceli', label: '🇹🇷 Tunceli, Turkey', country: 'turkey' },
                      { value: 'erzincan', label: '🇹🇷 Erzincan, Turkey', country: 'turkey' },
                      { value: 'amasya', label: '🇹🇷 Amasya, Turkey', country: 'turkey' },
                      { value: 'cankiri', label: '🇹🇷 Çankırı, Turkey', country: 'turkey' },
                      { value: 'kirsehir', label: '🇹🇷 Kırşehir, Turkey', country: 'turkey' },
                      { value: 'nevsehir', label: '🇹🇷 Nevşehir, Turkey', country: 'turkey' },
                      { value: 'nigde', label: '🇹🇷 Niğde, Turkey', country: 'turkey' },
                      { value: 'aksaray', label: '🇹🇷 Aksaray, Turkey', country: 'turkey' },
                      { value: 'karaman', label: '🇹🇷 Karaman, Turkey', country: 'turkey' },
                      { value: 'kutahya', label: '🇹🇷 Kütahya, Turkey', country: 'turkey' },
                      { value: 'usak', label: '🇹🇷 Uşak, Turkey', country: 'turkey' },
                      { value: 'bilecik', label: '🇹🇷 Bilecik, Turkey', country: 'turkey' },
                      { value: 'yozgat', label: '🇹🇷 Yozgat, Turkey', country: 'turkey' },
                      { value: 'kirikkale', label: '🇹🇷 Kırıkkale, Turkey', country: 'turkey' },
                      { value: 'bayburt', label: '🇹🇷 Bayburt, Turkey', country: 'turkey' },
                      { value: 'osmaniye', label: '🇹🇷 Osmaniye, Turkey', country: 'turkey' },
                      { value: 'kilis', label: '🇹🇷 Kilis, Turkey', country: 'turkey' },
                    ];

                    const selectedCountry = formData.country as string;
                    const filtered = allCities
                      .filter(c => !selectedCountry || c.country === selectedCountry)
                      .filter(c => c.label.toLowerCase().includes(citySearch.toLowerCase()));

                    const selectedCities = Array.isArray(formData.city)
                      ? formData.city
                      : formData.city ? formData.city.split(',').filter(Boolean) : [];

                    const toggleCity = (val: string) => {
                      let next: string[];
                      if (selectedCities.includes(val)) {
                        next = selectedCities.filter(c => c !== val);
                      } else {
                        next = [...selectedCities, val];
                      }
                      handleInputChange('city', next.join(','));
                      setUseMapSelection(false);
                    };

                    const getLabelForValue = (val: string) =>
                      allCities.find(c => c.value === val)?.label || val;

                    return (
                      <div className="relative">
                        {/* Trigger Button */}
                        <button
                          type="button"
                          onClick={() => setCityDropdownOpen(prev => !prev)}
                          className="w-full flex items-center justify-between border border-gray-300 rounded-md px-3 py-2 bg-white text-sm hover:border-[#3bcac4] focus:outline-none focus:ring-2 focus:ring-[#3bcac4]/30 transition-colors"
                        >
                          <span className={selectedCities.length === 0 ? 'text-gray-400' : 'text-gray-800'}>
                            {selectedCities.length === 0
                              ? 'Select city...'
                              : selectedCities.length === 1
                                ? getLabelForValue(selectedCities[0])
                                : `${selectedCities.length} cities selected`}
                          </span>
                          <svg className={`h-4 w-4 text-gray-400 transition-transform ${cityDropdownOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                        </button>

                        {/* Dropdown Panel */}
                        {cityDropdownOpen && (
                          <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg">
                            {/* Search */}
                            <div className="p-2 border-b border-gray-100">
                              <div className="relative">
                                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                <input
                                  type="text"
                                  value={citySearch}
                                  onChange={e => setCitySearch(e.target.value)}
                                  placeholder="Search city..."
                                  className="w-full pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-[#3bcac4]/30"
                                  autoFocus
                                />
                              </div>
                            </div>

                            {/* City List */}
                            <div className="max-h-56 overflow-y-auto p-1">
                              {filtered.length === 0 ? (
                                <div className="text-center text-sm text-gray-400 py-4">No cities found</div>
                              ) : (
                                filtered.map(cityOption => {
                                  const isSelected = selectedCities.includes(cityOption.value);
                                  return (
                                    <label
                                      key={cityOption.value}
                                      className={`flex items-center gap-2 px-3 py-2 rounded cursor-pointer text-sm hover:bg-gray-50 ${isSelected ? 'bg-[#3bcac4]/10 font-medium text-[#005476]' : 'text-gray-700'}`}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleCity(cityOption.value)}
                                        className="rounded border-gray-300 accent-[#3bcac4]"
                                      />
                                      {cityOption.label}
                                    </label>
                                  );
                                })
                              )}
                            </div>

                            {/* Footer */}
                            <div className="p-2 border-t border-gray-100 flex justify-between items-center">
                              <span className="text-xs text-gray-400">{selectedCities.length} selected</span>
                              <button type="button" onClick={() => setCityDropdownOpen(false)} className="text-xs text-[#005476] font-medium hover:underline">Done</button>
                            </div>
                          </div>
                        )}

                        {/* Selected Badges */}
                        {selectedCities.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1">
                            {selectedCities.map(val => (
                              <Badge key={val} variant="secondary" className="text-xs flex items-center gap-1">
                                {getLabelForValue(val)}
                                <button type="button" onClick={() => toggleCity(val)} className="ml-1 hover:text-red-500">×</button>
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}
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
                      <Label htmlFor="floorNumber">Floor Number *</Label>
                      <Input
                        id="floorNumber"
                        type="number"
                        value={formData.floorNumber}
                        onChange={(e) => handleInputChange('floorNumber', e.target.value)}
                        placeholder="Which floor"
                        required
                      />
                    </div>
                  )}
                </div>

                <div>
                  <Label htmlFor="area">
                    {propertyType === PROPERTY_TYPES.LAND ? '📐 المساحة / Area (m²) *' : 'Area (m²) *'}
                  </Label>
                  <div className="border border-gray-300 rounded-md p-3 bg-white">
                    <div className="text-sm text-gray-600 mb-2">
                      {propertyType === PROPERTY_TYPES.LAND ? 'اختر مساحة الأرض / Select land area:' : 'Select multiple areas:'}
                    </div>
                    <div className="grid grid-cols-3 md:grid-cols-4 gap-2 max-h-60 overflow-y-auto">
                      {(propertyType === PROPERTY_TYPES.LAND ? [
                        // 100 → 1000 كل 100
                        ...Array.from({length: 10}, (_, i) => (i + 1) * 100),
                        // 1000 → 5000 كل 500
                        ...Array.from({length: 8}, (_, i) => 1500 + i * 500),
                        // 5000 → 13000 كل 1000
                        ...Array.from({length: 8}, (_, i) => 6000 + i * 1000),
                        13000,
                      ] : [
                        ...Array.from({length: 76}, (_, i) => 25 + i),
                        ...Array.from({length: 40}, (_, i) => 100 + (i + 1) * 10),
                        ...Array.from({length: 10}, (_, i) => 500 + (i + 1) * 50),
                        ...Array.from({length: 40}, (_, i) => 1000 + (i + 1) * 100),
                      ]).map((num) => String(num)).map((areaValue) => {
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

                <div>
                  <Label htmlFor="purpose">Purpose *</Label>
                  {propertyType === PROPERTY_TYPES.PROJECT || propertyType === PROPERTY_TYPES.LAND ? (
                    <div className="border border-gray-300 rounded-md p-3 bg-gray-50">
                      <span className="text-sm font-medium">🏠 For Sell</span>
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
                        <SelectItem value="buy">🏠 For Sale</SelectItem>
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

          {/* Land Details — only shown for land type */}
          {propertyType === PROPERTY_TYPES.LAND && (
            <Card>
              <CardHeader>
                <CardTitle>🌍 {t('land.details', 'Land Details')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Land Area Selection */}
                <div>
                  <Label htmlFor="area">📐 {t('land.areaLabel', 'Area (m²)')} *</Label>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min={100}
                      max={13000}
                      value={formData.area && !formData.area.includes(',') ? formData.area : ''}
                      onChange={(e) => {
                        handleInputChange('area', e.target.value);
                      }}
                      onBlur={(e) => {
                        const num = parseInt(e.target.value);
                        if (!isNaN(num)) {
                          const clamped = Math.min(13000, Math.max(100, num));
                          handleInputChange('area', String(clamped));
                        }
                      }}
                      placeholder="100 – 13000"
                      className="flex-1 border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#3bcac4]"
                    />
                    <span className="text-sm font-medium text-gray-600 whitespace-nowrap">m²</span>
                  </div>
                  {formData.area && !formData.area.includes(',') && parseInt(formData.area) >= 1 && (
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-xs text-gray-500">{t('land.selected', 'Selected')}:</span>
                      <span className="bg-[#005476] text-white text-sm font-semibold px-3 py-0.5 rounded-full">
                        {formData.area} m²
                      </span>
                    </div>
                  )}
                </div>

                {/* Land Type */}
                <div>
                  <Label>{t('land.landType', 'Land Type')} *</Label>
                  <Select
                    value={formData.landType || ''}
                    onValueChange={(v) => handleInputChange('landType', v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder={t('land.selectLandType', 'Select land type...')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="agricultural">🌾 {t('land.agricultural', 'Agricultural Land')}</SelectItem>
                      <SelectItem value="non-agricultural">🏗️ {t('land.nonAgricultural', 'Non-Agricultural Land')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Land Features */}
                <div>
                  <Label>{t('land.includes', 'Land Includes')}</Label>
                  <div className="border border-gray-300 rounded-md p-3 bg-white mt-1">
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                      {[
                        { key: 'electricity', label: t('land.electricity', 'Electricity'), icon: '⚡' },
                        { key: 'water', label: t('land.water', 'Water'), icon: '💧' },
                        { key: 'internet', label: t('land.internet', 'Internet'), icon: '🌐' },
                        { key: 'gas', label: t('land.gas', 'Gas'), icon: '🔥' },
                        { key: 'asphalt-road', label: t('land.asphaltRoad', 'Asphalt Road'), icon: '🛣️' },
                        { key: 'fenced', label: t('land.fenced', 'Fenced'), icon: '🚧' },
                      ].map((item) => (
                        <label
                          key={item.key}
                          className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 p-2 rounded"
                        >
                          <input
                            type="checkbox"
                            checked={(formData.landFeatures || []).includes(item.key)}
                            onChange={(e) => {
                              const current = formData.landFeatures || [];
                              const updated = e.target.checked
                                ? [...current, item.key]
                                : current.filter((f: string) => f !== item.key);
                              setFormData(prev => ({ ...prev, landFeatures: updated }));
                            }}
                            className="rounded border-gray-300 accent-[#3bcac4]"
                          />
                          <span className="text-sm font-medium">
                            {item.icon} {item.label}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Payment Method — for all types except project */}
          {propertyType !== PROPERTY_TYPES.PROJECT && (
            <Card>
              <CardHeader>
                <CardTitle>💳 طريقة الدفع / Payment Method</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { value: 'cash', ar: 'نقدي', en: 'Cash', sub: 'أقساط غير متوفرة', icon: '💵' },
                    { value: 'installments', ar: 'أقساط', en: 'Installments', sub: 'Installments available', icon: '📋' },
                  ].map((opt) => (
                    <label
                      key={opt.value}
                      className={`flex flex-col items-center justify-center gap-1 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                        formData.paymentMethod === opt.value
                          ? 'border-[#3bcac4] bg-[#3bcac4]/10'
                          : 'border-gray-200 hover:border-[#3bcac4]/50'
                      }`}
                    >
                      <input
                        type="radio"
                        name="paymentMethod"
                        value={opt.value}
                        checked={formData.paymentMethod === opt.value}
                        onChange={() => handleInputChange('paymentMethod', opt.value)}
                        className="sr-only"
                      />
                      <span className="text-2xl">{opt.icon}</span>
                      <span className="font-semibold text-[#005476]">{opt.ar}</span>
                      <span className="text-xs text-gray-400">{opt.sub}</span>
                    </label>
                  ))}
                </div>

                {formData.paymentMethod === 'installments' && (
                  <div className="space-y-4 pt-2 border-t border-gray-100">
                    {/* Down Payment */}
                    <div>
                      <Label>دفعة أولى / Down Payment (%)</Label>
                      <div className="grid grid-cols-4 sm:grid-cols-6 gap-2 mt-2">
                        {[10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90].map((pct) => (
                          <button
                            key={pct}
                            type="button"
                            onClick={() => handleInputChange('downPaymentPercent', pct.toString())}
                            className={`py-2 rounded-lg text-sm font-medium border transition-all ${
                              formData.downPaymentPercent === pct.toString()
                                ? 'bg-[#005476] text-white border-[#005476]'
                                : 'bg-white text-gray-700 border-gray-200 hover:border-[#3bcac4]'
                            }`}
                          >
                            {pct}%
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Installment Duration */}
                    <div>
                      <Label>أقساط لمدة / Installment Duration</Label>
                      <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
                        {Array.from({ length: 36 }, (_, i) => i + 1).map((n) => ({
                          value: n === 1 ? '1-month' : `${n}-months`,
                          label: n === 12 ? '12 شهر (سنة)' : n === 24 ? '24 شهر (سنتان)' : n === 36 ? '36 شهر (3 سنوات)' : `${n} شهر`,
                        })).map((dur) => (
                          <button
                            key={dur.value}
                            type="button"
                            onClick={() => handleInputChange('installmentDuration', dur.value)}
                            className={`py-2 px-1 rounded-lg text-xs font-medium border transition-all ${
                              formData.installmentDuration === dur.value
                                ? 'bg-[#005476] text-white border-[#005476]'
                                : 'bg-white text-gray-700 border-gray-200 hover:border-[#3bcac4]'
                            }`}
                          >
                            {dur.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
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

          {/* Top Rated & Best Price Options - Admin only */}
          {user?.isAdmin && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border p-4 bg-gradient-to-r from-[#3bcac4]/5 to-[#005476]/5">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.topRated || false}
                    onChange={(e) => setFormData(prev => ({ ...prev, topRated: e.target.checked }))}
                    className="h-5 w-5 rounded border-gray-300 text-[#3bcac4] focus:ring-[#3bcac4]"
                  />
                  <span className="font-medium text-gray-900">Top Rated</span>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Star key={star} className="h-4 w-4 fill-[#3bcac4] text-[#3bcac4]" />
                    ))}
                  </div>
                </label>
              </div>
              <div className="rounded-lg border p-4 bg-gradient-to-r from-[#3bcac4]/5 to-[#005476]/5">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.bestPrice || false}
                    onChange={(e) => setFormData(prev => ({ ...prev, bestPrice: e.target.checked }))}
                    className="h-5 w-5 rounded border-gray-300 text-[#3bcac4] focus:ring-[#3bcac4]"
                  />
                  <span className="font-medium text-gray-900">Best Price</span>
                  <span className="bg-[#3bcac4] text-white text-xs font-bold px-2 py-0.5 rounded-full">💰</span>
                </label>
              </div>
              <div className="rounded-lg border p-4 bg-gradient-to-r from-[#005476]/5 to-[#3bcac4]/5">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(formData as any).acceptablePrice || false}
                    onChange={(e) => setFormData(prev => ({ ...prev, acceptablePrice: e.target.checked }))}
                    className="h-5 w-5 rounded border-gray-300 text-[#005476] focus:ring-[#005476]"
                  />
                  <span className="font-medium text-gray-900">Acceptable Price</span>
                  <span className="bg-[#005476] text-white text-xs font-bold px-2 py-0.5 rounded-full">✅</span>
                </label>
              </div>
              <div className="rounded-lg border p-4 bg-gradient-to-r from-slate-100 to-slate-50">
                <label className="flex items-center space-x-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={(formData as any).highPrice || false}
                    onChange={(e) => setFormData(prev => ({ ...prev, highPrice: e.target.checked }))}
                    className="h-5 w-5 rounded border-gray-300 text-slate-600 focus:ring-slate-400"
                  />
                  <span className="font-medium text-gray-900">High Price</span>
                  <span className="bg-slate-600 text-white text-xs font-bold px-2 py-0.5 rounded-full">📈</span>
                </label>
              </div>
            </div>
          )}

          {/* Submit Button */}
          <div className="flex justify-between items-center">
            {/* Delete button — admin only, edit mode only */}
            {isEditMode && (user?.isAdmin || existingProperty?.ownerId === user?.id) && (
              <Button
                type="button"
                variant="outline"
                className="border-red-300 text-red-600 hover:bg-red-50 hover:border-red-400"
                onClick={async () => {
                  const confirmed = window.confirm('هل أنت متأكد من حذف هذا العقار؟ لا يمكن التراجع عن هذا الإجراء.');
                  if (!confirmed) return;
                  try {
                    const res = await fetch(`/api/properties/${propertyId}`, { method: 'DELETE' });
                    if (res.ok) {
                      toast({ title: 'تم الحذف', description: 'تم حذف العقار بنجاح.' });
                      navigate('/admin');
                    } else {
                      const data = await res.json();
                      toast({ title: 'خطأ', description: data.message || 'فشل حذف العقار.', variant: 'destructive' });
                    }
                  } catch {
                    toast({ title: 'خطأ', description: 'حدث خطأ أثناء الحذف.', variant: 'destructive' });
                  }
                }}
              >
                🗑️ حذف العقار
              </Button>
            )}
            {!isEditMode && <div />}

            <div className="flex space-x-4">
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
                type="submit"
                disabled={isSubmitting}
                data-testid="button-submit-property"
                className={isSubmitting ? 'opacity-50 cursor-not-allowed' : ''}
              >
                {isSubmitting ? 'Submitting...' : `Submit ${getPropertyTypeTitle(propertyType)}`}
              </Button>
            )}
            </div>
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
          propertyId={paymentSuccessDetails?.propertyId}
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
            propertyLocation={paymentSuccessDetails.propertyLocation}
            durationDays={paymentSuccessDetails.durationDays}
            amount={paymentSuccessDetails.amount}
          />
        )}
      </div>
    </div>
  );
};

export default PropertyForm;