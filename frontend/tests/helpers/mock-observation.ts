import type { Page } from "@playwright/test";
import { mockJson } from "./mock-api";
import { MOCK_TEST_USER } from "./test-users";
import type { Occurrence, Identification, Comment, FeedResponse } from "../../src/services/types";

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
    uri: `at://${MOCK_TEST_USER.did}/bio.lexicons.temp.v0-1.occurrence/${MOCK_OBS_RKEY}`,
    cid: "bafytest",
    observer: {
      did: MOCK_TEST_USER.did,
      handle: MOCK_TEST_USER.handle,
      displayName: MOCK_TEST_USER.displayName,
    },
    communityId: "Quercus alba",
    effectiveTaxonomy: {
      scientificName: "Quercus alba",
      vernacularName: "White Oak",
      kingdom: "Plantae",
    },
    identificationCount: 1,
    images: [],
    externalRecords: [],

    eventDate: "2024-06-15",
    location: { latitude: 37.7749, longitude: -122.4194 },
    createdAt: new Date().toISOString(),
    likeCount: 3,
    viewerHasLiked: false,
    qualityIssues: [],
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
  await mockJson(page, "**/api/occurrences/*", response, { method: "GET" });
  return response;
}

/** Sets up route mocks for all feed endpoints, answering with `occurrences`. */
export async function mockFeed(page: Page, occurrences: Occurrence[]) {
  const feed: FeedResponse = { occurrences };
  for (const url of ["**/api/feeds/home*", "**/api/feeds/explore*", "**/api/occurrences/feed*"]) {
    await mockJson(page, url, feed);
  }
}

/**
 * Sets up route mocks for all feed endpoints with a single owned observation.
 */
export async function mockOwnObservationFeed(page: Page, overrides: Partial<Occurrence> = {}) {
  await mockFeed(page, [buildMockObservation(overrides)]);
}

/**
 * Mocks the observation detail route, then navigates directly to the mock
 * observation URL. Used by integration tests instead of navigating through
 * the explore feed.
 */
export async function navigateToMockedDetail(page: Page, overrides: MockDetailOverrides = {}) {
  await mockObservationDetailRoute(page, overrides);
  await page.goto(MOCK_OBS_URL);
  await page.getByText("Observed").waitFor({ timeout: 15_000 });
}
