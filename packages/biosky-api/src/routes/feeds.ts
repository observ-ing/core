/**
 * Feed routes - explore feed (public) and home feed (authenticated)
 */

import { Router } from "express";
import { Database, getIdentityResolver } from "biosky-shared";
import { enrichOccurrences } from "../enrichment.js";
import { logger } from "../middleware/logging.js";
import { requireAuth } from "../middleware/auth.js";

export function createFeedRoutes(db: Database): Router {
  const router = Router();

  // Explore feed - public, with optional filters
  router.get("/explore", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query["limit"] as string) || 20, 100);
      const cursor = req.query["cursor"] as string | undefined;
      const taxon = req.query["taxon"] as string | undefined;
      const lat = req.query["lat"] ? parseFloat(req.query["lat"] as string) : undefined;
      const lng = req.query["lng"] ? parseFloat(req.query["lng"] as string) : undefined;
      const radius = req.query["radius"]
        ? parseFloat(req.query["radius"] as string)
        : undefined;

      const rows = await db.getExploreFeed({
        limit,
        ...(cursor && { cursor }),
        ...(taxon && { taxon }),
        ...(lat !== undefined && { lat }),
        ...(lng !== undefined && { lng }),
        ...(radius !== undefined && { radius }),
      });

      const occurrences = await enrichOccurrences(db, rows);

      const lastExploreRow = rows[rows.length - 1];
      const nextCursor =
        rows.length === limit && lastExploreRow
          ? lastExploreRow.created_at.toISOString()
          : undefined;

      res.json({
        occurrences,
        cursor: nextCursor,
        meta: {
          filters: {
            taxon,
            location:
              lat !== undefined && lng !== undefined
                ? { lat, lng, radius: radius || 10000 }
                : undefined,
          },
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching explore feed");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Home feed - authenticated, shows observations from followed users and nearby
  router.get("/home", requireAuth, async (req, res) => {
    try {
      const sessionDid = req.user!.did;

      const limit = Math.min(parseInt(req.query["limit"] as string) || 20, 100);
      const cursor = req.query["cursor"] as string | undefined;
      const lat = req.query["lat"] ? parseFloat(req.query["lat"] as string) : undefined;
      const lng = req.query["lng"] ? parseFloat(req.query["lng"] as string) : undefined;
      const nearbyRadius = req.query["nearbyRadius"]
        ? parseFloat(req.query["nearbyRadius"] as string)
        : undefined;

      // Fetch user's follows using public API
      const resolver = getIdentityResolver();
      const followedDids = await resolver.getFollows(sessionDid);

      const { rows, followedCount, nearbyCount } = await db.getHomeFeed(
        followedDids,
        {
          limit,
          ...(cursor && { cursor }),
          ...(lat !== undefined && { lat }),
          ...(lng !== undefined && { lng }),
          ...(nearbyRadius !== undefined && { nearbyRadius }),
        }
      );

      const occurrences = await enrichOccurrences(db, rows);

      const lastHomeRow = rows[rows.length - 1];
      const nextCursor =
        rows.length === limit && lastHomeRow
          ? lastHomeRow.created_at.toISOString()
          : undefined;

      res.json({
        occurrences,
        cursor: nextCursor,
        meta: {
          followedCount,
          nearbyCount,
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching home feed");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
