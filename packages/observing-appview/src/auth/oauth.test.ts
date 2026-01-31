import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import cookieParser from "cookie-parser";
import {
  MemoryStateStore,
  MemorySessionStore,
  DatabaseStateStore,
  DatabaseSessionStore,
  OAuthService,
  type SessionData,
  type DatabaseLike,
} from "./oauth.js";

describe("OAuth stores", () => {
  describe("MemoryStateStore", () => {
    let store: MemoryStateStore;

    beforeEach(() => {
      store = new MemoryStateStore();
    });

    it("stores and retrieves values", async () => {
      await store.set("key1", "value1");
      const result = await store.get("key1");
      expect(result).toBe("value1");
    });

    it("returns undefined for non-existent keys", async () => {
      const result = await store.get("nonexistent");
      expect(result).toBeUndefined();
    });

    it("deletes values", async () => {
      await store.set("key1", "value1");
      await store.del("key1");
      const result = await store.get("key1");
      expect(result).toBeUndefined();
    });

    it("expires values after TTL", async () => {
      vi.useFakeTimers();

      await store.set("key1", "value1", 1000); // 1 second TTL
      expect(await store.get("key1")).toBe("value1");

      vi.advanceTimersByTime(1001);
      expect(await store.get("key1")).toBeUndefined();

      vi.useRealTimers();
    });

    it("uses default TTL of 10 minutes", async () => {
      vi.useFakeTimers();

      await store.set("key1", "value1");
      vi.advanceTimersByTime(599999); // Just under 10 minutes
      expect(await store.get("key1")).toBe("value1");

      vi.advanceTimersByTime(2); // Push past 10 minutes
      expect(await store.get("key1")).toBeUndefined();

      vi.useRealTimers();
    });
  });

  describe("MemorySessionStore", () => {
    let store: MemorySessionStore;

    const mockSession: SessionData = {
      did: "did:plc:test",
      handle: "test.bsky.social",
      accessToken: "token123",
      expiresAt: Date.now() + 3600000,
    };

    beforeEach(() => {
      store = new MemorySessionStore();
    });

    it("stores and retrieves session data", async () => {
      await store.set("did:plc:test", mockSession);
      const result = await store.get("did:plc:test");
      expect(result).toEqual(mockSession);
    });

    it("returns undefined for non-existent sessions", async () => {
      const result = await store.get("nonexistent");
      expect(result).toBeUndefined();
    });

    it("deletes sessions", async () => {
      await store.set("did:plc:test", mockSession);
      await store.del("did:plc:test");
      const result = await store.get("did:plc:test");
      expect(result).toBeUndefined();
    });

    it("stores session with refresh token", async () => {
      const sessionWithRefresh: SessionData = {
        ...mockSession,
        refreshToken: "refresh123",
      };
      await store.set("did:plc:test", sessionWithRefresh);
      const result = await store.get("did:plc:test");
      expect(result?.refreshToken).toBe("refresh123");
    });
  });

  describe("DatabaseStateStore", () => {
    let store: DatabaseStateStore;
    let mockDb: {
      getOAuthState: ReturnType<typeof vi.fn>;
      setOAuthState: ReturnType<typeof vi.fn>;
      deleteOAuthState: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
      mockDb = {
        getOAuthState: vi.fn(),
        setOAuthState: vi.fn(),
        deleteOAuthState: vi.fn(),
      };
      store = new DatabaseStateStore(mockDb as unknown as DatabaseLike);
    });

    it("delegates get to database", async () => {
      mockDb.getOAuthState.mockResolvedValue("stored-value");
      const result = await store.get("key1");
      expect(result).toBe("stored-value");
      expect(mockDb.getOAuthState).toHaveBeenCalledWith("key1");
    });

    it("delegates set to database with TTL", async () => {
      await store.set("key1", "value1", 5000);
      expect(mockDb.setOAuthState).toHaveBeenCalledWith("key1", "value1", 5000);
    });

    it("uses default TTL when not specified", async () => {
      await store.set("key1", "value1");
      expect(mockDb.setOAuthState).toHaveBeenCalledWith("key1", "value1", 600000);
    });

    it("delegates del to database", async () => {
      await store.del("key1");
      expect(mockDb.deleteOAuthState).toHaveBeenCalledWith("key1");
    });
  });

  describe("DatabaseSessionStore", () => {
    let store: DatabaseSessionStore;
    let mockDb: {
      getOAuthSession: ReturnType<typeof vi.fn>;
      setOAuthSession: ReturnType<typeof vi.fn>;
      deleteOAuthSession: ReturnType<typeof vi.fn>;
    };

    const mockSession: SessionData = {
      did: "did:plc:test",
      handle: "test.bsky.social",
      accessToken: "token123",
      expiresAt: Date.now() + 3600000,
    };

    beforeEach(() => {
      mockDb = {
        getOAuthSession: vi.fn(),
        setOAuthSession: vi.fn(),
        deleteOAuthSession: vi.fn(),
      };
      store = new DatabaseSessionStore(mockDb as unknown as DatabaseLike);
    });

    it("parses JSON when getting session", async () => {
      mockDb.getOAuthSession.mockResolvedValue(JSON.stringify(mockSession));
      const result = await store.get("did:plc:test");
      expect(result).toEqual(mockSession);
    });

    it("returns undefined for non-existent sessions", async () => {
      mockDb.getOAuthSession.mockResolvedValue(undefined);
      const result = await store.get("nonexistent");
      expect(result).toBeUndefined();
    });

    it("serializes JSON when setting session", async () => {
      await store.set("did:plc:test", mockSession);
      expect(mockDb.setOAuthSession).toHaveBeenCalledWith(
        "did:plc:test",
        JSON.stringify(mockSession)
      );
    });

    it("delegates del to database", async () => {
      await store.del("did:plc:test");
      expect(mockDb.deleteOAuthSession).toHaveBeenCalledWith("did:plc:test");
    });
  });
});

describe("OAuthService", () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("loopback detection", () => {
    it("detects localhost as loopback", () => {
      const service = new OAuthService({ publicUrl: "http://localhost:3000" });
      expect(service.clientId).toContain("http://localhost?");
    });

    it("detects 127.0.0.1 as loopback", () => {
      const service = new OAuthService({ publicUrl: "http://127.0.0.1:3000" });
      expect(service.clientId).toContain("http://localhost?");
    });

    it("detects [::1] as loopback", () => {
      const service = new OAuthService({ publicUrl: "http://[::1]:3000" });
      expect(service.clientId).toContain("http://localhost?");
    });

    it("treats production URLs as non-loopback", () => {
      const service = new OAuthService({ publicUrl: "https://observ.ing" });
      expect(service.clientId).toBe("https://observ.ing/client-metadata.json");
    });
  });

  describe("clientId generation", () => {
    it("generates loopback client ID with redirect_uri and scope", () => {
      const service = new OAuthService({ publicUrl: "http://localhost:3000" });
      const clientId = service.clientId;

      expect(clientId).toContain("http://localhost?");
      expect(clientId).toContain("redirect_uri=");
      expect(clientId).toContain("scope=atproto");
    });

    it("generates production client ID pointing to metadata", () => {
      const service = new OAuthService({ publicUrl: "https://observ.ing" });
      expect(service.clientId).toBe("https://observ.ing/client-metadata.json");
    });
  });

  describe("redirectUri generation", () => {
    it("uses 127.0.0.1 for loopback mode", () => {
      const service = new OAuthService({ publicUrl: "http://localhost:3000" });
      expect(service.redirectUri).toBe("http://127.0.0.1:3000/oauth/callback");
    });

    it("uses public URL for production mode", () => {
      const service = new OAuthService({ publicUrl: "https://observ.ing" });
      expect(service.redirectUri).toBe("https://observ.ing/oauth/callback");
    });
  });

  describe("getClientMetadata", () => {
    it("returns loopback metadata in development", () => {
      const service = new OAuthService({ publicUrl: "http://localhost:3000" });
      const metadata = service.getClientMetadata() as Record<string, unknown>;

      expect(metadata["client_id"]).toContain("http://localhost?");
      expect(metadata["redirect_uris"]).toContain("http://127.0.0.1:3000/oauth/callback");
      expect(metadata["dpop_bound_access_tokens"]).toBe(true);
      expect(metadata["client_name"]).toBeUndefined(); // No name in loopback mode
    });

    it("returns full metadata in production", () => {
      const service = new OAuthService({ publicUrl: "https://observ.ing" });
      const metadata = service.getClientMetadata() as Record<string, unknown>;

      expect(metadata["client_id"]).toBe("https://observ.ing/client-metadata.json");
      expect(metadata["client_name"]).toBe("Observ.ing");
      expect(metadata["client_uri"]).toBe("https://observ.ing");
    });
  });

  describe("session management", () => {
    it("stores and retrieves sessions", async () => {
      const sessionStore = new MemorySessionStore();
      const service = new OAuthService({
        publicUrl: "http://localhost:3000",
        sessionStore,
      });

      const mockSession: SessionData = {
        did: "did:plc:test",
        handle: "test.bsky.social",
        accessToken: "token",
        expiresAt: Date.now() + 3600000,
      };

      await sessionStore.set("did:plc:test", mockSession);
      const result = await service.getSession("did:plc:test");
      expect(result).toEqual(mockSession);
    });

    it("returns undefined for non-existent sessions", async () => {
      const service = new OAuthService({ publicUrl: "http://localhost:3000" });
      const result = await service.getSession("nonexistent");
      expect(result).toBeUndefined();
    });

    it("deletes session on logout", async () => {
      const sessionStore = new MemorySessionStore();
      const service = new OAuthService({
        publicUrl: "http://localhost:3000",
        sessionStore,
      });

      const mockSession: SessionData = {
        did: "did:plc:test",
        handle: "test.bsky.social",
        accessToken: "token",
        expiresAt: Date.now() + 3600000,
      };

      await sessionStore.set("did:plc:test", mockSession);
      await service.logout("did:plc:test");
      const result = await service.getSession("did:plc:test");
      expect(result).toBeUndefined();
    });
  });

  describe("getAuthorizationUrl", () => {
    it("throws when client not initialized", async () => {
      const service = new OAuthService({ publicUrl: "http://localhost:3000" });
      // Don't call initialize()
      await expect(service.getAuthorizationUrl("test.bsky.social")).rejects.toThrow(
        "OAuth client not initialized"
      );
    });
  });

  describe("handleCallback", () => {
    it("throws when client not initialized", async () => {
      const service = new OAuthService({ publicUrl: "http://localhost:3000" });
      await expect(
        service.handleCallback({ code: "code", state: "state", iss: "iss" })
      ).rejects.toThrow("OAuth client not initialized");
    });
  });

  describe("getAgent", () => {
    it("returns null when client not initialized", async () => {
      const service = new OAuthService({ publicUrl: "http://localhost:3000" });
      const agent = await service.getAgent("did:plc:test");
      expect(agent).toBeNull();
    });
  });

  describe("setupRoutes", () => {
    let app: express.Application;
    let service: OAuthService;
    let sessionStore: MemorySessionStore;

    beforeEach(() => {
      sessionStore = new MemorySessionStore();
      service = new OAuthService({
        publicUrl: "http://localhost:3000",
        sessionStore,
      });

      app = express();
      app.use(cookieParser());
      service.setupRoutes(app);
    });

    describe("GET /client-metadata.json", () => {
      it("returns client metadata", async () => {
        const res = await request(app).get("/client-metadata.json");
        expect(res.status).toBe(200);
        expect(res.body["client_id"]).toContain("http://localhost?");
      });
    });

    describe("GET /oauth/login", () => {
      it("returns 400 without handle", async () => {
        const res = await request(app).get("/oauth/login");
        expect(res.status).toBe(400);
        expect(res.body.error).toBe("Handle is required");
      });

      it("returns 503 when client not initialized", async () => {
        const res = await request(app).get("/oauth/login?handle=test.bsky.social");
        expect(res.status).toBe(503);
        expect(res.body.error).toBe("Login service is temporarily unavailable. Please try again later.");
      });
    });

    describe("POST /oauth/logout", () => {
      it("clears session cookie", async () => {
        const res = await request(app).post("/oauth/logout");
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      });

      it("deletes session from store", async () => {
        const mockSession: SessionData = {
          did: "did:plc:test",
          handle: "test.bsky.social",
          accessToken: "token",
          expiresAt: Date.now() + 3600000,
        };
        await sessionStore.set("did:plc:test", mockSession);

        await request(app)
          .post("/oauth/logout")
          .set("Cookie", "session_did=did:plc:test");

        const session = await sessionStore.get("did:plc:test");
        expect(session).toBeUndefined();
      });
    });

    describe("GET /oauth/me", () => {
      it("returns null user when no cookie", async () => {
        const res = await request(app).get("/oauth/me");
        expect(res.status).toBe(200);
        expect(res.body.user).toBeNull();
      });

      it("returns null user when session not found", async () => {
        const res = await request(app)
          .get("/oauth/me")
          .set("Cookie", "session_did=did:plc:nonexistent");
        expect(res.status).toBe(200);
        expect(res.body.user).toBeNull();
      });

      it("returns user when session exists", async () => {
        const mockSession: SessionData = {
          did: "did:plc:test",
          handle: "test.bsky.social",
          accessToken: "token",
          expiresAt: Date.now() + 3600000,
        };
        await sessionStore.set("did:plc:test", mockSession);

        const res = await request(app)
          .get("/oauth/me")
          .set("Cookie", "session_did=did:plc:test");

        expect(res.status).toBe(200);
        expect(res.body.user).toEqual({
          did: "did:plc:test",
          handle: "test.bsky.social",
        });
      });
    });
  });

  describe("environment variable fallback", () => {
    it("uses PUBLIC_URL from environment", () => {
      process.env["PUBLIC_URL"] = "https://env-url.com";
      const service = new OAuthService({});
      expect(service.clientId).toBe("https://env-url.com/client-metadata.json");
    });

    it("defaults to localhost when no config or env", () => {
      delete process.env["PUBLIC_URL"];
      const service = new OAuthService({});
      expect(service.clientId).toContain("http://localhost?");
    });
  });

  describe("custom scope", () => {
    it("uses custom scope in client ID", () => {
      const service = new OAuthService({
        publicUrl: "http://localhost:3000",
        scope: "atproto transition:generic",
      });
      expect(service.clientId).toContain("scope=atproto+transition%3Ageneric");
    });
  });
});
