import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { InternalClient } from "./internal-client.js";

vi.mock("./middleware/logging.js", () => ({
  logger: { error: vi.fn() },
}));

describe("InternalClient", () => {
  let client: InternalClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    client = new InternalClient({
      appviewUrl: "http://appview:3000",
      internalSecret: "secret123",
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("constructor", () => {
    it("stores appview URL and secret", () => {
      const c = new InternalClient({
        appviewUrl: "http://test:8080",
        internalSecret: "mysecret",
      });
      expect(c).toBeDefined();
    });

    it("works without internal secret", () => {
      const c = new InternalClient({ appviewUrl: "http://test:8080" });
      expect(c).toBeDefined();
    });
  });

  describe("uploadBlob", () => {
    it("uploads blob successfully", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, blob: { ref: "cid123" } }),
      });

      const result = await client.uploadBlob("did:plc:test", "base64data", "image/jpeg");

      expect(result).toEqual({ success: true, blob: { ref: "cid123" } });
      expect(mockFetch).toHaveBeenCalledWith(
        "http://appview:3000/internal/agent/upload-blob",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Internal-Secret": "secret123",
          },
          body: JSON.stringify({
            did: "did:plc:test",
            data: "base64data",
            mimeType: "image/jpeg",
          }),
        }
      );
    });

    it("returns error on failure", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: "Upload failed" }),
      });

      const result = await client.uploadBlob("did:plc:test", "data", "image/jpeg");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Upload failed");
    });

    it("handles network errors", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await client.uploadBlob("did:plc:test", "data", "image/jpeg");

      expect(result.success).toBe(false);
      expect(result.error).toContain("Network error");
    });
  });

  describe("createRecord", () => {
    it("creates record successfully", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            uri: "at://did:plc:test/collection/123",
            cid: "cid456",
          }),
      });

      const result = await client.createRecord(
        "did:plc:test",
        "org.rwell.test.occurrence",
        { field: "value" }
      );

      expect(result).toEqual({
        success: true,
        uri: "at://did:plc:test/collection/123",
        cid: "cid456",
      });
    });

    it("includes rkey when provided", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true, uri: "uri", cid: "cid" }),
      });

      await client.createRecord(
        "did:plc:test",
        "org.rwell.test.occurrence",
        { field: "value" },
        "custom-rkey"
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.rkey).toBe("custom-rkey");
    });

    it("returns error on failure", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: "Invalid record" }),
      });

      const result = await client.createRecord(
        "did:plc:test",
        "collection",
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Invalid record");
    });
  });

  describe("putRecord", () => {
    it("updates record successfully", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            success: true,
            uri: "at://did:plc:test/collection/123",
            cid: "cidnew",
          }),
      });

      const result = await client.putRecord(
        "did:plc:test",
        "org.rwell.test.occurrence",
        "123",
        { updated: true }
      );

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://appview:3000/internal/agent/put-record",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            did: "did:plc:test",
            collection: "org.rwell.test.occurrence",
            rkey: "123",
            record: { updated: true },
          }),
        })
      );
    });

    it("returns error on failure", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        json: () => Promise.resolve({ error: "Record not found" }),
      });

      const result = await client.putRecord(
        "did:plc:test",
        "collection",
        "123",
        {}
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Record not found");
    });
  });

  describe("deleteRecord", () => {
    it("deletes record successfully", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const result = await client.deleteRecord(
        "did:plc:test",
        "org.rwell.test.occurrence",
        "123"
      );

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledWith(
        "http://appview:3000/internal/agent/delete-record",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({
            did: "did:plc:test",
            collection: "org.rwell.test.occurrence",
            rkey: "123",
          }),
        })
      );
    });

    it("returns error on failure", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ error: "Not authorized" }),
      });

      const result = await client.deleteRecord(
        "did:plc:test",
        "collection",
        "123"
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Not authorized");
    });
  });

  describe("without internal secret", () => {
    it("does not include secret header", async () => {
      const clientNoSecret = new InternalClient({
        appviewUrl: "http://appview:3000",
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      await clientNoSecret.deleteRecord("did:plc:test", "collection", "123");

      const headers = mockFetch.mock.calls[0][1].headers;
      expect(headers["X-Internal-Secret"]).toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("handles non-JSON error responses", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        json: () => Promise.reject(new Error("Not JSON")),
      });

      const result = await client.createRecord("did:plc:test", "coll", {});

      expect(result.success).toBe(false);
      expect(result.error).toContain("Unknown error");
    });
  });
});
