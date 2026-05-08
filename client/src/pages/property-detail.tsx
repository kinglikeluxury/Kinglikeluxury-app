import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { useTranslation } from "react-i18next";
import { User, useAuth } from "@/lib/auth";
import { Property, PropertyWithAgent, Project } from "@shared/schema";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Bed, Bath, Home, User as UserIcon, MapPin, Calendar, Tag, CheckSquare, Dumbbell, Wifi, Coffee, Car, ShieldCheck, Edit, ChevronLeft, ChevronRight, X, Smartphone, Monitor, Share2, Heart, Star, BadgeCheck } from "lucide-react";
import PropertyMap from "@/components/property/PropertyMap";
import { useFavorites } from "@/hooks/use-favorites";
import { useAutoTranslate, useAutoTranslateArray } from "@/hooks/useAutoTranslate";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const PropertyDetail = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { toast } = useToast();
  const { toggleFavorite, isFavorite } = useFavorites();
  const [, params] = useRoute("/property/:id");
  const propertyId = params?.id ? parseInt(params.id) : null;
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [isImageModalOpen, setIsImageModalOpen] = useState(false);
  const [modalImageIndex, setModalImageIndex] = useState(0);
  const videoRefs = useRef<HTMLVideoElement[]>([]);
  const wasPlayingBeforePause = useRef<Set<number>>(new Set());
  const [videoOrientations, setVideoOrientations] = useState<('vertical' | 'horizontal')[]>([]);
  const [videoErrors, setVideoErrors] = useState<boolean[]>([]);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];
    const currentRefs = videoRefs.current;

    const setupObservers = () => {
      currentRefs.forEach((video) => {
        if (!video) return;
        const observer = new IntersectionObserver(
          (entries) => {
            entries.forEach((entry) => {
              if (!entry.isIntersecting && !video.paused) {
                video.pause();
              }
            });
          },
          { threshold: 0.3 }
        );
        observer.observe(video);
        observers.push(observer);
      });
    };

    const timer = setTimeout(setupObservers, 500);

    return () => {
      clearTimeout(timer);
      observers.forEach((obs) => obs.disconnect());
    };
  }, [videoOrientations]);


  const handleWhatsAppShare = () => {
    if (!property) return;
    const currentDomain = window.location.origin;
    const propertyLink = `${currentDomain}/property/${property.id}`;
    const message = `🏠 *${property.title}*\n\n💰 *Price:* ${getPriceRange(property.price)}\n📍 *Location:* ${property.location}\n🏡 *Type:* ${getPropertyTypeName(property.propertyType)}\n📐 *Area:* ${property.area} m²${property.bedrooms ? `\n🛏️ *Bedrooms:* ${property.bedrooms}` : ''}${property.bathrooms ? `\n🚿 *Bathrooms:* ${property.bathrooms}` : ''}${property.floorNumber ? `\n🏢 *Floor:* ${property.floorNumber}` : ''}\n\n📸 *Images:* ${property.images?.length || 0} photos${property.videos?.length ? `\n🎥 *Videos:* ${property.videos.length} property videos` : ''}\n\n✨ Check out this amazing property!\n\n🔗 ${propertyLink}\n\n🏢 *Kinglike Luxury Real Estate*`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  };

  // Platform fallback WhatsApp (used when property owner has no registered number)
  const PLATFORM_WHATSAPP = "995591000058";

  // Contact owner via WhatsApp — notify admin silently
  const handleContactOwner = async () => {
    if (!property) return;

    // Notify admin (fire-and-forget — don't block user)
    try {
      await apiRequest("POST", `/api/properties/${property.id}/contact`, {});
    } catch (_) { /* silent */ }

    // Determine owner contact number: prefer whatsapp > phone > platform fallback
    const rawNumber =
      property.agent?.whatsappNumber ||
      property.agent?.phoneNumber ||
      PLATFORM_WHATSAPP;

    const digits = rawNumber.replace(/[^0-9]/g, "");
    const propertyLink = `${window.location.origin}/property/${property.id}`;
    const msg =
      `مرحباً،\nوجدت هذا العقار "${property.title}" على تطبيق Kinglike Luxury.\nهل يمكنني الحصول على مزيد من المعلومات؟\n${propertyLink}`;
    window.open(`https://wa.me/${digits}?text=${encodeURIComponent(msg)}`, "_blank");
  };

  // Fetch property data
  const { data: property, isLoading: isLoadingProperty } = useQuery<PropertyWithAgent>({
    queryKey: [`/api/properties/${propertyId}`],
    enabled: !!propertyId,
  });

  // Mark as sold mutation
  const soldMutation = useMutation({
    mutationFn: ({ id, isSold }: { id: number; isSold: boolean }) =>
      apiRequest('PATCH', `/api/properties/${id}/sold`, { isSold }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/properties/${propertyId}`] });
      queryClient.invalidateQueries({ queryKey: ['/api/properties'] });
      toast({ title: t('property.sold', 'SOLD'), description: property?.isSold ? t('property.availableConfirmDesc') : t('property.soldConfirmDesc') });
    },
    onError: () => toast({ title: 'Error', description: 'Could not update status', variant: 'destructive' }),
  });

  // Fetch project data if property type is project
  const { data: projectData, isLoading: isLoadingProject } = useQuery<(Project & { property: Property })[]>({
    queryKey: ['/api/projects'],
    enabled: !!property && property.propertyType === 'project',
  });

  // Find the specific project that matches this property
  const project = projectData?.find(p => p.propertyId === propertyId);

  const isLoading = isLoadingProperty || (property?.propertyType === 'project' && isLoadingProject);

  const translatedTexts = useAutoTranslate({
    title: property?.title,
    description: property?.description,
  });
  const translatedFeatures = useAutoTranslateArray(property?.features || []);

  // Scroll to top when component mounts or property changes
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [propertyId]);

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

  // Auto-pause/resume videos based on visibility
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          const video = entry.target as HTMLVideoElement;
          const videoIndex = videoRefs.current.indexOf(video);
          
          if (!entry.isIntersecting) {
            // Video is going out of view
            if (!video.paused) {
              wasPlayingBeforePause.current.add(videoIndex);
              video.pause();
            }
          } else {
            // Video is coming into view
            if (video.paused && wasPlayingBeforePause.current.has(videoIndex)) {
              video.play().catch(() => {
                // Auto-play failed, which is normal for most browsers
                // The user will need to manually play the video
              });
              wasPlayingBeforePause.current.delete(videoIndex);
            }
          }
        });
      },
      {
        threshold: 0.5, // Pause/resume when less than 50% of video is visible
        rootMargin: '0px'
      }
    );

    // Observe all videos
    videoRefs.current.forEach(video => {
      if (video) {
        observer.observe(video);
      }
    });

    return () => {
      observer.disconnect();
    };
  }, [property?.videos]);

  const formatPrice = (price?: number) => {
    if (!price) return "";
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0
    }).format(price);
  };

  const getAreaDisplay = (area: number | string) => {
    if (!area) return "0";
    
    // Convert area to string to handle both number and string inputs
    const areaStr = String(area);
    
    // Check if area contains comma-separated values (multiple selections)
    if (areaStr.includes(',')) {
      const areaValues = areaStr.split(',').map(val => parseInt(val.trim())).filter(val => !isNaN(val));
      if (areaValues.length > 1) {
        const minArea = Math.min(...areaValues);
        const maxArea = Math.max(...areaValues);
        return `${minArea} - ${maxArea}`;
      } else if (areaValues.length === 1) {
        return String(areaValues[0]);
      }
    }
    
    // Single value - return as is
    return areaStr;
  };

  const getPriceRange = (price?: number) => {
    if (!price) return "";
    
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
                    <h1 className="text-3xl font-bold text-gray-900">{translatedTexts.title || property.title}</h1>
                    <button
                      onClick={() => toggleFavorite({ id: property.id, title: property.title, price: property.price, type: property.propertyType })}
                      className={`p-2 rounded-full border-2 transition-all ${isFavorite(property.id) ? 'border-[#3bcac4] bg-[#3bcac4]/10 hover:bg-[#3bcac4]/20' : 'border-gray-300 bg-white hover:bg-gray-50'}`}
                      aria-label={isFavorite(property.id) ? t('favorites.remove', 'Remove from favorites') : t('favorites.add', 'Add to favorites')}
                    >
                      <Heart className={`h-5 w-5 transition-colors ${isFavorite(property.id) ? 'text-[#3bcac4] fill-[#3bcac4]' : 'text-gray-400'}`} />
                    </button>
                    {user && (user.id === property.ownerId || user.isAdmin) && (
                      <>
                        <Button variant="outline" size="sm" className="border-[#3bcac4] text-[#3bcac4] hover:bg-[#3bcac4] hover:text-white" asChild>
                          <Link href={`/property/${property.id}/edit`}>
                            <Edit className="h-4 w-4 mr-1" />
                            Edit
                          </Link>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={soldMutation.isPending}
                          onClick={() => soldMutation.mutate({ id: property.id, isSold: !(property as any).isSold })}
                          className={
                            (property as any).isSold
                              ? "border-green-500 text-green-600 hover:bg-green-50"
                              : "border-red-500 text-red-600 hover:bg-red-50"
                          }
                        >
                          <BadgeCheck className="h-4 w-4 mr-1" />
                          {(property as any).isSold ? t('property.markAsAvailable', 'Mark as Available') : t('property.markAsSold', 'Mark as Sold')}
                        </Button>
                      </>
                    )}
                  </div>
                  <p className="text-gray-600 flex items-center mt-1">
                    <MapPin className="h-4 w-4 mr-1 text-gray-400" />
                    {property.location}
                  </p>
                </div>
                <div className="mt-4 sm:mt-0">
                  <span className="text-3xl font-bold text-primary-600">{getPriceRange(property.price)}</span>
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
                
                {property.topRated && (
                  <Badge className="bg-white border border-white shadow-md flex items-center gap-1 px-3 py-1">
                    <span className="font-semibold text-[#005476]">Top Rated</span>
                    <div className="flex items-center gap-0.5">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <Star key={star} className="h-3.5 w-3.5 fill-[#3bcac4] text-[#3bcac4]" />
                      ))}
                    </div>
                  </Badge>
                )}
              </div>
            </div>
            
            {/* Image Gallery */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
              <div className="md:col-span-2">
                <div className="relative rounded-lg overflow-hidden cursor-pointer" onClick={() => openImageModal(activeImageIndex)}>
                  <img 
                    src={property.images[activeImageIndex] || "https://images.unsplash.com/photo-1560518883-ce09059eeffa?ixlib=rb-1.2.1&auto=format&fit=crop&w=1000&q=80"}
                    alt={property.title}
                    className="w-full h-96 object-cover hover:opacity-90 transition-opacity"
                  />
                  <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                    <img src="/watermark-logo.png" alt="" className="w-1/4 opacity-30" draggable={false} />
                  </div>
                  {(property as any).isSold && (
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="bg-[#3bcac4] text-white font-extrabold text-4xl tracking-widest px-8 py-4 rounded-xl rotate-[-15deg] shadow-2xl border-4 border-white">
                        {t('property.sold', 'SOLD')}
                      </div>
                    </div>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {property.images.slice(0, 4).map((image, idx) => (
                  <div key={idx} className="relative rounded-lg overflow-hidden cursor-pointer" onClick={() => { setActiveImageIndex(idx); openImageModal(idx); }}>
                    <img 
                      src={image}
                      alt={`${property.title} ${idx + 1}`}
                      className={`w-full h-44 object-cover transition-opacity ${activeImageIndex === idx ? 'ring-4 ring-primary-500' : 'hover:opacity-80'}`}
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <img src="/watermark-logo.png" alt="" className="w-1/3 opacity-30" draggable={false} />
                    </div>
                  </div>
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
                  {property.videos.map((video, idx) => {
                    const isVertical = videoOrientations[idx] === 'vertical';
                    return (
                      <div 
                        key={idx} 
                        className={`rounded-lg overflow-hidden relative ${
                          isVertical ? 'md:col-span-1 mx-auto max-w-sm' : 'col-span-1'
                        }`}
                      >
                        {/* Video Orientation Badge */}
                        <div className="absolute top-2 right-2 z-10">
                          <Badge 
                            variant="secondary" 
                            className="bg-black/70 text-white border-none text-xs flex items-center gap-1"
                          >
                            {isVertical ? (
                              <>
                                <Smartphone className="h-3 w-3" />
                                Vertical
                              </>
                            ) : (
                              <>
                                <Monitor className="h-3 w-3" />
                                Horizontal
                              </>
                            )}
                          </Badge>
                        </div>
                        
                        {videoErrors[idx] ? (
                          <div className="w-full h-48 bg-gray-900 rounded-lg flex flex-col items-center justify-center gap-3 text-white">
                            <svg className="w-10 h-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 10l4.553-2.069A1 1 0 0121 8.82v6.361a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
                            </svg>
                            <p className="text-sm text-gray-400">تعذّر تشغيل الفيديو</p>
                            <a
                              href={video}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs px-4 py-2 rounded-full border border-[#3bcac4] text-[#3bcac4] hover:bg-[#3bcac4] hover:text-white transition-colors"
                            >
                              فتح الفيديو مباشرة
                            </a>
                          </div>
                        ) : (
                          <>
                            <video 
                              ref={el => {
                                if (el) videoRefs.current[idx] = el;
                              }}
                              controls 
                              controlsList="nodownload"
                              onContextMenu={(e) => e.preventDefault()}
                              className={`w-full rounded-lg ${
                                isVertical 
                                  ? 'h-96 object-contain bg-black' 
                                  : 'h-64 object-cover'
                              }`}
                              preload="metadata"
                              playsInline
                              onLoadedMetadata={(e) => {
                                const vid = e.target as HTMLVideoElement;
                                const isVideoVertical = vid.videoHeight > vid.videoWidth;
                                setVideoOrientations(prev => {
                                  const newOrientations = [...prev];
                                  newOrientations[idx] = isVideoVertical ? 'vertical' : 'horizontal';
                                  return newOrientations;
                                });
                              }}
                              onError={() => {
                                setVideoErrors(prev => {
                                  const next = [...prev];
                                  next[idx] = true;
                                  return next;
                                });
                              }}
                              style={{ objectFit: isVertical ? 'contain' : 'cover' }}
                            >
                              <source src={video} type="video/mp4" />
                              <source src={video} type="video/quicktime" />
                              <source src={video} type="video/webm" />
                            </video>
                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-[5]">
                              <img src="/watermark-logo.png" alt="" className="w-1/4 opacity-25" draggable={false} />
                            </div>
                          </>
                        )}
                        
                        {/* Video Type Info */}
                        <div className="absolute bottom-2 left-2 z-10">
                          <Badge 
                            variant="outline" 
                            className="bg-white/90 text-black border-white/50 text-xs"
                          >
                            {isVertical ? 'Mobile Format' : 'Landscape Format'}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              <div className="lg:col-span-2 space-y-8">
                {/* Details Section */}
                <div className="space-y-6">
                  <div>
                    <h3 className="text-xl font-semibold mb-4">Description</h3>
                    <p className="text-gray-700 whitespace-pre-line">{translatedTexts.description || property.description}</p>
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
                        <span className="font-medium">{getAreaDisplay(property.area)} m²</span>
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
                      {(property as any).readyStatus && (
                        <div className="flex flex-col p-4 bg-gray-50 rounded-lg">
                          <span className="text-gray-500 text-sm">Ready Status</span>
                          <span className="font-medium">
                            {(property as any).readyStatus === 'turnkey' && '🔑 Turnkey'}
                            {(property as any).readyStatus === 'white_frame' && '🏗️ White Frame'}
                            {(property as any).readyStatus === 'green_frame' && '🌿 Green Frame'}
                            {(property as any).readyStatus === 'black_frame' && '⬛ Black Frame'}
                          </span>
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
                      {translatedFeatures.map((feature, idx) => (
                        <div key={idx} className="flex items-center">
                          {getFeatureIcon(property.features[idx] || feature)}
                          <span>{feature}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500">No features listed for this property.</p>
                  )}
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
                                <p className="font-medium">Project Name</p>
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
                                <p className="text-gray-600">Under Construction</p>
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
                        <span className="text-gray-500">Price between:</span>
                        <span className="font-medium">{getPriceRange(property.price)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Property Type:</span>
                        <span>{getPropertyTypeName(property.propertyType)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Area:</span>
                        <span>{getAreaDisplay(property.area)} m²</span>
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
                    
                    {/* Share Property Button */}
                    <Button 
                      onClick={handleWhatsAppShare}
                      variant="outline" 
                      className="w-full mb-3 border-green-500 text-green-600 hover:bg-green-50 hover:border-green-600"
                      data-testid="button-share-property-whatsapp"
                    >
                      <span className="flex items-center justify-center">
                        <Share2 className="mr-2 h-4 w-4" />
                        Share Property on WhatsApp
                      </span>
                    </Button>
                    
                    <Separator className="my-4" />
                    
                    {/* Contact owner via WhatsApp — smart button */}
                    <Button
                      onClick={handleContactOwner}
                      className="w-full bg-[#25D366] hover:bg-[#1ebe5a] text-white font-semibold shadow-md"
                    >
                      <svg className="mr-2 h-5 w-5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/>
                        <path d="M12 0C5.373 0 0 5.373 0 12c0 2.124.558 4.117 1.532 5.845L.057 23.429a.75.75 0 0 0 .955.899l5.7-1.505A11.952 11.952 0 0 0 12 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 22c-1.907 0-3.693-.511-5.228-1.4l-.374-.22-3.883 1.026 1.003-3.795-.243-.388A9.96 9.96 0 0 1 2 12C2 6.477 6.477 2 12 2s10 4.477 10 10-4.477 10-10 10z"/>
                      </svg>
                      {t("property.contactWhatsApp", "تواصل عبر واتساب")}
                    </Button>

                    {/* Phone call button */}
                    {(property.agent?.phoneNumber || property.agent?.whatsappNumber) && (
                      <Button
                        variant="outline"
                        className="w-full mt-3 border-[#3bcac4] text-[#005476] hover:bg-[#3bcac4] hover:text-white font-medium"
                        asChild
                      >
                        <a href={`tel:${property.agent?.phoneNumber || property.agent?.whatsappNumber}`}>
                          📞 {property.agent?.phoneNumber || property.agent?.whatsappNumber}
                        </a>
                      </Button>
                    )}
                  </CardContent>
                </Card>
                
                <div className="mt-6">
                  <h3 className="text-lg font-semibold mb-3">Location</h3>
                  <PropertyMap 
                    latitude={property.latitude} 
                    longitude={property.longitude}
                    location={property.location}
                    className="mb-4"
                  />
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
            onClick={(e) => { e.stopPropagation(); closeImageModal(); }}
            className="absolute top-4 right-4 text-white hover:text-gray-300 transition-colors z-50"
          >
            <X className="h-8 w-8" />
          </button>

          {/* Previous button */}
          {modalImageIndex > 0 && (
            <button
              onClick={prevImage}
              className="absolute left-4 top-1/2 transform -translate-y-1/2 text-white hover:text-gray-300 transition-colors z-30"
            >
              <ChevronLeft className="h-10 w-10" />
            </button>
          )}

          {/* Next button */}
          {modalImageIndex < property.images.length - 1 && (
            <button
              onClick={nextImage}
              className="absolute right-4 top-1/2 transform -translate-y-1/2 text-white hover:text-gray-300 transition-colors z-30"
            >
              <ChevronRight className="h-10 w-10" />
            </button>
          )}

          {/* Image with slide animation and click zones */}
          <div className="max-w-screen-lg max-h-screen w-full h-full flex items-center justify-center">
            <div className="relative w-full h-full flex items-center justify-center">
              <img
                key={modalImageIndex}
                src={property.images[modalImageIndex]}
                alt={`${property.title} - Image ${modalImageIndex + 1}`}
                className="max-w-full max-h-full object-contain rounded-lg transition-all duration-300 ease-in-out"
                style={{
                  animation: 'slideIn 0.3s ease-in-out'
                }}
              />
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <img src="/watermark-logo.png" alt="" className="w-1/5 opacity-30" draggable={false} />
              </div>
              
              {/* Left click zone - for previous image */}
              {modalImageIndex > 0 && (
                <div
                  className="absolute left-0 top-16 w-1/2 cursor-pointer z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    prevImage();
                  }}
                  style={{ background: 'transparent', bottom: '5rem' }}
                />
              )}
              
              {/* Right click zone - for next image */}
              {modalImageIndex < property.images.length - 1 && (
                <div
                  className="absolute right-0 top-16 w-1/2 cursor-pointer z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    nextImage();
                  }}
                  style={{ background: 'transparent', bottom: '5rem' }}
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
