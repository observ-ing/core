/**
 * Identification routes - read and write endpoints
 */

import { Router } from "express";
import { Database, CommunityIdCalculator, TaxonomyClient } from "observing-shared";
import { enrichIdentifications } from "../enrichment.js";
import { logger } from "../middleware/logging.js";
import { requireAuth } from "../middleware/auth.js";
import { InternalClient } from "../internal-client.js";

export function createIdentificationRoutes(
  db: Database,
  communityId: CommunityIdCalculator,
  taxonomy: TaxonomyClient,
  internalClient: InternalClient
): Router {
  const router = Router();

  // Create a new identification
  router.post("/", requireAuth, async (req, res) => {
    try {
      const sessionDid = req.user!.did;
      const {
        occurrenceUri,
        occurrenceCid,
        subjectIndex = 0,
        taxonName,
        taxonRank = "species",
        comment,
        isAgreement = false,
        confidence = "medium",
      } = req.body;

      // Validate required fields
      if (!occurrenceUri || !occurrenceCid) {
        res.status(400).json({ error: "occurrenceUri and occurrenceCid are required" });
        return;
      }

      if (!taxonName || taxonName.trim().length === 0) {
        res.status(400).json({ error: "taxonName is required" });
        return;
      }

      if (taxonName.length > 256) {
        res.status(400).json({ error: "taxonName too long (max 256 characters)" });
        return;
      }

      if (comment && comment.length > 3000) {
        res.status(400).json({ error: "comment too long (max 3000 characters)" });
        return;
      }

      // Fetch taxonomy hierarchy from GBIF
      const validationResult = await taxonomy.validate(taxonName.trim());
      const taxon = validationResult.taxon;

      // Build the identification record
      const record = {
        $type: "org.rwell.test.identification",
        subject: {
          uri: occurrenceUri,
          cid: occurrenceCid,
        },
        subjectIndex,
        taxonName: taxonName.trim(),
        taxonRank,
        comment: comment?.trim() || undefined,
        isAgreement,
        confidence,
        createdAt: new Date().toISOString(),
        taxonId: taxon?.id,
        vernacularName: taxon?.commonName,
        kingdom: taxon?.kingdom,
        phylum: taxon?.phylum,
        class: taxon?.class,
        order: taxon?.order,
        family: taxon?.family,
        genus: taxon?.genus,
      };

      // Create the record via internal RPC
      const result = await internalClient.createRecord(
        sessionDid,
        "org.rwell.test.identification",
        record
      );

      if (!result.success || !result.uri) {
        res.status(500).json({ error: result.error || "Failed to create identification" });
        return;
      }

      logger.info({ uri: result.uri, occurrenceUri, isAgreement }, "Created identification via internal RPC");

      res.status(201).json({
        success: true,
        uri: result.uri,
        cid: result.cid,
      });
    } catch (error) {
      logger.error({ err: error }, "Error creating identification");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get identifications for an occurrence
  router.get("/:occurrenceUri(*)", async (req, res) => {
    try {
      const occurrenceUri = req.params["occurrenceUri"];
      if (!occurrenceUri) {
        res.status(400).json({ error: "occurrenceUri is required" });
        return;
      }
      const rows = await db.getIdentificationsForOccurrence(occurrenceUri);
      const identifications = await enrichIdentifications(rows);

      // Calculate community ID
      const communityTaxon = await communityId.calculate(occurrenceUri);

      res.json({
        identifications,
        communityId: communityTaxon,
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching identifications");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
