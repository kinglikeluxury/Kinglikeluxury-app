import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { User, useAuth } from "@/lib/auth";
import { Property, Project } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Bed, Bath, Home, User as UserIcon, MapPin, Calendar, Tag, CheckSquare, Dumbbell, Wifi, Coffee, Car, ShieldCheck, BarChart3, Edit, ChevronLeft, ChevronRight, X } from "lucide-react";
import PropertyScoreChart from "@/components/property/PropertyScoreChart";
import { PropertyScoreBadge } from "@/components/property/PropertyScoreBadge";

const PropertyDetail = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [, params] = useRoute("/property/:id");
  const propertyId = params?.id ? parseInt(params.id) : null;
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [modalImageIndex, setModalImageIndex] = useState(0);

  // Fetch property data
  const { data: property, isLoading: isLoadingProperty } = useQuery<Property>({
    queryKey: [`/api/properties/${propertyId}`],
    enabled: !!propertyId,
  });

  // Fetch project data if property type is project
  const { data: projectData, isLoading: isLoadingProject } = useQuery<(Project & { property: Property })[]>({
    queryKey: ['/api/projects'],
    enabled: !!property && property.propertyType === 'project',
  });

  // Find the specific project that matches this property
  const project = projectData?.find(p => p.propertyId === propertyId);

  const isLoading = isLoadingProperty || (property?.propertyType === 'project' && isLoadingProject);

  // Image modal functions
  const openImageModal = (index: number) => {
    setModalImageIndex(index);
    setIsImageModalOpen(true);
  };

  const closeImageModal = () => {
    setIsImageModalOpen(false);
  };

  const nextImage = () => {
    if (property?.images && modalImageIndex < property.images.length - 1) {
      setModalImageIndex(modalImageIndex + 1);
    }
  };

  const prevImage = () => {
    if (modalImageIndex > 0) {
      setModalImageIndex(modalImageIndex - 1);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isImageModalOpen) return;
      
      if (e.key === 'Escape') {
        closeImageModal();
      } else if (e.key === 'ArrowLeft') {
        prevImage();
      } else if (e.key === 'ArrowRight') {
        nextImage();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isImageModalOpen, modalImageIndex, property?.images]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (isImageModalOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, [isImageModalOpen]);

  const formatPrice = (price?: number) => {
    if (!price) return "";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(price);
  };

  const getPropertyTypeName = (type?: string) => {
    if (!type) return "";
    switch (type) {
      case "apartment": return "Apartment";
      case "villa": return "Villa";
      case "land": return "Land";
      case "project": return "Construction Project";
      default: return type;
    }
  };

  const getPropertyTypeColor = (type?: string) => {
    if (!type) return "";
    // Use consistent Kinglike blue color (#005476) for all property types
    return "bg-[#005476] text-white";
  };

  // Load sample amenities icons
  const getFeatureIcon = (feature: string) => {
    const lowerFeature = feature.toLowerCase();
    if (lowerFeature.includes("gym") || lowerFeature.includes("fitness")) return <Dumbbell className="h-4 w-4 mr-2" />;
    if (lowerFeature.includes("wifi") || lowerFeature.includes("internet")) return <Wifi className="h-4 w-4 mr-2" />;
    if (lowerFeature.includes("parking") || lowerFeature.includes("garage")) return <Car className="h-4 w-4 mr-2" />;
    if (lowerFeature.includes("security") || lowerFeature.includes("safe")) return <ShieldCheck className="h-4 w-4 mr-2" />;
    if (lowerFeature.includes("cafe") || lowerFeature.includes("coffee")) return <Coffee className="h-4 w-4 mr-2" />;
    return <CheckSquare className="h-4 w-4 mr-2" />;
  };

  if (!propertyId) {
    return <div className="text-center py-10">Invalid property ID</div>;
  }

  return (
    <div className="bg-gray-50 py-8">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {isLoading ? (
          <div>
            <Skeleton className="h-8 w-3/4 max-w-2xl mb-2" />
            <Skeleton className="h-6 w-1/2 max-w-xl mb-6" />
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <Skeleton className="h-96 col-span-2 rounded-lg" />
              <div className="grid grid-cols-2 gap-4">
                <Skeleton className="h-44 rounded-lg" />
                <Skeleton className="h-44 rounded-lg" />
                <Skeleton className="h-44 rounded-lg" />
                <Skeleton className="h-44 rounded-lg" />
              </div>
            </div>
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2">
                <Skeleton className="h-10 w-40 mb-4" />
                <Skeleton className="h-6 w-full mb-2" />
                <Skeleton className="h-6 w-full mb-2" />
                <Skeleton className="h-6 w-3/4 mb-6" />
                
                <Skeleton className="h-10 w-40 mb-4" />
                <div className="grid grid-cols-2 gap-4">
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                  <Skeleton className="h-8" />
                </div>
              </div>
              
              <div>
                <Skeleton className="h-64 rounded-lg mb-4" />
              </div>
            </div>
          </div>
        ) : property ? (
          <>
            <div className="mb-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center">
                <div>
                  <div className="flex items-center gap-3">
                    <h1 className="text-3xl font-bold text-gray-900">{property.title}</h1>
                    {user && (user.id === property.ownerId || user.isAdmin) && (
                      <Button variant="outline" size="sm" className="border-[#3bcac4] text-[#3bcac4] hover:bg-[#3bcac4] hover:text-white" asChild>
                        <Link href={`/property/${property.id}/edit`}>
                          <Edit className="h-4 w-4 mr-1" />
                          Edit
                        </Link>
                      </Button>
                    )}
                  </div>
                  <p className="text-gray-600 flex items-center mt-1">
                    <MapPin className="h-4 w-4 mr-1 text-gray-400" />
                    {property.location}
                  </p>
                </div>
                <div className="mt-4 sm:mt-0">
                  <span className="text-3xl font-bold text-primary-600">{formatPrice(property.price)}</span>
                </div>
              </div>
              
              <div className="flex flex-wrap gap-2 mt-4">
                <Badge className={`${getPropertyTypeColor(property.propertyType)} hover:${getPropertyTypeColor(property.propertyType)}`}>
                  {getPropertyTypeName(property.propertyType)}
                </Badge>
                
                {project && (
                  <Badge variant="outline" className="bg-[#3bcac4] text-white border-[#3bcac4]">
                    {project.projectStatus}
                  </Badge>
                )}
              </div>
            </div>
            
            {/* Image Gallery */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="md:col-span-2">
                <img 
                  src={property.images[activeImageIndex] || "https://images.unsplash.com/photo-1560518883-ce09059eeffa?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80"}
                  alt={property.title}
                  className="w-full h-96 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity"
                  onClick={() => openImageModal(activeImageIndex)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                {property.images.slice(0, 4).map((image, idx) => (
                  <img 
                    key={idx}
                    src={image}
                    alt={`${property.title} ${idx + 1}`}
                    className={`w-full h-44 object-cover rounded-lg cursor-pointer transition-opacity ${activeImageIndex === idx ? 'ring-4 ring-primary-500' : 'hover:opacity-80'}`}
                    onClick={() => {
                      setActiveImageIndex(idx);
                      openImageModal(idx);
                    }}
                  />
                ))}
                {property.images.length > 4 && (
                  <div 
                    className="w-full h-44 bg-black bg-opacity-50 rounded-lg flex items-center justify-center cursor-pointer hover:bg-opacity-60 transition-all"
                    onClick={() => {
                      setActiveImageIndex(4);
                      openImageModal(4);
                    }}
                  >
                    <span className="text-white text-lg font-medium">+{property.images.length - 4} more</span>
                  </div>
                )}
              </div>
            </div>

            {/* Video Section */}
            {property.videos && property.videos.length > 0 && (
              <div className="mb-8">
                <h3 className="text-xl font-semibold mb-4">Property Videos</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {property.videos.map((video, idx) => (
                    <div key={idx} className="rounded-lg overflow-hidden">
                      <video 
                        controls 
                        controlsList="nodownload"
                        onContextMenu={(e) => e.preventDefault()}
                        className="w-full h-64 object-cover rounded-lg"
                        preload="auto"
                        playsInline
                        style={{ objectFit: 'cover' }}
                      >
                        <source src={video} type="video/mp4" />
                        Your browser does not support the video tag.
                      </video>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-8">
                {/* Details Section */}
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Description</h3>
                    <p className="text-gray-700 whitespace-pre-line">{property.description}</p>
                  </div>
                  
                  <Separator />
                  
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Property Details</h3>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="flex flex-col p-4 bg-gray-50 rounded-lg">
                        <span className="text-gray-500 text-sm">Property ID</span>
                        <span className="font-medium">{property.id}</span>
                      </div>
                      <div className="flex flex-col p-4 bg-gray-50 rounded-lg">
                        <span className="text-gray-500 text-sm">Property Type</span>
                        <span className="font-medium">{getPropertyTypeName(property.propertyType)}</span>
                      </div>
                      <div className="flex flex-col p-4 bg-gray-50 rounded-lg">
                        <span className="text-gray-500 text-sm">Area</span>
                        <span className="font-medium">{property.area} sqft</span>
                      </div>
                      {property.bedrooms !== null && (
                        <div className="flex flex-col p-4 bg-gray-50 rounded-lg">
                          <span className="text-gray-500 text-sm">Bedrooms</span>
                          <span className="font-medium">{property.bedrooms}</span>
                        </div>
                      )}
                      {property.bathrooms !== null && (
                        <div className="flex flex-col p-4 bg-gray-50 rounded-lg">
                          <span className="text-gray-500 text-sm">Bathrooms</span>
                          <span className="font-medium">{property.bathrooms}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <Separator />

                {/* Features Section */}
                <div>
                  <h3 className="text-xl font-semibold mb-4">Features & Amenities</h3>
                  {property.features.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {property.features.map((feature, idx) => (
                        <div key={idx} className="flex items-center">
                          {getFeatureIcon(feature)}
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500">No features listed for this property.</p>
                  )}
                </div>

                <Separator />

                {/* Property Score Section */}
                <div className="space-y-6">
                  <div className="flex flex-col md:flex-row justify-between items-start md:items-center">
                    <div>
                      <h3 className="text-xl font-semibold mb-2 flex items-center">
                        <BarChart3 className="h-5 w-5 mr-2" />
                        {t('score.propertyScore')}
                      </h3>
                      <p className="text-gray-600">{t('score.overallScoreDetails')}</p>
                    </div>
                    <div className="mt-4 md:mt-0">
                      <PropertyScoreBadge 
                        score={property.overallScore || 0}
                        size="large"
                        showLabel={true}
                      />
                    </div>
                  </div>

                  <Separator />
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div>
                      <PropertyScoreChart
                        scores={{
                          location: property.locationScore || 0,
                          value: property.valueScore || 0,
                          amenities: property.amenitiesScore || 0,
                          condition: property.conditionScore || 0,
                          investment: property.investmentScore || 0
                        }}
                        size={300}
                      />
                    </div>
                    <div className="space-y-4">
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <h4 className="font-medium">{t('score.location')}</h4>
                          <PropertyScoreBadge score={property.locationScore || 0} />
                        </div>
                        <p className="text-sm text-gray-600">{t('score.locationDetails')}</p>
                      </div>
                      
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <h4 className="font-medium">{t('score.value')}</h4>
                          <PropertyScoreBadge score={property.valueScore || 0} />
                        </div>
                        <p className="text-sm text-gray-600">{t('score.valueDetails')}</p>
                      </div>
                      
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <h4 className="font-medium">{t('score.amenities')}</h4>
                          <PropertyScoreBadge score={property.amenitiesScore || 0} />
                        </div>
                        <p className="text-sm text-gray-600">{t('score.amenitiesDetails')}</p>
                      </div>
                      
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <h4 className="font-medium">{t('score.condition')}</h4>
                          <PropertyScoreBadge score={property.conditionScore || 0} />
                        </div>
                        <p className="text-sm text-gray-600">{t('score.conditionDetails')}</p>
                      </div>
                      
                      <div>
                        <div className="flex justify-between items-center mb-1">
                          <h4 className="font-medium">{t('score.investment')}</h4>
                          <PropertyScoreBadge score={property.investmentScore || 0} />
                        </div>
                        <p className="text-sm text-gray-600">{t('score.investmentDetails')}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Project Information Section */}
                {property.propertyType === 'project' && (
                  <>
                    <Separator />
                    <div>
                      <h3 className="text-xl font-semibold mb-4">Project Information</h3>
                      {project ? (
                        <div className="space-y-6">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                            <div className="flex items-start space-x-2">
                              <UserIcon className="h-5 w-5 text-gray-400 mt-0.5" />
                              <div>
                                <p className="font-medium">Developer</p>
                                <p className="text-gray-600">{project.developer}</p>
                              </div>
                            </div>
                            <div className="flex items-start space-x-2">
                              <Calendar className="h-5 w-5 text-gray-400 mt-0.5" />
                              <div>
                                <p className="font-medium">Completion Date</p>
                                <p className="text-gray-600">{project.completionDate}</p>
                              </div>
                            </div>
                            <div className="flex items-start space-x-2">
                              <Tag className="h-5 w-5 text-gray-400 mt-0.5" />
                              <div>
                                <p className="font-medium">Project Status</p>
                                <p className="text-gray-600">{project.projectStatus}</p>
                              </div>
                            </div>
                          </div>
                          
                          <Separator />
                          
                          <div>
                            <h4 className="font-semibold">About the Developer</h4>
                            <p className="mt-2 text-gray-700">
                              {project.developer} is a respected property developer with a track record of delivering high-quality projects.
                              This development showcases their commitment to excellence and innovation in real estate.
                            </p>
                          </div>
                        </div>
                      ) : (
                        <p className="text-gray-500">Project information not available.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
              
              <div>
                <Card>
                  <CardContent className="p-6">
                    <h3 className="text-lg font-semibold mb-4">Property Overview</h3>
                    <div className="space-y-4">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Price:</span>
                        <span className="font-medium">{formatPrice(property.price)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Property Type:</span>
                        <span>{getPropertyTypeName(property.propertyType)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Area:</span>
                        <span>{property.area} sqft</span>
                      </div>
                      {property.bedrooms !== null && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Bedrooms:</span>
                          <span>{property.bedrooms}</span>
                        </div>
                      )}
                      {property.bathrooms !== null && (
                        <div className="flex justify-between">
                          <span className="text-gray-500">Bathrooms:</span>
                          <span>{property.bathrooms}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-gray-500">Location:</span>
                        <span>{property.location}</span>
                      </div>
                    </div>
                    
                    <Separator className="my-4" />
                    
                    <div className="mt-4 mb-4">
                      <h3 className="text-lg font-semibold mb-2">Location</h3>
                      <div className="bg-gray-100 rounded-lg p-4 text-center text-gray-600">
                        <MapPin className="h-6 w-6 mx-auto mb-2" />
                        <p className="text-sm">{property.location}</p>
                      </div>
                    </div>
                    
                    <Separator className="my-4" />
                    
                    {/* Contact Agent Email */}
                    <Button className="w-full bg-[#3bcac4] hover:bg-[#3bcac4]/90 text-white" asChild>
                      <a href={`mailto:${property.agent?.email || 'info@kinglikeluxury.com'}?subject=Inquiry about ${property.title} (ID: ${property.id})`}>
                        Contact Agent: {property.agent?.username || 'Agent'}
                      </a>
                    </Button>
                    
                    {/* Phone/WhatsApp Contact - Show only if agent has phone number */}
                    {(property.agent?.phoneNumber || property.agent?.whatsappNumber) && (
                      <Button variant="outline" className="w-full mt-3 border-[#3bcac4] text-[#3bcac4] hover:bg-[#3bcac4] hover:text-white">
                        <a href={`tel:${property.agent?.phoneNumber || property.agent?.whatsappNumber}`}>
                          Call: {property.agent?.phoneNumber || property.agent?.whatsappNumber}
                        </a>
                      </Button>
                    )}
                    
                    {/* WhatsApp button if WhatsApp number exists */}
                    {property.agent?.whatsappNumber && (
                      <Button variant="outline" className="w-full mt-2 border-[#3bcac4] text-[#3bcac4] hover:bg-[#3bcac4] hover:text-white">
                        <a href={`https://wa.me/${property.agent.whatsappNumber.replace(/[^0-9]/g, '')}`} target="_blank" rel="noopener noreferrer">
                          WhatsApp: {property.agent.whatsappNumber}
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>
                
                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-3">Location</h3>
                  <div className="bg-gray-100 rounded-lg p-4 text-center text-gray-600">
                    <MapPin className="h-8 w-8 mx-auto mb-2" />
                    <p className="text-lg font-medium">{property.location}</p>
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-12">
            <h2 className="text-2xl font-bold mb-2">Property Not Found</h2>
            <p className="text-gray-500 mb-6">The property you're looking for doesn't exist or has been removed.</p>
            <Button className="bg-[#3bcac4] hover:bg-[#3bcac4]/90 text-white" asChild>
              <Link href="/properties">Browse All Properties</Link>
            </Button>
          </div>
        )}
      </div>

      {/* Image Modal */}
      {isImageModalOpen && property && property.images && property.images.length > 0 && (
        <div className="fixed inset-0 bg-black bg-opacity-90 z-50 flex items-center justify-center p-4">
          {/* Close button */}
          <button
            onClick={closeImageModal}
            className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors z-10"
          >
            <X className="h-8 w-8" />
          </button>

          {/* Previous button */}
          {modalImageIndex > 0 && (
            <button
              onClick={prevImage}
              className="absolute left-4 top-1/2 transform -translate-y-1/2 text-white hover:text-gray-300 transition-colors z-10"
            >
              <ChevronLeft className="h-10 w-10" />
            </button>
          )}

          {/* Next button */}
          {modalImageIndex < property.images.length - 1 && (
            <button
              onClick={nextImage}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 text-white hover:text-gray-300 transition-colors z-10"
            >
              <ChevronRight className="h-10 w-10" />
            </button>
          )}

          {/* Image with slide animation and click zones */}
          <div className="max-w-screen-lg max-h-screen w-full h-full flex items-center justify-center">
            <div className="relative w-full h-full flex items-center justify-center">
              <img
                key={modalImageIndex} // Force re-render for animation
                src={property.images[modalImageIndex]}
                alt={`${property.title} - Image ${modalImageIndex + 1}`}
                className="max-w-full max-h-full object-contain rounded-lg transition-all duration-300 ease-in-out"
                style={{
                  animation: 'slideIn 0.3s ease-in-out'
                }}
              />
              
              {/* Left click zone - for previous image */}
              {modalImageIndex > 0 && (
                <div
                  className="absolute left-0 top-0 w-1/2 h-full cursor-pointer z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    prevImage();
                  }}
                  style={{ background: 'transparent' }}
                />
              )}
              
              {/* Right click zone - for next image */}
              {modalImageIndex < property.images.length - 1 && (
                <div
                  className="absolute right-0 top-0 w-1/2 h-full cursor-pointer z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    nextImage();
                  }}
                  style={{ background: 'transparent' }}
                />
              )}
            </div>
          </div>

          {/* Bottom navigation */}
          <div className="absolute bottom-4 left-1/2 transform -translate-x-1/2 flex items-center gap-4">
            {/* Previous button */}
            <button
              onClick={prevImage}
              disabled={modalImageIndex === 0}
              className={`image-nav-button ${modalImageIndex === 0 ? 'opacity-50 cursor-not-allowed' : 'hover:scale-110'}`}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            
            {/* Image counter */}
            <div className="text-white bg-black bg-opacity-50 px-4 py-2 rounded-full backdrop-blur-sm">
              {modalImageIndex + 1} / {property.images.length}
            </div>
            
            {/* Next button */}
            <button
              onClick={nextImage}
              disabled={modalImageIndex === property.images.length - 1}
              className={`image-nav-button ${modalImageIndex === property.images.length - 1 ? 'opacity-50 cursor-not-allowed' : 'hover:scale-110'}`}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>

          {/* Click outside to close */}
          <div
            className="absolute inset-0 -z-10"
            onClick={closeImageModal}
          />
        </div>
      )}
    </div>
  );
};

export default PropertyDetail;
