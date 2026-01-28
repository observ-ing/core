/**
 * Convert a scientific name to a URL-friendly slug.
 * Spaces become hyphens for cleaner URLs.
 * e.g. "Quercus alba" → "Quercus-alba"
 */
export function nameToSlug(name: string): string {
  return name.replace(/ /g, "-");
}

/**
 * Convert a URL slug back to a scientific name.
 * Hyphens become spaces.
 * e.g. "Quercus-alba" → "Quercus alba"
 */
export function slugToName(slug: string): string {
  return slug.replace(/-/g, " ");
}
