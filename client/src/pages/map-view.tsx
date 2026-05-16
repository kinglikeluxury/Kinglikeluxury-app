import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';
import { useLocation } from 'wouter';
import { useTranslation } from 'react-i18next';
import type { Property } from '@shared/schema';

delete (L.Icon.Default.prototype as any)._getIconUrl;

const MapView = () => {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
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

      const minPrice = property.price ?? 0;

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
        navigate(`/property/${property.id}`);
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

    </div>
  );
};

export default MapView;
