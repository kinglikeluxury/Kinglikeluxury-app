import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface PropertyMapProps {
  latitude?: string | null;
  longitude?: string | null;
  location: string;
  className?: string;
}

const PropertyMap = ({ latitude, longitude, location, className = "" }: PropertyMapProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);

  const lat = latitude ? parseFloat(latitude) : null;
  const lng = longitude ? parseFloat(longitude) : null;
  const rawHasCoords = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng);

  // Detect mismatch: if location says Northern Cyprus (~35°N) but coords point to Georgia (~41°N), coords are wrong
  const isCoordMismatch = rawHasCoords && (
    (location.toLowerCase().includes('northern cyprus') && lat! > 38) ||
    (location.toLowerCase().includes('georgia') && lat! < 38 && lat! > 30 && lng! > 30 && lng! < 40) ||
    (location.toLowerCase().includes('uae') && (lat! < 20 || lat! > 30))
  );
  const hasCoords = rawHasCoords && !isCoordMismatch;

  // If coords are mismatched, pick a sensible center from location string
  const getFallbackCenter = (): { lat: number; lng: number; zoom: number } => {
    const loc = location.toLowerCase();
    if (loc.includes('northern cyprus') || loc.includes('girne') || loc.includes('lefkoşa') || loc.includes('gazimağusa') || loc.includes('iskele') || loc.includes('güzelyurt') || loc.includes('esentepe'))
      return { lat: 35.2, lng: 33.35, zoom: 11 };
    if (loc.includes('dubai')) return { lat: 25.2048, lng: 55.2708, zoom: 12 };
    if (loc.includes('uae') || loc.includes('sharjah') || loc.includes('ras al khaimah')) return { lat: 25.3, lng: 55.4, zoom: 11 };
    return { lat: 41.6168, lng: 41.6367, zoom: 13 }; // Batumi default
  };

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    const fallback = getFallbackCenter();
    const centerLat = hasCoords ? lat! : fallback.lat;
    const centerLng = hasCoords ? lng! : fallback.lng;
    const centerZoom = hasCoords ? 15 : fallback.zoom;

    // Disable ALL touch/scroll interactions so mobile page scrolling still works
    const map = L.map(mapRef.current, {
      zoomControl: false,
      dragging: false,
      scrollWheelZoom: false,
      touchZoom: false,
      doubleClickZoom: false,
      tap: false,
      keyboard: false,
      attributionControl: false,
    }).setView([centerLat, centerLng], centerZoom);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(map);

    if (hasCoords) {
      const customIcon = L.divIcon({
        html: `
          <div style="position:relative;width:60px;height:70px;display:flex;align-items:center;justify-content:center;">
            <div style="
              position:absolute;width:60px;height:60px;border-radius:50%;
              background:rgba(59,202,196,0.22);
              animation:pulsemap 1.8s ease-out infinite;
            "></div>
            <div style="
              position:absolute;width:40px;height:40px;border-radius:50%;
              background:rgba(59,202,196,0.35);
            "></div>
            <div style="
              position:absolute;width:26px;height:26px;
              background:linear-gradient(135deg,#3bcac4,#005476);
              border:3px solid white;border-radius:50%;
              box-shadow:0 4px 14px rgba(0,84,118,0.5);z-index:2;
            "></div>
            <div style="
              position:absolute;bottom:0;left:50%;
              transform:translateX(-50%);
              width:0;height:0;
              border-left:7px solid transparent;
              border-right:7px solid transparent;
              border-top:10px solid #005476;z-index:2;
            "></div>
          </div>
          <style>
            @keyframes pulsemap{0%{transform:scale(.6);opacity:.9}100%{transform:scale(1.5);opacity:0}}
          </style>`,
        iconSize: [60, 70],
        iconAnchor: [30, 70],
        className: '',
      });

      L.marker([lat!, lng!], { icon: customIcon })
        .addTo(map)
        .bindPopup(`<b style="color:#005476">📍 ${location}</b>`)
        .openPopup();
    }

    leafletMapRef.current = map;
    setTimeout(() => map.invalidateSize(), 200);

    return () => {
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [latitude, longitude, location]);

  return (
    <div
      ref={mapRef}
      className={`w-full rounded-xl border-2 border-[#3bcac4] shadow-md ${className}`}
      style={{ height: '240px' }}
    />
  );
};

export default PropertyMap;
