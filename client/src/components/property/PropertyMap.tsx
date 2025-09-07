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
  
  // Return different coordinates based on Batumi streets
  const batumiCoords: { [key: string]: [number, number] } = {
    'rustaveli-avenue': [41.6177, 41.6350],
    'chavchavadze-avenue': [41.6165, 41.6380],
    'gogebashvili-street': [41.6155, 41.6340],
    'baratashvili-street': [41.6170, 41.6360],
    'agmashenebeli-street': [41.6160, 41.6370],
    'pushkin-street': [41.6180, 41.6330],
    'gorgiladze-street': [41.6150, 41.6350],
    'takaishvili-street': [41.6175, 41.6340],
    'ninoshvili-street': [41.6145, 41.6360],
    'mazniashvili-street': [41.6185, 41.6375],
    'lermontov-street': [41.6140, 41.6345],
    'vazha-pshavela-avenue': [41.6190, 41.6320],
    'aghmashenebeli-avenue': [41.6135, 41.6355],
    'sherif-khimshiashvili-street': [41.6195, 41.6385],
    'grishashvili-street': [41.6130, 41.6365],
    'kostava-street': [41.6200, 41.6340],
    'parnavaz-mepe-street': [41.6125, 41.6375],
    'zurab-gorgiladze-street': [41.6205, 41.6350],
    'batumi-boulevard': [41.6220, 41.6400],
    'europe-square': [41.6180, 41.6390]
  };
  
  // Check if location matches any street
  for (const [streetKey, coords] of Object.entries(batumiCoords)) {
    if (location.toLowerCase().includes(streetKey) || location.toLowerCase().includes(streetKey.replace('-', ' '))) {
      return coords;
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
  const batumiCoords: { [key: string]: [number, number] } = {
    'rustaveli-avenue': [41.6177, 41.6350],
    'chavchavadze-avenue': [41.6165, 41.6380],
    'gogebashvili-street': [41.6155, 41.6340],
    'baratashvili-street': [41.6170, 41.6360],
    'agmashenebeli-street': [41.6160, 41.6370],
    'pushkin-street': [41.6180, 41.6330],
    'gorgiladze-street': [41.6150, 41.6350],
    'takaishvili-street': [41.6175, 41.6340],
    'batumi-boulevard': [41.6220, 41.6400],
    'europe-square': [41.6180, 41.6390]
  };

  let closestStreet = 'batumi-boulevard';
  let minDistance = Infinity;

  for (const [streetName, [streetLat, streetLng]] of Object.entries(batumiCoords)) {
    const distance = Math.sqrt(Math.pow(lat - streetLat, 2) + Math.pow(lng - streetLng, 2));
    if (distance < minDistance) {
      minDistance = distance;
      closestStreet = streetName;
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
        <Marker position={position as L.LatLngExpression}>
          <Popup>
            {markerPosition ? 'Selected Location' : `${title} - ${location}`}
            {interactive && <div className="text-xs mt-1">Click anywhere on the map to select a location</div>}
          </Popup>
        </Marker>
      </MapContainer>
    </div>
  );
};

export default PropertyMap;