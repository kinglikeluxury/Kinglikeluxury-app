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
  description?: string | null;
  title?: string | null;
  projectStatus?: string | null;
}

function hasExplicitBakuLocationEvidence(text: string): boolean {
  return (
    /\blocation\s*:\s*(?:baku|bakı)(?:\s*,\s*(?:azerbaijan|azərbaycan))?/i.test(text) ||
    /\b(?:baku|bakı)\s*,\s*(?:azerbaijan|azərbaycan)\b/i.test(text)
  );
}

export function filterProjectOfferProjects<T extends ProjectOfferProject>(
  projects: T[],
  selectedCountry: string,
  selectedCity: string,
): T[] {
  const isBakuSelection =
    normalizeLocationPart(selectedCountry) === normalizeLocationPart("Azerbaijan") &&
    normalizeLocationPart(selectedCity) === normalizeLocationPart("Baku");

  return projects.filter((project) => {
    let location = parseProjectLocation(project.location ?? "");
    if (
      isBakuSelection &&
      normalizeLocationPart(location.city) !== normalizeLocationPart("Baku") &&
      hasExplicitBakuLocationEvidence(`${project.title ?? ""}\n${project.description ?? ""}`)
    ) {
      location = { country: "Azerbaijan", city: "Baku" };
    }
    const matchesCountry =
      !selectedCountry ||
      normalizeLocationPart(location.country) === normalizeLocationPart(selectedCountry);
    const matchesCity =
      !selectedCity ||
      normalizeLocationPart(location.city) === normalizeLocationPart(selectedCity);

    // projectStatus describes marketing/sales status and is not a reliable
    // construction-stage field, so it must not hide a correctly located Baku project.
    return matchesCountry && matchesCity;
  });
}
