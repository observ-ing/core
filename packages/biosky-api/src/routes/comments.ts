/**
 * Comment routes - create comments on occurrences
 */

import { Router } from "express";
import { logger } from "../middleware/logging.js";
import { requireAuth } from "../middleware/auth.js";
import { InternalClient } from "../internal-client.js";

export function createCommentRoutes(internalClient: InternalClient): Router {
  const router = Router();

  // Create a new comment on an observation
  router.post("/", requireAuth, async (req, res) => {
    try {
      const sessionDid = req.user!.did;
      const {
        occurrenceUri,
        occurrenceCid,
        body,
        replyToUri,
        replyToCid,
      } = req.body;

      // Validate required fields
      if (!occurrenceUri || !occurrenceCid) {
        res.status(400).json({ error: "occurrenceUri and occurrenceCid are required" });
        return;
      }

      if (!body || body.trim().length === 0) {
        res.status(400).json({ error: "body is required" });
        return;
      }

      if (body.length > 3000) {
        res.status(400).json({ error: "body too long (max 3000 characters)" });
        return;
      }

      // Build the comment record
      const record: Record<string, unknown> = {
        $type: "org.rwell.test.comment",
        subject: {
          uri: occurrenceUri,
          cid: occurrenceCid,
        },
        body: body.trim(),
        createdAt: new Date().toISOString(),
      };

      // Add reply reference if provided
      if (replyToUri && replyToCid) {
        record["replyTo"] = {
          uri: replyToUri,
          cid: replyToCid,
        };
      }

      // Create the record via internal RPC
      const result = await internalClient.createRecord(
        sessionDid,
        "org.rwell.test.comment",
        record
      );

      if (!result.success || !result.uri) {
        res.status(500).json({ error: result.error || "Failed to create comment" });
        return;
      }

      logger.info({ uri: result.uri, occurrenceUri }, "Created comment via internal RPC");

      res.status(201).json({
        success: true,
        uri: result.uri,
        cid: result.cid,
      });
    } catch (error) {
      logger.error({ err: error }, "Error creating comment");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
