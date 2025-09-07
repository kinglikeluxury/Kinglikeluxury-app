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
const rasAlKhaimahStreets: { [key: string]: { coords: [number, number], name: string } } = {
  'al-quwain-street': { coords: [25.7889, 55.9778], name: 'Al Quwain Street' },
  'sheikh-khalifa-bin-zayed-street': { coords: [25.7951, 55.9643], name: 'Sheikh Khalifa Bin Zayed Street' },
  'corniche-road': { coords: [25.7889, 55.9534], name: 'Corniche Road' },
  'al-muntazah-street': { coords: [25.7826, 55.9712], name: 'Al Muntazah Street' },
  'al-nakheel-district': { coords: [25.7764, 55.9845], name: 'Al Nakheel District' },
  'al-rams-road': { coords: [25.8578, 56.0156], name: 'Al Rams Road' },
  'al-jazirah-al-hamra': { coords: [25.6889, 55.7778], name: 'Al Jazirah Al Hamra' },
  'ras-al-khaimah-mall-area': { coords: [25.7701, 55.9623], name: 'RAK Mall Area' },
  'al-mamourah': { coords: [25.7639, 55.9756], name: 'Al Mamourah' },
  'al-salam-street': { coords: [25.7764, 55.9578], name: 'Al Salam Street' },
  'dafan-al-nakheel': { coords: [25.7639, 55.9912], name: 'Dafan Al Nakheel' },
  'al-dhait': { coords: [25.2174, 56.0334], name: 'Al Dhait' },
  'khuzam-road': { coords: [25.6826, 55.8445], name: 'Khuzam Road' },
  'al-hamra-village': { coords: [25.6764, 55.7723], name: 'Al Hamra Village' },
  'al-marjan-island': { coords: [25.6889, 55.7634], name: 'Al Marjan Island' },
  'mina-al-arab': { coords: [25.6701, 55.7556], name: 'Mina Al Arab' },
  'flamingo-villas': { coords: [25.6639, 55.7489], name: 'Flamingo Villas' },
  'al-hulaylah': { coords: [25.9043, 56.0767], name: 'Al Hulaylah' },
  'digdaga': { coords: [25.6174, 55.9334], name: 'Digdaga' },
  'al-jeer': { coords: [25.5826, 55.6895], name: 'Al Jeer' },
  'rak-free-zone': { coords: [25.6139, 55.9456], name: 'RAK Free Zone' },
  'al-ghail': { coords: [25.5478, 55.7867], name: 'Al Ghail' },
  'masafi-road': { coords: [25.3217, 56.1434], name: 'Masafi Road' },
  'ras-al-khaimah-airport': { coords: [25.6139, 55.9389], name: 'RAK Airport Area' },
  'al-hamidiyah': { coords: [25.8391, 56.0023], name: 'Al Hamidiyah' },
  'al-uraibi': { coords: [25.7391, 55.9456], name: 'Al Uraibi' }
};

// Helper function to convert location address to approximate coordinates
// In a real app, this would be replaced with a geocoding service
const getCoordinates = (location: string): [number, number] => {
  // Default to Ras Al Khaimah, UAE coordinates
  const defaultCoords: [number, number] = [25.7889, 55.9778];
  
  // Check if location matches any street
  for (const [streetKey, streetData] of Object.entries(rasAlKhaimahStreets)) {
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
  let closestStreet = 'al-quwain-street';
  let minDistance = Infinity;

  for (const [streetKey, streetData] of Object.entries(rasAlKhaimahStreets)) {
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
        {Object.entries(rasAlKhaimahStreets).map(([streetKey, streetData]) => (
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