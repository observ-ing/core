import { test, expect, type Page, type Route } from "@playwright/test";
import type { TaxonAncestor } from "../frontend/src/bindings/TaxonAncestor";
import type { TaxaResult } from "../frontend/src/bindings/TaxaResult";

/**
 * Integration test for TaxonExplorer: verifies the classification tree builds
 * correctly for an example taxon, including aunts/uncles (siblings of each
 * ancestor). Guards the fix for #246.
 *
 * The test mocks /api/taxa/** so no backend (or GBIF) is involved — it drives
 * the real React component against fixture data that matches the ts-rs types.
 */

// ---- Fixture: Quercus agrifolia (Coast Live Oak) and its classification ----

const QUERCUS_AGRIFOLIA_ANCESTORS: TaxonAncestor[] = [
  { id: "6", name: "Plantae", rank: "kingdom" },
  { id: "7707728", name: "Tracheophyta", rank: "phylum" },
  { id: "220", name: "Magnoliopsida", rank: "class" },
  { id: "1354", name: "Fagales", rank: "order" },
  { id: "4689", name: "Fagaceae", rank: "family" },
  { id: "2877951", name: "Quercus", rank: "genus" },
];

const QUERCUS_AGRIFOLIA_DETAIL = {
  id: "2878289",
  scientificName: "Quercus agrifolia",
  commonName: "Coast Live Oak",
  rank: "species",
  kingdom: "Plantae",
  phylum: "Tracheophyta",
  class: "Magnoliopsida",
  order: "Fagales",
  family: "Fagaceae",
  genus: "Quercus",
  species: "Quercus agrifolia",
  source: "gbif",
  ancestors: QUERCUS_AGRIFOLIA_ANCESTORS,
  children: [] as TaxaResult[],
  observationCount: 0,
  numDescendants: 0,
};

/** A named sibling at each ancestor's child rank, used to assert aunts/uncles appear. */
const SIBLING_FIXTURES: Record<string, TaxaResult[]> = {
  // Siblings of Tracheophyta (other phyla under Plantae)
  Plantae: [
    mkTaxon("7707728", "Tracheophyta", "phylum"),
    mkTaxon("35", "Bryophyta", "phylum"),
    mkTaxon("36", "Marchantiophyta", "phylum"),
  ],
  // Siblings of Magnoliopsida (other classes under Tracheophyta)
  Tracheophyta: [
    mkTaxon("220", "Magnoliopsida", "class"),
    mkTaxon("196", "Liliopsida", "class"),
    mkTaxon("194", "Pinopsida", "class"),
  ],
  // Siblings of Fagales (other orders under Magnoliopsida)
  Magnoliopsida: [
    mkTaxon("1354", "Fagales", "order"),
    mkTaxon("1355", "Rosales", "order"),
    mkTaxon("1356", "Asterales", "order"),
  ],
  // Siblings of Fagaceae (other families under Fagales)
  Fagales: [
    mkTaxon("4689", "Fagaceae", "family"),
    mkTaxon("4690", "Betulaceae", "family"),
    mkTaxon("4691", "Juglandaceae", "family"),
  ],
  // Siblings of Quercus (other genera under Fagaceae)
  Fagaceae: [
    mkTaxon("2877951", "Quercus", "genus"),
    mkTaxon("2877952", "Fagus", "genus"),
    mkTaxon("2877953", "Castanea", "genus"),
  ],
  // Siblings of Quercus agrifolia (other species under Quercus) — these are
  // the taxon's direct siblings, which surface for free via the same fetch.
  Quercus: [
    mkTaxon("2878289", "Quercus agrifolia", "species"),
    mkTaxon("2878290", "Quercus alba", "species"),
    mkTaxon("2878291", "Quercus robur", "species"),
  ],
};

function mkTaxon(id: string, scientificName: string, rank: string): TaxaResult {
  return {
    id,
    scientificName,
    rank,
    kingdom: "Plantae",
    source: "gbif",
  };
}

// ---- Route handler ---------------------------------------------------------

async function mockTaxonomyRoutes(page: Page) {
  await page.route("**/api/taxa/**", (route: Route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;

    // /api/taxa/:kingdom/:name/children
    const childrenMatch = path.match(/^\/api\/taxa\/[^/]+\/([^/]+)\/children$/);
    if (childrenMatch) {
      const name = decodeURIComponent(childrenMatch[1]!);
      const siblings = SIBLING_FIXTURES[name] ?? [];
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(siblings),
      });
    }

    // /api/taxa/:kingdom/:name/occurrences (with optional query string)
    if (/^\/api\/taxa\/[^/]+\/[^/]+\/occurrences$/.test(path)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ occurrences: [], cursor: null }),
      });
    }

    // /api/taxa/:kingdom/:name (taxon detail)
    if (/^\/api\/taxa\/[^/]+\/[^/]+$/.test(path)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(QUERCUS_AGRIFOLIA_DETAIL),
      });
    }

    return route.continue();
  });
}

// ---- Tests -----------------------------------------------------------------

test.describe("Taxon Explorer - Classification tree", () => {
  test("builds the classification tree for Quercus agrifolia with aunts/uncles", async ({
    page,
  }) => {
    await mockTaxonomyRoutes(page);
    await page.goto("/taxon/Plantae/Quercus-agrifolia");

    // Wait for the detail panel to render, which signals TaxonExplorer has
    // processed the initial fetchTaxon response and kicked off sibling fetches.
    await expect(page.getByRole("heading", { name: "Quercus agrifolia", level: 5 })).toBeVisible();

    const tree = page.getByRole("tree");
    await expect(tree).toBeVisible();

    // Tree items are named "<scientificName> <rank>" (e.g. "Quercus genus").
    // Anchoring on the rank suffix makes assertions unambiguous when a name
    // is a prefix of another (e.g. "Quercus" vs "Quercus agrifolia").
    const treeitem = (name: string, rank: string) =>
      tree.getByRole("treeitem", { name: `${name} ${rank}`, exact: true });

    // The full ancestor chain must be present as tree items.
    for (const ancestor of QUERCUS_AGRIFOLIA_ANCESTORS) {
      await expect(treeitem(ancestor.name, ancestor.rank)).toBeVisible();
    }

    // The current taxon itself.
    await expect(treeitem("Quercus agrifolia", "species")).toBeVisible();

    // Aunts/uncles: at least one sibling must appear at each ancestor level.
    // These names are distinct from anything on the ancestor path, so their
    // presence uniquely proves the sibling merge worked.
    const expectedSiblings: Array<[string, string]> = [
      ["Bryophyta", "phylum"], // sibling of Tracheophyta
      ["Liliopsida", "class"], // sibling of Magnoliopsida
      ["Rosales", "order"], // sibling of Fagales
      ["Betulaceae", "family"], // sibling of Fagaceae
      ["Fagus", "genus"], // sibling of Quercus
      ["Quercus alba", "species"], // direct sibling of the current taxon
    ];
    for (const [name, rank] of expectedSiblings) {
      await expect(treeitem(name, rank)).toBeVisible();
    }
  });
});
