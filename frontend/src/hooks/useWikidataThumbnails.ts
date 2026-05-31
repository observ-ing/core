import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

/**
 * Batch-fetch taxon thumbnail images from Wikidata using a single SPARQL query.
 * Uses P225 (taxon name) to match taxa and P18 (image) to get images.
 * Returns a map of taxon name → thumbnail URL.
 *
 * Backed by TanStack Query: the whole name set is one query (so a taxon page's
 * names still resolve in a single SPARQL request), cached + persisted to
 * IndexedDB and never refetched (taxon images are effectively static).
 */
export function useWikidataThumbnails(names: string[], size: number = 48): Map<string, string> {
  // Unique + sorted so different orderings of the same names share a cache
  // entry. Query hashes the key deeply, so a fresh array each render is fine.
  const wanted = [...new Set(names)].sort();

  const { data } = useQuery({
    queryKey: ["wikidataThumbnails", wanted, size],
    queryFn: ({ signal }) => fetchBatch(wanted, size, signal),
    enabled: wanted.length > 0,
    staleTime: Infinity,
    // Decorative + external rate-limited API: don't retry or noisily refetch.
    retry: false,
  });

  return useMemo(() => new Map(Object.entries(data ?? {})), [data]);
}

/**
 * Fetch thumbnails for `names` in one SPARQL request. Returns a plain object
 * (not a Map) so the persisted query cache can JSON-serialize it.
 */
async function fetchBatch(
  names: string[],
  size: number,
  signal: AbortSignal,
): Promise<Record<string, string>> {
  const results: Record<string, string> = {};

  // Build SPARQL VALUES clause with escaped names
  const values = names.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(" ");
  const query = `SELECT ?taxonName ?image WHERE {
  VALUES ?taxonName { ${values} }
  ?item wdt:P225 ?taxonName .
  ?item wdt:P18 ?image .
}`;

  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
  const resp = await fetch(url, {
    headers: { Accept: "application/sparql-results+json" },
    signal,
  });
  if (!resp.ok) return results;

  const data = await resp.json();
  for (const binding of data.results?.bindings ?? []) {
    const name = binding.taxonName?.value;
    const imageUri = binding.image?.value;
    if (name && imageUri && !(name in results)) {
      // imageUri is like http://commons.wikimedia.org/wiki/Special:FilePath/Foo.jpg
      // Extract filename and build a sized thumbnail URL
      const filename = imageUri.split("/").pop();
      if (filename) {
        results[name] =
          `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=${size}`;
      }
    }
  }

  return results;
}
