import { useState } from "react";
import { useLocation } from "wouter";
import { PROPERTY_TYPES } from "@shared/schema";
import luxuryLogoPath from "@assets/LUXURY_20230822_234540_0000-removebg.png";
import constructionImagePath from "@assets/1702663538423.jfif";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Search } from "lucide-react";

const CategorySection = () => {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const [showModal, setShowModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>("");
  const [selectedCountry, setSelectedCountry] = useState<string>("");
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [selectedPurpose, setSelectedPurpose] = useState<string>("");
  const [selectedDeliveryYear, setSelectedDeliveryYear] = useState<string>("");
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const getCitiesForCountry = (country: string) => {
    switch (country) {
      case "georgia":
        return [
          { value: "batumi", label: "Batumi" },
          { value: "tbilisi", label: "Tbilisi" },
        ];
      case "uae":
        return [
          { value: "dubai", label: "Dubai" },
          { value: "sharjah", label: "Sharjah" },
          { value: "rasAlKhaimah", label: "Ras Al Khaimah" },
        ];
      default:
        return [];
    }
  };

  const handleCategoryClick = (e: React.MouseEvent, categoryType: string) => {
    e.preventDefault();
    setSelectedCategory(categoryType);
    setSelectedCountry("");
    setSelectedCity("");
    setSelectedPurpose("");
    setSelectedDeliveryYear("");
    setErrors({});
    setShowModal(true);
  };

  const isProjectCategory = selectedCategory === PROPERTY_TYPES.PROJECT;

  const handleModalSearch = () => {
    const newErrors: Record<string, boolean> = {};
    if (!selectedCountry) newErrors.country = true;
    if (!isProjectCategory && !selectedPurpose) newErrors.purpose = true;

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    if (isProjectCategory) {
      const params = new URLSearchParams();
      if (selectedCountry) params.append("country", selectedCountry);
      if (selectedCity) params.append("city", selectedCity);
      if (selectedDeliveryYear && selectedDeliveryYear !== "any") params.append("deliveryYear", selectedDeliveryYear);
      setShowModal(false);
      navigate(`/projects?${params.toString()}`);
    } else {
      const params = new URLSearchParams();
      params.append("type", selectedCategory);
      if (selectedCountry) params.append("city", selectedCountry);
      if (selectedCity) params.append("city", selectedCity);
      if (selectedPurpose) params.append("purpose", selectedPurpose);
      setShowModal(false);
      navigate(`/properties?${params.toString()}`);
    }
  };

  const categories = [
    {
      name: t('propertyTypes.apartment', 'Apartments'),
      image: "https://images.unsplash.com/photo-1545324418-cc1a3fa10c00?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
      type: PROPERTY_TYPES.APARTMENT,
      count: t('property.listings', '120+ Listings'),
    },
    {
      name: t('propertyTypes.villa', 'Villas'),
      image: "https://images.unsplash.com/photo-1613490493576-7fde63acd811?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
      type: PROPERTY_TYPES.VILLA,
      count: t('property.listings2', '85+ Listings'),
    },
    {
      name: t('propertyTypes.land', 'Lands'),
      image: "https://images.unsplash.com/photo-1500382017468-9049fed747ef?ixlib=rb-1.2.1&auto=format&fit=crop&w=800&q=80",
      type: PROPERTY_TYPES.LAND,
      count: t('property.listings3', '63+ Listings'),
    },
    {
      name: t('propertyTypes.project', 'Under Construction Projects'),
      image: constructionImagePath,
      type: PROPERTY_TYPES.PROJECT,
      count: t('property.listings4', '42+ Listings'),
      isProject: true,
    },
  ];

  return (
    <>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">{t('categories.title', 'Browse by category')}</h2>
          <div className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white text-xs font-medium px-3 py-1 rounded-full shadow-md">
            {t('common.exclusive', 'KINGLIKE EXCLUSIVE')}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {categories.map((category, index) => (
            <div
              key={index}
              onClick={(e) => handleCategoryClick(e, category.type)}
              className="relative rounded-lg overflow-hidden group h-48 block cursor-pointer"
            >
              <img
                src={category.image}
                alt={`${category.name} ${t('common.category', 'category')}`}
                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-110"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent"></div>

              {category.isProject && (
                <div className="absolute inset-0 flex flex-col items-center justify-center p-4 bg-black/60">
                  <div className="flex flex-col items-center mb-4">
                    <div className="text-[#3bcac4] font-bold text-lg mb-1">KINGLIKE</div>
                    <div className="text-[#3bcac4] font-bold text-lg">LUXURY</div>
                  </div>
                  <div className="bg-[#3bcac4]/90 px-3 py-1 rounded-full mb-2 rotate-[-5deg] shadow-lg">
                    <span className="text-white font-bold text-sm">{t('common.comingSoon', 'Coming Soon')}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-3">
                    <div className="w-5 h-5 rounded-full bg-[#005476] animate-pulse"></div>
                    <div className="w-5 h-5 rounded-full bg-[#3bcac4] animate-pulse delay-100"></div>
                    <div className="w-5 h-5 rounded-full bg-[#005476] animate-pulse delay-200"></div>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="h-5 w-5 bg-yellow-400 rounded-sm flex items-center justify-center">
                      <span className="text-black text-xs font-bold">!</span>
                    </div>
                    <p className="text-white text-xs">{t('admin.onlyListings', 'Admin-only listings')}</p>
                  </div>
                </div>
              )}

              <div className="absolute bottom-0 left-0 p-4">
                <h3 className="text-xl font-bold text-white">{category.name}</h3>
                <p className="text-sm text-white/80">{category.count}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-center text-lg font-bold text-[#005476]">
              {t('categories.selectFilters', 'Select your preferences')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className={`block text-sm font-medium mb-1 ${errors.country ? 'text-red-500' : 'text-gray-700'}`}>
                {t('home.hero.country', 'Country')} *
              </label>
              <Select value={selectedCountry} onValueChange={(v) => { setSelectedCountry(v); setSelectedCity(""); setErrors(prev => ({ ...prev, country: false })); }}>
                <SelectTrigger className={errors.country ? 'border-red-500 ring-red-500' : ''}>
                  <SelectValue placeholder={t('home.hero.anyCountry', 'Select Country')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="georgia">{t('countries.georgia', 'Georgia')}</SelectItem>
                  <SelectItem value="uae">{t('countries.uae', 'United Arab Emirates')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium mb-1 text-gray-700">
                {t('home.hero.city', 'City')}
              </label>
              <Select value={selectedCity} onValueChange={setSelectedCity} disabled={!selectedCountry}>
                <SelectTrigger>
                  <SelectValue placeholder={t('property.anyLocation', 'Any City')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t('property.anyLocation', 'Any City')}</SelectItem>
                  {getCitiesForCountry(selectedCountry).map((cityOption) => (
                    <SelectItem key={cityOption.value} value={cityOption.value}>
                      {t(`cities.${cityOption.value}`, cityOption.label)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {isProjectCategory ? (
              <div>
                <label className="block text-sm font-medium mb-1 text-gray-700">
                  {t('projects.deliveryDate', 'Delivery Date')}
                </label>
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
            ) : (
              <div>
                <label className={`block text-sm font-medium mb-1 ${errors.purpose ? 'text-red-500' : 'text-gray-700'}`}>
                  {t('home.hero.purpose', 'Purpose')} *
                </label>
                <Select value={selectedPurpose} onValueChange={(v) => { setSelectedPurpose(v); setErrors(prev => ({ ...prev, purpose: false })); }}>
                  <SelectTrigger className={errors.purpose ? 'border-red-500 ring-red-500' : ''}>
                    <SelectValue placeholder={t('home.hero.anyPurpose', 'Select Purpose')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">{t('home.hero.toBuy', 'For Sale')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <Button className="w-full bg-gradient-to-r from-[#3bcac4] to-[#005476] hover:opacity-90 text-white" onClick={handleModalSearch}>
              <Search className="mr-2 h-4 w-4" />
              {t('common.search', 'Search')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

export default CategorySection;
