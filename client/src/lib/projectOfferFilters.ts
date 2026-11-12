export const COUNTRY_CITY_MAP: Record<string, string[]> = {
  Georgia: ["Tbilisi", "Batumi", "Kutaisi", "Rustavi", "Zugdidi", "Gori", "Poti", "Telavi", "Mtskheta", "Kobuleti", "Borjomi", "Akhaltsikhe", "Senaki", "Anaklia", "Sighnaghi", "Ambrolauri", "Khashuri", "Samtredia", "Zestafoni", "Chiatura"],
  UAE: ["Dubai", "Sharjah", "Ras Al Khaimah", "Abu Dhabi", "Ajman", "Fujairah", "Umm Al Quwain"],
  "Northern Cyprus (TRNC)": ["Lefkoşa (Nicosia)", "Gazimağusa (Famagusta)", "Girne (Kyrenia)", "İskele", "Güzelyurt", "Esentepe"],
  Turkey: ["İstanbul", "Trabzon", "Ankara", "İzmir", "Antalya", "Bursa", "Alanya", "Mersin"],
  Azerbaijan: ["Baku"],
};

const COUNTRY_ALIASES: Record<string, string[]> = {
  UAE: ["UAE", "United Arab Emirates"],
  "Northern Cyprus (TRNC)": ["Northern Cyprus (TRNC)", "Northern Cyprus", "North Cyprus", "TRNC"],
  Azerbaijan: ["Azerbaijan", "Azərbaycan"],
};

const CITY_ALIASES: Record<string, string[]> = {
  Baku: ["Baku", "Bakı"],
};

export function normalizeLocationPart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

const countryEntries = Object.entries(COUNTRY_CITY_MAP).flatMap(([country]) => [
  { country, normalized: normalizeLocationPart(country) },
  ...(COUNTRY_ALIASES[country] ?? []).map((alias) => ({
    country,
    normalized: normalizeLocationPart(alias),
  })),
]);

const cityEntries = Object.entries(COUNTRY_CITY_MAP).flatMap(([country, cities]) =>
  cities.flatMap((city) => {
    const aliases = CITY_ALIASES[city] ?? [city];
    return aliases.map((alias) => ({
      country,
      city,
      normalized: normalizeLocationPart(alias),
    }));
  }),
);

export function parseProjectLocation(location: string): { country: string; city: string } {
  const parts = location.split(",").map((part) => part.trim()).filter(Boolean);
  const normalizedParts = parts.map(normalizeLocationPart);
  const cityMatch = [...normalizedParts]
    .reverse()
    .map((part) => cityEntries.find((entry) => entry.normalized === part))
    .find(Boolean);
  const countryMatch = [...normalizedParts]
    .reverse()
    .map((part) => countryEntries.find((entry) => entry.normalized === part)?.country)
    .find(Boolean);

  return {
    city: cityMatch?.city || parts[0] || "",
    country: countryMatch || cityMatch?.country || parts[parts.length - 1] || "",
  };
}

export interface ProjectOfferProject {
  location: string;
  projectStatus?: string | null;
}

export function isUnderConstructionStatus(status: string | null | undefined): boolean {
  return normalizeLocationPart(status ?? "").replace(/[\s_-]+/g, " ") === "under construction";
}

export function filterProjectOfferProjects<T extends ProjectOfferProject>(
  projects: T[],
  selectedCountry: string,
  selectedCity: string,
): T[] {
  const isBakuConstructionFilter =
    normalizeLocationPart(selectedCountry) === normalizeLocationPart("Azerbaijan") &&
    normalizeLocationPart(selectedCity) === normalizeLocationPart("Baku");

  return projects.filter((project) => {
    const location = parseProjectLocation(project.location ?? "");
    const matchesCountry =
      !selectedCountry ||
      normalizeLocationPart(location.country) === normalizeLocationPart(selectedCountry);
    const matchesCity =
      !selectedCity ||
      normalizeLocationPart(location.city) === normalizeLocationPart(selectedCity);

    return (
      matchesCountry &&
      matchesCity &&
      (!isBakuConstructionFilter || isUnderConstructionStatus(project.projectStatus))
    );
  });
}
