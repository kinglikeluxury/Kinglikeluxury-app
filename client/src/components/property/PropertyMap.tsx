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
  const hasCoords = lat !== null && lng !== null && !isNaN(lat) && !isNaN(lng);

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    const centerLat = hasCoords ? lat! : 41.6168;
    const centerLng = hasCoords ? lng! : 41.6367;

    const map = L.map(mapRef.current, { zoomControl: true }).setView([centerLat, centerLng], hasCoords ? 15 : 10);

    // Fast CartoDB Voyager tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(map);

    if (hasCoords) {
      // Large pulsing pin
      const customIcon = L.divIcon({
        html: `
          <div style="position:relative; width:60px; height:60px; display:flex; align-items:center; justify-content:center;">
            <!-- Pulse ring -->
            <div style="
              position:absolute;
              width:60px; height:60px;
              border-radius:50%;
              background:rgba(59,202,196,0.25);
              animation:pulse-ring 1.8s ease-out infinite;
            "></div>
            <!-- Outer ring -->
            <div style="
              position:absolute;
              width:44px; height:44px;
              border-radius:50%;
              background:rgba(59,202,196,0.4);
            "></div>
            <!-- Pin body -->
            <div style="
              position:absolute;
              width:28px; height:28px;
              background:linear-gradient(135deg,#3bcac4,#005476);
              border:3px solid white;
              border-radius:50%;
              box-shadow:0 4px 14px rgba(0,84,118,0.5);
              z-index:2;
            "></div>
            <!-- Pointer triangle -->
            <div style="
              position:absolute;
              bottom:-8px;
              left:50%;
              transform:translateX(-50%);
              width:0; height:0;
              border-left:8px solid transparent;
              border-right:8px solid transparent;
              border-top:10px solid #005476;
              z-index:2;
            "></div>
          </div>
          <style>
            @keyframes pulse-ring {
              0%{transform:scale(0.6);opacity:0.9}
              100%{transform:scale(1.4);opacity:0}
            }
          </style>`,
        iconSize: [60, 70],
        iconAnchor: [30, 68],
        className: '',
      });

      L.marker([lat!, lng!], { icon: customIcon })
        .addTo(map)
        .bindPopup(`
          <div style="font-family:sans-serif;min-width:160px;padding:4px">
            <p style="color:#005476;font-weight:700;margin:0 0 4px">📍 ${location}</p>
            <p style="color:#3bcac4;font-size:11px;margin:0">${lat!.toFixed(5)}, ${lng!.toFixed(5)}</p>
          </div>`)
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
      style={{ height: '280px', zIndex: 1 }}
    />
  );
};

export default PropertyMap;
