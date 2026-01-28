import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createTaxonomyRoutes } from "./taxonomy.js";

vi.mock("../middleware/logging.js", () => ({
  logger: { error: vi.fn() },
}));

vi.mock("../enrichment.js", () => ({
  enrichOccurrences: vi.fn(),
}));

import { enrichOccurrences } from "../enrichment.js";

describe("taxonomy routes", () => {
  let app: express.Application;
  let mockDb: {
    countOccurrencesByTaxon: ReturnType<typeof vi.fn>;
    getOccurrencesByTaxon: ReturnType<typeof vi.fn>;
  };
  let mockTaxonomy: {
    search: ReturnType<typeof vi.fn>;
    validate: ReturnType<typeof vi.fn>;
    getById: ReturnType<typeof vi.fn>;
    getByName: ReturnType<typeof vi.fn>;
  };

  const createMockTaxon = (overrides = {}) => ({
    id: "Plantae/Quercus alba",
    scientificName: "Quercus alba",
    rank: "SPECIES",
    kingdom: "Plantae",
    phylum: "Tracheophyta",
    class: "Magnoliopsida",
    order: "Fagales",
    family: "Fagaceae",
    genus: "Quercus",
    vernacularName: "White Oak",
    gbifUrl: "https://www.gbif.org/species/12345",
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      countOccurrencesByTaxon: vi.fn(),
      getOccurrencesByTaxon: vi.fn(),
    };

    mockTaxonomy = {
      search: vi.fn(),
      validate: vi.fn(),
      getById: vi.fn(),
      getByName: vi.fn(),
    };

    app = express();
    app.use("/taxonomy", createTaxonomyRoutes(mockDb as any, mockTaxonomy as any));
  });

  describe("GET /search", () => {
    it("returns search results", async () => {
      const results = [
        createMockTaxon(),
        createMockTaxon({ id: "Plantae/Quercus rubra", scientificName: "Quercus rubra" }),
      ];
      mockTaxonomy.search.mockResolvedValue(results);

      const res = await request(app).get("/taxonomy/search?q=Quercus");

      expect(res.status).toBe(200);
      expect(res.body.results).toHaveLength(2);
      expect(mockTaxonomy.search).toHaveBeenCalledWith("Quercus");
    });

    it("returns 400 if query missing", async () => {
      const res = await request(app).get("/taxonomy/search");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Query must be at least 2 characters");
    });

    it("returns 400 if query too short", async () => {
      const res = await request(app).get("/taxonomy/search?q=Q");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Query must be at least 2 characters");
    });

    it("returns empty results for no matches", async () => {
      mockTaxonomy.search.mockResolvedValue([]);

      const res = await request(app).get("/taxonomy/search?q=nonexistent");

      expect(res.status).toBe(200);
      expect(res.body.results).toEqual([]);
    });

    it("returns 500 on error", async () => {
      mockTaxonomy.search.mockRejectedValue(new Error("Search failed"));

      const res = await request(app).get("/taxonomy/search?q=Quercus");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  describe("GET /validate", () => {
    it("returns valid result for exact match", async () => {
      const taxon = createMockTaxon();
      mockTaxonomy.validate.mockResolvedValue({
        valid: true,
        taxon,
        suggestions: [],
      });

      const res = await request(app).get("/taxonomy/validate?name=Quercus%20alba");

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.taxon.scientificName).toBe("Quercus alba");
    });

    it("returns invalid with suggestions for partial match", async () => {
      mockTaxonomy.validate.mockResolvedValue({
        valid: false,
        suggestions: [
          createMockTaxon(),
          createMockTaxon({ id: "Plantae/Quercus rubra", scientificName: "Quercus rubra" }),
        ],
      });

      const res = await request(app).get("/taxonomy/validate?name=Quercus");

      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(false);
      expect(res.body.suggestions).toHaveLength(2);
    });

    it("returns 400 if name missing", async () => {
      const res = await request(app).get("/taxonomy/validate");

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("name parameter required");
    });

    it("returns 500 on error", async () => {
      mockTaxonomy.validate.mockRejectedValue(new Error("Validation failed"));

      const res = await request(app).get("/taxonomy/validate?name=test");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  describe("GET /:kingdom/:name", () => {
    it("returns taxon by kingdom and name", async () => {
      const taxon = createMockTaxon();
      mockTaxonomy.getByName.mockResolvedValue(taxon);
      mockDb.countOccurrencesByTaxon.mockResolvedValue(42);

      const res = await request(app).get("/taxonomy/Plantae/Quercus%20alba");

      expect(res.status).toBe(200);
      expect(res.body.scientificName).toBe("Quercus alba");
      expect(res.body.observationCount).toBe(42);
      expect(mockTaxonomy.getByName).toHaveBeenCalledWith("Quercus alba", "Plantae");
    });

    it("returns 404 when taxon not found", async () => {
      mockTaxonomy.getByName.mockResolvedValue(null);

      const res = await request(app).get("/taxonomy/Plantae/Nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Taxon not found");
    });

    it("returns 500 on error", async () => {
      mockTaxonomy.getByName.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get("/taxonomy/Plantae/Quercus%20alba");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  describe("GET /:id (backward compat)", () => {
    it("returns taxon by GBIF ID", async () => {
      const taxon = createMockTaxon();
      mockTaxonomy.getById.mockResolvedValue(taxon);
      mockDb.countOccurrencesByTaxon.mockResolvedValue(42);

      const res = await request(app).get("/taxonomy/gbif:12345");

      expect(res.status).toBe(200);
      expect(res.body.scientificName).toBe("Quercus alba");
      expect(res.body.observationCount).toBe(42);
      expect(mockTaxonomy.getById).toHaveBeenCalledWith("gbif:12345");
    });

    it("looks up taxon by name via getByName", async () => {
      const taxon = createMockTaxon();
      mockTaxonomy.getByName.mockResolvedValue(taxon);
      mockDb.countOccurrencesByTaxon.mockResolvedValue(10);

      const res = await request(app).get("/taxonomy/Plantae");

      expect(res.status).toBe(200);
      expect(mockTaxonomy.getByName).toHaveBeenCalledWith("Plantae");
    });

    it("passes kingdom to countOccurrencesByTaxon for disambiguation", async () => {
      const taxon = createMockTaxon({ kingdom: "Animalia" });
      mockTaxonomy.getById.mockResolvedValue(taxon);
      mockDb.countOccurrencesByTaxon.mockResolvedValue(7);

      const res = await request(app).get("/taxonomy/gbif:12345");

      expect(res.status).toBe(200);
      expect(mockDb.countOccurrencesByTaxon).toHaveBeenCalledWith(
        "Quercus alba",
        "SPECIES",
        "Animalia"
      );
    });

    it("passes undefined kingdom when taxon has no kingdom", async () => {
      const taxon = createMockTaxon({ kingdom: undefined });
      mockTaxonomy.getById.mockResolvedValue(taxon);
      mockDb.countOccurrencesByTaxon.mockResolvedValue(0);

      await request(app).get("/taxonomy/gbif:12345");

      expect(mockDb.countOccurrencesByTaxon).toHaveBeenCalledWith(
        "Quercus alba",
        "SPECIES",
        undefined
      );
    });

    it("returns 404 when taxon not found by ID", async () => {
      mockTaxonomy.getById.mockResolvedValue(null);

      const res = await request(app).get("/taxonomy/gbif:nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Taxon not found");
    });

    it("returns 404 when getByName returns null", async () => {
      mockTaxonomy.getByName.mockResolvedValue(null);

      const res = await request(app).get("/taxonomy/nonexistent");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Taxon not found");
    });

    it("returns 500 on error", async () => {
      mockTaxonomy.getById.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get("/taxonomy/gbif:12345");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  describe("GET /:kingdom/:name/occurrences", () => {
    const createMockOccurrenceRow = () => ({
      uri: "at://did:plc:test/org.rwell.test.occurrence/1",
      cid: "cid123",
      did: "did:plc:test",
      scientific_name: "Quercus alba",
      event_date: new Date("2024-01-15"),
      created_at: new Date("2024-01-15T12:00:00Z"),
    });

    it("returns occurrences for taxon by kingdom and name", async () => {
      const taxon = createMockTaxon();
      const rows = [createMockOccurrenceRow()];
      const enrichedOccurrences = [{ uri: "at://...", observer: { did: "did:plc:test" } }];

      mockTaxonomy.getByName.mockResolvedValue(taxon);
      mockDb.getOccurrencesByTaxon.mockResolvedValue(rows);
      vi.mocked(enrichOccurrences).mockResolvedValue(enrichedOccurrences as any);

      const res = await request(app).get("/taxonomy/Plantae/Quercus%20alba/occurrences");

      expect(res.status).toBe(200);
      expect(res.body.occurrences).toEqual(enrichedOccurrences);
      expect(mockTaxonomy.getByName).toHaveBeenCalledWith("Quercus alba", "Plantae");
      expect(mockDb.getOccurrencesByTaxon).toHaveBeenCalledWith(
        "Quercus alba",
        "SPECIES",
        { limit: 20, kingdom: "Plantae" }
      );
    });

    it("returns 404 when taxon not found", async () => {
      mockTaxonomy.getByName.mockResolvedValue(null);

      const res = await request(app).get("/taxonomy/Plantae/Nonexistent/occurrences");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Taxon not found");
    });
  });

  describe("GET /:id/occurrences (backward compat)", () => {
    const createMockOccurrenceRow = () => ({
      uri: "at://did:plc:test/org.rwell.test.occurrence/1",
      cid: "cid123",
      did: "did:plc:test",
      scientific_name: "Quercus alba",
      event_date: new Date("2024-01-15"),
      created_at: new Date("2024-01-15T12:00:00Z"),
    });

    it("returns occurrences for taxon by GBIF ID", async () => {
      const taxon = createMockTaxon();
      const rows = [createMockOccurrenceRow()];
      const enrichedOccurrences = [{ uri: "at://...", observer: { did: "did:plc:test" } }];

      mockTaxonomy.getById.mockResolvedValue(taxon);
      mockDb.getOccurrencesByTaxon.mockResolvedValue(rows);
      vi.mocked(enrichOccurrences).mockResolvedValue(enrichedOccurrences as any);

      const res = await request(app).get("/taxonomy/gbif:12345/occurrences");

      expect(res.status).toBe(200);
      expect(res.body.occurrences).toEqual(enrichedOccurrences);
      expect(mockDb.getOccurrencesByTaxon).toHaveBeenCalledWith(
        "Quercus alba",
        "SPECIES",
        { limit: 20, kingdom: "Plantae" }
      );
    });

    it("respects cursor parameter", async () => {
      const taxon = createMockTaxon();
      mockTaxonomy.getById.mockResolvedValue(taxon);
      mockDb.getOccurrencesByTaxon.mockResolvedValue([]);
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      await request(app).get(
        "/taxonomy/gbif:12345/occurrences?cursor=2024-01-01T00:00:00.000Z"
      );

      expect(mockDb.getOccurrencesByTaxon).toHaveBeenCalledWith(
        "Quercus alba",
        "SPECIES",
        { limit: 20, cursor: "2024-01-01T00:00:00.000Z", kingdom: "Plantae" }
      );
    });

    it("respects limit parameter with max of 100", async () => {
      const taxon = createMockTaxon();
      mockTaxonomy.getById.mockResolvedValue(taxon);
      mockDb.getOccurrencesByTaxon.mockResolvedValue([]);
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      await request(app).get("/taxonomy/gbif:12345/occurrences?limit=50");
      expect(mockDb.getOccurrencesByTaxon).toHaveBeenCalledWith(
        "Quercus alba",
        "SPECIES",
        { limit: 50, kingdom: "Plantae" }
      );

      await request(app).get("/taxonomy/gbif:12345/occurrences?limit=200");
      expect(mockDb.getOccurrencesByTaxon).toHaveBeenLastCalledWith(
        "Quercus alba",
        "SPECIES",
        { limit: 100, kingdom: "Plantae" }
      );
    });

    it("returns cursor when more results exist", async () => {
      const taxon = createMockTaxon();
      const rows = Array(20)
        .fill(null)
        .map((_, i) => ({
          ...createMockOccurrenceRow(),
          created_at: new Date(`2024-01-${String(i + 1).padStart(2, "0")}T12:00:00Z`),
        }));
      mockTaxonomy.getById.mockResolvedValue(taxon);
      mockDb.getOccurrencesByTaxon.mockResolvedValue(rows);
      vi.mocked(enrichOccurrences).mockResolvedValue(rows as any);

      const res = await request(app).get("/taxonomy/gbif:12345/occurrences");

      expect(res.body.cursor).toBe("2024-01-20T12:00:00.000Z");
    });

    it("returns no cursor when fewer results than limit", async () => {
      const taxon = createMockTaxon();
      const rows = [createMockOccurrenceRow()];
      mockTaxonomy.getById.mockResolvedValue(taxon);
      mockDb.getOccurrencesByTaxon.mockResolvedValue(rows);
      vi.mocked(enrichOccurrences).mockResolvedValue(rows as any);

      const res = await request(app).get("/taxonomy/gbif:12345/occurrences");

      expect(res.body.cursor).toBeUndefined();
    });

    it("passes kingdom to getOccurrencesByTaxon for disambiguation", async () => {
      const taxon = createMockTaxon({ kingdom: "Animalia" });
      mockTaxonomy.getById.mockResolvedValue(taxon);
      mockDb.getOccurrencesByTaxon.mockResolvedValue([]);
      vi.mocked(enrichOccurrences).mockResolvedValue([]);

      await request(app).get("/taxonomy/gbif:12345/occurrences");

      expect(mockDb.getOccurrencesByTaxon).toHaveBeenCalledWith(
        "Quercus alba",
        "SPECIES",
        { limit: 20, kingdom: "Animalia" }
      );
    });

    it("returns 404 when taxon not found", async () => {
      mockTaxonomy.getById.mockResolvedValue(null);

      const res = await request(app).get("/taxonomy/gbif:nonexistent/occurrences");

      expect(res.status).toBe(404);
      expect(res.body.error).toBe("Taxon not found");
    });

    it("returns 500 on error", async () => {
      mockTaxonomy.getById.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get("/taxonomy/gbif:12345/occurrences");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });
});
