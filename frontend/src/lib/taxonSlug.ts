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

/**
 * Build the URL for a taxon's detail page. Kingdom-rank taxa link directly;
 * every other rank needs a kingdom prefix, and with no kingdom there's no
 * link. Rank is compared case-insensitively since it can arrive from
 * different upstream sources with inconsistent casing.
 */
export function buildTaxonUrl(
  name: string,
  kingdom?: string | undefined,
  rank?: string | undefined,
): string | null {
  if (rank?.toLowerCase() === "kingdom") return `/taxon/${nameToSlug(name)}`;
  if (kingdom) return `/taxon/${nameToSlug(kingdom)}/${nameToSlug(name)}`;
  return null;
}
