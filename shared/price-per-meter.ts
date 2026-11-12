export const PRICE_PER_METER_LABELS: Record<string, { min: string; max: string; range: string }> = {
  ar: { min: "الحد الأدنى لسعر المتر المربع", max: "الحد الأعلى لسعر المتر المربع", range: "سعر المتر المربع" },
  en: { min: "Minimum Price per m²", max: "Maximum Price per m²", range: "Price per m²" },
  ru: { min: "Минимальная цена за м²", max: "Максимальная цена за м²", range: "Цена за м²" },
  ka: { min: "მინიმალური ფასი მ²-ზე", max: "მაქსიმალური ფასი მ²-ზე", range: "ფასი მ²-ზე" },
  az: { min: "m² üçün minimum qiymət", max: "m² üçün maksimum qiymət", range: "m² qiyməti" },
  tr: { min: "Minimum m² fiyatı", max: "Maksimum m² fiyatı", range: "m² fiyatı" },
  zh: { min: "每平方米最低价格", max: "每平方米最高价格", range: "每平方米价格" },
  pl: { min: "Minimalna cena za m²", max: "Maksymalna cena za m²", range: "Cena za m²" },
  he: { min: "מחיר מינימלי למ״ר", max: "מחיר מקסימלי למ״ר", range: "מחיר למ״ר" },
  it: { min: "Prezzo minimo al m²", max: "Prezzo massimo al m²", range: "Prezzo al m²" },
  fa: { min: "حداقل قیمت هر متر مربع", max: "حداکثر قیمت هر متر مربع", range: "قیمت هر متر مربع" },
  nl: { min: "Minimumprijs per m²", max: "Maximumprijs per m²", range: "Prijs per m²" },
  de: { min: "Mindestpreis pro m²", max: "Höchstpreis pro m²", range: "Preis pro m²" },
  sv: { min: "Lägsta pris per m²", max: "Högsta pris per m²", range: "Pris per m²" },
  fr: { min: "Prix minimum par m²", max: "Prix maximum par m²", range: "Prix par m²" },
};

export function getPricePerMeterLabels(language: string) {
  const code = language.toLowerCase().split(/[-_]/)[0];
  return PRICE_PER_METER_LABELS[code] ?? PRICE_PER_METER_LABELS.en;
}

export function formatPricePerMeterRange(min?: number | null, max?: number | null, locale = "en") {
  if (min == null || max == null || min <= 0 || max < min) return null;
  const money = (amount: number) => new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
  return `${money(min)} – ${money(max)} / m²`;
}

export function isValidPricePerMeterRange(min?: number | null, max?: number | null) {
  return min == null || max == null || max >= min;
}
