import { test, expect, type Page, type Route } from "@playwright/test";
import type { TaxonDetail } from "../src/services/types";
import type { TaxonAncestor } from "../src/bindings/TaxonAncestor";

/**
 * Integration test for the taxon **detail** page (TaxonDetailPanel, rendered by
 * TaxonExplorer at /taxon/:kingdom/:name). Guards the page's structure so the
 * design regressions that previously slipped past CI are caught:
 *
 *  - the species name renders as an <h5> heading (this exact contract recently
 *    regressed and broke CI, motivating the test),
 *  - the ancestor breadcrumb renders clickable links, and
 *  - the Media / Description collapsible sections toggle open/closed.
 *
 * Like taxon-explorer.spec.ts, this mocks /api/taxa/** so no backend (or GBIF)
 * is involved — it drives the real React components against fixture data that
 * matches the ts-rs bindings. Service workers are blocked by the Playwright
 * config so page.route() reliably intercepts these calls.
 */

// ---- Fixture: Quercus agrifolia (Coast Live Oak) — same taxon as the
//      explorer spec so the data is available in CI. ------------------------

const QUERCUS_AGRIFOLIA_ANCESTORS: TaxonAncestor[] = [
  { id: "6", name: "Plantae", rank: "kingdom" },
  { id: "7707728", name: "Tracheophyta", rank: "phylum" },
  { id: "220", name: "Magnoliopsida", rank: "class" },
  { id: "1354", name: "Fagales", rank: "order" },
  { id: "4689", name: "Fagaceae", rank: "family" },
  { id: "2877951", name: "Quercus", rank: "genus" },
];

// A unique sentence used to assert the Description body's visibility as the
// section is toggled. Kept distinct from anything else on the page.
const DESCRIPTION_TEXT =
  "The coast live oak is an evergreen oak endemic to the California Floristic Province.";

const QUERCUS_AGRIFOLIA_DETAIL: TaxonDetail = {
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
  children: [],
  observationCount: 0,
  numDescendants: 0,
  // Drives the (expanded-by-default) Description collapsible section.
  descriptions: [{ description: `<p>${DESCRIPTION_TEXT}</p>`, source: "Wikipedia" }],
  gbifUrl: "https://www.gbif.org/species/2878289",
  wikidataUrl: "https://www.wikidata.org/wiki/Q577526",
};

// ---- Route handler ---------------------------------------------------------

async function mockTaxonDetailRoutes(page: Page) {
  await page.route("**/api/taxa/**", (route: Route) => {
    const path = new URL(route.request().url()).pathname;

    // /api/taxa/:kingdom/:name/children — siblings/aunts-uncles are fetched in
    // the background; we don't assert on the tree here, so return none.
    if (/^\/api\/taxa\/[^/]+\/[^/]+\/children$/.test(path)) {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([]),
      });
    }

    // /api/taxa/:kingdom/:name/occurrences
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

test.describe("Taxon detail page", () => {
  test.beforeEach(async ({ page }) => {
    await mockTaxonDetailRoutes(page);
    await page.goto("/taxon/Plantae/Quercus-agrifolia");
    // Wait for the hero to render before asserting anything else.
    await expect(page.getByRole("heading", { name: "Quercus agrifolia", level: 5 })).toBeVisible();
  });

  test("renders the species name as an h5 heading", async ({ page }) => {
    // The species name must be an <h5> — this contract regressed and broke CI.
    await expect(page.getByRole("heading", { name: "Quercus agrifolia", level: 5 })).toBeVisible();
    // Common name appears alongside it.
    await expect(page.getByText("Coast Live Oak")).toBeVisible();
  });

  test("renders the ancestor breadcrumb as clickable links", async ({ page }) => {
    // Every ancestor appears in the breadcrumb as a navigable link.
    for (const ancestor of QUERCUS_AGRIFOLIA_ANCESTORS) {
      const link = page.getByRole("link", { name: ancestor.name, exact: true });
      await expect(link).toBeVisible();
      await expect(link).toHaveAttribute("href", /\/taxon\//);
    }

    // Spot-check the link targets: kingdom links to /taxon/:kingdom, lower
    // ranks to /taxon/:kingdom/:name.
    await expect(page.getByRole("link", { name: "Plantae", exact: true })).toHaveAttribute(
      "href",
      "/taxon/Plantae",
    );
    await expect(page.getByRole("link", { name: "Fagaceae", exact: true })).toHaveAttribute(
      "href",
      "/taxon/Plantae/Fagaceae",
    );
  });

  test("toggles the Media and Description collapsible sections", async ({ page }) => {
    const descriptionBody = page.getByText(DESCRIPTION_TEXT);
    const expandToggle = page.getByRole("button", { name: "Expand section" });
    const collapseToggle = page.getByRole("button", { name: "Collapse section" });

    // Initial state: Media is collapsed (one "Expand section" chevron) and
    // Description is expanded by default (one "Collapse section" chevron, body
    // visible).
    await expect(page.getByRole("heading", { name: "Media", level: 6 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Description", level: 6 })).toBeVisible();
    await expect(expandToggle).toHaveCount(1);
    await expect(collapseToggle).toHaveCount(1);
    await expect(descriptionBody).toBeVisible();

    // Collapse the Description section via its chevron (unambiguous while it's
    // the only expanded section) — its body should disappear.
    await collapseToggle.click();
    await expect(descriptionBody).not.toBeVisible();

    // Re-expand it by clicking the section header row (the whole header is
    // clickable). The body returns.
    await page.getByRole("heading", { name: "Description", level: 6 }).click();
    await expect(descriptionBody).toBeVisible();

    // Expand the Media section ("Expand section" is unique again now that
    // Description is open). Both sections are then expanded, so the page has
    // two "Collapse section" chevrons and no "Expand section" chevron — proof
    // the Media chevron flipped and its body mounted.
    await expandToggle.click();
    await expect(page.getByRole("button", { name: "Expand section" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Collapse section" })).toHaveCount(2);
  });
});
