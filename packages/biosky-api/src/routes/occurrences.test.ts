import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createOccurrenceRoutes } from "./occurrences.js";

vi.mock("../middleware/logging.js", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

vi.mock("../enrichment.js", () => ({
  enrichOccurrences: vi.fn(),
  enrichIdentifications: vi.fn(),
  enrichComments: vi.fn(),
}));

const mockRequireAuth = vi.fn((req, _res, next) => next());
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => mockRequireAuth(req, res, next),
}));

const mockGetProfiles = vi.fn();
vi.mock("biosky-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("biosky-shared")>();
  return {
    ...actual,
    getIdentityResolver: () => ({
      getProfiles: mockGetProfiles,
    }),
  };
});

import { enrichOccurrences, enrichIdentifications, enrichComments } from "../enrichment.js";

describe("occurrences routes", () => {
  let app: express.Application;
  let mockDb: {
    getOccurrence: ReturnType<typeof vi.fn>;
    getOccurrenceObservers: ReturnType<typeof vi.fn>;
    getOccurrencesNearby: ReturnType<typeof vi.fn>;
    getOccurrencesFeed: ReturnType<typeof vi.fn>;
    getOccurrencesByBoundingBox: ReturnType<typeof vi.fn>;
    getIdentificationsForOccurrence: ReturnType<typeof vi.fn>;
    getCommentsForOccurrence: ReturnType<typeof vi.fn>;
    saveOccurrencePrivateData: ReturnType<typeof vi.fn>;
    syncOccurrenceObservers: ReturnType<typeof vi.fn>;
  };
  let mockTaxonomy: {
    validate: ReturnType<typeof vi.fn>;
  };
  let mockGeocoding: {
    reverseGeocode: ReturnType<typeof vi.fn>;
  };
  let mockInternalClient: {
    uploadBlob: ReturnType<typeof vi.fn>;
    createRecord: ReturnType<typeof vi.fn>;
  };

  const createMockOccurrenceRow = (overrides = {}) => ({
    uri: "at://did:plc:test/org.rwell.test.occurrence/1",
    cid: "cid123",
    did: "did:plc:test",
    scientific_name: "Quercus alba",
    latitude: 40.7128,
    longitude: -74.006,
    event_date: new Date("2024-01-15"),
    created_at: new Date("2024-01-15T12:00:00Z"),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      getOccurrence: vi.fn(),
      getOccurrenceObservers: vi.fn(),
      getOccurrencesNearby: vi.fn(),
      getOccurrencesFeed: vi.fn(),
      getOccurrencesByBoundingBox: vi.fn(),
      getIdentificationsForOccurrence: vi.fn(),
      getCommentsForOccurrence: vi.fn(),
      saveOccurrencePrivateData: vi.fn(),
      syncOccurrenceObservers: vi.fn(),
    };

    mockTaxonomy = {
      validate: vi.fn(),
    };

    mockGeocoding = {
      reverseGeocode: vi.fn(),
    };

    mockInternalClient = {
      uploadBlob: vi.fn(),
      createRecord: vi.fn(),
    };

    mockRequireAuth.mockImplementation((req, _res, next) => {
      req.user = { did: "did:plc:sessionuser" };
      next();
    });

    app = express();
    app.use(express.json());
    app.use(
      "/occurrences",
      createOccurrenceRoutes(
        mockDb as any,
        mockTaxonomy as any,
        mockGeocoding as any,
        mockInternalClient as any
      )
    );
  });

  describe("GET /:uri/observers", () => {
    it("returns observers for occurrence", async () => {
      mockDb.getOccurrence.mockResolvedValue(createMockOccurrenceRow());
      mockDb.getOccurrenceObservers.mockResolvedValue([
        { did: "did:plc:owner", role: "owner", addedAt: new Date("2024-01-15") },
        { did: "did:plc:coobs", role: "co-observer", addedAt: new Date("2024-01-15") },
      ]);
      mockGetProfiles.mockResolvedValue(
        new Map([
          ["did:plc:owner", { did: "did:plc:owner", handle: "owner.bsky.social" }],
          ["did:plc:coobs", { did: "did:plc:coobs", handle: "coobs.bsky.social" }],
        ])
      );

      const res = await request(app).get(
        "/occurrences/at://did:plc:test/org.rwell.test.occurrence/1/observers"
      );

      expect(res.status).toBe(200);
      expect(res.body.observers).toHaveLength(2);
      expect(res.body.observers[0].role).toBe("owner");
      expect(res.body.observers[0].handle).toBe("owner.bsky.social");
    });

    it("returns 404 when occurrence not found", async () => {
      mockDb.getOccurrence.mockResolvedValue(null);

      const res = await request(app).get("/occurrences/at://nonexistent/observers");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Occurrence not found");
    });

    it("returns 500 on error", async () => {
      mockDb.getOccurrence.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get("/occurrences/at://test/observers");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  describe("GET /nearby", () => {
    it("returns nearby occurrences", async () => {
      const rows = [createMockOccurrenceRow()];
      const enriched = [{ uri: "at://...", observer: { did: "did:plc:test" } }];
      mockDb.getOccurrencesNearby.mockResolvedValue(rows);
      vi.mocked(enrichOccurrences).mockResolvedValue(enriched as any);

      const res = await request(app).get("/occurrences/nearby?lat=40.7&lng=-74.0");

      expect(res.status).toBe(200);
      expect(res.body.occurrences).toEqual(enriched);
      expect(res.body.meta).toEqual({
        lat: 40.7,
        lng: -74.0,
        radius: 10000,
        limit: 100,
        offset: 0,
        count: 1,
      });
    });

    it("respects custom radius, limit, and offset", async () => {
      mockDb.getOccurrencesNearby.mockResolvedValue([]);
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      await request(app).get(
        "/occurrences/nearby?lat=40.7&lng=-74.0&radius=5000&limit=50&offset=10"
      );

      expect(mockDb.getOccurrencesNearby).toHaveBeenCalledWith(40.7, -74.0, 5000, 50, 10);
    });

    it("returns 400 when lat/lng missing", async () => {
      const res = await request(app).get("/occurrences/nearby");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("lat and lng are required");
    });

    it("returns 400 for invalid coordinates", async () => {
      const res = await request(app).get("/occurrences/nearby?lat=91&lng=-74.0");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid coordinates");
    });

    it("returns 500 on error", async () => {
      mockDb.getOccurrencesNearby.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get("/occurrences/nearby?lat=40.7&lng=-74.0");

      expect(res.status).toBe(500);
    });
  });

  describe("GET /feed", () => {
    it("returns occurrence feed", async () => {
      const rows = [createMockOccurrenceRow()];
      const enriched = [{ uri: "at://...", observer: { did: "did:plc:test" } }];
      mockDb.getOccurrencesFeed.mockResolvedValue(rows);
      vi.mocked(enrichOccurrences).mockResolvedValue(enriched as any);

      const res = await request(app).get("/occurrences/feed");

      expect(res.status).toBe(200);
      expect(res.body.occurrences).toEqual(enriched);
      expect(mockDb.getOccurrencesFeed).toHaveBeenCalledWith(20, undefined);
    });

    it("respects limit and cursor", async () => {
      mockDb.getOccurrencesFeed.mockResolvedValue([]);
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      await request(app).get("/occurrences/feed?limit=50&cursor=2024-01-01T00:00:00Z");

      expect(mockDb.getOccurrencesFeed).toHaveBeenCalledWith(50, "2024-01-01T00:00:00Z");
    });

    it("caps limit at 100", async () => {
      mockDb.getOccurrencesFeed.mockResolvedValue([]);
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      await request(app).get("/occurrences/feed?limit=200");

      expect(mockDb.getOccurrencesFeed).toHaveBeenCalledWith(100, undefined);
    });

    it("returns cursor when more results exist", async () => {
      const rows = Array(20)
        .fill(null)
        .map((_, i) => ({
          ...createMockOccurrenceRow(),
          created_at: new Date(`2024-01-${String(i + 1).padStart(2, "0")}T12:00:00Z`),
        }));
      mockDb.getOccurrencesFeed.mockResolvedValue(rows);
      vi.mocked(enrichOccurrences).mockResolvedValue(rows as any);

      const res = await request(app).get("/occurrences/feed");

      expect(res.body.cursor).toBe("2024-01-20T12:00:00.000Z");
    });

    it("returns 500 on error", async () => {
      mockDb.getOccurrencesFeed.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get("/occurrences/feed");

      expect(res.status).toBe(500);
    });
  });

  describe("GET /bbox", () => {
    it("returns occurrences in bounding box", async () => {
      const rows = [createMockOccurrenceRow()];
      const enriched = [{ uri: "at://...", observer: { did: "did:plc:test" } }];
      mockDb.getOccurrencesByBoundingBox.mockResolvedValue(rows);
      vi.mocked(enrichOccurrences).mockResolvedValue(enriched as any);

      const res = await request(app).get(
        "/occurrences/bbox?minLat=40&minLng=-75&maxLat=41&maxLng=-73"
      );

      expect(res.status).toBe(200);
      expect(res.body.occurrences).toEqual(enriched);
      expect(res.body.meta.bounds).toEqual({
        minLat: 40,
        minLng: -75,
        maxLat: 41,
        maxLng: -73,
      });
    });

    it("returns 400 when bounds missing", async () => {
      const res = await request(app).get("/occurrences/bbox?minLat=40");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("minLat, minLng, maxLat, maxLng are required");
    });

    it("returns 500 on error", async () => {
      mockDb.getOccurrencesByBoundingBox.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get(
        "/occurrences/bbox?minLat=40&minLng=-75&maxLat=41&maxLng=-73"
      );

      expect(res.status).toBe(500);
    });
  });

  describe("GET /geojson", () => {
    it("returns GeoJSON FeatureCollection", async () => {
      const rows = [
        createMockOccurrenceRow({
          uri: "at://did:plc:test/org.rwell.test.occurrence/1",
          latitude: 40.7128,
          longitude: -74.006,
        }),
      ];
      mockDb.getOccurrencesByBoundingBox.mockResolvedValue(rows);

      const res = await request(app).get(
        "/occurrences/geojson?minLat=40&minLng=-75&maxLat=41&maxLng=-73"
      );

      expect(res.status).toBe(200);
      expect(res.body.type).toBe("FeatureCollection");
      expect(res.body.features).toHaveLength(1);
      expect(res.body.features[0].type).toBe("Feature");
      expect(res.body.features[0].geometry.type).toBe("Point");
      expect(res.body.features[0].geometry.coordinates).toEqual([-74.006, 40.7128]);
    });

    it("returns 400 when bounds missing", async () => {
      const res = await request(app).get("/occurrences/geojson");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Bounding box required");
    });

    it("returns 500 on error", async () => {
      mockDb.getOccurrencesByBoundingBox.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get(
        "/occurrences/geojson?minLat=40&minLng=-75&maxLat=41&maxLng=-73"
      );

      expect(res.status).toBe(500);
    });
  });

  describe("POST /", () => {
    it("requires authentication", async () => {
      mockRequireAuth.mockImplementation((_req, res) => {
        res.status(401).json({ error: "Unauthorized" });
      });

      const res = await request(app)
        .post("/occurrences")
        .send({ latitude: 40.7, longitude: -74.0 });

      expect(res.status).toBe(401);
    });

    it("creates occurrence with minimal data", async () => {
      mockGeocoding.reverseGeocode.mockResolvedValue({
        continent: "North America",
        country: "United States",
        countryCode: "US",
        stateProvince: "New York",
      });
      mockInternalClient.createRecord.mockResolvedValue({
        success: true,
        uri: "at://did:plc:sessionuser/org.rwell.test.occurrence/123",
        cid: "cid123",
      });
      mockDb.saveOccurrencePrivateData.mockResolvedValue(undefined);
      mockDb.syncOccurrenceObservers.mockResolvedValue(undefined);

      const res = await request(app)
        .post("/occurrences")
        .send({ latitude: 40.7, longitude: -74.0 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.uri).toBeDefined();
    });

    it("creates occurrence with taxonomy and identification", async () => {
      mockTaxonomy.validate.mockResolvedValue({
        taxon: {
          id: "gbif:12345",
          rank: "SPECIES",
          commonName: "White Oak",
          kingdom: "Plantae",
        },
      });
      mockGeocoding.reverseGeocode.mockResolvedValue({});
      mockInternalClient.createRecord
        .mockResolvedValueOnce({
          success: true,
          uri: "at://did:plc:sessionuser/org.rwell.test.occurrence/123",
          cid: "cid123",
        })
        .mockResolvedValueOnce({
          success: true,
          uri: "at://did:plc:sessionuser/org.rwell.test.identification/456",
          cid: "cid456",
        });
      mockDb.saveOccurrencePrivateData.mockResolvedValue(undefined);
      mockDb.syncOccurrenceObservers.mockResolvedValue(undefined);

      const res = await request(app)
        .post("/occurrences")
        .send({
          latitude: 40.7,
          longitude: -74.0,
          scientificName: "Quercus alba",
        });

      expect(res.status).toBe(201);
      expect(res.body.identificationUri).toBeDefined();
      expect(mockInternalClient.createRecord).toHaveBeenCalledTimes(2);
    });

    it("uploads images as blobs", async () => {
      mockGeocoding.reverseGeocode.mockResolvedValue({});
      mockInternalClient.uploadBlob.mockResolvedValue({
        success: true,
        blob: { ref: "blobcid123" },
      });
      mockInternalClient.createRecord.mockResolvedValue({
        success: true,
        uri: "at://did:plc:sessionuser/org.rwell.test.occurrence/123",
        cid: "cid123",
      });
      mockDb.saveOccurrencePrivateData.mockResolvedValue(undefined);
      mockDb.syncOccurrenceObservers.mockResolvedValue(undefined);

      const res = await request(app)
        .post("/occurrences")
        .send({
          latitude: 40.7,
          longitude: -74.0,
          images: [{ data: "base64data", mimeType: "image/jpeg" }],
        });

      expect(res.status).toBe(201);
      expect(mockInternalClient.uploadBlob).toHaveBeenCalledWith(
        "did:plc:sessionuser",
        "base64data",
        "image/jpeg"
      );
    });

    it("syncs co-observers", async () => {
      mockGeocoding.reverseGeocode.mockResolvedValue({});
      mockInternalClient.createRecord.mockResolvedValue({
        success: true,
        uri: "at://did:plc:sessionuser/org.rwell.test.occurrence/123",
        cid: "cid123",
      });
      mockDb.saveOccurrencePrivateData.mockResolvedValue(undefined);
      mockDb.syncOccurrenceObservers.mockResolvedValue(undefined);

      await request(app)
        .post("/occurrences")
        .send({
          latitude: 40.7,
          longitude: -74.0,
          recordedBy: ["did:plc:coobs1", "did:plc:coobs2"],
        });

      expect(mockDb.syncOccurrenceObservers).toHaveBeenCalledWith(
        expect.any(String),
        "did:plc:sessionuser",
        ["did:plc:coobs1", "did:plc:coobs2"]
      );
    });

    it("returns 400 when coordinates missing", async () => {
      const res = await request(app).post("/occurrences").send({});

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("latitude and longitude are required");
    });

    it("returns 500 when record creation fails", async () => {
      mockGeocoding.reverseGeocode.mockResolvedValue({});
      mockInternalClient.createRecord.mockResolvedValue({
        success: false,
        error: "Creation failed",
      });

      const res = await request(app)
        .post("/occurrences")
        .send({ latitude: 40.7, longitude: -74.0 });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Creation failed");
    });

    it("returns 500 on error", async () => {
      mockGeocoding.reverseGeocode.mockRejectedValue(new Error("Geocoding failed"));

      const res = await request(app)
        .post("/occurrences")
        .send({ latitude: 40.7, longitude: -74.0 });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  describe("GET /:uri", () => {
    it("returns single occurrence with identifications and comments", async () => {
      const row = createMockOccurrenceRow();
      const enrichedOccurrence = { uri: "at://...", observer: { did: "did:plc:test" } };
      const identifications = [{ uri: "at://id", scientific_name: "Quercus alba" }];
      const comments = [{ uri: "at://comment", body: "Nice find!" }];

      mockDb.getOccurrence.mockResolvedValue(row);
      vi.mocked(enrichOccurrences).mockResolvedValue([enrichedOccurrence as any]);
      mockDb.getIdentificationsForOccurrence.mockResolvedValue(identifications);
      mockDb.getCommentsForOccurrence.mockResolvedValue(comments);
      vi.mocked(enrichIdentifications).mockResolvedValue(identifications as any);
      vi.mocked(enrichComments).mockResolvedValue(comments as any);

      const res = await request(app).get(
        "/occurrences/at://did:plc:test/org.rwell.test.occurrence/1"
      );

      expect(res.status).toBe(200);
      expect(res.body.occurrence).toEqual(enrichedOccurrence);
      expect(res.body.identifications).toEqual(identifications);
      expect(res.body.comments).toEqual(comments);
    });

    it("returns 404 when occurrence not found", async () => {
      mockDb.getOccurrence.mockResolvedValue(null);

      const res = await request(app).get("/occurrences/at://nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Occurrence not found");
    });

    it("returns 500 on error", async () => {
      mockDb.getOccurrence.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get("/occurrences/at://test");

      expect(res.status).toBe(500);
    });
  });
});
