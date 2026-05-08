import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bed, Bath, Home, ArrowRight, Heart, Star } from "lucide-react";
import { PROPERTY_TYPES, PROPERTY_STATUS } from "@shared/schema";
import { useTranslation } from "react-i18next";
import { useFavorites } from "@/hooks/use-favorites";
import { useAutoTranslateText } from "@/hooks/useAutoTranslate";

interface PropertyCardProps {
  id: number;
  title: string;
  location: string;
  price: number;
  area: number;
  bedrooms?: number | null;
  bathrooms?: number | null;
  propertyType: string;
  images: string[];
  status: string;
  isFeatured?: boolean;
  topRated?: boolean | null;
  isSold?: boolean | null;
}

const PropertyCard = ({
  id,
  title,
  location,
  price,
  area,
  bedrooms,
  bathrooms,
  propertyType,
  images,
  status,
  isFeatured = false,
  topRated = false,
  isSold = false,
}: PropertyCardProps) => {
  const { t } = useTranslation();
  const { toggleFavorite, isFavorite } = useFavorites();
  const favorited = isFavorite(id);
  const translatedTitle = useAutoTranslateText(title);
  const getPropertyTypeColor = () => {
    // Use consistent Kinglike blue color (#005476) for all property types
    return "bg-[#005476] text-white";
  };

  const getPropertyTypeName = () => {
    switch (propertyType) {
      case PROPERTY_TYPES.APARTMENT:
        return t('propertyTypes.apartment', 'Apartment');
      case PROPERTY_TYPES.VILLA:
        return t('propertyTypes.villa', 'Villa');
      case PROPERTY_TYPES.LAND:
        return t('propertyTypes.land', 'Land');
      case PROPERTY_TYPES.PROJECT:
        return t('propertyTypes.project', 'Off Plan Project');
      default:
        return propertyType;
    }
  };

  const getStatusBadge = () => {
    if (status === PROPERTY_STATUS.PENDING) {
      return <Badge variant="outline" className="bg-[#3bcac4] text-white border-[#3bcac4]">Pending Approval</Badge>;
    }
    if (status === PROPERTY_STATUS.REJECTED) {
      return <Badge variant="outline" className="bg-red-100 text-red-800 border-red-300">Rejected</Badge>;
    }
    return null;
  };

  const formatPrice = (price: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
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


  return (
    <Card className="overflow-hidden h-full flex flex-col">
      <div className="relative">
        <Link href={`/property/${id}`} className="block">
          <div className="relative">
            <img
              src={images && images.length > 0 ? images[0] : "https://via.placeholder.com/800x600?text=No+Image"}
              alt={title || 'Property image'}
              className="w-full h-56 object-cover cursor-pointer hover:opacity-95 transition-opacity"
              onError={(e) => {
                const target = e.target as HTMLImageElement;
                if (target.src !== "https://via.placeholder.com/800x600?text=Image+Not+Available") {
                  target.src = "https://via.placeholder.com/800x600?text=Image+Not+Available";
                }
              }}
            />
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <img src="/watermark-logo.png" alt="" className="w-1/4 opacity-25" draggable={false} />
            </div>
            {isSold && (
              <div className="absolute inset-0 bg-[#005476]/60 flex items-center justify-center pointer-events-none">
                <div className="bg-[#3bcac4] text-white font-extrabold text-2xl tracking-widest px-6 py-3 rounded-lg rotate-[-15deg] shadow-2xl border-4 border-white">
                  {t('property.sold', 'SOLD')}
                </div>
              </div>
            )}
          </div>
        </Link>
        <div className="absolute top-2 left-2">
          <Badge className={`${getPropertyTypeColor()} hover:${getPropertyTypeColor()}`}>
            {getPropertyTypeName()}
          </Badge>
        </div>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            toggleFavorite({ id, title, price, type: propertyType });
          }}
          className="absolute top-2 right-2 z-10 p-2 rounded-full bg-white/80 backdrop-blur-sm hover:bg-white transition-all shadow-md"
          aria-label={favorited ? t('favorites.remove', 'Remove from favorites') : t('favorites.add', 'Add to favorites')}
        >
          <Heart className={`h-5 w-5 transition-colors ${favorited ? 'text-[#3bcac4] fill-[#3bcac4]' : 'text-gray-600'}`} />
        </button>
        {isFeatured && (
          <div className="absolute top-2 right-12">
            <Badge className="bg-[#3bcac4] hover:bg-[#3bcac4]/90 text-white">Featured</Badge>
          </div>
        )}
        {topRated && (
          <div className="absolute bottom-2 left-2">
            <Badge className="bg-white border border-white shadow-md flex items-center gap-1 px-2 py-1">
              <span className="text-xs font-semibold text-[#005476]">Top Rated</span>
              <div className="flex items-center gap-0.5">
                {[1, 2, 3, 4, 5].map((star) => (
                  <Star key={star} className="h-3 w-3 fill-[#3bcac4] text-[#3bcac4]" />
                ))}
              </div>
            </Badge>
          </div>
        )}
      </div>
      <CardContent className="p-4 flex-1 flex flex-col">
        <div className="flex justify-between items-start mb-1">
          <div>
            <h3 className="text-lg font-medium text-gray-900 line-clamp-1">{translatedTitle || title || 'Untitled Property'}</h3>
            <p className="text-gray-500 text-sm">{location || 'Location not specified'}</p>
          </div>
          <p className="text-lg font-bold text-primary-600">{getPriceRange(price || 0)}</p>
        </div>
        
        {getStatusBadge()}
        
        <div className="-mt-1 flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center">
            <Home className="h-4 w-4 mr-1" />
            <span>{(() => {
              const areaStr = String(area || 0);
              if (areaStr.includes(',')) {
                const vals = areaStr.split(',').map(v => parseInt(v.trim())).filter(v => !isNaN(v));
                if (vals.length > 1) return `${Math.min(...vals)} - ${Math.max(...vals)} m²`;
                if (vals.length === 1) return `${vals[0]} m²`;
              }
              return `${areaStr} m²`;
            })()}</span>
          </div>
          
          {bedrooms != null && (
            <div className="flex items-center">
              <Bed className="h-4 w-4 mr-1" />
              <span>{bedrooms} {bedrooms === 1 ? 'Bed' : 'Beds'}</span>
            </div>
          )}
          
          {bathrooms != null && (
            <div className="flex items-center">
              <Bath className="h-4 w-4 mr-1" />
              <span>{bathrooms} {bathrooms === 1 ? 'Bath' : 'Baths'}</span>
            </div>
          )}
        </div>
        
        <div className="mt-4 mt-auto">
          <Button className="w-full bg-[#3bcac4] hover:bg-[#3bcac4]/90 text-white" asChild>
            <Link href={`/property/${id}`}>
              <span className="flex items-center justify-center">
                {t('property.viewDetails', 'View Details')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </span>
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default PropertyCard;
