import { SYRIA_CITY_OPTIONS } from "@shared/syriaLocations";
import { isBakuProjectLocation, normalizeLocationPart } from "./projectOfferFilters";

export interface PublicProjectRecord {
  id?: number | string;
  propertyId?: number;
  title?: string | null;
  description?: string | null;
  location?: string | null;
  price?: number | null;
  bedrooms?: number | null;
  status?: string | null;
  completionDate?: string | null;
  property?: PublicProjectRecord | null;
}

export interface PublicProjectFilters {
  searchTerm: string;
  selectedCountry: string;
  selectedCity: string;
  minPrice: number | null;
  maxPrice: number | null;
  bedroomCount: string;
  selectedDeliveryYear: string;
  isAdmin: boolean;
}

const BAKU_SEARCH_ALIASES = ["baku", "bakı", "باكو", "azerbaijan", "azərbaycan", "أذربيجان"];

function isBakuSearchQuery(searchTerm: string): boolean {
  const terms = normalizeLocationPart(searchTerm)
    .split(/[\s,،/|;-]+/)
    .filter(Boolean);
  return BAKU_SEARCH_ALIASES.some((alias) => terms.includes(normalizeLocationPart(alias)));
}

/**
 * Shared public /projects filtering, kept as a pure function so the page's
 * approval, location, search, and other filters can be verified together.
 */
export function filterPublicProjects<T extends PublicProjectRecord>(
  projects: T[],
  filters: PublicProjectFilters,
): T[] {
  const {
    searchTerm,
    selectedCountry,
    selectedCity,
    minPrice,
    maxPrice,
    bedroomCount,
    selectedDeliveryYear,
    isAdmin,
  } = filters;
  const requiredFieldsFilled =
    selectedCountry !== "" && selectedCountry !== "all";
  if (!requiredFieldsFilled) return [];

  const normalizedSearchTerm = searchTerm.toLowerCase();
  const searchHasBakuAlias = isBakuSearchQuery(searchTerm);

  return projects.filter((project) => {
    const propertyData = project.property || project;
    const projectStatus = propertyData.status || project.status;
    if (!isAdmin && projectStatus !== "approved") return false;

    const projectLocation = (propertyData.location || project.location || "").toLowerCase();
    const projectTitle = (propertyData.title || project.title || "").toLowerCase();
    const projectDescription =
      propertyData.description || project.description || "";
    const locationEvidence = `${projectTitle}\n${projectDescription}`;
    const isVerifiedBaku = isBakuProjectLocation(projectLocation, locationEvidence);

    if (
      searchTerm &&
      !projectTitle.includes(normalizedSearchTerm) &&
      !projectLocation.includes(normalizedSearchTerm) &&
      !(searchHasBakuAlias && isVerifiedBaku)
    ) {
      return false;
    }

    if (selectedCountry && selectedCountry !== "all" && selectedCountry !== "any") {
      const countryNameMap: Record<string, string> = {
        georgia: "georgia",
        uae: "uae",
        "northern-cyprus": "northern cyprus",
        turkey: "turkey",
        syria: "syria",
        azerbaijan: "azerbaijan",
      };
      const countryName = countryNameMap[selectedCountry] || selectedCountry.replace(/-/g, " ");
      const matchesCountryName = projectLocation.includes(countryName);
      const georgianCityAliases = ["batumi", "tbilisi", "kobuleti"];
      const matchesGeorgianCity =
        selectedCountry === "georgia" &&
        georgianCityAliases.some((city) => projectLocation.includes(city));
      const matchesSyrianCity =
        selectedCountry === "syria" &&
        SYRIA_CITY_OPTIONS.some(({ value }) =>
          projectLocation.includes(value.replace(/-/g, " ")),
        );
      const matchesBaku = selectedCountry === "azerbaijan" && isVerifiedBaku;
      if (!matchesCountryName && !matchesGeorgianCity && !matchesSyrianCity && !matchesBaku) {
        return false;
      }
    }

    if (selectedCity && selectedCity !== "all" && selectedCity !== "any") {
      const cityMap: Record<string, string> = {
        batumi: "batumi",
        tbilisi: "tbilisi",
        dubai: "dubai",
        sharjah: "sharjah",
        rasAlKhaimah: "ras al khaimah",
        "ras-al-khaimah": "ras al khaimah",
        "abu-dhabi": "abu dhabi",
        lefkosa: "lefkoşa",
        "gazimağusa": "gazimağusa",
        girne: "girne",
        iskele: "skele",
        guzelyurt: "güzelyurt",
        esentepe: "esentepe",
        istanbul: "istanbul",
        trabzon: "trabzon",
      };
      const cityName = cityMap[selectedCity] || selectedCity.toLowerCase().replace(/-/g, " ");
      const matchesSelectedBaku =
        selectedCountry === "azerbaijan" &&
        (selectedCity === "baku" || selectedCity === "Baku") &&
        isVerifiedBaku;
      if (!matchesSelectedBaku && !projectLocation.includes(cityName)) return false;
    }

    const projectPrice = propertyData.price || project.price || 0;
    if (minPrice !== null && projectPrice < minPrice) return false;
    if (maxPrice !== null && projectPrice > maxPrice) return false;

    const projectBedrooms = propertyData.bedrooms || project.bedrooms;
    if (bedroomCount && bedroomCount !== "any" && projectBedrooms !== parseInt(bedroomCount)) {
      return false;
    }

    if (selectedDeliveryYear && selectedDeliveryYear !== "any") {
      const completionDate = project.completionDate || "";
      const yearMatch = completionDate.match(/\d{4}/);
      if (yearMatch) {
        const projectYear = parseInt(yearMatch[0]);
        const [rangeStart, rangeEnd] = selectedDeliveryYear.split("-").map(Number);
        if (rangeEnd) {
          if (projectYear < rangeStart || projectYear > rangeEnd) return false;
        } else if (projectYear !== rangeStart) {
          return false;
        }
      } else {
        return false;
      }
    }

    return true;
  });
}
