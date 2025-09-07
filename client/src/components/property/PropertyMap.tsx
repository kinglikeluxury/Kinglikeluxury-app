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

// Batumi street coordinates and names for markers
const batumiStreets: { [key: string]: { coords: [number, number], name: string } } = {
  'rustaveli-ave': { coords: [41.6461, 41.6368], name: 'Rustaveli Avenue' },
  'gogebashvili-str': { coords: [41.6484, 41.6345], name: 'Gogebashvili Street' },
  'chavchavadze-str': { coords: [41.6473, 41.6356], name: 'Chavchavadze Street' },
  'parnavaz-mepe-str': { coords: [41.6459, 41.6378], name: 'Parnavaz Mepe Street' },
  'agmashenebeli-str': { coords: [41.6445, 41.6389], name: 'Agmashenebeli Street' },
  'ninoshvili-str': { coords: [41.6467, 41.6341], name: 'Ninoshvili Street' },
  'lermontov-str': { coords: [41.6478, 41.6334], name: 'Lermontov Street' },
  'pushkin-str': { coords: [41.6489, 41.6327], name: 'Pushkin Street' },
  'tabidze-str': { coords: [41.6456, 41.6362], name: 'Tabidze Street' },
  'vazha-pshavela-ave': { coords: [41.6434, 41.6398], name: 'Vazha Pshavela Avenue' },
  'melikishvili-str': { coords: [41.6492, 41.6324], name: 'Melikishvili Street' },
  'batumi-boulevard': { coords: [41.6434, 41.6356], name: 'Batumi Boulevard' },
  'gorgiladze-str': { coords: [41.6467, 41.6378], name: 'Gorgiladze Street' },
  'sherif-khimshiashvili-str': { coords: [41.6445, 41.6345], name: 'Sherif Khimshiashvili Street' },
  'kostava-str': { coords: [41.6478, 41.6389], name: 'Kostava Street' }
};

// Helper function to convert location address to approximate coordinates
// In a real app, this would be replaced with a geocoding service
const getCoordinates = (location: string): [number, number] => {
  // Check if location is Batumi
  if (location.toLowerCase().includes('batumi')) {
    // Default to Batumi center coordinates
    const batumiCenter: [number, number] = [41.6461, 41.6368];
    
    // Check if location matches any Batumi street
    for (const [streetKey, streetData] of Object.entries(batumiStreets)) {
      if (location.toLowerCase().includes(streetKey) || location.toLowerCase().includes(streetKey.replace('-', ' '))) {
        return streetData.coords;
      }
    }
    
    return batumiCenter;
  }
  
  // Default to Ras Al Khaimah, UAE coordinates
  const defaultCoords: [number, number] = [25.7889, 55.9778];
  
  // Check if location matches any RAK street
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
  let streetCollection = rasAlKhaimahStreets;
  
  // Determine if we're in Batumi area (Georgia) based on coordinates
  if (lat > 40 && lat < 43 && lng > 40 && lng < 43) {
    streetCollection = batumiStreets;
    closestStreet = 'rustaveli-ave';
  }

  for (const [streetKey, streetData] of Object.entries(streetCollection)) {
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
    <div className={`overflow-hidden rounded-lg shadow-2xl border-2 border-gray-200 ${className}`}>
      <MapContainer
        center={defaultPosition as L.LatLngExpression}
        zoom={15}
        style={{ height: '400px', width: '100%' }}
        scrollWheelZoom={true}
        className="super-3d-map"
      >
        {/* Enhanced satellite/hybrid tile layer for 3D effect */}
        <TileLayer
          attribution='&copy; <a href="https://www.esri.com/">Esri</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          opacity={0.9}
        />
        {/* Overlay for street names and labels */}
        <TileLayer
          attribution=''
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"
          opacity={0.8}
        />
        {interactive && <MapClickHandler onLocationSelect={handleLocationSelect} />}
        
        {/* Street markers with names */}
        {/* Show Batumi streets if location includes 'batumi' */}
        {location.toLowerCase().includes('batumi') 
          ? Object.entries(batumiStreets).map(([streetKey, streetData]) => (
              <Marker key={streetKey} position={streetData.coords as L.LatLngExpression}>
                <Popup>
                  <div className="text-center">
                    <div className="font-semibold">{streetData.name}</div>
                    <div className="text-xs text-gray-600">Click to select this location</div>
                  </div>
                </Popup>
              </Marker>
            ))
          : Object.entries(rasAlKhaimahStreets).map(([streetKey, streetData]) => (
              <Marker key={streetKey} position={streetData.coords as L.LatLngExpression}>
                <Popup>
                  <div className="text-center">
                    <div className="font-semibold">{streetData.name}</div>
                    <div className="text-xs text-gray-600">Click to select this location</div>
                  </div>
                </Popup>
              </Marker>
            ))
        }
        
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