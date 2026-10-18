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

const GBIF_TAXON_ID = /^(?:gbif:|https?:\/\/(?:www\.)?gbif\.org\/species\/)(\d+)\/?$/i;

/**
 * Pull the GBIF usage key out of a Darwin Core taxonID: the `gbif:NNN`
 * shorthand or a `https://www.gbif.org/species/NNN` URI. Other sources
 * (iNaturalist, Wikidata) yield null.
 */
export function gbifKeyFromTaxonId(taxonId: string | undefined): string | null {
  return taxonId?.trim().match(GBIF_TAXON_ID)?.[1] ?? null;
}

/**
 * Build the URL for a taxon's detail page. A GBIF taxonID links by key,
 * since one name can belong to several taxa (e.g. the "Anisoptera" genera)
 * and a name lookup can't tell them apart. Otherwise kingdom-rank taxa link
 * directly; every other rank needs a kingdom prefix, and with no kingdom
 * there's no link. Rank is compared case-insensitively since it can arrive
 * from different upstream sources with inconsistent casing.
 */
export function buildTaxonUrl(
  name: string,
  kingdom?: string | undefined,
  rank?: string | undefined,
  taxonId?: string | undefined,
): string | null {
  const gbifKey = gbifKeyFromTaxonId(taxonId);
  if (gbifKey) return `/taxon/gbif:${gbifKey}`;
  if (rank?.toLowerCase() === "kingdom") return `/taxon/${nameToSlug(name)}`;
  if (kingdom) return `/taxon/${nameToSlug(kingdom)}/${nameToSlug(name)}`;
  return null;
}
