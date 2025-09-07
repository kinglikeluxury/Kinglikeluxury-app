import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icons in React Leaflet
// @ts-ignore - these imports are working at runtime
import icon from 'leaflet/dist/images/marker-icon.png';
// @ts-ignore
import iconShadow from 'leaflet/dist/images/marker-shadow.png';

// Fix default icon issue
const DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

// Set default icon for all markers
L.Marker.prototype.options.icon = DefaultIcon;

interface PropertyMapProps {
  location: string;
  title: string;
  className?: string;
  onLocationSelect?: (lat: number, lng: number, address: string) => void;
  interactive?: boolean;
}

// Street coordinates and names for markers
const dubaiStreets: { [key: string]: { coords: [number, number], name: string } } = {
  'sheikh-zayed-road': { coords: [25.2048, 55.2708], name: 'Sheikh Zayed Road' },
  'al-wasl-road': { coords: [25.2285, 55.2870], name: 'Al Wasl Road' },
  'jumeirah-beach-road': { coords: [25.2387, 55.2774], name: 'Jumeirah Beach Road' },
  'emirates-road': { coords: [25.1872, 55.2796], name: 'Emirates Road' },
  'al-khaleej-road': { coords: [25.2697, 55.3095], name: 'Al Khaleej Road' },
  'dubai-marina-walk': { coords: [25.0769, 55.1390], name: 'Dubai Marina Walk' },
  'palm-jumeirah': { coords: [25.1124, 55.1390], name: 'Palm Jumeirah' },
  'downtown-dubai': { coords: [25.1972, 55.2744], name: 'Downtown Dubai' },
  'business-bay': { coords: [25.1877, 55.2635], name: 'Business Bay' },
  'jbr-walk': { coords: [25.0769, 55.1390], name: 'JBR Walk' },
  'dubai-mall-area': { coords: [25.1975, 55.2796], name: 'Dubai Mall Area' },
  'burj-khalifa-area': { coords: [25.1972, 55.2744], name: 'Burj Khalifa Area' },
  'deira-district': { coords: [25.2697, 55.3095], name: 'Deira District' },
  'bur-dubai': { coords: [25.2637, 55.2975], name: 'Bur Dubai' },
  'jumeirah-1': { coords: [25.2387, 55.2774], name: 'Jumeirah 1' },
  'jumeirah-2': { coords: [25.2289, 55.2698], name: 'Jumeirah 2' },
  'jumeirah-3': { coords: [25.2191, 55.2622], name: 'Jumeirah 3' },
  'umm-suqeim': { coords: [25.1797, 55.2289], name: 'Umm Suqeim' },
  'al-barsha': { coords: [25.1066, 55.1950], name: 'Al Barsha' },
  'motor-city': { coords: [25.0506, 55.2289], name: 'Motor City' },
  'sports-city': { coords: [25.0382, 55.2289], name: 'Sports City' },
  'dubai-hills': { coords: [25.1066, 55.2450], name: 'Dubai Hills' },
  'mirdif': { coords: [25.2191, 55.4057], name: 'Mirdif' },
  'festival-city': { coords: [25.2289, 55.3532], name: 'Festival City' },
  'silicon-oasis': { coords: [25.1204, 55.3857], name: 'Silicon Oasis' },
  'academic-city': { coords: [25.1066, 55.4057], name: 'Academic City' }
};

// Helper function to convert location address to approximate coordinates
// In a real app, this would be replaced with a geocoding service
const getCoordinates = (location: string): [number, number] => {
  // Default to Dubai, UAE coordinates
  const defaultCoords: [number, number] = [25.2048, 55.2708];
  
  // Check if location matches any street
  for (const [streetKey, streetData] of Object.entries(dubaiStreets)) {
    if (location.toLowerCase().includes(streetKey) || location.toLowerCase().includes(streetKey.replace('-', ' '))) {
      return streetData.coords;
    }
  }
  
  return defaultCoords;
};

// Component to handle map clicks
const MapClickHandler = ({ onLocationSelect }: { onLocationSelect?: (lat: number, lng: number, address: string) => void }) => {
  useMapEvents({
    click: (e) => {
      if (onLocationSelect) {
        const { lat, lng } = e.latlng;
        // Simple reverse geocoding - find closest street
        const address = getClosestStreet(lat, lng);
        onLocationSelect(lat, lng, address);
      }
    },
  });
  return null;
};

// Helper function to find closest street to clicked coordinates
const getClosestStreet = (lat: number, lng: number): string => {
  let closestStreet = 'sheikh-zayed-road';
  let minDistance = Infinity;

  for (const [streetKey, streetData] of Object.entries(dubaiStreets)) {
    const [streetLat, streetLng] = streetData.coords;
    const distance = Math.sqrt(Math.pow(lat - streetLat, 2) + Math.pow(lng - streetLng, 2));
    if (distance < minDistance) {
      minDistance = distance;
      closestStreet = streetKey;
    }
  }

  return closestStreet;
};

const PropertyMap = ({ 
  location, 
  title, 
  className = '', 
  onLocationSelect, 
  interactive = false 
}: PropertyMapProps) => {
  const [markerPosition, setMarkerPosition] = useState<[number, number] | null>(null);
  const defaultPosition = getCoordinates(location);
  const position = markerPosition || defaultPosition;
  
  useEffect(() => {
    // This is needed to properly render the map after it's mounted
    window.dispatchEvent(new Event('resize'));
  }, []);

  const handleLocationSelect = (lat: number, lng: number, address: string) => {
    setMarkerPosition([lat, lng]);
    if (onLocationSelect) {
      onLocationSelect(lat, lng, address);
    }
  };

  return (
    <div className={`overflow-hidden rounded-lg ${className}`}>
      <MapContainer
        center={defaultPosition as L.LatLngExpression}
        zoom={14}
        style={{ height: '300px', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {interactive && <MapClickHandler onLocationSelect={handleLocationSelect} />}
        
        {/* Street markers with names */}
        {Object.entries(dubaiStreets).map(([streetKey, streetData]) => (
          <Marker key={streetKey} position={streetData.coords as L.LatLngExpression}>
            <Popup>
              <div className="text-center">
                <div className="font-semibold">{streetData.name}</div>
                <div className="text-xs text-gray-600">Click to select this location</div>
              </div>
            </Popup>
          </Marker>
        ))}
        
        {/* Selected location marker */}
        {markerPosition && (
          <Marker position={position as L.LatLngExpression}>
            <Popup>
              <div className="text-center">
                <div className="font-semibold text-blue-600">Selected Location</div>
                {interactive && <div className="text-xs mt-1">Click anywhere on the map to select a different location</div>}
              </div>
            </Popup>
          </Marker>
        )}
      </MapContainer>
    </div>
  );
};

export default PropertyMap;