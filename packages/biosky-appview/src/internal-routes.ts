/**
 * Internal RPC endpoints for AT Protocol operations
 *
 * These endpoints are called by the API service to perform write operations
 * on behalf of authenticated users. They are not exposed publicly.
 */

import { Router, Request, Response } from "express";
import { OAuthService } from "./auth/index.js";
import pino from "pino";

const logger = pino({
  formatters: {
    level(label) {
      const severityMap: Record<string, string> = {
        trace: "DEBUG",
        debug: "DEBUG",
        info: "INFO",
        warn: "WARNING",
        error: "ERROR",
        fatal: "CRITICAL",
      };
      return { severity: severityMap[label] || "DEFAULT" };
    },
  },
});

interface InternalConfig {
  oauth: OAuthService;
  internalSecret?: string | undefined;
}

/**
 * Create internal RPC routes for AT Protocol operations
 */
export function createInternalRoutes(config: InternalConfig): Router {
  const router = Router();
  const { oauth, internalSecret } = config;

  // Verify internal requests (optional shared secret for production)
  const verifyInternal = (req: Request, res: Response, next: () => void) => {
    if (internalSecret) {
      const authHeader = req.headers["x-internal-secret"];
      if (authHeader !== internalSecret) {
        res.status(403).json({ error: "Forbidden" });
        return;
      }
    }
    next();
  };

  router.use(verifyInternal);

  /**
   * Upload a blob to user's PDS
   * POST /internal/agent/upload-blob
   * Body: { did: string, data: string (base64), mimeType: string }
   */
  router.post("/upload-blob", async (req, res) => {
    try {
      const { did, data, mimeType } = req.body;

      if (!did || !data || !mimeType) {
        res.status(400).json({ error: "did, data, and mimeType are required" });
        return;
      }

      const agent = await oauth.getAgent(did);
      if (!agent) {
        res.status(401).json({ error: "Invalid session" });
        return;
      }

      // Convert base64 to Uint8Array
      const bytes = new Uint8Array(Buffer.from(data, "base64"));

      // Upload blob to PDS
      const blobResponse = await agent.uploadBlob(bytes, {
        encoding: mimeType,
      });

      logger.info({ did, size: bytes.length, mimeType }, "Internal: uploaded blob");

      res.json({
        success: true,
        blob: blobResponse.data.blob,
      });
    } catch (error) {
      logger.error({ err: error }, "Internal: error uploading blob");
      res.status(500).json({ error: "Failed to upload blob" });
    }
  });

  /**
   * Create a record on user's PDS
   * POST /internal/agent/create-record
   * Body: { did: string, collection: string, record: object, rkey?: string }
   */
  router.post("/create-record", async (req, res) => {
    try {
      const { did, collection, record, rkey } = req.body;

      if (!did || !collection || !record) {
        res.status(400).json({ error: "did, collection, and record are required" });
        return;
      }

      const agent = await oauth.getAgent(did);
      if (!agent) {
        res.status(401).json({ error: "Invalid session" });
        return;
      }

      const result = await agent.com.atproto.repo.createRecord({
        repo: did,
        collection,
        record,
        ...(rkey && { rkey }),
      });

      logger.info({ did, collection, uri: result.data.uri }, "Internal: created record");

      res.json({
        success: true,
        uri: result.data.uri,
        cid: result.data.cid,
      });
    } catch (error) {
      logger.error({ err: error }, "Internal: error creating record");
      res.status(500).json({ error: "Failed to create record" });
    }
  });

  /**
   * Update (put) a record on user's PDS
   * POST /internal/agent/put-record
   * Body: { did: string, collection: string, rkey: string, record: object }
   */
  router.post("/put-record", async (req, res) => {
    try {
      const { did, collection, rkey, record } = req.body;

      if (!did || !collection || !rkey || !record) {
        res.status(400).json({ error: "did, collection, rkey, and record are required" });
        return;
      }

      const agent = await oauth.getAgent(did);
      if (!agent) {
        res.status(401).json({ error: "Invalid session" });
        return;
      }

      const result = await agent.com.atproto.repo.putRecord({
        repo: did,
        collection,
        rkey,
        record,
      });

      logger.info({ did, collection, rkey, uri: result.data.uri }, "Internal: updated record");

      res.json({
        success: true,
        uri: result.data.uri,
        cid: result.data.cid,
      });
    } catch (error) {
      logger.error({ err: error }, "Internal: error updating record");
      res.status(500).json({ error: "Failed to update record" });
    }
  });

  /**
   * Delete a record from user's PDS
   * POST /internal/agent/delete-record
   * Body: { did: string, collection: string, rkey: string }
   */
  router.post("/delete-record", async (req, res) => {
    try {
      const { did, collection, rkey } = req.body;

      if (!did || !collection || !rkey) {
        res.status(400).json({ error: "did, collection, and rkey are required" });
        return;
      }

      const agent = await oauth.getAgent(did);
      if (!agent) {
        res.status(401).json({ error: "Invalid session" });
        return;
      }

      await agent.com.atproto.repo.deleteRecord({
        repo: did,
        collection,
        rkey,
      });

      logger.info({ did, collection, rkey }, "Internal: deleted record");

      res.json({ success: true });
    } catch (error) {
      logger.error({ err: error }, "Internal: error deleting record");
      res.status(500).json({ error: "Failed to delete record" });
    }
  });

  return router;
}
