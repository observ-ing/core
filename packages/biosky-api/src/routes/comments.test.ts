import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createCommentRoutes } from "./comments.js";

vi.mock("../middleware/logging.js", () => ({
  logger: { error: vi.fn(), info: vi.fn() },
}));

const mockRequireAuth = vi.fn((req, _res, next) => next());
vi.mock("../middleware/auth.js", () => ({
  requireAuth: (req: any, res: any, next: any) => mockRequireAuth(req, res, next),
}));

describe("comments routes", () => {
  let app: express.Application;
  let mockInternalClient: {
    createRecord: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockInternalClient = {
      createRecord: vi.fn(),
    };

    mockRequireAuth.mockImplementation((req, _res, next) => {
      req.user = { did: "did:plc:sessionuser" };
      next();
    });

    app = express();
    app.use(express.json());
    app.use("/comments", createCommentRoutes(mockInternalClient as any));
  });

  describe("POST /", () => {
    it("requires authentication", async () => {
      mockRequireAuth.mockImplementation((_req, res) => {
        res.status(401).json({ error: "Unauthorized" });
      });

      const res = await request(app)
        .post("/comments")
        .send({
          occurrenceUri: "at://test",
          occurrenceCid: "cid123",
          body: "Great observation!",
        });

      expect(res.status).toBe(401);
    });

    it("creates comment successfully", async () => {
      mockInternalClient.createRecord.mockResolvedValue({
        success: true,
        uri: "at://did:plc:sessionuser/org.rwell.test.comment/123",
        cid: "cid456",
      });

      const res = await request(app)
        .post("/comments")
        .send({
          occurrenceUri: "at://did:plc:test/org.rwell.test.occurrence/1",
          occurrenceCid: "cid123",
          body: "Great observation!",
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.uri).toBeDefined();
      expect(mockInternalClient.createRecord).toHaveBeenCalledWith(
        "did:plc:sessionuser",
        "org.rwell.test.comment",
        expect.objectContaining({
          $type: "org.rwell.test.comment",
          body: "Great observation!",
          subject: {
            uri: "at://did:plc:test/org.rwell.test.occurrence/1",
            cid: "cid123",
          },
        })
      );
    });

    it("creates comment with reply reference", async () => {
      mockInternalClient.createRecord.mockResolvedValue({
        success: true,
        uri: "at://test",
        cid: "cid123",
      });

      await request(app)
        .post("/comments")
        .send({
          occurrenceUri: "at://test/occurrence",
          occurrenceCid: "occ-cid",
          body: "Reply to your comment",
          replyToUri: "at://test/comment",
          replyToCid: "reply-cid",
        });

      const callArgs = mockInternalClient.createRecord.mock.calls[0];
      expect(callArgs[2].replyTo).toEqual({
        uri: "at://test/comment",
        cid: "reply-cid",
      });
    });

    it("trims whitespace from body", async () => {
      mockInternalClient.createRecord.mockResolvedValue({
        success: true,
        uri: "at://test",
        cid: "cid123",
      });

      await request(app)
        .post("/comments")
        .send({
          occurrenceUri: "at://test",
          occurrenceCid: "cid123",
          body: "  Nice find!  ",
        });

      const callArgs = mockInternalClient.createRecord.mock.calls[0];
      expect(callArgs[2].body).toBe("Nice find!");
    });

    it("returns 400 when occurrenceUri missing", async () => {
      const res = await request(app)
        .post("/comments")
        .send({ occurrenceCid: "cid123", body: "Comment" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("occurrenceUri and occurrenceCid are required");
    });

    it("returns 400 when occurrenceCid missing", async () => {
      const res = await request(app)
        .post("/comments")
        .send({ occurrenceUri: "at://test", body: "Comment" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("occurrenceUri and occurrenceCid are required");
    });

    it("returns 400 when body missing", async () => {
      const res = await request(app)
        .post("/comments")
        .send({ occurrenceUri: "at://test", occurrenceCid: "cid123" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("body is required");
    });

    it("returns 400 when body empty", async () => {
      const res = await request(app)
        .post("/comments")
        .send({ occurrenceUri: "at://test", occurrenceCid: "cid123", body: "   " });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("body is required");
    });

    it("returns 400 when body too long", async () => {
      const res = await request(app)
        .post("/comments")
        .send({
          occurrenceUri: "at://test",
          occurrenceCid: "cid123",
          body: "a".repeat(3001),
        });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("body too long (max 3000 characters)");
    });

    it("returns 500 when record creation fails", async () => {
      mockInternalClient.createRecord.mockResolvedValue({
        success: false,
        error: "Creation failed",
      });

      const res = await request(app)
        .post("/comments")
        .send({
          occurrenceUri: "at://test",
          occurrenceCid: "cid123",
          body: "Great find!",
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Creation failed");
    });

    it("returns 500 on error", async () => {
      mockInternalClient.createRecord.mockRejectedValue(new Error("Network error"));

      const res = await request(app)
        .post("/comments")
        .send({
          occurrenceUri: "at://test",
          occurrenceCid: "cid123",
          body: "Great find!",
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Internal server error");
    });
  });
});
