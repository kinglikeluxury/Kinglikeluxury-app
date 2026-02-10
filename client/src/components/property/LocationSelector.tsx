import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const CITY_CENTERS: Record<string, { lat: number; lng: number; zoom: number }> = {
  batumi: { lat: 41.6168, lng: 41.6367, zoom: 13 },
  tbilisi: { lat: 41.7151, lng: 44.8271, zoom: 12 },
  dubai: { lat: 25.2048, lng: 55.2708, zoom: 12 },
  sharjah: { lat: 25.3463, lng: 55.4209, zoom: 12 },
  rasAlKhaimah: { lat: 25.7895, lng: 55.9432, zoom: 12 },
};

interface LocationSelectorProps {
  onLocationSelect: (location: string, coordinates: { lat: number, lng: number }) => void;
  selectedLocation?: string;
  className?: string;
  city?: string;
}

const LocationSelector = ({ onLocationSelect, selectedLocation, className = "", city }: LocationSelectorProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);

  const getCenter = () => {
    if (city) {
      const firstCity = city.split(',')[0].trim();
      if (CITY_CENTERS[firstCity]) return CITY_CENTERS[firstCity];
    }
    return CITY_CENTERS.batumi;
  };

  useEffect(() => {
    if (leafletMapRef.current) {
      const center = getCenter();
      leafletMapRef.current.setView([center.lat, center.lng], center.zoom);
    }
  }, [city]);

  useEffect(() => {
    const initializeMap = async () => {
      if (!mapRef.current) return;

      try {
        const center = getCenter();
        const map = L.map(mapRef.current).setView([center.lat, center.lng], center.zoom);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap',
          maxZoom: 19
        }).addTo(map);

        leafletMapRef.current = map;

        map.on('click', async (e) => {
          const { lat, lng } = e.latlng;
          
          if (markerRef.current) {
            markerRef.current.remove();
          }
          
          const marker = L.marker([lat, lng]).addTo(map);
          markerRef.current = marker;
          
          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
            );
            const data = await response.json();
            
            let locationName = 'Selected Location';
            if (data && data.display_name) {
              const parts = data.display_name.split(',');
              if (parts.length >= 2) {
                locationName = `${parts[0].trim()}, ${parts[1].trim()}`;
              } else {
                locationName = parts[0].trim();
              }
            }
            
            marker.bindPopup(locationName).openPopup();
            onLocationSelect(locationName, { lat, lng });
            
          } catch (error) {
            console.error('Error getting location name:', error);
            const locationName = `Lat: ${lat.toFixed(4)}, Lng: ${lng.toFixed(4)}`;
            marker.bindPopup(locationName).openPopup();
            onLocationSelect(locationName, { lat, lng });
          }
        });
        
        setTimeout(() => {
          setIsMapReady(true);
          map.invalidateSize();
        }, 300);

      } catch (error) {
        console.error('Error initializing map:', error);
        setTimeout(() => setIsMapReady(true), 100);
      }
    };

    const timeoutId = setTimeout(initializeMap, 200);

    return () => {
      clearTimeout(timeoutId);
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
      setIsMapReady(false);
    };
  }, []);

  return (
    <div className={`w-full rounded-lg border overflow-hidden ${className}`} style={{ minHeight: '400px' }}>
      {!isMapReady && (
        <div className="w-full h-[400px] flex items-center justify-center bg-gray-50">
          <div className="text-center text-gray-600">
            <MapPin className="h-8 w-8 mx-auto mb-2 animate-bounce" />
            <p className="font-medium">Loading map...</p>
          </div>
        </div>
      )}
      <div ref={mapRef} className="w-full h-full" style={{ minHeight: '400px', display: isMapReady ? 'block' : 'none' }} />
    </div>
  );
};

export default LocationSelector;