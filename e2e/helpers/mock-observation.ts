import { getTestUser } from "../fixtures/auth";

/**
 * Builds a mock observation object for API responses.
 * Matches the Occurrence type from the Rust-generated bindings.
 */
export function buildMockObservation(overrides: Record<string, any> = {}) {
  const user = getTestUser();
  return {
    uri: `at://${user.did}/org.observ.ing.occurrence/test123`,
    cid: "bafytest",
    observer: {
      did: user.did,
      handle: user.handle,
      displayName: user.displayName || user.handle,
      avatar: undefined,
    },
    observers: [
      {
        did: user.did,
        handle: user.handle,
        displayName: user.displayName || user.handle,
        role: "owner",
      },
    ],
    communityId: "Quercus alba",
    effectiveTaxonomy: {
      scientificName: "Quercus alba",
      vernacularName: "White Oak",
      kingdom: "Plantae",
      taxonRank: "species",
    },
    subjects: [{ index: 0, identificationCount: 1 }],
    images: [],
    eventDate: "2024-06-15",
    location: { latitude: 37.7749, longitude: -122.4194 },
    verbatimLocality: "Golden Gate Park, San Francisco, CA",
    occurrenceRemarks: "Found near the eastern edge of the meadow",
    createdAt: new Date().toISOString(),
    likeCount: 3,
    viewerHasLiked: false,
    ...overrides,
  };
}

/**
 * Builds a full observation detail API response including identifications and comments.
 */
function buildMockObservationResponse(overrides: Record<string, any> = {}) {
  const {
    identifications = [],
    comments = [],
    ...occurrenceOverrides
  } = overrides;

  return {
    occurrence: buildMockObservation(occurrenceOverrides),
    identifications,
    comments,
  };
}

/**
 * Sets up page.route() mock for the observation detail API endpoint.
 * Intercepts GET /api/occurrences/* and returns the mocked response.
 */
export async function mockObservationDetailRoute(
  page: any,
  overrides: Record<string, any> = {},
) {
  const response = buildMockObservationResponse(overrides);
  await page.route("**/api/occurrences/*", (route: any) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response),
      });
    }
    return route.continue();
  });
  return response;
}

/**
 * Sets up page.route() mock for the interactions API endpoint.
 */
export async function mockInteractionsRoute(
  page: any,
  interactions: any[] = [],
) {
  await page.route("**/api/interactions/occurrence/*", (route: any) => {
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ interactions }),
    });
  });
}

/**
 * Sets up route mocks for all feed endpoints with a single owned observation.
 */
export async function mockOwnObservationFeed(
  page: any,
  overrides: Record<string, any> = {},
) {
  const body = JSON.stringify({
    occurrences: [buildMockObservation(overrides)],
    cursor: null,
  });
  const handler = (route: any) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body,
    });
  await page.route("**/api/feeds/home*", handler);
  await page.route("**/api/feeds/explore*", handler);
  await page.route("**/api/occurrences/feed*", handler);
}
