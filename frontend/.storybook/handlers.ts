import { http, HttpResponse } from "msw";

/**
 * Default MSW handlers used as a baseline by every story. Each one returns a
 * "looks plausible" empty/sentinel response so a component can mount without
 * exploding when it issues a fetch on mount. Stories that care about a
 * specific shape override individual handlers via:
 *
 *   parameters: { msw: { handlers: [http.get(...)] } }
 *
 * (overrides take precedence over defaults inside `msw-storybook-addon`).
 */
export const defaultHandlers = [
  // Auth
  http.get("/oauth/me", () => HttpResponse.json(null)),
  http.post("/oauth/logout", () => HttpResponse.json({ success: true })),
  http.post("/oauth/login/init", () =>
    HttpResponse.json({ url: "https://example.invalid/oauth" }),
  ),

  // Feeds
  http.get("/api/occurrences/feed", () =>
    HttpResponse.json({ occurrences: [], cursor: null }),
  ),
  http.get("/api/feeds/explore", () =>
    HttpResponse.json({ occurrences: [], cursor: null }),
  ),
  http.get("/api/feeds/home", () =>
    HttpResponse.json({ occurrences: [], cursor: null }),
  ),
  http.get("/api/profiles/:did/feed", () =>
    HttpResponse.json({
      profile: { did: "did:plc:unknown", handle: "unknown" },
      counts: { observations: 0, identifications: 0, species: 0 },
      occurrences: [],
      identifications: [],
    }),
  ),

  // Observations
  http.get("/api/occurrences/geojson", () =>
    HttpResponse.json({ type: "FeatureCollection", features: [] }),
  ),
  http.get("/api/occurrences/*", () => HttpResponse.json(null)),

  // Taxa
  http.get("/api/taxa/search", () => HttpResponse.json([])),
  http.get("/api/taxa/:kingdom/:name/occurrences", () =>
    HttpResponse.json({ occurrences: [], cursor: null }),
  ),
  http.get("/api/taxa/:id/occurrences", () =>
    HttpResponse.json({ occurrences: [], cursor: null }),
  ),
  http.get("/api/taxa/:kingdom/:name/children", () => HttpResponse.json([])),
  http.get("/api/taxa/:kingdom/:name", () => HttpResponse.json(null)),
  http.get("/api/taxa/:id", () => HttpResponse.json(null)),

  // Interactions
  http.get("/api/interactions/*", () => HttpResponse.json([])),

  // Notifications
  http.get("/api/notifications", () =>
    HttpResponse.json({ notifications: [], cursor: null }),
  ),
  http.get("/api/notifications/unread-count", () =>
    HttpResponse.json({ count: 0 }),
  ),
];
