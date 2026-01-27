import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createIdentificationRoutes } from "./identifications.js";

vi.mock("../middleware/logging.js", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

vi.mock("../enrichment.js", () => ({
  enrichIdentifications: vi.fn(),
}));

const mockRequireAuth = vi.fn((req, _res, next) => next());
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => mockRequireAuth(req, res, next),
}));

import { enrichIdentifications } from "../enrichment.js";

describe("identifications routes", () => {
  let app: express.Application;
  let mockDb: {
    getIdentificationsForOccurrence: ReturnType<typeof vi.fn>;
  };
  let mockCommunityId: {
    calculate: ReturnType<typeof vi.fn>;
  };
  let mockTaxonomy: {
    validate: ReturnType<typeof vi.fn>;
  };
  let mockInternalClient: {
    createRecord: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockDb = {
      getIdentificationsForOccurrence: vi.fn(),
    };

    mockCommunityId = {
      calculate: vi.fn(),
    };

    mockTaxonomy = {
      validate: vi.fn(),
    };

    mockInternalClient = {
      createRecord: vi.fn(),
    };

    mockRequireAuth.mockImplementation((req, _res, next) => {
      req.user = { did: "did:plc:sessionuser" };
      next();
    });

    app = express();
    app.use(express.json());
    app.use(
      "/identifications",
      createIdentificationRoutes(
        mockDb as any,
        mockCommunityId as any,
        mockTaxonomy as any,
        mockInternalClient as any
      )
    );
  });

  describe("POST /", () => {
    it("requires authentication", async () => {
      mockRequireAuth.mockImplementation((_req, res) => {
        res.status(401).json({ error: "Unauthorized" });
      });

      const res = await request(app)
        .post("/identifications")
        .send({
          occurrenceUri: "at://test",
          occurrenceCid: "cid123",
          taxonName: "Quercus alba",
        });

      expect(res.status).toBe(401);
    });

    it("creates identification successfully", async () => {
      mockTaxonomy.validate.mockResolvedValue({
        taxon: {
          id: "gbif:12345",
          commonName: "White Oak",
          kingdom: "Plantae",
          phylum: "Tracheophyta",
          class: "Magnoliopsida",
          order: "Fagales",
          family: "Fagaceae",
          genus: "Quercus",
        },
      });
      mockInternalClient.createRecord.mockResolvedValue({
        success: true,
        uri: "at://did:plc:sessionuser/org.rwell.test.identification/123",
        cid: "cid456",
      });

      const res = await request(app)
        .post("/identifications")
        .send({
          occurrenceUri: "at://did:plc:test/org.rwell.test.occurrence/1",
          occurrenceCid: "cid123",
          taxonName: "Quercus alba",
          taxonRank: "species",
          isAgreement: true,
          confidence: "high",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.uri).toBeDefined();
      expect(mockTaxonomy.validate).toHaveBeenCalledWith("Quercus alba");
    });

    it("creates identification with optional comment", async () => {
      mockTaxonomy.validate.mockResolvedValue({});
      mockInternalClient.createRecord.mockResolvedValue({
        success: true,
        uri: "at://test",
        cid: "cid123",
      });

      const res = await request(app)
        .post("/identifications")
        .send({
          occurrenceUri: "at://test",
          occurrenceCid: "cid123",
          taxonName: "Quercus alba",
          comment: "Based on leaf shape",
        });

      expect(res.status).toBe(201);
      const callArgs = mockInternalClient.createRecord.mock.calls[0];
      expect(callArgs[2].comment).toBe("Based on leaf shape");
    });

    it("creates identification with custom subjectIndex", async () => {
      mockTaxonomy.validate.mockResolvedValue({});
      mockInternalClient.createRecord.mockResolvedValue({
        success: true,
        uri: "at://test",
        cid: "cid123",
      });

      await request(app)
        .post("/identifications")
        .send({
          occurrenceUri: "at://test",
          occurrenceCid: "cid123",
          taxonName: "Quercus alba",
          subjectIndex: 2,
        });

      const callArgs = mockInternalClient.createRecord.mock.calls[0];
      expect(callArgs[2].subjectIndex).toBe(2);
    });

    it("returns 400 when occurrenceUri missing", async () => {
      const res = await request(app)
        .post("/identifications")
        .send({ occurrenceCid: "cid123", taxonName: "Quercus" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("occurrenceUri and occurrenceCid are required");
    });

    it("returns 400 when taxonName missing", async () => {
      const res = await request(app)
        .post("/identifications")
        .send({ occurrenceUri: "at://test", occurrenceCid: "cid123" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("taxonName is required");
    });

    it("returns 400 when taxonName empty", async () => {
      const res = await request(app)
        .post("/identifications")
        .send({ occurrenceUri: "at://test", occurrenceCid: "cid123", taxonName: "  " });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("taxonName is required");
    });

    it("returns 400 when taxonName too long", async () => {
      const res = await request(app)
        .post("/identifications")
        .send({
          occurrenceUri: "at://test",
          occurrenceCid: "cid123",
          taxonName: "a".repeat(257),
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("taxonName too long (max 256 characters)");
    });

    it("returns 400 when comment too long", async () => {
      const res = await request(app)
        .post("/identifications")
        .send({
          occurrenceUri: "at://test",
          occurrenceCid: "cid123",
          taxonName: "Quercus alba",
          comment: "a".repeat(3001),
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("comment too long (max 3000 characters)");
    });

    it("returns 500 when record creation fails", async () => {
      mockTaxonomy.validate.mockResolvedValue({});
      mockInternalClient.createRecord.mockResolvedValue({
        success: false,
        error: "Creation failed",
      });

      const res = await request(app)
        .post("/identifications")
        .send({
          occurrenceUri: "at://test",
          occurrenceCid: "cid123",
          taxonName: "Quercus alba",
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Creation failed");
    });

    it("returns 500 on error", async () => {
      mockTaxonomy.validate.mockRejectedValue(new Error("Taxonomy error"));

      const res = await request(app)
        .post("/identifications")
        .send({
          occurrenceUri: "at://test",
          occurrenceCid: "cid123",
          taxonName: "Quercus alba",
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });

  describe("GET /:occurrenceUri", () => {
    it("returns identifications with community ID", async () => {
      const identifications = [
        { uri: "at://id1", scientific_name: "Quercus alba" },
        { uri: "at://id2", scientific_name: "Quercus rubra" },
      ];
      mockDb.getIdentificationsForOccurrence.mockResolvedValue(identifications);
      vi.mocked(enrichIdentifications).mockResolvedValue(identifications as any);
      mockCommunityId.calculate.mockResolvedValue("Quercus alba");

      const res = await request(app).get(
        "/identifications/at://did:plc:test/org.rwell.test.occurrence/1"
      );

      expect(res.status).toBe(200);
      expect(res.body.identifications).toEqual(identifications);
      expect(res.body.communityId).toBe("Quercus alba");
    });

    it("returns null communityId when no consensus", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([]);
      vi.mocked(enrichIdentifications).mockResolvedValue([]);
      mockCommunityId.calculate.mockResolvedValue(null);

      const res = await request(app).get("/identifications/at://test");

      expect(res.status).toBe(200);
      expect(res.body.communityId).toBeNull();
    });

    it("returns 500 on error", async () => {
      mockDb.getIdentificationsForOccurrence.mockRejectedValue(new Error("DB error"));

      const res = await request(app).get("/identifications/at://test");

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });
});
