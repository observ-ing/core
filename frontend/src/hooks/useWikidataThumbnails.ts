import { useEffect, useState } from "react";

const cache = new Map<string, string | null>();

/**
 * Batch-fetch taxon thumbnail images from Wikidata using a single SPARQL query.
 * Uses P225 (taxon name) to match taxa and P18 (image) to get images.
 * Returns a map of taxon name → thumbnail URL.
 */
export function useWikidataThumbnails(
  names: string[],
  size: number = 48,
): Map<string, string> {
  const [thumbnails, setThumbnails] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (names.length === 0) return;

    // Check which names still need fetching
    const resolved = new Map<string, string>();
    const needed: string[] = [];

    for (const name of names) {
      if (cache.has(name)) {
        const url = cache.get(name);
        if (url) resolved.set(name, url);
      } else {
        needed.push(name);
      }
    }

    if (resolved.size > 0) {
      setThumbnails(new Map(resolved));
    }

    if (needed.length === 0) return;

    let cancelled = false;

    fetchBatch(needed, size).then((results) => {
      if (cancelled) return;

      // Cache all results (including misses as null)
      for (const name of needed) {
        const url = results.get(name) ?? null;
        cache.set(name, url);
      }

      setThumbnails((prev) => {
        const next = new Map(prev);
        for (const [name, url] of results) {
          next.set(name, url);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [names.join("|"), size]);

  return thumbnails;
}

async function fetchBatch(
  names: string[],
  size: number,
): Promise<Map<string, string>> {
  const results = new Map<string, string>();

  // Build SPARQL VALUES clause with escaped names
  const values = names.map((n) => `"${n.replace(/"/g, '\\"')}"`).join(" ");
  const query = `SELECT ?taxonName ?image WHERE {
  VALUES ?taxonName { ${values} }
  ?item wdt:P225 ?taxonName .
  ?item wdt:P18 ?image .
}`;

  try {
    const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(query)}&format=json`;
    const resp = await fetch(url, {
      headers: { Accept: "application/sparql-results+json" },
    });
    if (!resp.ok) return results;

    const data = await resp.json();
    for (const binding of data.results?.bindings ?? []) {
      const name = binding.taxonName?.value;
      const imageUri = binding.image?.value;
      if (name && imageUri && !results.has(name)) {
        // imageUri is like http://commons.wikimedia.org/wiki/Special:FilePath/Foo.jpg
        // Extract filename and build a sized thumbnail URL
        const filename = imageUri.split("/").pop();
        if (filename) {
          results.set(
            name,
            `https://commons.wikimedia.org/wiki/Special:FilePath/${filename}?width=${size}`,
          );
        }
      }
    }
  } catch {
    // Silently fail — thumbnails are decorative
  }

  return results;
}
