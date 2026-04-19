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
  lefkosa: { lat: 35.1856, lng: 33.3823, zoom: 13 },
  'gazimağusa': { lat: 35.1264, lng: 33.9411, zoom: 13 },
  girne: { lat: 35.3411, lng: 33.3199, zoom: 13 },
  iskele: { lat: 35.2923, lng: 33.8845, zoom: 13 },
  guzelyurt: { lat: 35.2028, lng: 32.9938, zoom: 13 },
  esentepe: { lat: 35.3942, lng: 33.5217, zoom: 13 },
};

interface LocationSelectorProps {
  onLocationSelect: (location: string, coordinates: { lat: number, lng: number }) => void;
  selectedLocation?: string;
  className?: string;
  city?: string;
  initialLat?: number;
  initialLng?: number;
}

const LocationSelector = ({ onLocationSelect, selectedLocation, className = "", city, initialLat, initialLng }: LocationSelectorProps) => {
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
    if (leafletMapRef.current && city) {
      const center = getCenter();
      leafletMapRef.current.setView([center.lat, center.lng], center.zoom);
      if (markerRef.current) {
        markerRef.current.remove();
        markerRef.current = null;
      }
      // Auto-save city center coordinates so they're stored even without clicking the map
      onLocationSelect('', { lat: center.lat, lng: center.lng });
    }
  }, [city]);

  useEffect(() => {
    const initializeMap = async () => {
      if (!mapRef.current || leafletMapRef.current) return;

      try {
        const center = getCenter();
        const startLat = initialLat ?? center.lat;
        const startLng = initialLng ?? center.lng;

        const map = L.map(mapRef.current, {
          zoomControl: true,
          scrollWheelZoom: true,
        }).setView([startLat, startLng], center.zoom);

        // Fast CartoDB Voyager tiles — better performance on mobile
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
          attribution: '© <a href="https://www.openstreetmap.org/copyright">OSM</a> © <a href="https://carto.com/">CARTO</a>',
          maxZoom: 20,
          subdomains: 'abcd',
        }).addTo(map);

        leafletMapRef.current = map;

        // Custom teal marker icon
        const customIcon = L.divIcon({
          html: `<div style="
            width: 32px; height: 32px;
            background: #3bcac4;
            border: 3px solid #005476;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
          "></div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
          className: '',
        });

        // If initial coordinates provided, place marker
        if (initialLat && initialLng) {
          const marker = L.marker([initialLat, initialLng], { icon: customIcon, draggable: true }).addTo(map);
          markerRef.current = marker;
          marker.on('dragend', () => {
            const pos = marker.getLatLng();
            onLocationSelect(`Lat: ${pos.lat.toFixed(5)}, Lng: ${pos.lng.toFixed(5)}`, { lat: pos.lat, lng: pos.lng });
          });
        }

        // Click to place / move marker
        map.on('click', async (e) => {
          const { lat, lng } = e.latlng;

          if (markerRef.current) {
            markerRef.current.setLatLng([lat, lng]);
          } else {
            const marker = L.marker([lat, lng], { icon: customIcon, draggable: true }).addTo(map);
            markerRef.current = marker;
            marker.on('dragend', async () => {
              const pos = marker.getLatLng();
              onLocationSelect(`${pos.lat.toFixed(5)}, ${pos.lng.toFixed(5)}`, { lat: pos.lat, lng: pos.lng });
              try {
                const r = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${pos.lat}&lon=${pos.lng}&format=json&addressdetails=1`);
                const d = await r.json();
                if (d?.address) {
                  const addr = d.address;
                  const parts = [addr.road || addr.pedestrian, addr.neighbourhood || addr.suburb, addr.city || addr.town || addr.village].filter(Boolean);
                  const name = parts.length > 0 ? parts.join(', ') : d.display_name.split(',').slice(0, 3).join(', ');
                  marker.bindPopup(`<b>📍 ${name}</b>`).openPopup();
                  onLocationSelect(name, { lat: pos.lat, lng: pos.lng });
                }
              } catch { /* keep coordinate fallback */ }
            });
          }

          markerRef.current!.bindPopup('<b>📍 Locating address...</b>').openPopup();
          // Use coordinates as fallback immediately
          onLocationSelect(`${lat.toFixed(5)}, ${lng.toFixed(5)}`, { lat, lng });

          // Reverse geocode to get actual street address
          try {
            const response = await fetch(
              `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1`
            );
            const data = await response.json();
            if (data?.display_name) {
              // Build a readable address: road + neighbourhood + city
              const addr = data.address || {};
              const parts = [
                addr.road || addr.pedestrian || addr.street,
                addr.neighbourhood || addr.suburb,
                addr.city || addr.town || addr.village || addr.county,
              ].filter(Boolean);
              const locationName = parts.length > 0
                ? parts.join(', ')
                : data.display_name.split(',').slice(0, 3).join(', ').trim();
              markerRef.current?.bindPopup(`<b>📍 ${locationName}</b>`).openPopup();
              // Update form with real address name
              onLocationSelect(locationName, { lat, lng });
            }
          } catch { /* keep coordinate fallback */ }
        });

        setTimeout(() => {
          setIsMapReady(true);
          map.invalidateSize();
        }, 100);

      } catch (error) {
        console.error('Map init error:', error);
        setIsMapReady(true);
      }
    };

    const timeoutId = setTimeout(initializeMap, 100);

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
    <div className={`w-full rounded-xl border-2 border-[#3bcac4] overflow-hidden shadow-md ${className}`}>
      <div style={{ position: 'relative', height: '380px' }}>
        <div
          ref={mapRef}
          style={{ height: '100%', width: '100%' }}
        />
        {!isMapReady && (
          <div
            className="w-full flex items-center justify-center bg-gray-50"
            style={{ position: 'absolute', inset: 0 }}
          >
            <div className="text-center text-[#005476]">
              <MapPin className="h-10 w-10 mx-auto mb-2 text-[#3bcac4] animate-bounce" />
              <p className="font-semibold">Loading map...</p>
              <p className="text-sm text-gray-500 mt-1">Tap anywhere to pin location</p>
            </div>
          </div>
        )}
      </div>
      {isMapReady && (
        <div className="bg-[#005476] text-white text-xs text-center py-1.5 font-medium">
          📍 Tap on the map to set property location — you can also drag the pin
        </div>
      )}
    </div>
  );
};

export default LocationSelector;
