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
const tbilisiStreets: { [key: string]: { coords: [number, number], name: string } } = {
  'rustaveli-avenue': { coords: [41.6941, 44.8337], name: 'Rustaveli Avenue' },
  'kostava-street': { coords: [41.7151, 44.7737], name: 'Kostava Street' },
  'chavchavadze-avenue': { coords: [41.7086, 44.7739], name: 'Chavchavadze Avenue' },
  'pekini-avenue': { coords: [41.7297, 44.7514], name: 'Pekini Avenue' },
  'aghmashenebeli-avenue': { coords: [41.6928, 44.8086], name: 'Aghmashenebeli Avenue' },
  'vazha-pshavela-avenue': { coords: [41.7225, 44.7806], name: 'Vazha-Pshavela Avenue' },
  'tsereteli-avenue': { coords: [41.7136, 44.7472], name: 'Tsereteli Avenue' },
  'kazbegi-avenue': { coords: [41.7297, 44.7514], name: 'Kazbegi Avenue' },
  'varketili-street': { coords: [41.6547, 44.8947], name: 'Varketili Street' },
  'gldani-street': { coords: [41.7736, 44.8072], name: 'Gldani Street' },
  'saburtalo-street': { coords: [41.7428, 44.7264], name: 'Saburtalo Street' },
  'nutsubidze-street': { coords: [41.7300, 44.7200], name: 'Nutsubidze Street' },
  'vake-street': { coords: [41.7086, 44.7639], name: 'Vake Street' },
  'mtatsminda-street': { coords: [41.6886, 44.7917], name: 'Mtatsminda Street' },
  'didube-street': { coords: [41.7319, 44.7792], name: 'Didube Street' },
  'isani-street': { coords: [41.6886, 44.8317], name: 'Isani Street' },
  'samgori-street': { coords: [41.7086, 44.8639], name: 'Samgori Street' },
  'chugureti-street': { coords: [41.6997, 44.8222], name: 'Chugureti Street' },
  'vera-street': { coords: [41.7019, 44.7906], name: 'Vera Street' },
  'sololaki-street': { coords: [41.6911, 44.8081], name: 'Sololaki Street' },
  'avlabari-street': { coords: [41.6889, 44.8194], name: 'Avlabari Street' },
  'ortachala-street': { coords: [41.6747, 44.8389], name: 'Ortachala Street' },
  'krtsanisi-street': { coords: [41.6747, 44.8239], name: 'Krtsanisi Street' },
  'digomi-street': { coords: [41.7619, 44.7556], name: 'Digomi Street' },
  'temka-street': { coords: [41.7486, 44.8111], name: 'Temka Street' },
  'lilo-street': { coords: [41.6519, 44.9056], name: 'Lilo Street' }
};

// Helper function to convert location address to approximate coordinates
// In a real app, this would be replaced with a geocoding service
const getCoordinates = (location: string): [number, number] => {
  // Default to Tbilisi, Georgia coordinates
  const defaultCoords: [number, number] = [41.7151, 44.8271];
  
  // Check if location matches any street
  for (const [streetKey, streetData] of Object.entries(tbilisiStreets)) {
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
  let closestStreet = 'rustaveli-avenue';
  let minDistance = Infinity;

  for (const [streetKey, streetData] of Object.entries(tbilisiStreets)) {
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
        {Object.entries(tbilisiStreets).map(([streetKey, streetData]) => (
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