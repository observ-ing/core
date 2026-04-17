import type { Page, Route } from "@playwright/test";
import { MOCK_TEST_USER } from "./test-users";
import type {
  Occurrence,
  Identification,
  Comment,
  FeedResponse,
} from "../../frontend/src/services/types";
import type { EnrichedInteraction } from "../../frontend/src/bindings/EnrichedInteraction";

export const MOCK_OBS_DID = MOCK_TEST_USER.did;
export const MOCK_OBS_RKEY = "test123";
export const MOCK_OBS_URL = `/observation/${MOCK_OBS_DID}/${MOCK_OBS_RKEY}`;

/** Occurrence overrides plus optional detail-level fields */
type MockDetailOverrides = Partial<Occurrence> & {
  identifications?: Identification[];
  comments?: Comment[];
};

/**
 * Builds a mock observation object for API responses.
 * Validated against the Rust-generated Occurrence type.
 */
export function buildMockObservation(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    uri: `at://${MOCK_TEST_USER.did}/bio.lexicons.temp.occurrence/${MOCK_OBS_RKEY}`,
    cid: "bafytest",
    observer: {
      did: MOCK_TEST_USER.did,
      handle: MOCK_TEST_USER.handle,
      displayName: MOCK_TEST_USER.displayName,
    },
    observers: [
      {
        did: MOCK_TEST_USER.did,
        handle: MOCK_TEST_USER.handle,
        displayName: MOCK_TEST_USER.displayName,
        role: "owner",
      },
    ],
    communityId: "Quercus alba",
    effectiveTaxonomy: {
      scientificName: "Quercus alba",
      vernacularName: "White Oak",
      kingdom: "Plantae",
    },
    identificationCount: 1,
    images: [],
    eventDate: "2024-06-15",
    location: { latitude: 37.7749, longitude: -122.4194 },
    createdAt: new Date().toISOString(),
    likeCount: 3,
    viewerHasLiked: false,
    ...overrides,
  };
}

/**
 * Builds a full observation detail API response including identifications and comments.
 */
function buildMockObservationResponse(overrides: MockDetailOverrides = {}) {
  const { identifications = [], comments = [], ...occurrenceOverrides } = overrides;

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
export async function mockObservationDetailRoute(page: Page, overrides: MockDetailOverrides = {}) {
  const response = buildMockObservationResponse(overrides);
  await page.route("**/api/occurrences/*", (route: Route) => {
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
export async function mockInteractionsRoute(page: Page, interactions: EnrichedInteraction[] = []) {
  await page.route("**/api/interactions/occurrence/*", (route: Route) => {
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
export async function mockOwnObservationFeed(page: Page, overrides: Partial<Occurrence> = {}) {
  const feedResponse: FeedResponse = {
    occurrences: [buildMockObservation(overrides)],
  };
  const body = JSON.stringify(feedResponse);
  const handler = (route: Route) =>
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
 * Mocks observation detail + interactions routes, then navigates directly
 * to the mock observation URL. Used by integration tests instead of
 * navigating through the explore feed.
 */
export async function navigateToMockedDetail(page: Page, overrides: MockDetailOverrides = {}) {
  await mockObservationDetailRoute(page, {
    uri: `at://${MOCK_OBS_DID}/bio.lexicons.temp.occurrence/${MOCK_OBS_RKEY}`,
    ...overrides,
  });
  await mockInteractionsRoute(page);
  await page.goto(MOCK_OBS_URL);
  await page.getByText("Observed").waitFor({ timeout: 15_000 });
}
