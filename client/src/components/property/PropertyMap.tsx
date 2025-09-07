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
const sharjahStreets: { [key: string]: { coords: [number, number], name: string } } = {
  'al-wahda-street': { coords: [25.3548, 55.3928], name: 'Al Wahda Street' },
  'king-faisal-street': { coords: [25.3618, 55.3897], name: 'King Faisal Street' },
  'al-arouba-street': { coords: [25.3435, 55.4037], name: 'Al Arouba Street' },
  'corniche-road': { coords: [25.3697, 55.3867], name: 'Corniche Road' },
  'al-khan-street': { coords: [25.3287, 55.3829], name: 'Al Khan Street' },
  'al-qasimia-street': { coords: [25.3287, 55.4066], name: 'Al Qasimia Street' },
  'al-taawun-street': { coords: [25.3408, 55.4008], name: 'Al Taawun Street' },
  'al-majaz-waterfront': { coords: [25.3240, 55.3770], name: 'Al Majaz Waterfront' },
  'rolla-street': { coords: [25.3548, 55.3897], name: 'Rolla Street' },
  'al-nud-area': { coords: [25.3156, 55.3998], name: 'Al Nud Area' },
  'al-nahda-sharjah': { coords: [25.3087, 55.3729], name: 'Al Nahda Sharjah' },
  'university-city': { coords: [25.2957, 55.4827], name: 'University City' },
  'muwailih': { coords: [25.2826, 55.4395], name: 'Muwailih' },
  'al-ramtha': { coords: [25.2695, 55.4563], name: 'Al Ramtha' },
  'al-ghubaiba': { coords: [25.2565, 55.4831], name: 'Al Ghubaiba' },
  'al-mizhar': { coords: [25.2434, 55.4999], name: 'Al Mizhar' },
  'kalba-road': { coords: [25.2174, 55.5667], name: 'Kalba Road' },
  'mleiha-road': { coords: [25.1913, 55.7835], name: 'Mleiha Road' },
  'industrial-area': { coords: [25.3287, 55.4266], name: 'Industrial Area' },
  'al-jubail': { coords: [25.3697, 55.3667], name: 'Al Jubail' },
  'al-layyah': { coords: [25.2043, 55.6334], name: 'Al Layyah' },
  'al-dhaid-road': { coords: [25.2913, 55.8835], name: 'Al Dhaid Road' },
  'al-sajaa': { coords: [25.3217, 55.6434], name: 'Al Sajaa' },
  'al-rumaitha': { coords: [25.3478, 55.4466], name: 'Al Rumaitha' },
  'al-fisht': { coords: [25.3826, 55.4334], name: 'Al Fisht' },
  'al-darari': { coords: [25.4174, 55.4202], name: 'Al Darari' }
};

// Helper function to convert location address to approximate coordinates
// In a real app, this would be replaced with a geocoding service
const getCoordinates = (location: string): [number, number] => {
  // Default to Sharjah, UAE coordinates
  const defaultCoords: [number, number] = [25.3548, 55.3928];
  
  // Check if location matches any street
  for (const [streetKey, streetData] of Object.entries(sharjahStreets)) {
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
  let closestStreet = 'al-wahda-street';
  let minDistance = Infinity;

  for (const [streetKey, streetData] of Object.entries(sharjahStreets)) {
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
        {Object.entries(sharjahStreets).map(([streetKey, streetData]) => (
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