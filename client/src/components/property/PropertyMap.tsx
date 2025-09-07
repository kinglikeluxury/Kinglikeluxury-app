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

// Helper function to convert location address to approximate coordinates
// In a real app, this would be replaced with a geocoding service
const getCoordinates = (location: string): [number, number] => {
  // Default to Batumi, Georgia coordinates
  const defaultCoords: [number, number] = [41.6168, 41.6367];
  
  // Check if location matches any street
  for (const [streetKey, streetData] of Object.entries(batumiStreets)) {
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

// Street coordinates and names for markers
const batumiStreets: { [key: string]: { coords: [number, number], name: string } } = {
  'rustaveli-avenue': { coords: [41.6177, 41.6350], name: 'Rustaveli Avenue' },
  'chavchavadze-avenue': { coords: [41.6165, 41.6380], name: 'Chavchavadze Avenue' },
  'gogebashvili-street': { coords: [41.6155, 41.6340], name: 'Gogebashvili Street' },
  'baratashvili-street': { coords: [41.6170, 41.6360], name: 'Baratashvili Street' },
  'agmashenebeli-street': { coords: [41.6160, 41.6370], name: 'Agmashenebeli Street' },
  'pushkin-street': { coords: [41.6180, 41.6330], name: 'Pushkin Street' },
  'gorgiladze-street': { coords: [41.6150, 41.6350], name: 'Gorgiladze Street' },
  'takaishvili-street': { coords: [41.6175, 41.6340], name: 'Takaishvili Street' },
  'ninoshvili-street': { coords: [41.6145, 41.6360], name: 'Ninoshvili Street' },
  'mazniashvili-street': { coords: [41.6185, 41.6375], name: 'Mazniashvili Street' },
  'lermontov-street': { coords: [41.6140, 41.6345], name: 'Lermontov Street' },
  'vazha-pshavela-avenue': { coords: [41.6190, 41.6320], name: 'Vazha-Pshavela Avenue' },
  'aghmashenebeli-avenue': { coords: [41.6135, 41.6355], name: 'Aghmashenebeli Avenue' },
  'sherif-khimshiashvili-street': { coords: [41.6195, 41.6385], name: 'Sherif Khimshiashvili Street' },
  'grishashvili-street': { coords: [41.6130, 41.6365], name: 'Grishashvili Street' },
  'kostava-street': { coords: [41.6200, 41.6340], name: 'Kostava Street' },
  'parnavaz-mepe-street': { coords: [41.6125, 41.6375], name: 'Parnavaz Mepe Street' },
  'zurab-gorgiladze-street': { coords: [41.6205, 41.6350], name: 'Zurab Gorgiladze Street' },
  'batumi-boulevard': { coords: [41.6220, 41.6400], name: 'Batumi Boulevard' },
  'europe-square': { coords: [41.6180, 41.6390], name: 'Europe Square' }
};

// Helper function to find closest street to clicked coordinates
const getClosestStreet = (lat: number, lng: number): string => {
  let closestStreet = 'batumi-boulevard';
  let minDistance = Infinity;

  for (const [streetKey, streetData] of Object.entries(batumiStreets)) {
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
        {Object.entries(batumiStreets).map(([streetKey, streetData]) => (
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