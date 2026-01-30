import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";

// Create mock implementations that will be used by the mock
const createMockDatabase = () => ({
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  getOccurrencesNearby: vi.fn().mockResolvedValue([]),
  getOccurrencesByBoundingBox: vi.fn().mockResolvedValue([]),
  getOccurrence: vi.fn().mockResolvedValue(null),
  upsertOccurrence: vi.fn().mockResolvedValue(undefined),
  getIdentificationsForOccurrence: vi.fn().mockResolvedValue([]),
  getCommentsForOccurrence: vi.fn().mockResolvedValue([]),
  getSubjectsForOccurrence: vi.fn().mockResolvedValue([]),
  getCommunityId: vi.fn().mockResolvedValue(null),
  saveOccurrencePrivateData: vi.fn().mockResolvedValue(undefined),
  getOccurrencePrivateData: vi.fn().mockResolvedValue(null),
  deleteOccurrencePrivateData: vi.fn().mockResolvedValue(undefined),
  // Multi-user observation methods
  getOccurrenceObservers: vi.fn().mockResolvedValue([]),
  addOccurrenceObserver: vi.fn().mockResolvedValue(undefined),
  removeOccurrenceObserver: vi.fn().mockResolvedValue(undefined),
  syncOccurrenceObservers: vi.fn().mockResolvedValue(undefined),
  isOccurrenceOwner: vi.fn().mockResolvedValue(false),
});

const createMockIdentityResolver = () => ({
  getProfiles: vi.fn().mockResolvedValue(new Map()),
});

const createMockOAuthService = () => ({
  initialize: vi.fn().mockResolvedValue(undefined),
  setupRoutes: vi.fn(),
  getAgent: vi.fn().mockResolvedValue(null),
});

// Store mocks at module level so they can be accessed by tests
let mockDatabase: ReturnType<typeof createMockDatabase>;
let mockIdentityResolver: ReturnType<typeof createMockIdentityResolver>;
let mockOAuthService: ReturnType<typeof createMockOAuthService>;

const createMockCommunityIdCalculator = () => ({
  calculate: vi.fn().mockResolvedValue(null),
});

const createMockTaxonomyClient = () => ({
  search: vi.fn().mockResolvedValue([]),
  validate: vi.fn().mockResolvedValue({ valid: false, suggestions: [] }),
  getById: vi.fn().mockResolvedValue(null),
  getByName: vi.fn().mockResolvedValue(null),
  getChildren: vi.fn().mockResolvedValue([]),
});

let mockCommunityIdCalculator: ReturnType<typeof createMockCommunityIdCalculator>;
let mockTaxonomyClient: ReturnType<typeof createMockTaxonomyClient>;

// Mock the dependencies before importing AppViewServer
vi.mock("observing-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("observing-shared")>();

  // Create a class-like mock for Database
  const MockDatabase = function (this: ReturnType<typeof createMockDatabase>) {
    mockDatabase = createMockDatabase();
    Object.assign(this, mockDatabase);
  } as unknown as new () => ReturnType<typeof createMockDatabase>;

  // Mock CommunityIdCalculator
  const MockCommunityIdCalculator = function (this: object) {
    mockCommunityIdCalculator = createMockCommunityIdCalculator();
    Object.assign(this, mockCommunityIdCalculator);
  };

  // Mock TaxonomyClient
  const MockTaxonomyClient = function (this: object) {
    mockTaxonomyClient = createMockTaxonomyClient();
    Object.assign(this, mockTaxonomyClient);
  };

  return {
    ...actual,
    Database: MockDatabase,
    CommunityIdCalculator: MockCommunityIdCalculator,
    TaxonomyClient: MockTaxonomyClient,
    getIdentityResolver: vi.fn().mockImplementation(() => {
      if (!mockIdentityResolver) {
        mockIdentityResolver = createMockIdentityResolver();
      }
      return mockIdentityResolver;
    }),
  };
});

vi.mock("./auth/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth/index.js")>();

  // Create a class-like mock for OAuthService
  const MockOAuthService = function (this: ReturnType<typeof createMockOAuthService>) {
    mockOAuthService = createMockOAuthService();
    Object.assign(this, mockOAuthService);
  } as unknown as new () => ReturnType<typeof createMockOAuthService>;

  return {
    ...actual,
    OAuthService: MockOAuthService,
    DatabaseStateStore: vi.fn(),
    DatabaseSessionStore: vi.fn(),
  };
});

// Import after mocks are set up
import { AppViewServer } from "./api.js";

describe("AppViewServer", () => {
  let server: AppViewServer;
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();

    // Reset module-level mocks
    mockIdentityResolver = createMockIdentityResolver();

    server = new AppViewServer({
      port: 3000,
      databaseUrl: "postgresql://test:5432/test",
      corsOrigins: ["http://localhost:5173"],
      publicUrl: "http://localhost:3000",
    });

    // Access the express app for testing
    app = (server as unknown as { app: express.Application }).app;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ==========================================================================
  // Health check
  // ==========================================================================
  describe("GET /health", () => {
    it("returns ok status", async () => {
      const res = await request(app).get("/health");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ status: "ok" });
    });
  });

  // ==========================================================================
  // POST /api/occurrences
  // ==========================================================================
  describe("POST /api/occurrences", () => {
    it("returns 400 when latitude is missing", async () => {
      const res = await request(app)
        .post("/api/occurrences")
        .send({ longitude: -122.4194 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details).toContainEqual(
        expect.objectContaining({ path: "latitude" })
      );
    });

    it("returns 400 when longitude is missing", async () => {
      const res = await request(app)
        .post("/api/occurrences")
        .send({ latitude: 37.7749 });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Validation failed");
      expect(res.body.details).toContainEqual(
        expect.objectContaining({ path: "longitude" })
      );
    });

    it("returns 401 when not authenticated", async () => {
      const res = await request(app).post("/api/occurrences").send({
        scientificName: "Quercus agrifolia",
        latitude: 37.7749,
        longitude: -122.4194,
        notes: "Test observation",
      });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Authentication required to create observations");
    });

    it("creates AT Protocol record when authenticated", async () => {
      const mockAgent = {
        com: {
          atproto: {
            repo: {
              createRecord: vi.fn().mockResolvedValue({
                data: {
                  uri: "at://did:plc:test/org.rwell.test.occurrence/abc123",
                  cid: "bafytest123",
                },
              }),
            },
          },
        },
      };
      mockOAuthService.getAgent.mockResolvedValue(mockAgent);

      const res = await request(app)
        .post("/api/occurrences")
        .set("Cookie", ["session_did=did:plc:test"])
        .send({
          scientificName: "Quercus agrifolia",
          latitude: 37.7749,
          longitude: -122.4194,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.uri).toBe(
        "at://did:plc:test/org.rwell.test.occurrence/abc123"
      );
      expect(res.body.cid).toBe("bafytest123");
      expect(mockAgent.com.atproto.repo.createRecord).toHaveBeenCalledWith({
        repo: "did:plc:test",
        collection: "org.rwell.test.occurrence",
        record: expect.objectContaining({
          $type: "org.rwell.test.occurrence",
          scientificName: "Quercus agrifolia",
          location: expect.objectContaining({
            decimalLatitude: "37.7749",
            decimalLongitude: "-122.4194",
          }),
        }),
      });
    });

    it("handles AT Protocol errors gracefully", async () => {
      const mockAgent = {
        com: {
          atproto: {
            repo: {
              createRecord: vi
                .fn()
                .mockRejectedValue(new Error("Network error")),
            },
          },
        },
      };
      mockOAuthService.getAgent.mockResolvedValue(mockAgent);

      const res = await request(app)
        .post("/api/occurrences")
        .set("Cookie", ["session_did=did:plc:test"])
        .send({
          latitude: 37.7749,
          longitude: -122.4194,
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  // ==========================================================================
  // GET /api/occurrences/nearby
  // ==========================================================================
  describe("GET /api/occurrences/nearby", () => {
    it("returns 400 when lat is missing", async () => {
      const res = await request(app).get("/api/occurrences/nearby?lng=-122");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("lat and lng are required");
    });

    it("returns 400 when lng is missing", async () => {
      const res = await request(app).get("/api/occurrences/nearby?lat=37");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("lat and lng are required");
    });

    it("returns 400 for invalid lat (out of range)", async () => {
      const res = await request(app).get(
        "/api/occurrences/nearby?lat=100&lng=-122"
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid coordinates");
    });

    it("returns 400 for invalid lng (out of range)", async () => {
      const res = await request(app).get(
        "/api/occurrences/nearby?lat=37&lng=200"
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid coordinates");
    });

    it("returns empty array when no occurrences found", async () => {
      mockDatabase.getOccurrencesNearby.mockResolvedValue([]);

      const res = await request(app).get(
        "/api/occurrences/nearby?lat=37.7749&lng=-122.4194"
      );

      expect(res.status).toBe(200);
      expect(res.body.occurrences).toEqual([]);
      expect(res.body.meta).toEqual({
        lat: 37.7749,
        lng: -122.4194,
        radius: 10000,
        limit: 100,
        offset: 0,
        count: 0,
      });
    });

    it("returns occurrences with enriched data", async () => {
      const mockRow = {
        uri: "at://did:plc:test/org.rwell.test.occurrence/abc",
        cid: "bafytest",
        did: "did:plc:test",
        scientific_name: "Quercus agrifolia",
        event_date: new Date("2026-01-01"),
        latitude: 37.7749,
        longitude: -122.4194,
        coordinate_uncertainty_meters: 50,
        verbatim_locality: null,
        occurrence_remarks: null,
        associated_media: [],
        created_at: new Date("2026-01-01"),
      };
      mockDatabase.getOccurrencesNearby.mockResolvedValue([mockRow]);
      mockIdentityResolver.getProfiles.mockResolvedValue(
        new Map([
          [
            "did:plc:test",
            {
              did: "did:plc:test",
              handle: "test.bsky.social",
              displayName: "Test User",
            },
          ],
        ])
      );
      mockDatabase.getCommunityId.mockResolvedValue("Quercus agrifolia");

      const res = await request(app).get(
        "/api/occurrences/nearby?lat=37.7749&lng=-122.4194&radius=5000&limit=50&offset=10"
      );

      expect(res.status).toBe(200);
      expect(res.body.occurrences).toHaveLength(1);
      expect(res.body.occurrences[0]).toMatchObject({
        uri: "at://did:plc:test/org.rwell.test.occurrence/abc",
        observer: {
          did: "did:plc:test",
          handle: "test.bsky.social",
          displayName: "Test User",
        },
        scientificName: "Quercus agrifolia",
        communityId: "Quercus agrifolia",
        location: {
          latitude: 37.7749,
          longitude: -122.4194,
          uncertaintyMeters: 50,
        },
      });
      expect(res.body.meta).toEqual({
        lat: 37.7749,
        lng: -122.4194,
        radius: 5000,
        limit: 50,
        offset: 10,
        count: 1,
      });
    });

    it("handles database errors gracefully", async () => {
      mockDatabase.getOccurrencesNearby.mockRejectedValue(
        new Error("DB error")
      );

      const res = await request(app).get(
        "/api/occurrences/nearby?lat=37.7749&lng=-122.4194"
      );

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  // ==========================================================================
  // GET /api/occurrences/bbox
  // ==========================================================================
  describe("GET /api/occurrences/bbox", () => {
    it("returns 400 when bounding box params are missing", async () => {
      const res = await request(app).get(
        "/api/occurrences/bbox?minLat=37&minLng=-123&maxLat=38"
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe(
        "minLat, minLng, maxLat, maxLng are required"
      );
    });

    it("returns occurrences within bounding box", async () => {
      const mockRow = {
        uri: "at://did:plc:test/org.rwell.test.occurrence/abc",
        cid: "bafytest",
        did: "did:plc:test",
        scientific_name: "Quercus agrifolia",
        event_date: new Date("2026-01-01"),
        latitude: 37.7749,
        longitude: -122.4194,
        coordinate_uncertainty_meters: null,
        verbatim_locality: null,
        occurrence_remarks: null,
        associated_media: [],
        created_at: new Date("2026-01-01"),
      };
      mockDatabase.getOccurrencesByBoundingBox.mockResolvedValue([mockRow]);

      const res = await request(app).get(
        "/api/occurrences/bbox?minLat=37&minLng=-123&maxLat=38&maxLng=-122"
      );

      expect(res.status).toBe(200);
      expect(res.body.occurrences).toHaveLength(1);
      expect(res.body.meta).toEqual({
        bounds: { minLat: 37, minLng: -123, maxLat: 38, maxLng: -122 },
        count: 1,
      });
    });

    it("handles database errors gracefully", async () => {
      mockDatabase.getOccurrencesByBoundingBox.mockRejectedValue(
        new Error("DB error")
      );

      const res = await request(app).get(
        "/api/occurrences/bbox?minLat=37&minLng=-123&maxLat=38&maxLng=-122"
      );

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  // ==========================================================================
  // GET /api/occurrences/:uri
  // ==========================================================================
  describe("GET /api/occurrences/:uri", () => {
    it("returns 404 when occurrence not found", async () => {
      mockDatabase.getOccurrence.mockResolvedValue(null);

      const res = await request(app).get(
        "/api/occurrences/at://did:plc:test/org.rwell.test.occurrence/notfound"
      );

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Occurrence not found");
    });

    it("returns occurrence with identifications", async () => {
      const mockRow = {
        uri: "at://did:plc:test/org.rwell.test.occurrence/abc",
        cid: "bafytest",
        did: "did:plc:test",
        scientific_name: "Quercus agrifolia",
        event_date: new Date("2026-01-01"),
        latitude: 37.7749,
        longitude: -122.4194,
        coordinate_uncertainty_meters: null,
        verbatim_locality: null,
        occurrence_remarks: null,
        associated_media: [],
        created_at: new Date("2026-01-01"),
      };
      mockDatabase.getOccurrence.mockResolvedValue(mockRow);
      mockDatabase.getIdentificationsForOccurrence.mockResolvedValue([
        {
          uri: "at://did:plc:id/org.rwell.test.identification/123",
          did: "did:plc:id",
          taxon_name: "Quercus agrifolia",
          taxon_rank: "species",
          comment: "Looks correct",
          created_at: new Date("2026-01-02"),
        },
      ]);
      mockIdentityResolver.getProfiles.mockResolvedValue(
        new Map([
          [
            "did:plc:test",
            { did: "did:plc:test", handle: "observer.bsky.social" },
          ],
          ["did:plc:id", { did: "did:plc:id", handle: "identifier.bsky.social" }],
        ])
      );

      const res = await request(app).get(
        "/api/occurrences/at://did:plc:test/org.rwell.test.occurrence/abc"
      );

      expect(res.status).toBe(200);
      expect(res.body.occurrence).toBeDefined();
      expect(res.body.occurrence.uri).toBe(
        "at://did:plc:test/org.rwell.test.occurrence/abc"
      );
      expect(res.body.identifications).toHaveLength(1);
      expect(res.body.identifications[0].identifier.handle).toBe(
        "identifier.bsky.social"
      );
    });

    it("handles database errors gracefully", async () => {
      mockDatabase.getOccurrence.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get(
        "/api/occurrences/at://did:plc:test/org.rwell.test.occurrence/abc"
      );

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  // ==========================================================================
  // GET /api/occurrences/geojson
  // ==========================================================================
  describe("GET /api/occurrences/geojson", () => {
    it("returns 400 when bounding box params are missing", async () => {
      const res = await request(app).get(
        "/api/occurrences/geojson?minLat=37&minLng=-123"
      );

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Bounding box required");
    });

    it("returns GeoJSON FeatureCollection", async () => {
      const mockRows = [
        {
          uri: "at://did:plc:test/org.rwell.test.occurrence/abc",
          scientific_name: "Quercus agrifolia",
          basis_of_record: "HumanObservation",
          event_date: new Date("2026-01-01"),
          latitude: 37.7749,
          longitude: -122.4194,
        },
      ];
      mockDatabase.getOccurrencesByBoundingBox.mockResolvedValue(mockRows);

      const res = await request(app).get(
        "/api/occurrences/geojson?minLat=37&minLng=-123&maxLat=38&maxLng=-122"
      );

      expect(res.status).toBe(200);
      expect(res.body.type).toBe("FeatureCollection");
      expect(res.body.features).toHaveLength(1);
      expect(res.body.features[0]).toEqual({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [-122.4194, 37.7749],
        },
        properties: {
          uri: "at://did:plc:test/org.rwell.test.occurrence/abc",
          scientificName: "Quercus agrifolia",
          eventDate: "2026-01-01T00:00:00.000Z",
        },
      });
    });

    it("handles database errors gracefully", async () => {
      mockDatabase.getOccurrencesByBoundingBox.mockRejectedValue(
        new Error("DB error")
      );

      const res = await request(app).get(
        "/api/occurrences/geojson?minLat=37&minLng=-123&maxLat=38&maxLng=-122"
      );

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  // ==========================================================================
  // GET /api/identifications/:occurrenceUri
  // ==========================================================================
  describe("GET /api/identifications/:occurrenceUri", () => {
    it("returns identifications for an occurrence", async () => {
      mockDatabase.getIdentificationsForOccurrence.mockResolvedValue([
        {
          uri: "at://did:plc:id/org.rwell.test.identification/123",
          did: "did:plc:id",
          taxon_name: "Quercus agrifolia",
          taxon_rank: "species",
          comment: "Agreed",
          is_agreement: true,
          confidence: "high",
          created_at: new Date("2026-01-02"),
        },
      ]);
      mockIdentityResolver.getProfiles.mockResolvedValue(
        new Map([
          ["did:plc:id", { did: "did:plc:id", handle: "expert.bsky.social" }],
        ])
      );

      const res = await request(app).get(
        "/api/identifications/at://did:plc:test/org.rwell.test.occurrence/abc"
      );

      expect(res.status).toBe(200);
      expect(res.body.identifications).toHaveLength(1);
      expect(res.body.identifications[0].taxon_name).toBe("Quercus agrifolia");
      expect(res.body.identifications[0].identifier.handle).toBe(
        "expert.bsky.social"
      );
    });

    it("handles database errors gracefully", async () => {
      mockDatabase.getIdentificationsForOccurrence.mockRejectedValue(
        new Error("DB error")
      );

      const res = await request(app).get(
        "/api/identifications/at://did:plc:test/org.rwell.test.occurrence/abc"
      );

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  // ==========================================================================
  // GET /api/taxa/search
  // ==========================================================================
  describe("GET /api/taxa/search", () => {
    it("returns 400 when query is missing", async () => {
      const res = await request(app).get("/api/taxa/search");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Query must be at least 2 characters");
    });

    it("returns 400 when query is too short", async () => {
      const res = await request(app).get("/api/taxa/search?q=a");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Query must be at least 2 characters");
    });
  });

  // ==========================================================================
  // GET /api/taxa/validate
  // ==========================================================================
  describe("GET /api/taxa/validate", () => {
    it("returns 400 when name is missing", async () => {
      const res = await request(app).get("/api/taxa/validate");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("name parameter required");
    });
  });

  // ==========================================================================
  // Edge cases for enrichOccurrences
  // ==========================================================================
  describe("enrichOccurrences", () => {
    it("handles occurrences with image blobs", async () => {
      const mockRow = {
        uri: "at://did:plc:test/org.rwell.test.occurrence/abc",
        cid: "bafytest",
        did: "did:plc:test",
        scientific_name: null,
        event_date: new Date("2026-01-01"),
        latitude: 37.7749,
        longitude: -122.4194,
        coordinate_uncertainty_meters: null,
        verbatim_locality: "Golden Gate Park",
        occurrence_remarks: "Beautiful specimen",
        associated_media: [{ image: { ref: "blobref123" } }],
        created_at: new Date("2026-01-01"),
      };
      mockDatabase.getOccurrencesNearby.mockResolvedValue([mockRow]);

      const res = await request(app).get(
        "/api/occurrences/nearby?lat=37.7749&lng=-122.4194"
      );

      expect(res.status).toBe(200);
      expect(res.body.occurrences[0].images).toEqual([
        "/media/blob/did:plc:test/blobref123",
      ]);
      expect(res.body.occurrences[0].verbatimLocality).toBe("Golden Gate Park");
      expect(res.body.occurrences[0].occurrenceRemarks).toBe(
        "Beautiful specimen"
      );
    });

    it("handles empty occurrences array", async () => {
      mockDatabase.getOccurrencesNearby.mockResolvedValue([]);

      const res = await request(app).get(
        "/api/occurrences/nearby?lat=37.7749&lng=-122.4194"
      );

      expect(res.status).toBe(200);
      expect(res.body.occurrences).toEqual([]);
    });
  });
});
