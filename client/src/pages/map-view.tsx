import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, X, Home, Bed, Bath, Maximize } from 'lucide-react';
import { Link } from 'wouter';
import { useTranslation } from 'react-i18next';
import type { Property } from '@shared/schema';

delete (L.Icon.Default.prototype as any)._getIconUrl;

const MapView = () => {
  const { t } = useTranslation();
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);

  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ['/api/properties'],
  });

  // Properties with valid coordinates
  const mappableProperties = properties.filter(
    (p) => p.latitude && p.longitude && p.status === 'approved'
  );

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    const map = L.map(mapRef.current, {
      zoomControl: true,
      preferCanvas: true,
    }).setView([41.6168, 41.6367], 6);

    // Fast CartoDB Voyager tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(map);

    leafletMapRef.current = map;

    setTimeout(() => {
      map.invalidateSize();
      setIsMapReady(true);
    }, 150);

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, []);

  // Add markers when map and properties are ready
  useEffect(() => {
    if (!leafletMapRef.current || !isMapReady) return;

    const map = leafletMapRef.current;

    // Clear existing markers
    map.eachLayer((layer) => {
      if (layer instanceof L.Marker) map.removeLayer(layer);
    });

    if (mappableProperties.length === 0) return;

    const bounds: [number, number][] = [];

    mappableProperties.forEach((property) => {
      const lat = parseFloat(property.latitude!);
      const lng = parseFloat(property.longitude!);

      const formatPrice = (p: number) =>
        new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(p);

      const minPrice = property.priceMin ?? property.priceMax ?? 0;

      // Price bubble marker
      const icon = L.divIcon({
        html: `
          <div style="
            background: linear-gradient(135deg, #005476, #3bcac4);
            color: white;
            padding: 5px 10px;
            border-radius: 20px;
            font-size: 11px;
            font-weight: 700;
            white-space: nowrap;
            box-shadow: 0 3px 12px rgba(0,84,118,0.4);
            border: 2px solid white;
            cursor: pointer;
            position: relative;
          ">
            ${formatPrice(minPrice)}
            <div style="
              position: absolute;
              bottom: -8px; left: 50%;
              transform: translateX(-50%);
              width: 0; height: 0;
              border-left: 6px solid transparent;
              border-right: 6px solid transparent;
              border-top: 8px solid #3bcac4;
            "></div>
          </div>`,
        iconSize: [100, 36],
        iconAnchor: [50, 44],
        className: '',
      });

      const marker = L.marker([lat, lng], { icon }).addTo(map);
      bounds.push([lat, lng]);

      marker.on('click', () => {
        setSelectedProperty(property);
        map.setView([lat, lng], 15, { animate: true });
      });
    });

    // Fit map to show all markers
    if (bounds.length > 0) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    }
  }, [mappableProperties, isMapReady]);

  return (
    <div className="relative w-full" style={{ height: 'calc(100vh - 96px)' }}>
      {/* Loading overlay */}
      {!isMapReady && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-white">
          <div className="text-center text-[#005476]">
            <MapPin className="h-12 w-12 mx-auto mb-3 text-[#3bcac4] animate-bounce" />
            <p className="font-bold text-lg">{t('nav.map', 'Property Map')}</p>
            <p className="text-sm text-gray-500 mt-1">Loading map...</p>
          </div>
        </div>
      )}

      {/* Count badge */}
      {isMapReady && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-white rounded-full px-4 py-2 shadow-lg border border-gray-100 flex items-center gap-2 text-sm font-semibold text-[#005476]">
          <MapPin className="h-4 w-4 text-[#3bcac4]" />
          {mappableProperties.length} {t('property.properties', 'properties')}
        </div>
      )}

      {/* Map */}
      <div ref={mapRef} className="w-full h-full" />

      {/* Property Card Popup */}
      {selectedProperty && (
        <div className="absolute bottom-4 left-4 right-4 z-20">
          <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border border-gray-100">
            {/* Image */}
            <div className="relative h-40">
              {selectedProperty.images?.[0] ? (
                <img
                  src={selectedProperty.images[0]}
                  alt={selectedProperty.title}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-[#3bcac4] to-[#005476] flex items-center justify-center">
                  <Home className="h-12 w-12 text-white opacity-50" />
                </div>
              )}
              {selectedProperty.isFeatured && (
                <span className="absolute top-2 right-2 bg-[#3bcac4] text-white text-xs font-bold px-2 py-1 rounded-full">
                  Featured
                </span>
              )}
              <button
                onClick={() => setSelectedProperty(null)}
                className="absolute top-2 left-2 w-7 h-7 bg-white rounded-full flex items-center justify-center shadow-md"
              >
                <X className="h-4 w-4 text-gray-600" />
              </button>
            </div>

            {/* Info */}
            <div className="p-3">
              <h3 className="font-bold text-[#005476] text-base leading-tight mb-1">
                {selectedProperty.title}
              </h3>
              <p className="text-gray-500 text-xs mb-2 flex items-center gap-1">
                <MapPin className="h-3 w-3" /> {selectedProperty.location}
              </p>

              <div className="flex items-center gap-3 text-xs text-gray-600 mb-3">
                {selectedProperty.bedrooms && (
                  <span className="flex items-center gap-1">
                    <Bed className="h-3 w-3" /> {selectedProperty.bedrooms}
                  </span>
                )}
                {selectedProperty.bathrooms && (
                  <span className="flex items-center gap-1">
                    <Bath className="h-3 w-3" /> {selectedProperty.bathrooms}
                  </span>
                )}
                {selectedProperty.area && (
                  <span className="flex items-center gap-1">
                    <Maximize className="h-3 w-3" /> {selectedProperty.area} m²
                  </span>
                )}
              </div>

              <div className="flex items-center justify-between">
                <div>
                  {selectedProperty.priceMin && (
                    <p className="text-[#005476] font-bold text-sm">
                      {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(selectedProperty.priceMin)}
                      {selectedProperty.priceMax && selectedProperty.priceMax !== selectedProperty.priceMin && (
                        <span className="text-gray-400 font-normal">
                          {' '}– {new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(selectedProperty.priceMax)}
                        </span>
                      )}
                    </p>
                  )}
                </div>
                <Link href={`/property/${selectedProperty.id}`}>
                  <button className="bg-gradient-to-r from-[#3bcac4] to-[#005476] text-white text-xs font-bold px-4 py-2 rounded-full">
                    {t('property.viewDetails', 'View Details')} →
                  </button>
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapView;
