import { SYRIAN_CITY_ENTRIES, toSyriaCityValue } from "@shared/syriaLocations";

const COUNTRY_ALIASES: Record<string, string[]> = {
  georgia: ["Georgia"],
  uae: ["UAE", "United Arab Emirates"],
  "northern-cyprus": ["Northern Cyprus", "Northern Cyprus (TRNC)", "North Cyprus", "TRNC"],
  turkey: ["Turkey"],
  syria: ["Syria", "Syrian Arab Republic"],
  azerbaijan: ["Azerbaijan"],
};

const LEGACY_CITIES_BY_COUNTRY: Record<string, string[]> = {
  georgia: [
    "Tbilisi", "Batumi", "Kutaisi", "Rustavi", "Zugdidi", "Gori", "Poti",
    "Telavi", "Mtskheta", "Kobuleti", "Borjomi", "Akhaltsikhe", "Senaki",
    "Anaklia", "Sighnaghi", "Ambrolauri", "Khashuri", "Samtredia", "Zestafoni",
    "Chiatura",
  ],
  uae: ["Dubai", "Sharjah", "Ras Al Khaimah"],
  "northern-cyprus": ["Lefkoşa", "Gazimağusa", "Girne", "İskele", "Güzelyurt", "Esentepe"],
  turkey: ["Istanbul", "Trabzon"],
  syria: SYRIAN_CITY_ENTRIES.map(({ city }) => city),
  azerbaijan: ["Baku"],
};

const CITY_CODE_ALIASES: Record<string, string> = {
  rasalkhaimah: "Ras Al Khaimah",
  "ras-al-khaimah": "Ras Al Khaimah",
  lefkosa: "Lefkoşa",
  istanbul: "Istanbul",
  baku: "Baku",
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tokenRegex(values: string[]): string {
  const alternatives = values.map(escapeRegex).join("|");
  return `(^|[,،][[:space:]]*)(${alternatives})([[:space:]]*[,،]|$)`;
}

function normalizeCountry(country: string): string | undefined {
  const normalized = country.trim().toLowerCase();
  if (normalized === "sy") return "syria";
  if (normalized === "ge") return "georgia";
  if (normalized === "ae") return "uae";
  if (normalized === "tr") return "turkey";
  return COUNTRY_ALIASES[normalized] ? normalized : undefined;
}

export interface PropertyLocationFilter {
  countryRegex: string;
  cityRegex?: string;
}

export function buildPropertyLocationFilter(
  country: string,
  city?: string,
): PropertyLocationFilter | undefined {
  const countryKey = normalizeCountry(country);
  if (!countryKey) return undefined;

  const cityValue = city?.trim().toLowerCase();
  const cityNames = cityValue
    ? countryKey === "syria"
      ? SYRIAN_CITY_ENTRIES.filter(({ city: name }) => toSyriaCityValue(name) === cityValue).map(({ city: name }) => name)
      : [
          CITY_CODE_ALIASES[cityValue],
          ...(LEGACY_CITIES_BY_COUNTRY[countryKey] ?? []).filter((name) =>
            name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === cityValue ||
            name.toLowerCase() === cityValue,
          ),
        ].filter((name): name is string =>
          Boolean(name && LEGACY_CITIES_BY_COUNTRY[countryKey]?.includes(name)),
        )
    : [];
  const uniqueCityNames = [...new Set(cityNames)];

  if (cityValue && uniqueCityNames.length === 0) return undefined;

  return {
    countryRegex: tokenRegex(COUNTRY_ALIASES[countryKey]),
    cityRegex: uniqueCityNames.length ? tokenRegex(uniqueCityNames) : undefined,
  };
}

export function propertyLocationMatches(
  location: string,
  filter: PropertyLocationFilter,
): boolean {
  const tokens = location
    .toLowerCase()
    .split(/[,،]/)
    .map((part) => part.trim())
    .filter(Boolean);
  const countryKey = Object.entries(COUNTRY_ALIASES).find(([, aliases]) =>
    tokenRegex(aliases) === filter.countryRegex,
  )?.[0];
  const countryMatches = Boolean(
    countryKey && COUNTRY_ALIASES[countryKey].some((alias) => tokens.includes(alias.toLowerCase())),
  );
  const cityAliases = countryKey
    ? (LEGACY_CITIES_BY_COUNTRY[countryKey] ?? []).filter((name) =>
        filter.cityRegex === tokenRegex([name]),
      )
    : [];
  const cityMatches = !filter.cityRegex || cityAliases.some((name) => tokens.includes(name.toLowerCase()));
  return cityMatches && countryMatches;
}
