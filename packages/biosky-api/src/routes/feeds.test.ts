import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createFeedRoutes } from "./feeds.js";

vi.mock("../middleware/logging.js", () => ({
  logger: { error: vi.fn() },
}));

vi.mock("../enrichment.js", () => ({
  enrichOccurrences: vi.fn(),
}));

// Mock requireAuth to optionally set user
const mockRequireAuth = vi.fn((req, _res, next) => next());
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => mockRequireAuth(req, res, next),
}));

const mockGetFollows = vi.fn();
vi.mock("biosky-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("biosky-shared")>();
  return {
    ...actual,
    getIdentityResolver: () => ({
      getFollows: mockGetFollows,
    }),
  };
});

import { enrichOccurrences } from "../enrichment.js";

describe("feeds routes", () => {
  let app: express.Application;
  let mockDb: {
    getExploreFeed: ReturnType<typeof vi.fn>;
    getHomeFeed: ReturnType<typeof vi.fn>;
  };

  const createMockOccurrenceRow = (overrides = {}) => ({
    uri: "at://did:plc:test/org.rwell.test.occurrence/1",
    cid: "cid123",
    did: "did:plc:test",
    scientific_name: "Quercus alba",
    event_date: new Date("2024-01-15"),
    created_at: new Date("2024-01-15T12:00:00Z"),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      getExploreFeed: vi.fn(),
      getHomeFeed: vi.fn(),
    };

    // Default: pass auth and set user
    mockRequireAuth.mockImplementation((req, _res, next) => {
      req.user = { did: "did:plc:sessionuser" };
      next();
    });

    app = express();
    app.use("/feeds", createFeedRoutes(mockDb as any));
  });

  describe("GET /explore", () => {
    it("returns explore feed", async () => {
      const rows = [createMockOccurrenceRow()];
      const enrichedOccurrences = [{ uri: "at://...", observer: { did: "did:plc:test" } }];

      mockDb.getExploreFeed.mockResolvedValue(rows);
      vi.mocked(enrichOccurrences).mockResolvedValue(enrichedOccurrences as any);

      const res = await request(app).get("/feeds/explore");

      expect(res.status).toBe(200);
      expect(res.body.occurrences).toEqual(enrichedOccurrences);
      expect(res.body.meta.filters).toEqual({ taxon: undefined, location: undefined });
    });

    it("passes filters to database", async () => {
      mockDb.getExploreFeed.mockResolvedValue([]);
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      await request(app).get(
        "/feeds/explore?taxon=Quercus&lat=40.7&lng=-74.0&radius=5000"
      );

      expect(mockDb.getExploreFeed).toHaveBeenCalledWith({
        limit: 20,
        taxon: "Quercus",
        lat: 40.7,
        lng: -74.0,
        radius: 5000,
      });
    });

    it("returns filter metadata in response", async () => {
      mockDb.getExploreFeed.mockResolvedValue([]);
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      const res = await request(app).get(
        "/feeds/explore?taxon=Quercus&lat=40.7&lng=-74.0"
      );

      expect(res.body.meta.filters).toEqual({
        taxon: "Quercus",
        location: { lat: 40.7, lng: -74.0, radius: 10000 },
      });
    });

    it("respects limit parameter with max of 100", async () => {
      mockDb.getExploreFeed.mockResolvedValue([]);
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      await request(app).get("/feeds/explore?limit=50");
      expect(mockDb.getExploreFeed).toHaveBeenCalledWith({ limit: 50 });

      await request(app).get("/feeds/explore?limit=200");
      expect(mockDb.getExploreFeed).toHaveBeenLastCalledWith({ limit: 100 });
    });

    it("respects cursor parameter", async () => {
      mockDb.getExploreFeed.mockResolvedValue([]);
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      await request(app).get("/feeds/explore?cursor=2024-01-01T00:00:00.000Z");

      expect(mockDb.getExploreFeed).toHaveBeenCalledWith({
        limit: 20,
        cursor: "2024-01-01T00:00:00.000Z",
      });
    });

    it("returns cursor when more results exist", async () => {
      const rows = Array(20)
        .fill(null)
        .map((_, i) => ({
          ...createMockOccurrenceRow(),
          created_at: new Date(`2024-01-${String(i + 1).padStart(2, "0")}T12:00:00Z`),
        }));
      mockDb.getExploreFeed.mockResolvedValue(rows);
      vi.mocked(enrichOccurrences).mockResolvedValue(rows as any);

      const res = await request(app).get("/feeds/explore");

      expect(res.body.cursor).toBe("2024-01-20T12:00:00.000Z");
    });

    it("returns no cursor when fewer results than limit", async () => {
      const rows = [createMockOccurrenceRow()];
      mockDb.getExploreFeed.mockResolvedValue(rows);
      vi.mocked(enrichOccurrences).mockResolvedValue(rows as any);

      const res = await request(app).get("/feeds/explore");

      expect(res.body.cursor).toBeUndefined();
    });

    it("returns 500 on error", async () => {
      mockDb.getExploreFeed.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/feeds/explore");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  describe("GET /home", () => {
    it("requires authentication", async () => {
      mockRequireAuth.mockImplementation((_req, res) => {
        res.status(401).json({ error: "Unauthorized" });
      });

      const res = await request(app).get("/feeds/home");

      expect(res.status).toBe(401);
    });

    it("returns home feed with followed users", async () => {
      const rows = [createMockOccurrenceRow()];
      const enrichedOccurrences = [{ uri: "at://...", observer: { did: "did:plc:test" } }];

      mockGetFollows.mockResolvedValue(["did:plc:friend1", "did:plc:friend2"]);
      mockDb.getHomeFeed.mockResolvedValue({
        rows,
        followedCount: 5,
        nearbyCount: 3,
      });
      vi.mocked(enrichOccurrences).mockResolvedValue(enrichedOccurrences as any);

      const res = await request(app).get("/feeds/home");

      expect(res.status).toBe(200);
      expect(res.body.occurrences).toEqual(enrichedOccurrences);
      expect(res.body.meta).toEqual({ followedCount: 5, nearbyCount: 3 });
      expect(mockGetFollows).toHaveBeenCalledWith("did:plc:sessionuser");
      expect(mockDb.getHomeFeed).toHaveBeenCalledWith(
        ["did:plc:friend1", "did:plc:friend2"],
        { limit: 20 }
      );
    });

    it("passes location parameters for nearby feed", async () => {
      mockGetFollows.mockResolvedValue([]);
      mockDb.getHomeFeed.mockResolvedValue({
        rows: [],
        followedCount: 0,
        nearbyCount: 0,
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      await request(app).get("/feeds/home?lat=40.7&lng=-74.0&nearbyRadius=5000");

      expect(mockDb.getHomeFeed).toHaveBeenCalledWith([], {
        limit: 20,
        lat: 40.7,
        lng: -74.0,
        nearbyRadius: 5000,
      });
    });

    it("respects limit parameter with max of 100", async () => {
      mockGetFollows.mockResolvedValue([]);
      mockDb.getHomeFeed.mockResolvedValue({
        rows: [],
        followedCount: 0,
        nearbyCount: 0,
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      await request(app).get("/feeds/home?limit=50");
      expect(mockDb.getHomeFeed).toHaveBeenCalledWith([], { limit: 50 });

      await request(app).get("/feeds/home?limit=200");
      expect(mockDb.getHomeFeed).toHaveBeenLastCalledWith([], { limit: 100 });
    });

    it("respects cursor parameter", async () => {
      mockGetFollows.mockResolvedValue([]);
      mockDb.getHomeFeed.mockResolvedValue({
        rows: [],
        followedCount: 0,
        nearbyCount: 0,
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      await request(app).get("/feeds/home?cursor=2024-01-01T00:00:00.000Z");

      expect(mockDb.getHomeFeed).toHaveBeenCalledWith([], {
        limit: 20,
        cursor: "2024-01-01T00:00:00.000Z",
      });
    });

    it("returns cursor when more results exist", async () => {
      const rows = Array(20)
        .fill(null)
        .map((_, i) => ({
          ...createMockOccurrenceRow(),
          created_at: new Date(`2024-01-${String(i + 1).padStart(2, "0")}T12:00:00Z`),
        }));
      mockGetFollows.mockResolvedValue([]);
      mockDb.getHomeFeed.mockResolvedValue({
        rows,
        followedCount: 0,
        nearbyCount: 20,
      });
      vi.mocked(enrichOccurrences).mockResolvedValue(rows as any);

      const res = await request(app).get("/feeds/home");

      expect(res.body.cursor).toBe("2024-01-20T12:00:00.000Z");
    });

    it("returns no cursor when fewer results than limit", async () => {
      mockGetFollows.mockResolvedValue([]);
      mockDb.getHomeFeed.mockResolvedValue({
        rows: [createMockOccurrenceRow()],
        followedCount: 0,
        nearbyCount: 1,
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      const res = await request(app).get("/feeds/home");

      expect(res.body.cursor).toBeUndefined();
    });

    it("returns 500 on error", async () => {
      mockGetFollows.mockRejectedValue(new Error("Identity error"));

      const res = await request(app).get("/feeds/home");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });
});
