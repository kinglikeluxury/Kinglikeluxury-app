export const COUNTRY_CITY_MAP: Record<string, string[]> = {
  Georgia: ["Tbilisi", "Batumi", "Kutaisi", "Rustavi", "Zugdidi", "Gori", "Poti", "Telavi", "Mtskheta", "Kobuleti", "Borjomi", "Akhaltsikhe", "Senaki", "Anaklia", "Sighnaghi", "Ambrolauri", "Khashuri", "Samtredia", "Zestafoni", "Chiatura"],
  UAE: ["Dubai", "Sharjah", "Ras Al Khaimah", "Abu Dhabi", "Ajman", "Fujairah", "Umm Al Quwain"],
  "Northern Cyprus (TRNC)": ["Lefkoşa (Nicosia)", "Gazimağusa (Famagusta)", "Girne (Kyrenia)", "İskele", "Güzelyurt", "Esentepe"],
  Turkey: ["İstanbul", "Trabzon", "Ankara", "İzmir", "Antalya", "Bursa", "Alanya", "Mersin"],
  Azerbaijan: ["Baku"],
};

const COUNTRY_ALIASES: Record<string, string[]> = {
  Georgia: ["საქართველო", "جورجيا", "Gürcüstan", "Gürcistan"],
  UAE: ["UAE", "United Arab Emirates", "الإمارات العربية المتحدة", "Birləşmiş Ərəb Əmirlikləri"],
  "Northern Cyprus (TRNC)": [
    "Northern Cyprus (TRNC)", "Northern Cyprus", "North Cyprus", "TRNC",
    "قبرص الشمالية", "Şimali Kipr",
  ],
  Turkey: ["Türkiye", "تركيا", "Türkiyə"],
  Azerbaijan: ["Azerbaijan", "Azərbaycan", "أذربيجان"],
};

const CITY_ALIASES: Record<string, string[]> = {
  Batumi: ["Batumi", "Batum", "باتومي", "ბათუმი"],
  Tbilisi: ["Tbilisi", "Tiflis", "თბილისი", "تبليسي"],
  Dubai: ["Dubai", "Dubay", "دبي"],
  "İstanbul": ["Istanbul", "İstanbul", "إسطنبول", "استانبول"],
  Baku: ["Baku", "Bakı", "باكو"],
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
  return parseProjectLocationWithEvidence(location);
}

function hasExplicitBakuLocationEvidence(text: string): boolean {
  return (
    /\blocation\s*:\s*(?:baku|bakı)(?:\s*,\s*(?:azerbaijan|azərbaycan))?/i.test(text) ||
    /\b(?:baku|bakı)\s*,\s*(?:azerbaijan|azərbaycan)\b/i.test(text)
  );
}

function isSabunchuDistrict(location: string): boolean {
  const normalized = normalizeLocationPart(location);
  return normalized.includes("sabunchu raion") || normalized.includes("sabuncu rayonu");
}

export function parseProjectLocationWithEvidence(
  location: string,
  evidenceText = "",
): { country: string; city: string } {
  const parts = location.split(/[,،]/).map((part) => part.trim()).filter(Boolean);
  const normalizedParts = parts.map(normalizeLocationPart);
  const cityMatch = [...normalizedParts]
    .reverse()
    .map((part) => cityEntries.find((entry) => entry.normalized === part))
    .find(Boolean);
  const countryMatch = [...normalizedParts]
    .reverse()
    .map((part) => countryEntries.find((entry) => entry.normalized === part)?.country)
    .find(Boolean);

  const hasBakuDescriptionEvidence =
    hasExplicitBakuLocationEvidence(evidenceText) ||
    (isSabunchuDistrict(location) && /\b(?:baku|bakı|باكو)\b/i.test(evidenceText));

  if (hasBakuDescriptionEvidence && !cityMatch && (!countryMatch || isSabunchuDistrict(location))) {
    return { country: "Azerbaijan", city: "Baku" };
  }

  return {
    city: cityMatch?.city || parts[0] || "",
    country: countryMatch || cityMatch?.country || parts[parts.length - 1] || "",
  };
}

export function isBakuProjectLocation(location: string, evidenceText = ""): boolean {
  const parsed = parseProjectLocationWithEvidence(location, evidenceText);
  return (
    normalizeLocationPart(parsed.country) === normalizeLocationPart("Azerbaijan") &&
    normalizeLocationPart(parsed.city) === normalizeLocationPart("Baku")
  );
}

export interface ProjectOfferProject {
  location: string;
  description?: string | null;
  title?: string | null;
  projectStatus?: string | null;
}

export interface ProjectOfferLocation {
  country: string;
  city: string;
}

export type LocationNameTranslator = (
  category: "countries" | "cities",
  canonicalName: string,
  lang: string,
) => string;

export const PROJECT_OFFER_FLAG_CODES: Record<string, string> = {
  Georgia: "GE",
  UAE: "AE",
  "Northern Cyprus (TRNC)": "TRNC",
  Turkey: "TR",
  Azerbaijan: "AZ",
};

function canonicalCountry(value: string): string {
  const normalized = normalizeLocationPart(value);
  return countryEntries.find((entry) => entry.normalized === normalized)?.country ?? "";
}

function canonicalCity(value: string, country = ""): { country: string; city: string } | undefined {
  const normalized = normalizeLocationPart(value);
  return cityEntries.find(
    (entry) =>
      entry.normalized === normalized &&
      (!country || entry.country === country),
  );
}

export function resolveProjectOfferLocation(
  selectedCountry: string,
  selectedCity: string,
  projectLocation: string,
  projectDescription = "",
  projectTitle = "",
): ProjectOfferLocation {
  const parsed = parseProjectLocationWithEvidence(
    projectLocation,
    `${projectTitle}\n${projectDescription}`,
  );
  const selectedCityAnyCountry = canonicalCity(selectedCity);
  const country =
    canonicalCountry(selectedCountry) ||
    canonicalCountry(parsed.country) ||
    selectedCityAnyCountry?.country ||
    "";
  const selectedCityMatch = canonicalCity(selectedCity, country);
  const parsedCityMatch = canonicalCity(parsed.city, country);

  return {
    country,
    city: selectedCityMatch?.city || parsedCityMatch?.city || "",
  };
}

export function formatProjectOfferLocation(
  location: ProjectOfferLocation,
  lang: string,
  translate: LocationNameTranslator,
): string {
  const city = location.city ? translate("cities", location.city, lang) : "";
  const country = location.country ? translate("countries", location.country, lang) : "";
  return [city, country].filter(Boolean).join(" - ");
}

export function filterProjectOfferProjects<T extends ProjectOfferProject>(
  projects: T[],
  selectedCountry: string,
  selectedCity: string,
): T[] {
  return projects.filter((project) => {
    const location = parseProjectLocationWithEvidence(
      project.location ?? "",
      `${project.title ?? ""}\n${project.description ?? ""}`,
    );
    const isSelectedBaku =
      normalizeLocationPart(selectedCountry) === normalizeLocationPart("Azerbaijan") &&
      normalizeLocationPart(selectedCity) === normalizeLocationPart("Baku");
    const matchesCountry =
      !selectedCountry ||
      normalizeLocationPart(location.country) === normalizeLocationPart(selectedCountry) ||
      (isSelectedBaku && isBakuProjectLocation(
        project.location ?? "",
        `${project.title ?? ""}\n${project.description ?? ""}`,
      ));
    const matchesCity =
      !selectedCity ||
      normalizeLocationPart(location.city) === normalizeLocationPart(selectedCity) ||
      (isSelectedBaku && isBakuProjectLocation(
        project.location ?? "",
        `${project.title ?? ""}\n${project.description ?? ""}`,
      ));

    // projectStatus describes marketing/sales status and is not a reliable
    // construction-stage field, so it must not hide a correctly located Baku project.
    return matchesCountry && matchesCity;
  });
}
