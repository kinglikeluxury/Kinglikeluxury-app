import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';

// Fix for default marker icons in Leaflet
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

interface LocationSelectorProps {
  onLocationSelect: (location: string, coordinates: { lat: number, lng: number }) => void;
  selectedLocation?: string;
  className?: string;
}

const LocationSelector = ({ onLocationSelect, selectedLocation, className = "" }: LocationSelectorProps) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const leafletMapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);

  useEffect(() => {
    // Add a small delay to ensure the DOM element is fully rendered
    const initializeMap = () => {
      if (!mapRef.current) {
        console.log('Map container not available yet');
        return;
      }

      try {
        console.log('Initializing map...');
        
        // Initialize map centered on Batumi, Georgia
        const map = L.map(mapRef.current).setView([41.6168, 41.6367], 13);

        // Add tile layer
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap contributors'
        }).addTo(map);

        leafletMapRef.current = map;

        // Handle map clicks
        map.on('click', async (e) => {
          const { lat, lng } = e.latlng;
          
          // Remove existing marker
          if (markerRef.current) {
            markerRef.current.remove();
          }
          
          // Add new marker
          const marker = L.marker([lat, lng]).addTo(map);
          markerRef.current = marker;
          
          // Reverse geocoding to get address
          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
            );
            const data = await response.json();
            
            let locationName = 'Selected Location';
            if (data && data.display_name) {
              // Extract a more readable location name
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
        
        // Set map ready after a short delay to ensure tiles load
        setTimeout(() => {
          setIsMapReady(true);
          console.log('Map initialized successfully');
        }, 100);
      } catch (error) {
        console.error('Error initializing map:', error);
        // Still set as ready to avoid infinite loading
        setIsMapReady(true);
      }
    };

    // Use setTimeout to ensure DOM is ready
    const timeoutId = setTimeout(initializeMap, 50);

    // Cleanup function
    return () => {
      clearTimeout(timeoutId);
      if (leafletMapRef.current) {
        leafletMapRef.current.remove();
        leafletMapRef.current = null;
      }
    };
  }, [onLocationSelect]);

  if (!isMapReady) {
    return (
      <div className={`w-full h-[400px] rounded-lg border flex items-center justify-center bg-gray-50 ${className}`}>
        <div className="text-center text-gray-600">
          <MapPin className="h-8 w-8 mx-auto mb-2" />
          <p className="font-medium">Loading map...</p>
          <p className="text-sm">Location: {selectedLocation || "Not selected"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`w-full h-[400px] rounded-lg border overflow-hidden ${className}`}>
      <div ref={mapRef} className="w-full h-full" />
    </div>
  );
};

export default LocationSelector;