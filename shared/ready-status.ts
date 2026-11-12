export const RENOVATED_WITHOUT_EQUIPMENT_FURNITURE = {
  value: "renovated_without_equipment_furniture",
  labels: {
    ar: "تشطيب كامل بدون أثاث وكهربائيات",
    en: "Renovated without equipments & Furniture",
    ru: "Отремонтирована без оборудования и мебели",
    ka: "გარემონტებული ტექნიკისა და ავეჯის გარეშე",
    az: "Avadanlıq və mebel olmadan təmir edilmiş",
    tr: "Ekipman ve mobilya olmadan yenilenmiş",
    zh: "已翻新，不含设备和家具",
    pl: "Odnowione bez wyposażenia i mebli",
    he: "שופצה ללא ציוד וריהוט",
    it: "Ristrutturato senza attrezzature e mobili",
    fa: "بازسازی‌شده بدون تجهیزات و مبلمان",
    nl: "Gerenoveerd zonder apparatuur en meubels",
    de: "Renoviert ohne Ausstattung und Möbel",
    sv: "Renoverad utan utrustning och möbler",
    fr: "Rénové sans équipements ni meubles",
  },
} as const;

export function getReadyStatusLabel(language: string): string {
  const languageCode = language.toLowerCase().split(/[-_]/)[0] as keyof typeof RENOVATED_WITHOUT_EQUIPMENT_FURNITURE.labels;
  return RENOVATED_WITHOUT_EQUIPMENT_FURNITURE.labels[languageCode]
    ?? RENOVATED_WITHOUT_EQUIPMENT_FURNITURE.labels.en;
}
