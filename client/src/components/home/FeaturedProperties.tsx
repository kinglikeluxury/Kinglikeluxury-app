import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import PropertyCard from "@/components/property/PropertyCard";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Property } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";
import { useTranslation } from "react-i18next";

const FeaturedProperties = () => {
  const { t } = useTranslation();
  const [currentPage, setCurrentPage] = useState(0);
  const itemsPerPage = 3;

  const { data: properties, isLoading } = useQuery<Property[]>({
    queryKey: ['/api/properties'],
    staleTime: 60000, // 1 minute
  });

  const featuredProperties = properties || [];
  const paginatedProperties = (): Property[] => {
    const startIndex = currentPage * itemsPerPage;
    return featuredProperties.slice(startIndex, startIndex + itemsPerPage);
  };

  const totalPages = Math.ceil(featuredProperties.length / itemsPerPage);

  const goToNextPage = () => {
    setCurrentPage((prevPage) => (prevPage + 1) % totalPages);
  };

  const goToPrevPage = () => {
    setCurrentPage((prevPage) => (prevPage - 1 + totalPages) % totalPages);
  };

  return (
    <div className="bg-gray-50 py-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <h2 className="text-2xl font-bold text-gray-900">{t('home.featured.title', 'Featured Properties')}</h2>
          <div className="flex space-x-2">
            <Button 
              onClick={goToPrevPage} 
              variant="outline" 
              size="icon" 
              disabled={isLoading || featuredProperties.length <= itemsPerPage}
              className="rounded-full"
            >
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <Button 
              onClick={goToNextPage} 
              variant="outline" 
              size="icon" 
              disabled={isLoading || featuredProperties.length <= itemsPerPage}
              className="rounded-full"
            >
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {Array(3).fill(0).map((_, index) => (
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {featuredProperties.length === 0 ? (
              <p className="text-gray-500 col-span-3 text-center py-12">{t('home.featured.noResults', 'No properties found')}</p>
            ) : (
              paginatedProperties().map((property) => (
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
                  isFeatured={true}
                  topRated={property.topRated}
                />
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default FeaturedProperties;
