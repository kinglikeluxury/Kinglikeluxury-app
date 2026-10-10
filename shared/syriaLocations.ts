export const SYRIAN_GOVERNORATES = {
  aleppo: [
    "Aleppo", "Afrin", "A'zaz", "Al-Bab", "Ain al-Arab", "Atarib",
    "Dayr Hafir", "Jarabulus", "Manbij", "As-Safira",
  ],
  damascus: ["Damascus"],
  rifDimashq: [
    "Douma", "Darayya", "Harasta", "Jaramana", "Qatana", "Yabroud",
    "Al-Zabadani", "An-Nabk", "Adra", "Sayyidah Zaynab",
  ],
  homs: [
    "Homs", "Palmyra", "Al-Qusayr", "Ar-Rastan", "Talkalakh",
    "Al-Mukharram", "Al-Qaryatayn", "Talbiseh",
  ],
  hama: ["Hama", "Salamiyah", "Masyaf", "Mahardah", "As-Suqaylabiyah", "Kafr Zita"],
  latakia: ["Latakia", "Jableh", "Qardaha", "Al-Haffah"],
  tartus: ["Tartus", "Baniyas", "Safita", "Dreikish", "Sheikh Badr"],
  idlib: [
    "Idlib", "Maarrat al-Nu'man", "Jisr ash-Shughur", "Ariha",
    "Harim", "Saraqib", "Kafr Takharim",
  ],
  raqqa: ["Raqqa", "Tell Abyad", "Ath-Thawrah"],
  deirEzzor: ["Deir ez-Zor", "Al-Mayadin", "Abu Kamal"],
  hasakah: [
    "Al-Hasakah", "Qamishli", "Ras al-Ayn", "Amuda", "Al-Malikiyah", "Darbasiyah",
  ],
  daraa: ["Daraa", "Izra", "Nawa", "Tafas", "Jasim", "As-Sanamayn"],
  suwayda: ["As-Suwayda", "Shahba", "Salkhad"],
  quneitra: ["Quneitra", "Khan Arnabah", "Jaba"],
} as const;

export const SYRIAN_CITIES = Object.values(SYRIAN_GOVERNORATES).flat();

export function toSyriaCityValue(city: string): string {
  return city
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export const SYRIA_CITY_OPTIONS = SYRIAN_CITIES.map((city) => ({
  value: toSyriaCityValue(city),
  label: city,
}));
