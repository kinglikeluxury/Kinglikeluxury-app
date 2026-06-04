import { parsePhoneNumber, isValidPhoneNumber } from "libphonenumber-js";

const COUNTRY_NAMES: Record<string, string> = {
  AE: "United Arab Emirates",
  AM: "Armenia",
  AZ: "Azerbaijan",
  BA: "Bosnia and Herzegovina",
  BD: "Bangladesh",
  BE: "Belgium",
  BG: "Bulgaria",
  BH: "Bahrain",
  BY: "Belarus",
  CN: "China",
  CY: "Cyprus",
  CZ: "Czech Republic",
  DE: "Germany",
  DZ: "Algeria",
  EG: "Egypt",
  ES: "Spain",
  FR: "France",
  GB: "United Kingdom",
  GE: "Georgia",
  GR: "Greece",
  HR: "Croatia",
  HU: "Hungary",
  ID: "Indonesia",
  IL: "Israel",
  IN: "India",
  IQ: "Iraq",
  IR: "Iran",
  IT: "Italy",
  JO: "Jordan",
  JP: "Japan",
  KG: "Kyrgyzstan",
  KR: "South Korea",
  KW: "Kuwait",
  KZ: "Kazakhstan",
  LB: "Lebanon",
  LY: "Libya",
  MA: "Morocco",
  MD: "Moldova",
  MK: "North Macedonia",
  MX: "Mexico",
  MY: "Malaysia",
  NG: "Nigeria",
  NL: "Netherlands",
  NO: "Norway",
  OM: "Oman",
  PH: "Philippines",
  PK: "Pakistan",
  PL: "Poland",
  PS: "Palestine",
  PT: "Portugal",
  QA: "Qatar",
  RO: "Romania",
  RS: "Serbia",
  RU: "Russia",
  SA: "Saudi Arabia",
  SE: "Sweden",
  SG: "Singapore",
  SK: "Slovakia",
  SY: "Syria",
  TJ: "Tajikistan",
  TM: "Turkmenistan",
  TN: "Tunisia",
  TR: "Turkey",
  TW: "Taiwan",
  UA: "Ukraine",
  US: "United States",
  UZ: "Uzbekistan",
  VN: "Vietnam",
  XK: "Kosovo",
  YE: "Yemen",
  ZA: "South Africa",
};

export interface PhoneValidationResult {
  valid: boolean;
  country: string;
  error?: string;
}

export interface EmailValidationResult {
  valid: boolean;
  error?: string;
}

export function validatePhone(phone: string): PhoneValidationResult {
  if (!phone?.trim()) {
    return { valid: false, country: "", error: "Phone number is required." };
  }
  try {
    if (!isValidPhoneNumber(phone)) {
      return { valid: false, country: "", error: "Invalid phone number." };
    }
    const parsed = parsePhoneNumber(phone);
    const isoCode = parsed?.country ?? "";
    const country = isoCode ? (COUNTRY_NAMES[isoCode] ?? isoCode) : "Country not detected";
    return { valid: true, country };
  } catch {
    return { valid: false, country: "", error: "Invalid phone number." };
  }
}

export function validateEmail(email: string): EmailValidationResult {
  if (!email?.trim()) {
    return { valid: true };
  }
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!re.test(email.trim())) {
    return { valid: false, error: "Invalid email address." };
  }
  return { valid: true };
}
