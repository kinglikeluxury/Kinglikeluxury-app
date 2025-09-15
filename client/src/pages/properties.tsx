import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Property, PROPERTY_TYPES } from "@shared/schema";
import PropertyCard from "@/components/property/PropertyCard";
import SearchFilters from "@/components/property/SearchFilters";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

const Properties = () => {
  const { t } = useTranslation();
  const [location] = useLocation();
  const [filters, setFilters] = useState<Record<string, string | null>>({});
  const [title, setTitle] = useState(t('property.viewAll', 'All Properties'));

  // Parse URL parameters
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const newFilters: Record<string, string | null> = {};
    
    params.forEach((value, key) => {
      newFilters[key] = value;
    });
    
    setFilters(newFilters);
    
    // Set title based on property type
    if (params.has("type")) {
      const type = params.get("type");
      switch (type) {
        case PROPERTY_TYPES.APARTMENT:
          setTitle(t('propertyTypes.apartment', 'Apartments'));
          break;
        case PROPERTY_TYPES.VILLA:
          setTitle(t('propertyTypes.villa', 'Villas'));
          break;
        case PROPERTY_TYPES.LAND:
          setTitle(t('propertyTypes.land', 'Lands'));
          break;
        case PROPERTY_TYPES.PROJECT:
          setTitle(t('propertyTypes.project', 'Projects'));
          break;
        default:
          setTitle(t('property.viewAll', 'All Properties'));
      }
    } else if (params.has("myProperties")) {
      setTitle(t('property.myProperties', 'My Properties'));
    } else {
      setTitle(t('property.viewAll', 'All Properties'));
    }
  }, [location]);

  // Construct API query URL with filters
  const getQueryUrl = () => {
    const params = new URLSearchParams();
    
    if (filters.type) {
      params.append("type", filters.type);
    }
    
    if (filters.location) {
      params.append("location", filters.location);
    }
    
    if (filters.city) {
      params.append("city", filters.city);
    }
    
    if (filters.minPrice) {
      params.append("minPrice", filters.minPrice);
    }
    
    if (filters.maxPrice) {
      params.append("maxPrice", filters.maxPrice);
    }
    
    if (filters.myProperties) {
      params.append("myProperties", "true");
    }
    
    return `/api/properties${params.size > 0 ? `?${params.toString()}` : ""}`;
  };

  // Fetch properties based on filters
  const { data: properties, isLoading } = useQuery<Property[]>({
    queryKey: [getQueryUrl()],
    staleTime: 0, // Don't use cached data
  });

  // Convert filters for the search component
  const searchFilters = {
    type: filters.type || undefined,
    location: filters.location || undefined,
    minPrice: filters.minPrice ? parseInt(filters.minPrice) : undefined,
    maxPrice: filters.maxPrice ? parseInt(filters.maxPrice) : undefined,
  };

  return (
    <div className="bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900">{title}</h1>
          {filters.myProperties && (
            <Badge variant="outline" className="mt-2">{t('property.myProperties', 'My Listings')}</Badge>
          )}
          <div className="mt-4">
            <SearchFilters initialFilters={searchFilters} />
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
            {Array(6).fill(0).map((_, index) => (
              <div key={index} className="bg-white rounded-lg shadow-md overflow-hidden">
                <Skeleton className="h-56 w-full" />
                <div className="p-4">
                  <Skeleton className="h-6 w-2/3 mb-2" />
                  <Skeleton className="h-4 w-1/2 mb-4" />
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-4 w-full mb-2" />
                  <Skeleton className="h-10 w-full mt-4" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            {properties && properties.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
                {properties.map((property) => (
                  <PropertyCard
                    key={property.id}
                    id={property.id}
                    title={property.title}
                    location={property.location}
                    price={property.price}
                    area={property.area}
                    bedrooms={property.bedrooms}
                    bathrooms={property.bathrooms}
                    propertyType={property.propertyType}
                    images={property.images}
                    status={property.status}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <h3 className="text-lg font-medium text-gray-900 mb-2">{t('property.noResults', 'No properties found')}</h3>
                <p className="text-gray-500 mb-6">{t('property.tryAdjustingFilters', 'Try adjusting your search filters or check back later.')}</p>
                <Button variant="outline" asChild>
                  <a href="/properties">{t('property.viewAll', 'View All Properties')}</a>
                </Button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Properties;
