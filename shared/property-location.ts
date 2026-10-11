import { SYRIA_CITY_OPTIONS } from "./syriaLocations";

export function getSyriaCityDisplayName(cityValue: string): string | undefined {
  return SYRIA_CITY_OPTIONS.find((option) => option.value === cityValue)?.label.split(" — ")[0];
}

export function combineLocationParts(parts: Array<string | null | undefined>): string {
  const result: string[] = [];

  for (const part of parts) {
    const value = part?.trim();
    if (!value) continue;

    const normalizedValue = value.toLocaleLowerCase();
    const alreadyPresent = result.some((existing) =>
      existing.toLocaleLowerCase().includes(normalizedValue),
    );

    if (!alreadyPresent) result.push(value);
  }

  return result.join(", ");
}
