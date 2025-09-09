import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet
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
    if (!mapRef.current) return;

    // Default coordinates (Batumi, Georgia) if no coordinates provided
    let lat = 41.6168;
    let lng = 41.6367;

    // Use provided coordinates if available
    if (latitude && longitude) {
      lat = parseFloat(latitude);
      lng = parseFloat(longitude);
    }

    // Initialize map
    if (!leafletMapRef.current) {
      leafletMapRef.current = L.map(mapRef.current).setView([lat, lng], 13);

      // Add tile layer
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
      }).addTo(leafletMapRef.current);

      // Add marker
      L.marker([lat, lng])
        .addTo(leafletMapRef.current)
        .bindPopup(`<b>${location}</b>`)
        .openPopup();
    }

    // Cleanup function
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
      className={`w-full h-64 rounded-lg border ${className}`}
      style={{ zIndex: 1 }}
    />
  );
};

export default PropertyMap;