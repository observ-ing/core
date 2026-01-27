import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { createSessionMiddleware, requireAuth } from "./auth.js";

describe("auth middleware", () => {
  describe("createSessionMiddleware", () => {
    let mockDb: { getOAuthSession: ReturnType<typeof vi.fn> };
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;
    let middleware: ReturnType<typeof createSessionMiddleware>;

    beforeEach(() => {
      vi.clearAllMocks();

      mockDb = {
        getOAuthSession: vi.fn(),
      };
      mockReq = {
        cookies: {},
      };
      mockRes = {};
      mockNext = vi.fn();
      middleware = createSessionMiddleware(mockDb as any);
    });

    it("continues without user when no session cookie present", async () => {
      mockReq.cookies = {};

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
      expect(mockDb.getOAuthSession).not.toHaveBeenCalled();
    });

    it("continues without user when cookies object is undefined", async () => {
      delete mockReq.cookies;

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });

    it("continues without user when session not found in database", async () => {
      mockReq.cookies = { session_did: "did:plc:test123" };
      mockDb.getOAuthSession.mockResolvedValue(null);

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockDb.getOAuthSession).toHaveBeenCalledWith("did:plc:test123");
      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
    });

    it("attaches user to request when valid session found", async () => {
      const sessionData = {
        did: "did:plc:user123",
        handle: "alice.bsky.social",
        accessToken: "token123",
        expiresAt: Date.now() + 3600000,
      };
      mockReq.cookies = { session_did: "did:plc:user123" };
      mockDb.getOAuthSession.mockResolvedValue(JSON.stringify(sessionData));

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq.user).toEqual({
        did: "did:plc:user123",
        handle: "alice.bsky.social",
      });
      expect(mockNext).toHaveBeenCalled();
    });

    it("includes optional refreshToken in parsed session", async () => {
      const sessionData = {
        did: "did:plc:user123",
        handle: "bob.bsky.social",
        accessToken: "token123",
        refreshToken: "refresh456",
        expiresAt: Date.now() + 3600000,
      };
      mockReq.cookies = { session_did: "did:plc:user123" };
      mockDb.getOAuthSession.mockResolvedValue(JSON.stringify(sessionData));

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockReq.user).toEqual({
        did: "did:plc:user123",
        handle: "bob.bsky.social",
      });
    });

    it("continues without user when JSON parsing fails", async () => {
      mockReq.cookies = { session_did: "did:plc:test123" };
      mockDb.getOAuthSession.mockResolvedValue("invalid-json{");
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("continues without user when database throws error", async () => {
      mockReq.cookies = { session_did: "did:plc:test123" };
      mockDb.getOAuthSession.mockRejectedValue(new Error("Database connection failed"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      await middleware(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(mockReq.user).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        "Session verification error:",
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe("requireAuth", () => {
    let mockReq: Partial<Request>;
    let mockRes: Partial<Response>;
    let mockNext: NextFunction;
    let statusMock: ReturnType<typeof vi.fn>;
    let jsonMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.clearAllMocks();

      jsonMock = vi.fn();
      statusMock = vi.fn().mockReturnValue({ json: jsonMock });
      mockReq = {};
      mockRes = {
        status: statusMock as unknown as Response["status"],
      };
      mockNext = vi.fn();
    });

    it("returns 401 when user is not present", () => {
      delete mockReq.user;

      requireAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({ error: "Authentication required" });
      expect(mockNext).not.toHaveBeenCalled();
    });

    it("calls next when user is present", () => {
      mockReq.user = { did: "did:plc:test123", handle: "test.bsky.social" };

      requireAuth(mockReq as Request, mockRes as Response, mockNext);

      expect(mockNext).toHaveBeenCalled();
      expect(statusMock).not.toHaveBeenCalled();
    });
  });
});
