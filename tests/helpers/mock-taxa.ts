import type { Page, Route } from "@playwright/test";
import type { TaxaResult } from "../../frontend/src/bindings/TaxaResult";

/** Canned taxa results keyed by query substring (lowercase). */
const TAXA_FIXTURES: Record<string, TaxaResult[]> = {
  "california poppy": [
    {
      id: "3189396",
      scientificName: "Eschscholzia californica",
      commonName: "California Poppy",
      rank: "SPECIES",
      kingdom: "Plantae",
      family: "Papaveraceae",
      genus: "Eschscholzia",
      source: "gbif",
    },
  ],
  quercus: [
    {
      id: "2877951",
      scientificName: "Quercus alba",
      commonName: "White Oak",
      rank: "SPECIES",
      kingdom: "Plantae",
      family: "Fagaceae",
      genus: "Quercus",
      source: "gbif",
    },
    {
      id: "2878688",
      scientificName: "Quercus robur",
      commonName: "English Oak",
      rank: "SPECIES",
      kingdom: "Plantae",
      family: "Fagaceae",
      genus: "Quercus",
      source: "gbif",
    },
  ],
};

/** Find matching fixture by checking if any key is a prefix of the query. */
function findResults(query: string): TaxaResult[] {
  const q = query.toLowerCase();
  for (const [key, results] of Object.entries(TAXA_FIXTURES)) {
    if (q.startsWith(key) || key.startsWith(q)) {
      return results;
    }
  }
  return [];
}

/**
 * Intercepts /api/taxa/search and returns typed fixture data.
 * The fixtures are typed against the Rust-generated TaxaResult binding,
 * so `npx tsc -p e2e/tsconfig.json` will catch shape mismatches when
 * the backend changes.
 */
export async function mockTaxaSearchRoute(page: Page) {
  await page.route("**/api/taxa/search*", (route: Route) => {
    const url = new URL(route.request().url());
    const query = url.searchParams.get("q") || "";
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: findResults(query) }),
    });
  });
}
