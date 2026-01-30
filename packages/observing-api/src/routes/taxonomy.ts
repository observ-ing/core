/**
 * Taxonomy routes - search, validate, and taxon details
 */

import { Router } from "express";
import { Database, TaxonomyClient } from "observing-shared";
import { enrichOccurrences } from "../enrichment.js";
import { logger } from "../middleware/logging.js";

export function createTaxonomyRoutes(
  db: Database,
  taxonomy: TaxonomyClient
): Router {
  const router = Router();

  // Search taxa
  router.get("/search", async (req, res) => {
    try {
      const query = req.query["q"] as string;
      if (!query || query.length < 2) {
        res.status(400).json({ error: "Query must be at least 2 characters" });
        return;
      }

      const results = await taxonomy.search(query);
      res.json({ results });
    } catch (error) {
      logger.error({ err: error }, "Error searching taxa");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Validate taxon name
  router.get("/validate", async (req, res) => {
    try {
      const name = req.query["name"] as string;
      if (!name) {
        res.status(400).json({ error: "name parameter required" });
        return;
      }

      const result = await taxonomy.validate(name);
      res.json(result);
    } catch (error) {
      logger.error({ err: error }, "Error validating taxon");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Helper to resolve a taxon from an ID or name string
  async function resolveTaxon(idOrName: string) {
    if (idOrName.startsWith("gbif:")) {
      return taxonomy.getById(idOrName);
    }
    // Try name-based resolution
    return taxonomy.getByName(idOrName);
  }

  // Helper to resolve a taxon from kingdom + name
  async function resolveTaxonByKingdomName(kingdom: string, name: string) {
    return taxonomy.getByName(name, kingdom);
  }

  // Get taxon occurrences by kingdom + name (must be before /:param1/:param2)
  router.get("/:kingdom/:name/occurrences", async (req, res) => {
    try {
      const kingdom = decodeURIComponent(req.params["kingdom"] ?? "");
      const name = decodeURIComponent(req.params["name"] ?? "");
      const cursor = req.query["cursor"] as string | undefined;
      const limit = Math.min(parseInt(req.query["limit"] as string) || 20, 100);

      const taxon = await resolveTaxonByKingdomName(kingdom, name);
      if (!taxon) {
        res.status(404).json({ error: "Taxon not found" });
        return;
      }

      const rows = await db.getOccurrencesByTaxon(taxon.scientificName, taxon.rank, {
        limit,
        ...(cursor && { cursor }),
        ...(taxon.kingdom && { kingdom: taxon.kingdom }),
      });

      const occurrences = await enrichOccurrences(db, rows);

      const nextCursor =
        rows.length === limit
          ? rows[rows.length - 1]?.created_at?.toISOString()
          : undefined;

      res.json({
        occurrences,
        cursor: nextCursor,
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching taxon occurrences");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get taxon occurrences by ID or name (backward compat)
  router.get("/:id/occurrences", async (req, res) => {
    try {
      const idOrName = decodeURIComponent(req.params["id"] ?? "");
      const cursor = req.query["cursor"] as string | undefined;
      const limit = Math.min(parseInt(req.query["limit"] as string) || 20, 100);

      const taxon = await resolveTaxon(idOrName);
      if (!taxon) {
        res.status(404).json({ error: "Taxon not found" });
        return;
      }

      const rows = await db.getOccurrencesByTaxon(taxon.scientificName, taxon.rank, {
        limit,
        ...(cursor && { cursor }),
        ...(taxon.kingdom && { kingdom: taxon.kingdom }),
      });

      const occurrences = await enrichOccurrences(db, rows);

      const nextCursor =
        rows.length === limit
          ? rows[rows.length - 1]?.created_at?.toISOString()
          : undefined;

      res.json({
        occurrences,
        cursor: nextCursor,
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching taxon occurrences");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get taxon details by kingdom + name
  router.get("/:kingdom/:name", async (req, res) => {
    try {
      const kingdom = decodeURIComponent(req.params["kingdom"] ?? "");
      const name = decodeURIComponent(req.params["name"] ?? "");

      const taxon = await resolveTaxonByKingdomName(kingdom, name);
      if (!taxon) {
        res.status(404).json({ error: "Taxon not found" });
        return;
      }

      const observationCount = await db.countOccurrencesByTaxon(
        taxon.scientificName,
        taxon.rank,
        taxon.kingdom,
      );

      res.json({
        ...taxon,
        observationCount,
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching taxon");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get taxon details by ID or name (backward compat + kingdom-level lookup)
  router.get("/:id", async (req, res) => {
    try {
      const idOrName = decodeURIComponent(req.params["id"] ?? "");

      const taxon = await resolveTaxon(idOrName);
      if (!taxon) {
        res.status(404).json({ error: "Taxon not found" });
        return;
      }

      const observationCount = await db.countOccurrencesByTaxon(
        taxon.scientificName,
        taxon.rank,
        taxon.kingdom,
      );

      res.json({
        ...taxon,
        observationCount,
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching taxon");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
