/**
 * Occurrence routes - read and write endpoints
 */

import { Router } from "express";
import { Database, getIdentityResolver, TaxonomyClient, GeocodingService } from "observing-shared";
import { enrichOccurrences, enrichIdentifications, enrichComments } from "../enrichment.js";
import { logger } from "../middleware/logging.js";
import { requireAuth } from "../middleware/auth.js";
import { InternalClient } from "../internal-client.js";

export function createOccurrenceRoutes(
  db: Database,
  taxonomy: TaxonomyClient,
  geocoding: GeocodingService,
  internalClient: InternalClient
): Router {
  const router = Router();

  // Get observers for an occurrence
  router.get("/:uri(*)/observers", async (req, res) => {
    try {
      const occurrenceUri = req.params["uri"];
      if (!occurrenceUri) {
        res.status(400).json({ error: "uri is required" });
        return;
      }

      const occurrence = await db.getOccurrence(occurrenceUri);
      if (!occurrence) {
        res.status(404).json({ error: "Occurrence not found" });
        return;
      }

      const observerData = await db.getOccurrenceObservers(occurrenceUri);

      // Enrich with profile info
      const resolver = getIdentityResolver();
      const dids = observerData.map((o) => o.did);
      const profiles = await resolver.getProfiles(dids);

      const observers = observerData.map((o) => {
        const profile = profiles.get(o.did);
        return {
          did: o.did,
          handle: profile?.handle,
          displayName: profile?.displayName,
          avatar: profile?.avatar,
          role: o.role,
          addedAt: o.addedAt.toISOString(),
        };
      });

      res.json({ observers });
    } catch (error) {
      logger.error({ err: error }, "Error fetching observers");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get occurrences nearby
  router.get("/nearby", async (req, res) => {
    try {
      const lat = parseFloat(req.query["lat"] as string);
      const lng = parseFloat(req.query["lng"] as string);
      const radius = parseFloat(req.query["radius"] as string) || 10000;
      const limit = parseInt(req.query["limit"] as string) || 100;
      const offset = parseInt(req.query["offset"] as string) || 0;

      if (isNaN(lat) || isNaN(lng)) {
        res.status(400).json({ error: "lat and lng are required" });
        return;
      }

      if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        res.status(400).json({ error: "Invalid coordinates" });
        return;
      }

      const rows = await db.getOccurrencesNearby(lat, lng, radius, limit, offset);
      const occurrences = await enrichOccurrences(db, rows);

      res.json({
        occurrences,
        meta: {
          lat,
          lng,
          radius,
          limit,
          offset,
          count: occurrences.length,
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching nearby occurrences");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get occurrences feed (chronological)
  router.get("/feed", async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query["limit"] as string) || 20, 100);
      const cursor = req.query["cursor"] as string | undefined;

      const rows = await db.getOccurrencesFeed(limit, cursor);
      const occurrences = await enrichOccurrences(db, rows);

      const lastRow = rows[rows.length - 1];
      const nextCursor =
        rows.length === limit && lastRow
          ? lastRow.created_at.toISOString()
          : undefined;

      res.json({
        occurrences,
        cursor: nextCursor,
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching feed");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get occurrences in bounding box
  router.get("/bbox", async (req, res) => {
    try {
      const minLat = parseFloat(req.query["minLat"] as string);
      const minLng = parseFloat(req.query["minLng"] as string);
      const maxLat = parseFloat(req.query["maxLat"] as string);
      const maxLng = parseFloat(req.query["maxLng"] as string);
      const limit = parseInt(req.query["limit"] as string) || 1000;

      if (isNaN(minLat) || isNaN(minLng) || isNaN(maxLat) || isNaN(maxLng)) {
        res.status(400).json({
          error: "minLat, minLng, maxLat, maxLng are required",
        });
        return;
      }

      const rows = await db.getOccurrencesByBoundingBox(
        minLat,
        minLng,
        maxLat,
        maxLng,
        limit
      );

      const occurrences = await enrichOccurrences(db, rows);

      res.json({
        occurrences,
        meta: {
          bounds: { minLat, minLng, maxLat, maxLng },
          count: occurrences.length,
        },
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching bbox occurrences");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get GeoJSON for map clustering (must be before :uri(*) route)
  router.get("/geojson", async (req, res) => {
    try {
      const minLat = parseFloat(req.query["minLat"] as string);
      const minLng = parseFloat(req.query["minLng"] as string);
      const maxLat = parseFloat(req.query["maxLat"] as string);
      const maxLng = parseFloat(req.query["maxLng"] as string);

      if (isNaN(minLat) || isNaN(minLng) || isNaN(maxLat) || isNaN(maxLng)) {
        res.status(400).json({ error: "Bounding box required" });
        return;
      }

      const rows = await db.getOccurrencesByBoundingBox(
        minLat,
        minLng,
        maxLat,
        maxLng,
        5000
      );

      const features = rows.map((row) => ({
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [row.longitude, row.latitude],
        },
        properties: {
          uri: row.uri,
          scientificName: row.scientific_name,
          eventDate: row.event_date.toISOString(),
        },
      }));

      res.json({
        type: "FeatureCollection",
        features,
      });
    } catch (error) {
      logger.error({ err: error }, "Error generating GeoJSON");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Create a new occurrence
  router.post("/", requireAuth, async (req, res) => {
    try {
      const sessionDid = req.user!.did;
      const {
        scientificName,
        latitude,
        longitude,
        notes,
        license,
        eventDate,
        images,
        taxonId,
        taxonRank,
        vernacularName,
        kingdom,
        phylum,
        class: taxonomyClass,
        order,
        family,
        genus,
        recordedBy,
      } = req.body;

      if (!latitude || !longitude) {
        res.status(400).json({ error: "latitude and longitude are required" });
        return;
      }

      // Upload images as blobs if provided
      const associatedMedia: Array<{ image: unknown; alt: string }> = [];

      if (images && Array.isArray(images)) {
        for (let i = 0; i < images.length; i++) {
          const img = images[i] as { data: string; mimeType: string };
          if (!img.data || !img.mimeType) continue;

          const blobResult = await internalClient.uploadBlob(sessionDid, img.data, img.mimeType);
          if (blobResult.success && blobResult.blob) {
            associatedMedia.push({
              image: blobResult.blob,
              alt: `Photo ${i + 1}${scientificName ? ` of ${scientificName}` : ""}`,
            });
            logger.info({ mimeType: img.mimeType }, "Uploaded blob via internal RPC");
          } else {
            logger.error({ error: blobResult.error }, "Failed to upload blob");
          }
        }
      }

      // Fetch taxonomy hierarchy from GBIF if scientificName is provided (for identification record)
      let taxon: {
        id?: string | undefined;
        commonName?: string | undefined;
        kingdom?: string | undefined;
        phylum?: string | undefined;
        class?: string | undefined;
        order?: string | undefined;
        family?: string | undefined;
        genus?: string | undefined;
        rank?: string | undefined;
      } | undefined;
      if (scientificName && !taxonId) {
        const validationResult = await taxonomy.validate(scientificName.trim());
        taxon = validationResult.taxon;
      }

      // Reverse geocode to get administrative geography fields
      const geocoded = await geocoding.reverseGeocode(latitude, longitude);

      // Build the occurrence record WITHOUT taxonomy fields
      // Taxonomy data goes into the identification record instead
      const record: Record<string, unknown> = {
        $type: "org.rwell.test.occurrence",
        eventDate: eventDate || new Date().toISOString(),
        location: {
          decimalLatitude: String(latitude),
          decimalLongitude: String(longitude),
          coordinateUncertaintyInMeters: 50,
          geodeticDatum: "WGS84",
          continent: geocoded.continent,
          country: geocoded.country,
          countryCode: geocoded.countryCode,
          stateProvince: geocoded.stateProvince,
          county: geocoded.county,
          municipality: geocoded.municipality,
          locality: geocoded.locality,
          waterBody: geocoded.waterBody,
        },
        notes: notes || undefined,
        license: license || undefined,
        createdAt: new Date().toISOString(),
      };

      if (associatedMedia.length > 0) {
        record["associatedMedia"] = associatedMedia;
      }

      // Add co-observers if provided
      const coObservers: string[] = [];
      if (recordedBy && Array.isArray(recordedBy)) {
        for (const did of recordedBy) {
          if (typeof did === "string" && did !== sessionDid) {
            coObservers.push(did);
          }
        }
        if (coObservers.length > 0) {
          record["recordedBy"] = coObservers;
        }
      }

      // Create the record via internal RPC
      const result = await internalClient.createRecord(
        sessionDid,
        "org.rwell.test.occurrence",
        record
      );

      if (!result.success || !result.uri) {
        res.status(500).json({ error: result.error || "Failed to create record" });
        return;
      }

      logger.info({ uri: result.uri, imageCount: associatedMedia.length }, "Created occurrence via internal RPC");

      // Store exact coordinates in private data table
      await db.saveOccurrencePrivateData(
        result.uri,
        latitude,
        longitude,
        "open"
      );

      // Sync observers table
      await db.syncOccurrenceObservers(result.uri, sessionDid, coObservers);

      // Create identification record if scientificName was provided
      let identificationUri: string | undefined;
      let identificationCid: string | undefined;
      if (scientificName) {
        const identificationRecord = {
          $type: "org.rwell.test.identification",
          subject: {
            uri: result.uri,
            cid: result.cid,
          },
          subjectIndex: 0,
          taxonName: scientificName.trim(),
          taxonRank: taxonRank || taxon?.rank || "species",
          isAgreement: false,
          confidence: "high",
          createdAt: new Date().toISOString(),
          taxonId: taxonId || taxon?.id,
          vernacularName: vernacularName || taxon?.commonName,
          kingdom: kingdom || taxon?.kingdom,
          phylum: phylum || taxon?.phylum,
          class: taxonomyClass || taxon?.class,
          order: order || taxon?.order,
          family: family || taxon?.family,
          genus: genus || taxon?.genus,
        };

        const idResult = await internalClient.createRecord(
          sessionDid,
          "org.rwell.test.identification",
          identificationRecord
        );

        if (idResult.success && idResult.uri) {
          identificationUri = idResult.uri;
          identificationCid = idResult.cid;
          logger.info({ uri: idResult.uri, occurrenceUri: result.uri }, "Created initial identification via internal RPC");
        } else {
          logger.error({ error: idResult.error }, "Failed to create initial identification");
        }
      }

      res.status(201).json({
        success: true,
        uri: result.uri,
        cid: result.cid,
        identificationUri,
        identificationCid,
        message: "Observation posted to AT Protocol network",
      });
    } catch (error) {
      logger.error({ err: error }, "Error creating occurrence");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Get single occurrence (must be after specific routes like /geojson)
  router.get("/:uri(*)", async (req, res) => {
    try {
      const uri = req.params["uri"];
      if (!uri) {
        res.status(400).json({ error: "uri is required" });
        return;
      }
      const row = await db.getOccurrence(uri);

      if (!row) {
        res.status(404).json({ error: "Occurrence not found" });
        return;
      }

      const [occurrence] = await enrichOccurrences(db, [row]);
      const identifications = await db.getIdentificationsForOccurrence(uri);
      const comments = await db.getCommentsForOccurrence(uri);

      res.json({
        occurrence,
        identifications: await enrichIdentifications(identifications),
        comments: await enrichComments(comments),
      });
    } catch (error) {
      logger.error({ err: error }, "Error fetching occurrence");
      res.status(500).json({ error: "Internal server error" });
    }
  });

  return router;
}
