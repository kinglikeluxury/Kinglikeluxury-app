import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
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
}

// Helper function to convert location address to approximate coordinates
// In a real app, this would be replaced with a geocoding service
const getCoordinates = (location: string): [number, number] => {
  // This is a simplified mock implementation
  // Default to Dubai coordinates
  const defaultCoords: [number, number] = [25.2048, 55.2708];
  
  // Return different coordinates based on location text 
  // These are just sample coordinates
  if (location.toLowerCase().includes('palm jumeirah')) {
    return [25.1124, 55.1390];
  } else if (location.toLowerCase().includes('downtown dubai')) {
    return [25.1972, 55.2744];
  } else if (location.toLowerCase().includes('dubai marina')) {
    return [25.0805, 55.1403];
  } else if (location.toLowerCase().includes('abu dhabi')) {
    return [24.4539, 54.3773];
  } else if (location.toLowerCase().includes('sharjah')) {
    return [25.3463, 55.4209];
  }
  
  return defaultCoords;
};

const PropertyMap = ({ location, title, className = '' }: PropertyMapProps) => {
  const position = getCoordinates(location);
  
  useEffect(() => {
    // This is needed to properly render the map after it's mounted
    window.dispatchEvent(new Event('resize'));
  }, []);

  return (
    <div className={`overflow-hidden rounded-lg ${className}`}>
      <MapContainer
        center={position as L.LatLngExpression}
        zoom={14}
        style={{ height: '300px', width: '100%' }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <Marker position={position as L.LatLngExpression}>
          <Popup>{title} - {location}</Popup>
        </Marker>
      </MapContainer>
    </div>
  );
};

export default PropertyMap;