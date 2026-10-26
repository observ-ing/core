import { http, HttpResponse } from "msw";
import type {
  AuthResponse,
  ExploreFeedResponse,
  FeedResponse,
  GeoJSONFeatureCollection,
  HomeFeedResponse,
  NotificationsResponse,
  ProfileFeedResponse,
  TaxaResult,
  TaxaSearchResponse,
} from "../src/services/types";

/**
 * Default MSW handlers used as a baseline by every story. Each one returns a
 * "looks plausible" empty/sentinel response so a component can mount without
 * exploding when it issues a fetch on mount. Stories that care about a
 * specific shape override individual handlers via:
 *
 *   parameters: { msw: { handlers: [http.get(...)] } }
 *
 * (overrides take precedence over defaults inside `msw-storybook-addon`).
 *
 * Each body `satisfies` the type the client reads from that endpoint, so a
 * mock can't drift from the API's shape unnoticed. Overrides should too.
 */
export const defaultHandlers = [
  // Auth
  http.get("/oauth/me", () => HttpResponse.json({} satisfies AuthResponse)),
  http.post("/oauth/logout", () => HttpResponse.json({ success: true })),

  // Feeds
  http.get("/api/occurrences/feed", () =>
    HttpResponse.json({ occurrences: [] } satisfies FeedResponse),
  ),
  http.get("/api/feeds/explore", () =>
    HttpResponse.json({ occurrences: [] } satisfies ExploreFeedResponse),
  ),
  http.get("/api/feeds/home", () =>
    HttpResponse.json({ occurrences: [] } satisfies HomeFeedResponse),
  ),
  http.get("/api/profiles/:did/feed", () =>
    HttpResponse.json({
      profile: { did: "did:plc:unknown", handle: "unknown" },
      counts: { observations: 0, identifications: 0, species: 0 },
      occurrences: [],
      identifications: [],
    } satisfies ProfileFeedResponse),
  ),

  // Observations
  http.get("/api/occurrences/geojson", () =>
    HttpResponse.json({ type: "FeatureCollection", features: [] } satisfies GeoJSONFeatureCollection),
  ),
  // No such observation: the client reads any non-2xx as null.
  http.get("/api/occurrences/*", () => new HttpResponse(null, { status: 404 })),

  // Taxa
  http.get("/api/taxa/search", () =>
    HttpResponse.json({ results: [] } satisfies TaxaSearchResponse),
  ),
  http.get("/api/taxa/:kingdom/:name/occurrences", () =>
    HttpResponse.json({ occurrences: [] } satisfies FeedResponse),
  ),
  http.get("/api/taxa/:id/occurrences", () =>
    HttpResponse.json({ occurrences: [] } satisfies FeedResponse),
  ),
  http.get("/api/taxa/:kingdom/:name/children", () =>
    HttpResponse.json([] satisfies TaxaResult[]),
  ),
  // No such taxon: the client reads a 404 as null.
  http.get("/api/taxa/:kingdom/:name", () => new HttpResponse(null, { status: 404 })),
  http.get("/api/taxa/:id", () => new HttpResponse(null, { status: 404 })),

  // Notifications
  http.get("/api/notifications", () =>
    HttpResponse.json({ notifications: [] } satisfies NotificationsResponse),
  ),
  http.get("/api/notifications/unread-count", () => HttpResponse.json({ count: 0 })),
];
