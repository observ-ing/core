import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createProfileRoutes } from "./profiles.js";

vi.mock("../middleware/logging.js", () => ({
  logger: { error: vi.fn() },
}));

vi.mock("../enrichment.js", () => ({
  enrichOccurrences: vi.fn(),
  enrichIdentifications: vi.fn(),
}));

const mockGetProfile = vi.fn();
vi.mock("biosky-shared", async (importOriginal) => {
  const actual = await importOriginal<typeof import("biosky-shared")>();
  return {
    ...actual,
    getIdentityResolver: () => ({
      getProfile: mockGetProfile,
    }),
  };
});

import { enrichOccurrences, enrichIdentifications } from "../enrichment.js";

describe("profiles routes", () => {
  let app: express.Application;
  let mockDb: {
    getProfileFeed: ReturnType<typeof vi.fn>;
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

  const createMockIdentificationRow = (overrides = {}) => ({
    uri: "at://did:plc:test/org.rwell.test.identification/1",
    cid: "cid456",
    did: "did:plc:test",
    subject_uri: "at://did:plc:other/org.rwell.test.occurrence/1",
    scientific_name: "Quercus alba",
    date_identified: new Date("2024-01-16T12:00:00Z"),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      getProfileFeed: vi.fn(),
    };

    app = express();
    app.use("/profiles", createProfileRoutes(mockDb as any));
  });

  describe("GET /:did/feed", () => {
    it("returns profile feed with occurrences and identifications", async () => {
      const occurrences = [createMockOccurrenceRow()];
      const identifications = [createMockIdentificationRow()];
      const enrichedOccurrences = [{ uri: "at://...", observer: { did: "did:plc:test" } }];
      const enrichedIdentifications = [{ uri: "at://...", identifier: { did: "did:plc:test" } }];

      mockDb.getProfileFeed.mockResolvedValue({
        occurrences,
        identifications,
        counts: { observations: 5, identifications: 3 },
      });
      vi.mocked(enrichOccurrences).mockResolvedValue(enrichedOccurrences as any);
      vi.mocked(enrichIdentifications).mockResolvedValue(enrichedIdentifications as any);
      mockGetProfile.mockResolvedValue({
        did: "did:plc:test",
        handle: "alice.bsky.social",
        displayName: "Alice",
        avatar: "https://avatar.url",
      });

      const res = await request(app).get("/profiles/did:plc:test/feed");

      expect(res.status).toBe(200);
      expect(res.body.profile).toEqual({
        did: "did:plc:test",
        handle: "alice.bsky.social",
        displayName: "Alice",
        avatar: "https://avatar.url",
      });
      expect(res.body.counts).toEqual({ observations: 5, identifications: 3 });
      expect(res.body.occurrences).toEqual(enrichedOccurrences);
      expect(res.body.identifications).toEqual(enrichedIdentifications);
    });

    it("handles missing profile gracefully", async () => {
      mockDb.getProfileFeed.mockResolvedValue({
        occurrences: [],
        identifications: [],
        counts: { observations: 0, identifications: 0 },
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);
      vi.mocked(enrichIdentifications).mockResolvedValue([]);
      mockGetProfile.mockResolvedValue(null);

      const res = await request(app).get("/profiles/did:plc:unknown/feed");

      expect(res.status).toBe(200);
      expect(res.body.profile).toEqual({ did: "did:plc:unknown" });
    });

    it("respects type=observations filter", async () => {
      mockDb.getProfileFeed.mockResolvedValue({
        occurrences: [createMockOccurrenceRow()],
        identifications: [],
        counts: { observations: 1, identifications: 0 },
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);
      vi.mocked(enrichIdentifications).mockResolvedValue([]);
      mockGetProfile.mockResolvedValue(null);

      await request(app).get("/profiles/did:plc:test/feed?type=observations");

      expect(mockDb.getProfileFeed).toHaveBeenCalledWith("did:plc:test", {
        limit: 20,
        type: "observations",
      });
    });

    it("respects type=identifications filter", async () => {
      mockDb.getProfileFeed.mockResolvedValue({
        occurrences: [],
        identifications: [createMockIdentificationRow()],
        counts: { observations: 0, identifications: 1 },
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);
      vi.mocked(enrichIdentifications).mockResolvedValue([]);
      mockGetProfile.mockResolvedValue(null);

      await request(app).get("/profiles/did:plc:test/feed?type=identifications");

      expect(mockDb.getProfileFeed).toHaveBeenCalledWith("did:plc:test", {
        limit: 20,
        type: "identifications",
      });
    });

    it("respects limit parameter with max of 100", async () => {
      mockDb.getProfileFeed.mockResolvedValue({
        occurrences: [],
        identifications: [],
        counts: { observations: 0, identifications: 0 },
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);
      vi.mocked(enrichIdentifications).mockResolvedValue([]);
      mockGetProfile.mockResolvedValue(null);

      await request(app).get("/profiles/did:plc:test/feed?limit=50");
      expect(mockDb.getProfileFeed).toHaveBeenCalledWith("did:plc:test", {
        limit: 50,
        type: "all",
      });

      await request(app).get("/profiles/did:plc:test/feed?limit=200");
      expect(mockDb.getProfileFeed).toHaveBeenLastCalledWith("did:plc:test", {
        limit: 100,
        type: "all",
      });
    });

    it("respects cursor parameter", async () => {
      mockDb.getProfileFeed.mockResolvedValue({
        occurrences: [],
        identifications: [],
        counts: { observations: 0, identifications: 0 },
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);
      vi.mocked(enrichIdentifications).mockResolvedValue([]);
      mockGetProfile.mockResolvedValue(null);

      await request(app).get(
        "/profiles/did:plc:test/feed?cursor=2024-01-01T00:00:00.000Z"
      );

      expect(mockDb.getProfileFeed).toHaveBeenCalledWith("did:plc:test", {
        limit: 20,
        type: "all",
        cursor: "2024-01-01T00:00:00.000Z",
      });
    });

    it("returns cursor for observations when type=observations", async () => {
      const occurrences = Array(20)
        .fill(null)
        .map((_, i) => ({
          ...createMockOccurrenceRow(),
          created_at: new Date(`2024-01-${String(i + 1).padStart(2, "0")}T12:00:00Z`),
        }));
      mockDb.getProfileFeed.mockResolvedValue({
        occurrences,
        identifications: [],
        counts: { observations: 20, identifications: 0 },
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);
      vi.mocked(enrichIdentifications).mockResolvedValue([]);
      mockGetProfile.mockResolvedValue(null);

      const res = await request(app).get(
        "/profiles/did:plc:test/feed?type=observations"
      );

      expect(res.body.cursor).toBe("2024-01-20T12:00:00.000Z");
    });

    it("returns cursor for identifications when type=identifications", async () => {
      const identifications = Array(20)
        .fill(null)
        .map((_, i) => ({
          ...createMockIdentificationRow(),
          date_identified: new Date(`2024-01-${String(i + 1).padStart(2, "0")}T12:00:00Z`),
        }));
      mockDb.getProfileFeed.mockResolvedValue({
        occurrences: [],
        identifications,
        counts: { observations: 0, identifications: 20 },
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);
      vi.mocked(enrichIdentifications).mockResolvedValue([]);
      mockGetProfile.mockResolvedValue(null);

      const res = await request(app).get(
        "/profiles/did:plc:test/feed?type=identifications"
      );

      expect(res.body.cursor).toBe("2024-01-20T12:00:00.000Z");
    });

    it("returns cursor from older item when type=all", async () => {
      const occurrences = [
        createMockOccurrenceRow({
          created_at: new Date("2024-01-15T12:00:00Z"),
        }),
      ];
      const identifications = [
        createMockIdentificationRow({
          date_identified: new Date("2024-01-16T12:00:00Z"),
        }),
      ];
      mockDb.getProfileFeed.mockResolvedValue({
        occurrences,
        identifications,
        counts: { observations: 1, identifications: 1 },
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);
      vi.mocked(enrichIdentifications).mockResolvedValue([]);
      mockGetProfile.mockResolvedValue(null);

      const res = await request(app).get("/profiles/did:plc:test/feed?type=all");

      // Should return the older cursor (occurrence created_at)
      expect(res.body.cursor).toBe("2024-01-15T12:00:00.000Z");
    });

    it("returns no cursor when empty results", async () => {
      mockDb.getProfileFeed.mockResolvedValue({
        occurrences: [],
        identifications: [],
        counts: { observations: 0, identifications: 0 },
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);
      vi.mocked(enrichIdentifications).mockResolvedValue([]);
      mockGetProfile.mockResolvedValue(null);

      const res = await request(app).get("/profiles/did:plc:test/feed");

      expect(res.body.cursor).toBeUndefined();
    });

    it("handles URL-encoded DIDs", async () => {
      mockDb.getProfileFeed.mockResolvedValue({
        occurrences: [],
        identifications: [],
        counts: { observations: 0, identifications: 0 },
      });
      vi.mocked(enrichOccurrences).mockResolvedValue([]);
      vi.mocked(enrichIdentifications).mockResolvedValue([]);
      mockGetProfile.mockResolvedValue(null);

      await request(app).get("/profiles/did%3Aplc%3Atest/feed");

      expect(mockDb.getProfileFeed).toHaveBeenCalledWith("did:plc:test", {
        limit: 20,
        type: "all",
      });
    });

    it("returns 500 on error", async () => {
      mockDb.getProfileFeed.mockRejectedValue(new Error("Database error"));

      const res = await request(app).get("/profiles/did:plc:test/feed");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });
});
