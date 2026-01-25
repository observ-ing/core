/**
 * Session verification middleware for API service
 *
 * Verifies user sessions via the shared database session table.
 * This enables authenticated read endpoints without needing the OAuth client.
 */

import { Request, Response, NextFunction } from "express";
import { Database } from "biosky-shared";

export interface SessionData {
  did: string;
  handle: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: { did: string; handle: string };
    }
  }
}

/**
 * Creates session verification middleware
 * Reads session_did cookie and validates against database
 */
export function createSessionMiddleware(db: Database) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const sessionDid = req.cookies?.session_did;
      if (!sessionDid) {
        // No session - continue without user
        return next();
      }

      // Look up session in database
      const sessionJson = await db.getOAuthSession(sessionDid);
      if (!sessionJson) {
        // Invalid session - continue without user
        return next();
      }

      const session: SessionData = JSON.parse(sessionJson);

      // Session token expiry is managed by AT Protocol OAuth client refresh
      // Our session record doesn't expire - we trust the OAuth session store
      // Skip expiration check since the AT Protocol client handles token refresh

      // Attach user to request
      req.user = {
        did: session.did,
        handle: session.handle,
      };

      next();
    } catch (error) {
      // On error, continue without user
      console.error("Session verification error:", error);
      next();
    }
  };
}

/**
 * Middleware that requires authentication
 * Returns 401 if no valid session
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  next();
}
