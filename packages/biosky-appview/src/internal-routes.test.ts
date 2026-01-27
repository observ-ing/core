import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { createInternalRoutes } from "./internal-routes.js";
import type { OAuthService } from "./auth/index.js";

describe("createInternalRoutes", () => {
  let app: express.Application;
  let mockOAuth: {
    getAgent: ReturnType<typeof vi.fn>;
  };
  let mockAgent: {
    uploadBlob: ReturnType<typeof vi.fn>;
    com: {
      atproto: {
        repo: {
          createRecord: ReturnType<typeof vi.fn>;
          putRecord: ReturnType<typeof vi.fn>;
          deleteRecord: ReturnType<typeof vi.fn>;
        };
      };
    };
  };

  const createMockAgent = () => ({
    uploadBlob: vi.fn(),
    com: {
      atproto: {
        repo: {
          createRecord: vi.fn(),
          putRecord: vi.fn(),
          deleteRecord: vi.fn(),
        },
      },
    },
  });

  beforeEach(() => {
    mockAgent = createMockAgent();
    mockOAuth = {
      getAgent: vi.fn().mockResolvedValue(mockAgent),
    };
  });

  const setupApp = (internalSecret?: string) => {
    app = express();
    app.use(express.json());
    const router = createInternalRoutes({
      oauth: mockOAuth as unknown as OAuthService,
      internalSecret,
    });
    app.use("/internal/agent", router);
  };

  describe("verifyInternal middleware", () => {
    it("allows requests when no secret is configured", async () => {
      setupApp(); // No secret
      mockAgent.uploadBlob.mockResolvedValue({
        data: { blob: { ref: "blobref", mimeType: "image/jpeg", size: 100 } },
      });

      const res = await request(app)
        .post("/internal/agent/upload-blob")
        .send({ did: "did:plc:test", data: "dGVzdA==", mimeType: "image/jpeg" });

      expect(res.status).toBe(200);
    });

    it("blocks requests with wrong secret", async () => {
      setupApp("correct-secret");

      const res = await request(app)
        .post("/internal/agent/upload-blob")
        .set("x-internal-secret", "wrong-secret")
        .send({ did: "did:plc:test", data: "dGVzdA==", mimeType: "image/jpeg" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden");
    });

    it("blocks requests with no secret header when secret is configured", async () => {
      setupApp("correct-secret");

      const res = await request(app)
        .post("/internal/agent/upload-blob")
        .send({ did: "did:plc:test", data: "dGVzdA==", mimeType: "image/jpeg" });

      expect(res.status).toBe(403);
      expect(res.body.error).toBe("Forbidden");
    });

    it("allows requests with correct secret", async () => {
      setupApp("correct-secret");
      mockAgent.uploadBlob.mockResolvedValue({
        data: { blob: { ref: "blobref", mimeType: "image/jpeg", size: 100 } },
      });

      const res = await request(app)
        .post("/internal/agent/upload-blob")
        .set("x-internal-secret", "correct-secret")
        .send({ did: "did:plc:test", data: "dGVzdA==", mimeType: "image/jpeg" });

      expect(res.status).toBe(200);
    });
  });

  describe("POST /upload-blob", () => {
    beforeEach(() => {
      setupApp();
    });

    it("returns 400 when did is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/upload-blob")
        .send({ data: "dGVzdA==", mimeType: "image/jpeg" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, data, and mimeType are required");
    });

    it("returns 400 when data is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/upload-blob")
        .send({ did: "did:plc:test", mimeType: "image/jpeg" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, data, and mimeType are required");
    });

    it("returns 400 when mimeType is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/upload-blob")
        .send({ did: "did:plc:test", data: "dGVzdA==" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, data, and mimeType are required");
    });

    it("returns 401 when session is invalid", async () => {
      mockOAuth.getAgent.mockResolvedValue(null);

      const res = await request(app)
        .post("/internal/agent/upload-blob")
        .send({ did: "did:plc:test", data: "dGVzdA==", mimeType: "image/jpeg" });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid session");
    });

    it("uploads blob and returns blob reference", async () => {
      const mockBlob = { ref: { $link: "blobcid" }, mimeType: "image/jpeg", size: 4 };
      mockAgent.uploadBlob.mockResolvedValue({ data: { blob: mockBlob } });

      const res = await request(app)
        .post("/internal/agent/upload-blob")
        .send({ did: "did:plc:test", data: "dGVzdA==", mimeType: "image/jpeg" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.blob).toEqual(mockBlob);
      expect(mockAgent.uploadBlob).toHaveBeenCalledWith(
        expect.any(Uint8Array),
        { encoding: "image/jpeg" }
      );
    });

    it("returns 500 on upload error", async () => {
      mockAgent.uploadBlob.mockRejectedValue(new Error("Upload failed"));

      const res = await request(app)
        .post("/internal/agent/upload-blob")
        .send({ did: "did:plc:test", data: "dGVzdA==", mimeType: "image/jpeg" });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to upload blob");
    });
  });

  describe("POST /create-record", () => {
    beforeEach(() => {
      setupApp();
    });

    it("returns 400 when did is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/create-record")
        .send({ collection: "app.test.record", record: { text: "hello" } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, collection, and record are required");
    });

    it("returns 400 when collection is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/create-record")
        .send({ did: "did:plc:test", record: { text: "hello" } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, collection, and record are required");
    });

    it("returns 400 when record is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/create-record")
        .send({ did: "did:plc:test", collection: "app.test.record" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, collection, and record are required");
    });

    it("returns 401 when session is invalid", async () => {
      mockOAuth.getAgent.mockResolvedValue(null);

      const res = await request(app)
        .post("/internal/agent/create-record")
        .send({
          did: "did:plc:test",
          collection: "app.test.record",
          record: { text: "hello" },
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid session");
    });

    it("creates record and returns uri and cid", async () => {
      mockAgent.com.atproto.repo.createRecord.mockResolvedValue({
        data: { uri: "at://did:plc:test/app.test.record/123", cid: "cid123" },
      });

      const res = await request(app)
        .post("/internal/agent/create-record")
        .send({
          did: "did:plc:test",
          collection: "app.test.record",
          record: { text: "hello" },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.uri).toBe("at://did:plc:test/app.test.record/123");
      expect(res.body.cid).toBe("cid123");
      expect(mockAgent.com.atproto.repo.createRecord).toHaveBeenCalledWith({
        repo: "did:plc:test",
        collection: "app.test.record",
        record: { text: "hello" },
      });
    });

    it("includes rkey when provided", async () => {
      mockAgent.com.atproto.repo.createRecord.mockResolvedValue({
        data: { uri: "at://did:plc:test/app.test.record/custom-key", cid: "cid123" },
      });

      const res = await request(app)
        .post("/internal/agent/create-record")
        .send({
          did: "did:plc:test",
          collection: "app.test.record",
          record: { text: "hello" },
          rkey: "custom-key",
        });

      expect(res.status).toBe(200);
      expect(mockAgent.com.atproto.repo.createRecord).toHaveBeenCalledWith({
        repo: "did:plc:test",
        collection: "app.test.record",
        record: { text: "hello" },
        rkey: "custom-key",
      });
    });

    it("returns 500 on create error", async () => {
      mockAgent.com.atproto.repo.createRecord.mockRejectedValue(new Error("Create failed"));

      const res = await request(app)
        .post("/internal/agent/create-record")
        .send({
          did: "did:plc:test",
          collection: "app.test.record",
          record: { text: "hello" },
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to create record");
    });
  });

  describe("POST /put-record", () => {
    beforeEach(() => {
      setupApp();
    });

    it("returns 400 when did is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/put-record")
        .send({ collection: "app.test.record", rkey: "123", record: { text: "hello" } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, collection, rkey, and record are required");
    });

    it("returns 400 when collection is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/put-record")
        .send({ did: "did:plc:test", rkey: "123", record: { text: "hello" } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, collection, rkey, and record are required");
    });

    it("returns 400 when rkey is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/put-record")
        .send({ did: "did:plc:test", collection: "app.test.record", record: { text: "hello" } });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, collection, rkey, and record are required");
    });

    it("returns 400 when record is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/put-record")
        .send({ did: "did:plc:test", collection: "app.test.record", rkey: "123" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, collection, rkey, and record are required");
    });

    it("returns 401 when session is invalid", async () => {
      mockOAuth.getAgent.mockResolvedValue(null);

      const res = await request(app)
        .post("/internal/agent/put-record")
        .send({
          did: "did:plc:test",
          collection: "app.test.record",
          rkey: "123",
          record: { text: "updated" },
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid session");
    });

    it("updates record and returns uri and cid", async () => {
      mockAgent.com.atproto.repo.putRecord.mockResolvedValue({
        data: { uri: "at://did:plc:test/app.test.record/123", cid: "newcid" },
      });

      const res = await request(app)
        .post("/internal/agent/put-record")
        .send({
          did: "did:plc:test",
          collection: "app.test.record",
          rkey: "123",
          record: { text: "updated" },
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.uri).toBe("at://did:plc:test/app.test.record/123");
      expect(res.body.cid).toBe("newcid");
      expect(mockAgent.com.atproto.repo.putRecord).toHaveBeenCalledWith({
        repo: "did:plc:test",
        collection: "app.test.record",
        rkey: "123",
        record: { text: "updated" },
      });
    });

    it("returns 500 on update error", async () => {
      mockAgent.com.atproto.repo.putRecord.mockRejectedValue(new Error("Update failed"));

      const res = await request(app)
        .post("/internal/agent/put-record")
        .send({
          did: "did:plc:test",
          collection: "app.test.record",
          rkey: "123",
          record: { text: "updated" },
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to update record");
    });
  });

  describe("POST /delete-record", () => {
    beforeEach(() => {
      setupApp();
    });

    it("returns 400 when did is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/delete-record")
        .send({ collection: "app.test.record", rkey: "123" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, collection, and rkey are required");
    });

    it("returns 400 when collection is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/delete-record")
        .send({ did: "did:plc:test", rkey: "123" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, collection, and rkey are required");
    });

    it("returns 400 when rkey is missing", async () => {
      const res = await request(app)
        .post("/internal/agent/delete-record")
        .send({ did: "did:plc:test", collection: "app.test.record" });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe("did, collection, and rkey are required");
    });

    it("returns 401 when session is invalid", async () => {
      mockOAuth.getAgent.mockResolvedValue(null);

      const res = await request(app)
        .post("/internal/agent/delete-record")
        .send({
          did: "did:plc:test",
          collection: "app.test.record",
          rkey: "123",
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe("Invalid session");
    });

    it("deletes record and returns success", async () => {
      mockAgent.com.atproto.repo.deleteRecord.mockResolvedValue({});

      const res = await request(app)
        .post("/internal/agent/delete-record")
        .send({
          did: "did:plc:test",
          collection: "app.test.record",
          rkey: "123",
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(mockAgent.com.atproto.repo.deleteRecord).toHaveBeenCalledWith({
        repo: "did:plc:test",
        collection: "app.test.record",
        rkey: "123",
      });
    });

    it("returns 500 on delete error", async () => {
      mockAgent.com.atproto.repo.deleteRecord.mockRejectedValue(new Error("Delete failed"));

      const res = await request(app)
        .post("/internal/agent/delete-record")
        .send({
          did: "did:plc:test",
          collection: "app.test.record",
          rkey: "123",
        });

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to delete record");
    });
  });
});
