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
export function buildMockObservationResponse(overrides: Record<string, any> = {}) {
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
 * Builds a mock feed response containing an observation owned by the test user.
 */
export function buildMockFeedResponse(overrides: Record<string, any> = {}) {
  return JSON.stringify({
    occurrences: [buildMockObservation(overrides)],
    cursor: null,
  });
}

/**
 * Sets up route mocks for all feed endpoints with a single owned observation.
 */
export async function mockOwnObservationFeed(
  page: any,
  overrides: Record<string, any> = {},
) {
  const body = buildMockFeedResponse(overrides);
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

/**
 * Builds a mock identification object.
 */
export function buildMockIdentification(overrides: Record<string, any> = {}) {
  const user = getTestUser();
  return {
    identifier: {
      did: user.did,
      handle: user.handle,
      displayName: user.displayName || user.handle,
    },
    uri: `at://${user.did}/org.observ.ing.identification/id123`,
    cid: "bafyidtest",
    did: user.did,
    subject_uri: `at://${user.did}/org.observ.ing.occurrence/test123`,
    subject_cid: "bafytest",
    subject_index: 0,
    scientific_name: "Quercus alba",
    is_agreement: true,
    date_identified: new Date().toISOString(),
    confidence: "high",
    kingdom: "Plantae",
    ...overrides,
  };
}

/**
 * Builds a mock comment object.
 */
export function buildMockComment(overrides: Record<string, any> = {}) {
  const user = getTestUser();
  return {
    commenter: {
      did: user.did,
      handle: user.handle,
      displayName: user.displayName || user.handle,
    },
    uri: `at://${user.did}/org.observ.ing.comment/cmt123`,
    cid: "bafycmttest",
    did: user.did,
    subject_uri: `at://${user.did}/org.observ.ing.occurrence/test123`,
    subject_cid: "bafytest",
    body: "Great observation! The bark pattern is very distinctive.",
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Builds a mock interaction response object.
 */
export function buildMockInteraction(overrides: Record<string, any> = {}) {
  const user = getTestUser();
  return {
    uri: `at://${user.did}/org.observ.ing.interaction/int123`,
    cid: "bafyinttest",
    did: user.did,
    subject_a_occurrence_uri: `at://${user.did}/org.observ.ing.occurrence/test123`,
    subject_a_occurrence_cid: "bafytest",
    subject_a_subject_index: 0,
    subject_a_taxon_name: "Quercus alba",
    subject_a_kingdom: "Plantae",
    subject_b_occurrence_uri: null,
    subject_b_occurrence_cid: null,
    subject_b_subject_index: 0,
    subject_b_taxon_name: "Andricus quercuscalifornicus",
    subject_b_kingdom: "Animalia",
    interaction_type: "parasitism",
    direction: "BtoA",
    confidence: "high",
    comment: "Oak gall visible on branch",
    created_at: new Date().toISOString(),
    creator: {
      did: user.did,
      handle: user.handle,
      displayName: user.displayName || user.handle,
    },
    ...overrides,
  };
}
