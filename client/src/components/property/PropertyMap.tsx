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

  useEffect(() => {
    if (!mapRef.current || leafletMapRef.current) return;

    const lat = latitude ? parseFloat(latitude) : 41.6168;
    const lng = longitude ? parseFloat(longitude) : 41.6367;

    const map = L.map(mapRef.current, { zoomControl: true }).setView([lat, lng], 15);

    // Fast CartoDB Voyager tiles
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(map);

    // Custom teal pin
    const customIcon = L.divIcon({
      html: `<div style="
        width: 36px; height: 36px;
        background: linear-gradient(135deg, #3bcac4, #005476);
        border: 3px solid white;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 3px 10px rgba(0,0,0,0.4);
      "></div>`,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      className: '',
    });

    L.marker([lat, lng], { icon: customIcon })
      .addTo(map)
      .bindPopup(`<b style="color:#005476">📍 ${location}</b>`)
      .openPopup();

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
