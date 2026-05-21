export function slugifyProperty(title: string, location: string, id: number): string {
  const toSlug = (str: string) =>
    str
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .trim()
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-");

  const [city = "", country = ""] = location.split(",").map((s) => s.trim());
  return [toSlug(title), toSlug(city), toSlug(country), String(id)]
    .filter(Boolean)
    .join("-");
}

export function extractIdFromSlug(slug: string): number {
  const parts = slug.split("-");
  return parseInt(parts[parts.length - 1], 10);
}
