import L from "leaflet";

const OPENSTREETMAP_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const OPENSTREETMAP_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>';

export function addOpenStreetMapTiles(map: L.Map): L.TileLayer {
  return L.tileLayer(OPENSTREETMAP_TILES, {
    attribution: OPENSTREETMAP_ATTRIBUTION,
    maxZoom: 19,
    keepBuffer: 2,
  }).addTo(map);
}
