import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Bed, Bath, Home, ArrowRight } from "lucide-react";
import { PROPERTY_TYPES, PROPERTY_STATUS } from "@shared/schema";

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
}: PropertyCardProps) => {
  const getPropertyTypeColor = () => {
    switch (propertyType) {
      case PROPERTY_TYPES.APARTMENT:
        return "bg-primary-500";
      case PROPERTY_TYPES.VILLA:
        return "bg-secondary-500";
      case PROPERTY_TYPES.LAND:
        return "bg-amber-600";
      case PROPERTY_TYPES.PROJECT:
        return "bg-purple-500";
      default:
        return "bg-gray-500";
    }
  };

  const getPropertyTypeName = () => {
    switch (propertyType) {
      case PROPERTY_TYPES.APARTMENT:
        return "Apartment";
      case PROPERTY_TYPES.VILLA:
        return "Villa";
      case PROPERTY_TYPES.LAND:
        return "Land";
      case PROPERTY_TYPES.PROJECT:
        return "Project";
      default:
        return propertyType;
    }
  };

  const getStatusBadge = () => {
    if (status === PROPERTY_STATUS.PENDING) {
      return <Badge variant="outline" className="bg-yellow-100 text-yellow-800 border-yellow-300">Pending Approval</Badge>;
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

  return (
    <Card className="overflow-hidden h-full flex flex-col">
      <div className="relative">
        <img
          src={images && images.length > 0 ? images[0] : "https://via.placeholder.com/800x600?text=No+Image"}
          alt={title || 'Property image'}
          className="w-full h-56 object-cover"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            if (target.src !== "https://via.placeholder.com/800x600?text=Image+Not+Available") {
              target.src = "https://via.placeholder.com/800x600?text=Image+Not+Available";
            }
          }}
        />
        <div className="absolute top-2 left-2">
          <Badge className={`${getPropertyTypeColor()} hover:${getPropertyTypeColor()}`}>
            {getPropertyTypeName()}
          </Badge>
        </div>
        {isFeatured && (
          <div className="absolute top-2 right-2">
            <Badge className="bg-amber-500 hover:bg-amber-600">Featured</Badge>
          </div>
        )}
      </div>
      <CardContent className="p-4 flex-1 flex flex-col">
        <div className="flex justify-between items-start mb-1">
          <div>
            <h3 className="text-lg font-medium text-gray-900 line-clamp-1">{title || 'Untitled Property'}</h3>
            <p className="text-gray-500 text-sm">{location || 'Location not specified'}</p>
          </div>
          <p className="text-lg font-bold text-primary-600">{formatPrice(price || 0)}</p>
        </div>
        
        {getStatusBadge()}
        
        <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
          <div className="flex items-center">
            <Home className="h-4 w-4 mr-1" />
            <span>{area || 0} sqft</span>
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
          <Button variant="secondary" className="w-full" asChild>
            <Link href={`/property/${id}`}>
              <span className="flex items-center justify-center">
                View Details
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
