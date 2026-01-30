/**
 * AppView REST API
 *
 * Provides geospatial and biodiversity data endpoints
 * for the Observ.ing frontend.
 */

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import swaggerUi from "swagger-ui-express";
import pino from "pino";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configure pino for GCP Cloud Logging
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
import {
  Database,
  type OccurrenceRow,
  type IdentificationRow,
  type CommentRow,
  getIdentityResolver,
  type Profile,
  TaxonomyClient,
  CommunityIdCalculator,
  GeocodingService,
  // Zod schemas for validation
  CreateOccurrenceRequestSchema,
  CreateIdentificationRequestSchema,
  CreateCommentRequestSchema,
} from "observing-shared";
import {
  OAuthService,
  DatabaseStateStore,
  DatabaseSessionStore,
} from "./auth/index.js";
import { createInternalRoutes } from "./internal-routes.js";

// Utility to build DATABASE_URL from environment variables
function getDatabaseUrl(): string {
  // If DB_PASSWORD is set, construct URL from individual components (GCP Secret Manager)
  if (process.env["DB_PASSWORD"]) {
    const host = process.env["DB_HOST"] || "localhost";
    const name = process.env["DB_NAME"] || "observing";
    const user = process.env["DB_USER"] || "postgres";
    const password = process.env["DB_PASSWORD"];
    return `postgresql://${user}:${password}@/${name}?host=${host}`;
  }
  // Otherwise use DATABASE_URL directly (local dev)
  return process.env["DATABASE_URL"] || "postgresql://localhost:5432/observing";
}

interface AppViewConfig {
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  publicUrl: string;
}

interface SubjectResponse {
  index: number;
  communityId?: string | undefined;
  identificationCount: number;
}

interface EffectiveTaxonomy {
  scientificName: string;
  taxonId?: string | undefined;
  taxonRank?: string | undefined;
  vernacularName?: string | undefined;
  kingdom?: string | undefined;
  phylum?: string | undefined;
  class?: string | undefined;
  order?: string | undefined;
  family?: string | undefined;
  genus?: string | undefined;
}

interface ObserverInfo {
  did: string;
  handle?: string | undefined;
  displayName?: string | undefined;
  avatar?: string | undefined;
  role: "owner" | "co-observer";
}

interface OccurrenceResponse {
  uri: string;
  cid: string;
  observer: {
    did: string;
    handle?: string | undefined;
    displayName?: string | undefined;
    avatar?: string | undefined;
  };
  observers: ObserverInfo[];
  // Darwin Core fields
  scientificName?: string | undefined;
  communityId?: string | undefined; // Keep for backward compat (refers to subject 0)
  effectiveTaxonomy?: EffectiveTaxonomy | undefined; // Taxonomy from winning ID or GBIF lookup
  subjects: SubjectResponse[]; // All subjects with their community IDs
  eventDate: string;
  location: {
    latitude: number;
    longitude: number;
    uncertaintyMeters?: number | undefined;
    continent?: string | undefined;
    country?: string | undefined;
    countryCode?: string | undefined;
    stateProvince?: string | undefined;
    county?: string | undefined;
    municipality?: string | undefined;
    locality?: string | undefined;
    waterBody?: string | undefined;
  };
  verbatimLocality?: string | undefined;
  occurrenceRemarks?: string | undefined;
  // Taxonomy fields
  taxonId?: string | undefined;
  taxonRank?: string | undefined;
  vernacularName?: string | undefined;
  kingdom?: string | undefined;
  phylum?: string | undefined;
  class?: string | undefined;
  order?: string | undefined;
  family?: string | undefined;
  genus?: string | undefined;
  images: string[];
  createdAt: string;
  identificationCount?: number | undefined;
}

// Legacy alias
type ObservationResponse = OccurrenceResponse;

export class AppViewServer {
  private app: express.Application;
  private config: AppViewConfig;
  private db: Database;
  private oauth: OAuthService;
  private taxonomy: TaxonomyClient;
  private communityId: CommunityIdCalculator;
  private geocoding: GeocodingService;

  constructor(config: Partial<AppViewConfig> = {}) {
    this.config = {
      port: config.port || 3000,
      databaseUrl:
        config.databaseUrl ||
        process.env["DATABASE_URL"] ||
        "postgresql://localhost:5432/observing",
      corsOrigins: config.corsOrigins || ["http://localhost:5173"],
      publicUrl: config.publicUrl || process.env["PUBLIC_URL"] || "http://localhost:3000",
    };

    this.app = express();
    this.db = new Database(this.config.databaseUrl);

    // Use database-backed stores for OAuth to persist sessions across deploys
    // Request write access to occurrence and identification collections
    this.oauth = new OAuthService({
      publicUrl: this.config.publicUrl,
      scope: "atproto transition:generic",
      stateStore: new DatabaseStateStore(this.db),
      sessionStore: new DatabaseSessionStore(this.db),
    });

    this.taxonomy = new TaxonomyClient();
    this.communityId = new CommunityIdCalculator(this.db);
    this.geocoding = new GeocodingService();

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    this.app.use(
      cors({
        origin: this.config.corsOrigins,
        credentials: true,
      }),
    );
    // Increase JSON body size limit for base64 image uploads
    this.app.use(express.json({ limit: "50mb" }));
    this.app.use(cookieParser());
  }

  private setupRoutes(): void {
    // Health check
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok" });
    });

    // OpenAPI documentation
    this.setupApiDocs();

    // OAuth routes
    this.oauth.setupRoutes(this.app);

    // Occurrences API
    this.setupOccurrenceRoutes();

    // Feeds API
    this.setupFeedRoutes();

    // Profiles API
    this.setupProfileRoutes();

    // Identifications API
    this.setupIdentificationRoutes();

    // Comments API
    this.setupCommentRoutes();

    // Taxonomy API
    this.setupTaxonomyRoutes();

    // Internal RPC routes for API service
    this.app.use(
      "/internal/agent",
      createInternalRoutes({
        oauth: this.oauth,
        internalSecret: process.env["INTERNAL_SECRET"],
      })
    );

    // Proxy media requests to media-proxy service
    this.setupMediaProxy();

    // Serve frontend static files in production
    // In dev: __dirname is packages/observing-appview/src, public is at ../../dist/public
    // In prod: __dirname is /app/packages/observing-appview/dist, public is at /app/dist/public
    const publicPath =
      process.env["NODE_ENV"] === "production"
        ? path.resolve("/app/dist/public")
        : path.join(__dirname, "../../../dist/public");
    this.app.use(express.static(publicPath));
    this.app.get("*", (_req, res) => {
      res.sendFile(path.join(publicPath, "index.html"));
    });
  }

  private setupOccurrenceRoutes(): void {
    // Create new occurrence - posts to AT Protocol network if authenticated
    this.app.post("/api/occurrences", async (req, res) => {
      try {
        // Validate request body with Zod schema
        const parseResult = CreateOccurrenceRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(400).json({
            error: "Validation failed",
            details: parseResult.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          });
          return;
        }

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
        } = parseResult.data;

        // Require authentication
        const sessionDid = req.cookies?.session_did;
        const agent = sessionDid ? await this.oauth.getAgent(sessionDid) : null;

        if (!agent) {
          res.status(401).json({ error: "Authentication required to create observations" });
          return;
        }

        // Upload images as blobs if provided
        const associatedMedia: Array<{ image: unknown; alt: string }> = [];

        if (images && Array.isArray(images)) {
          for (let i = 0; i < images.length; i++) {
            const img = images[i] as { data: string; mimeType: string };
            if (!img.data || !img.mimeType) continue;

            try {
              // Convert base64 to Uint8Array using Node.js Buffer
              const bytes = new Uint8Array(Buffer.from(img.data, "base64"));

              // Upload blob to PDS
              const blobResponse = await agent.uploadBlob(bytes, {
                encoding: img.mimeType,
              });

              associatedMedia.push({
                image: blobResponse.data.blob,
                alt: `Photo ${i + 1}${scientificName ? ` of ${scientificName}` : ""}`,
              });

              logger.info({ size: bytes.length, mimeType: img.mimeType }, "Uploaded blob to PDS");
            } catch (blobError) {
              logger.error({ err: blobError }, "Error uploading blob");
              // Continue with other images even if one fails
            }
          }
        }

        // Fetch taxonomy hierarchy from GBIF if scientificName is provided and taxonomy not already given
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
          const validationResult = await this.taxonomy.validate(scientificName.trim());
          taxon = validationResult.taxon;
        }

        // Reverse geocode to get administrative geography fields
        const geocoded = await this.geocoding.reverseGeocode(latitude, longitude);

        // User is authenticated - post to AT Protocol network
        const record: Record<string, unknown> = {
          $type: "org.rwell.test.occurrence",
          scientificName: scientificName || undefined,
          eventDate: eventDate || new Date().toISOString(),
          location: {
            decimalLatitude: String(latitude),
            decimalLongitude: String(longitude),
            coordinateUncertaintyInMeters: 50,
            geodeticDatum: "WGS84",
            // Darwin Core administrative geography from geocoding
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
          // Taxonomy fields - prefer user-provided, fall back to GBIF lookup
          taxonId: taxonId || taxon?.id,
          taxonRank: taxonRank || taxon?.rank,
          vernacularName: vernacularName || taxon?.commonName,
          kingdom: kingdom || taxon?.kingdom,
          phylum: phylum || taxon?.phylum,
          class: taxonomyClass || taxon?.class,
          order: order || taxon?.order,
          family: family || taxon?.family,
          genus: genus || taxon?.genus,
          createdAt: new Date().toISOString(),
        };

        // Add images if any were successfully uploaded
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

        // Create the record on the user's PDS
        const result = await agent.com.atproto.repo.createRecord({
          repo: sessionDid,
          collection: "org.rwell.test.occurrence",
          record,
        });

        logger.info({ uri: result.data.uri, imageCount: associatedMedia.length }, "Created AT Protocol record");

        // Store exact coordinates in private data table
        await this.db.saveOccurrencePrivateData(
          result.data.uri,
          latitude,
          longitude,
          "open", // Default geoprivacy for now
        );

        // Sync observers table (owner + co-observers)
        await this.db.syncOccurrenceObservers(result.data.uri, sessionDid, coObservers);

        res.status(201).json({
          success: true,
          uri: result.data.uri,
          cid: result.data.cid,
          message: "Observation posted to AT Protocol network",
        });
      } catch (error) {
        logger.error({ err: error }, "Error creating occurrence");
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Update an existing occurrence
    this.app.put("/api/occurrences", async (req, res) => {
      try {
        const {
          uri,
          scientificName,
          latitude,
          longitude,
          notes,
          license,
          eventDate,
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

        if (!uri) {
          res.status(400).json({ error: "uri is required" });
          return;
        }

        if (!latitude || !longitude) {
          res.status(400).json({ error: "latitude and longitude are required" });
          return;
        }

        // Parse the AT URI to extract DID and rkey
        // Format: at://did:plc:xxx/org.rwell.test.occurrence/rkey
        const uriMatch = uri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
        if (!uriMatch) {
          res.status(400).json({ error: "Invalid AT URI format" });
          return;
        }

        const [, recordDid, collection, rkey] = uriMatch;

        // Verify user is authenticated
        const sessionDid = req.cookies?.session_did;
        const agent = sessionDid ? await this.oauth.getAgent(sessionDid) : null;

        if (!agent) {
          res.status(401).json({ error: "Authentication required to edit observations" });
          return;
        }

        // Verify user owns this record
        if (sessionDid !== recordDid) {
          res.status(403).json({ error: "You can only edit your own observations" });
          return;
        }

        // Fetch taxonomy hierarchy from GBIF if scientificName is provided and taxonomy not already given
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
          const validationResult = await this.taxonomy.validate(scientificName.trim());
          taxon = validationResult.taxon;
        }

        // Reverse geocode to get administrative geography fields
        const geocoded = await this.geocoding.reverseGeocode(latitude, longitude);

        // Parse co-observers
        const coObservers: string[] = [];
        if (recordedBy && Array.isArray(recordedBy)) {
          for (const did of recordedBy) {
            if (typeof did === "string" && did !== sessionDid) {
              coObservers.push(did);
            }
          }
        }

        // Build the updated record
        const record: Record<string, unknown> = {
          $type: "org.rwell.test.occurrence",
          scientificName: scientificName || undefined,
          eventDate: eventDate || new Date().toISOString(),
          location: {
            decimalLatitude: String(latitude),
            decimalLongitude: String(longitude),
            coordinateUncertaintyInMeters: 50,
            geodeticDatum: "WGS84",
            // Darwin Core administrative geography from geocoding
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
          // Taxonomy fields - prefer user-provided, fall back to GBIF lookup
          taxonId: taxonId || taxon?.id,
          taxonRank: taxonRank || taxon?.rank,
          vernacularName: vernacularName || taxon?.commonName,
          kingdom: kingdom || taxon?.kingdom,
          phylum: phylum || taxon?.phylum,
          class: taxonomyClass || taxon?.class,
          order: order || taxon?.order,
          family: family || taxon?.family,
          genus: genus || taxon?.genus,
          createdAt: new Date().toISOString(),
        };

        // Add co-observers if any
        if (coObservers.length > 0) {
          record["recordedBy"] = coObservers;
        }

        // Update the record on the user's PDS using putRecord
        const result = await agent.com.atproto.repo.putRecord({
          repo: sessionDid,
          collection,
          rkey,
          record,
        });

        logger.info({ uri: result.data.uri }, "Updated AT Protocol record");

        // Update exact coordinates in private data table
        await this.db.saveOccurrencePrivateData(
          result.data.uri,
          latitude,
          longitude,
          "open", // Default geoprivacy for now
        );

        // Sync observers table
        await this.db.syncOccurrenceObservers(result.data.uri, sessionDid, coObservers);

        res.json({
          success: true,
          uri: result.data.uri,
          cid: result.data.cid,
          message: "Observation updated",
        });
      } catch (error) {
        logger.error({ err: error }, "Error updating occurrence");
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Add co-observer to an occurrence
    this.app.post("/api/occurrences/:uri(*)/observers", async (req, res) => {
      try {
        const occurrenceUri = req.params["uri"];
        const { did: coObserverDid } = req.body;

        if (!occurrenceUri || !coObserverDid) {
          res.status(400).json({ error: "uri and did are required" });
          return;
        }

        // Require authentication
        const sessionDid = req.cookies?.session_did;
        if (!sessionDid) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }

        // Verify user is the owner of the occurrence
        const occurrence = await this.db.getOccurrence(occurrenceUri);
        if (!occurrence) {
          res.status(404).json({ error: "Occurrence not found" });
          return;
        }

        if (occurrence.did !== sessionDid) {
          res.status(403).json({ error: "Only the owner can add co-observers" });
          return;
        }

        // Cannot add self as co-observer
        if (coObserverDid === sessionDid) {
          res.status(400).json({ error: "Cannot add yourself as a co-observer" });
          return;
        }

        // Add co-observer
        await this.db.addOccurrenceObserver(occurrenceUri, coObserverDid, "co-observer");

        // Also ensure owner is in the table
        await this.db.addOccurrenceObserver(occurrenceUri, sessionDid, "owner");

        logger.info({ occurrenceUri, coObserverDid }, "Added co-observer");

        res.json({ success: true });
      } catch (error) {
        logger.error({ err: error }, "Error adding co-observer");
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Remove co-observer from an occurrence
    this.app.delete("/api/occurrences/:uri(*)/observers/:did(*)", async (req, res) => {
      try {
        const occurrenceUri = req.params["uri"];
        const coObserverDid = req.params["did"];

        if (!occurrenceUri || !coObserverDid) {
          res.status(400).json({ error: "uri and did are required" });
          return;
        }

        // Require authentication
        const sessionDid = req.cookies?.session_did;
        if (!sessionDid) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }

        // Verify user is the owner of the occurrence
        const occurrence = await this.db.getOccurrence(occurrenceUri);
        if (!occurrence) {
          res.status(404).json({ error: "Occurrence not found" });
          return;
        }

        if (occurrence.did !== sessionDid) {
          res.status(403).json({ error: "Only the owner can remove co-observers" });
          return;
        }

        // Remove co-observer (this won't remove the owner)
        await this.db.removeOccurrenceObserver(occurrenceUri, coObserverDid);

        logger.info({ occurrenceUri, coObserverDid }, "Removed co-observer");

        res.json({ success: true });
      } catch (error) {
        logger.error({ err: error }, "Error removing co-observer");
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Delete an occurrence (owner only)
    this.app.delete("/api/occurrences/:uri(*)", async (req, res) => {
      try {
        const occurrenceUri = req.params["uri"];

        if (!occurrenceUri) {
          res.status(400).json({ error: "uri is required" });
          return;
        }

        // Parse the AT URI to extract DID, collection, and rkey
        // Format: at://did:plc:xxx/org.rwell.test.occurrence/rkey
        const uriMatch = occurrenceUri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
        if (!uriMatch) {
          res.status(400).json({ error: "Invalid AT URI format" });
          return;
        }

        const recordDid = uriMatch[1]!;
        const collection = uriMatch[2]!;
        const rkey = uriMatch[3]!;

        // Require authentication
        const sessionDid = req.cookies?.session_did;
        const agent = sessionDid ? await this.oauth.getAgent(sessionDid) : null;

        if (!agent) {
          res.status(401).json({ error: "Authentication required to delete observations" });
          return;
        }

        // Verify user owns this record
        if (sessionDid !== recordDid) {
          res.status(403).json({ error: "You can only delete your own observations" });
          return;
        }

        // Delete from AT Protocol (user's PDS)
        await agent.com.atproto.repo.deleteRecord({
          repo: sessionDid,
          collection,
          rkey,
        });

        logger.info({ uri: occurrenceUri }, "Deleted AT Protocol record");

        // Delete from AppView database (cascading deletes handle identifications, comments, observers)
        await this.db.deleteOccurrence(occurrenceUri);

        res.json({ success: true, message: "Observation deleted" });
      } catch (error) {
        logger.error({ err: error }, "Error deleting occurrence");
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Get observers for an occurrence
    this.app.get("/api/occurrences/:uri(*)/observers", async (req, res) => {
      try {
        const occurrenceUri = req.params["uri"];
        if (!occurrenceUri) {
          res.status(400).json({ error: "uri is required" });
          return;
        }

        const occurrence = await this.db.getOccurrence(occurrenceUri);
        if (!occurrence) {
          res.status(404).json({ error: "Occurrence not found" });
          return;
        }

        const observerData = await this.db.getOccurrenceObservers(occurrenceUri);

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
    this.app.get("/api/occurrences/nearby", async (req, res) => {
      try {
        const lat = parseFloat(req.query["lat"] as string);
        const lng = parseFloat(req.query["lng"] as string);
        const radius = parseFloat(req.query["radius"] as string) || 10000; // default 10km
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

        const rows = await this.db.getOccurrencesNearby(
          lat,
          lng,
          radius,
          limit,
          offset,
        );

        const occurrences = await this.enrichOccurrences(rows);

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
    this.app.get("/api/occurrences/feed", async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query["limit"] as string) || 20, 100);
        const cursor = req.query["cursor"] as string | undefined;

        const rows = await this.db.getOccurrencesFeed(limit, cursor);
        const occurrences = await this.enrichOccurrences(rows);

        // Create cursor for next page
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
    this.app.get("/api/occurrences/bbox", async (req, res) => {
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

        const rows = await this.db.getOccurrencesByBoundingBox(
          minLat,
          minLng,
          maxLat,
          maxLng,
          limit,
        );

        const occurrences = await this.enrichOccurrences(rows);

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
    this.app.get("/api/occurrences/geojson", async (req, res) => {
      try {
        const minLat = parseFloat(req.query["minLat"] as string);
        const minLng = parseFloat(req.query["minLng"] as string);
        const maxLat = parseFloat(req.query["maxLat"] as string);
        const maxLng = parseFloat(req.query["maxLng"] as string);

        if (isNaN(minLat) || isNaN(minLng) || isNaN(maxLat) || isNaN(maxLng)) {
          res.status(400).json({ error: "Bounding box required" });
          return;
        }

        const rows = await this.db.getOccurrencesByBoundingBox(
          minLat,
          minLng,
          maxLat,
          maxLng,
          5000,
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

    // Get single occurrence (must be after specific routes like /geojson)
    this.app.get("/api/occurrences/:uri(*)", async (req, res) => {
      try {
        const uri = req.params["uri"];
        if (!uri) {
          res.status(400).json({ error: "uri is required" });
          return;
        }
        const row = await this.db.getOccurrence(uri);

        if (!row) {
          res.status(404).json({ error: "Occurrence not found" });
          return;
        }

        const [occurrence] = await this.enrichOccurrences([row]);
        const identifications =
          await this.db.getIdentificationsForOccurrence(uri);
        const comments = await this.db.getCommentsForOccurrence(uri);

        res.json({
          occurrence,
          identifications: await this.enrichIdentifications(identifications),
          comments: await this.enrichComments(comments),
        });
      } catch (error) {
        logger.error({ err: error }, "Error fetching occurrence");
        res.status(500).json({ error: "Internal server error" });
      }
    });
  }

  private setupFeedRoutes(): void {
    // Explore feed - public, with optional filters
    this.app.get("/api/feeds/explore", async (req, res) => {
      try {
        const limit = Math.min(parseInt(req.query["limit"] as string) || 20, 100);
        const cursor = req.query["cursor"] as string | undefined;
        const taxon = req.query["taxon"] as string | undefined;
        const lat = req.query["lat"] ? parseFloat(req.query["lat"] as string) : undefined;
        const lng = req.query["lng"] ? parseFloat(req.query["lng"] as string) : undefined;
        const radius = req.query["radius"]
          ? parseFloat(req.query["radius"] as string)
          : undefined;

        const rows = await this.db.getExploreFeed({
          limit,
          ...(cursor && { cursor }),
          ...(taxon && { taxon }),
          ...(lat !== undefined && { lat }),
          ...(lng !== undefined && { lng }),
          ...(radius !== undefined && { radius }),
        });

        const occurrences = await this.enrichOccurrences(rows);

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

    // Home feed - requires authentication, returns follows + nearby
    this.app.get("/api/feeds/home", async (req, res) => {
      try {
        const sessionDid = req.cookies?.session_did;
        if (!sessionDid) {
          res.status(401).json({ error: "Authentication required" });
          return;
        }

        const agent = await this.oauth.getAgent(sessionDid);
        if (!agent) {
          res.status(401).json({ error: "Invalid session" });
          return;
        }

        const limit = Math.min(parseInt(req.query["limit"] as string) || 20, 100);
        const cursor = req.query["cursor"] as string | undefined;
        const lat = req.query["lat"] ? parseFloat(req.query["lat"] as string) : undefined;
        const lng = req.query["lng"] ? parseFloat(req.query["lng"] as string) : undefined;
        const nearbyRadius = req.query["nearbyRadius"]
          ? parseFloat(req.query["nearbyRadius"] as string)
          : undefined;

        // Fetch user's follows
        const resolver = getIdentityResolver();
        const followedDids = await resolver.getFollows(sessionDid, agent);

        const { rows, followedCount, nearbyCount } = await this.db.getHomeFeed(
          followedDids,
          {
            limit,
            ...(cursor && { cursor }),
            ...(lat !== undefined && { lat }),
            ...(lng !== undefined && { lng }),
            ...(nearbyRadius !== undefined && { nearbyRadius }),
          },
        );

        const occurrences = await this.enrichOccurrences(rows);

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
            totalFollows: followedDids.length,
          },
        });
      } catch (error) {
        logger.error({ err: error }, "Error fetching home feed");
        res.status(500).json({ error: "Internal server error" });
      }
    });
  }

  private setupProfileRoutes(): void {
    // Get profile feed - use regex to capture DID with colons
    this.app.get(/^\/api\/profiles\/(.+)\/feed$/, async (req, res) => {
      try {
        const did = decodeURIComponent(req.params[0] ?? "");
        const limit = Math.min(parseInt(req.query["limit"] as string) || 20, 100);
        const cursor = req.query["cursor"] as string | undefined;
        const type = (req.query["type"] as "observations" | "identifications" | "all") || "all";

        const { occurrences, identifications, counts } = await this.db.getProfileFeed(
          did,
          {
            limit,
            type,
            ...(cursor && { cursor }),
          },
        );

        // Enrich occurrences
        const enrichedOccurrences = await this.enrichOccurrences(occurrences);

        // Enrich identifications
        const enrichedIdentifications = await this.enrichIdentifications(identifications);

        // Get profile info
        const resolver = getIdentityResolver();
        const profile = await resolver.getProfile(did);

        // Determine next cursor based on what was returned
        let nextCursor: string | undefined;
        const lastOcc = occurrences[occurrences.length - 1];
        const lastId = identifications[identifications.length - 1];
        if (type === "observations" && occurrences.length === limit && lastOcc) {
          nextCursor = lastOcc.created_at.toISOString();
        } else if (type === "identifications" && identifications.length === limit && lastId) {
          nextCursor = lastId.date_identified.toISOString();
        } else if (type === "all") {
          // For "all", use the oldest timestamp between the two
          if (lastOcc && lastId) {
            nextCursor =
              lastOcc.created_at < lastId.date_identified
                ? lastOcc.created_at.toISOString()
                : lastId.date_identified.toISOString();
          } else if (lastOcc) {
            nextCursor = lastOcc.created_at.toISOString();
          } else if (lastId) {
            nextCursor = lastId.date_identified.toISOString();
          }
        }

        res.json({
          profile: profile
            ? {
                did: profile.did,
                handle: profile.handle,
                displayName: profile.displayName,
                avatar: profile.avatar,
              }
            : { did },
          counts,
          occurrences: enrichedOccurrences,
          identifications: enrichedIdentifications,
          cursor: nextCursor,
        });
      } catch (error) {
        logger.error({ err: error }, "Error fetching profile feed");
        res.status(500).json({ error: "Internal server error" });
      }
    });
  }

  private setupIdentificationRoutes(): void {
    // Create a new identification
    this.app.post("/api/identifications", async (req, res) => {
      try {
        // Validate request body with Zod schema
        const parseResult = CreateIdentificationRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(400).json({
            error: "Validation failed",
            details: parseResult.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          });
          return;
        }

        const {
          occurrenceUri,
          occurrenceCid,
          subjectIndex,
          taxonName,
          taxonRank,
          comment,
          isAgreement,
          confidence,
        } = parseResult.data;

        // Require authentication
        const sessionDid = req.cookies?.session_did;
        const agent = sessionDid ? await this.oauth.getAgent(sessionDid) : null;

        if (!agent) {
          res.status(401).json({ error: "Authentication required to add identifications" });
          return;
        }

        // Fetch taxonomy hierarchy from GBIF
        const validationResult = await this.taxonomy.validate(taxonName.trim());
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
          // Darwin Core taxonomy fields from GBIF
          taxonId: taxon?.id,
          vernacularName: taxon?.commonName,
          kingdom: taxon?.kingdom,
          phylum: taxon?.phylum,
          class: taxon?.class,
          order: taxon?.order,
          family: taxon?.family,
          genus: taxon?.genus,
        };

        // Create the record on the user's PDS
        const result = await agent.com.atproto.repo.createRecord({
          repo: sessionDid,
          collection: "org.rwell.test.identification",
          record,
        });

        logger.info(
          { uri: result.data.uri, occurrenceUri, isAgreement },
          "Created identification record"
        );

        res.status(201).json({
          success: true,
          uri: result.data.uri,
          cid: result.data.cid,
        });
      } catch (error) {
        logger.error({ err: error }, "Error creating identification");
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Get identifications for an occurrence
    this.app.get("/api/identifications/:occurrenceUri(*)", async (req, res) => {
      try {
        const occurrenceUri = req.params["occurrenceUri"];
        if (!occurrenceUri) {
          res.status(400).json({ error: "occurrenceUri is required" });
          return;
        }
        const rows =
          await this.db.getIdentificationsForOccurrence(occurrenceUri);
        const identifications = await this.enrichIdentifications(rows);

        // Calculate community ID
        const communityTaxon = await this.communityId.calculate(occurrenceUri);

        res.json({
          identifications,
          communityId: communityTaxon,
        });
      } catch (error) {
        logger.error({ err: error }, "Error fetching identifications");
        res.status(500).json({ error: "Internal server error" });
      }
    });
  }

  private setupCommentRoutes(): void {
    // Create a new comment on an observation
    this.app.post("/api/comments", async (req, res) => {
      try {
        // Validate request body with Zod schema
        const parseResult = CreateCommentRequestSchema.safeParse(req.body);
        if (!parseResult.success) {
          res.status(400).json({
            error: "Validation failed",
            details: parseResult.error.issues.map((i) => ({
              path: i.path.join("."),
              message: i.message,
            })),
          });
          return;
        }

        const {
          occurrenceUri,
          occurrenceCid,
          body,
          replyToUri,
          replyToCid,
        } = parseResult.data;

        // Require authentication
        const sessionDid = req.cookies?.session_did;
        const agent = sessionDid ? await this.oauth.getAgent(sessionDid) : null;

        if (!agent) {
          res.status(401).json({ error: "Authentication required to add comments" });
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

        // Create the record on the user's PDS
        const result = await agent.com.atproto.repo.createRecord({
          repo: sessionDid,
          collection: "org.rwell.test.comment",
          record,
        });

        logger.info(
          { uri: result.data.uri, occurrenceUri },
          "Created comment record"
        );

        res.status(201).json({
          success: true,
          uri: result.data.uri,
          cid: result.data.cid,
        });
      } catch (error) {
        logger.error({ err: error }, "Error creating comment");
        res.status(500).json({ error: "Internal server error" });
      }
    });
  }

  private setupTaxonomyRoutes(): void {
    // Search taxa
    this.app.get("/api/taxa/search", async (req, res) => {
      try {
        const query = req.query["q"] as string;
        if (!query || query.length < 2) {
          res
            .status(400)
            .json({ error: "Query must be at least 2 characters" });
          return;
        }

        const results = await this.taxonomy.search(query);
        res.json({ results });
      } catch (error) {
        logger.error({ err: error }, "Error searching taxa");
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Validate taxon name
    this.app.get("/api/taxa/validate", async (req, res) => {
      try {
        const name = req.query["name"] as string;
        if (!name) {
          res.status(400).json({ error: "name parameter required" });
          return;
        }

        const result = await this.taxonomy.validate(name);
        res.json(result);
      } catch (error) {
        logger.error({ err: error }, "Error validating taxon");
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Helper to resolve a taxon from an ID or name string
    const resolveTaxon = async (idOrName: string) => {
      if (idOrName.startsWith("gbif:")) {
        return this.taxonomy.getById(idOrName);
      }
      return this.taxonomy.getByName(idOrName);
    };

    // Get taxon occurrences by kingdom + name (must be before /:param1/:param2)
    this.app.get("/api/taxa/:kingdom/:name/occurrences", async (req, res) => {
      try {
        const kingdom = decodeURIComponent(req.params["kingdom"] ?? "");
        const name = decodeURIComponent(req.params["name"] ?? "");
        const cursor = req.query["cursor"] as string | undefined;
        const limit = Math.min(parseInt(req.query["limit"] as string) || 20, 100);

        const taxon = await this.taxonomy.getByName(name, kingdom);
        if (!taxon) {
          res.status(404).json({ error: "Taxon not found" });
          return;
        }

        const rows = await this.db.getOccurrencesByTaxon(
          taxon.scientificName,
          taxon.rank,
          { limit, ...(cursor && { cursor }), ...(taxon.kingdom && { kingdom: taxon.kingdom }) },
        );

        const occurrences = await this.enrichOccurrences(rows);

        const nextCursor = rows.length === limit
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
    this.app.get("/api/taxa/:id/occurrences", async (req, res) => {
      try {
        const idOrName = decodeURIComponent(req.params["id"] ?? "");
        const cursor = req.query["cursor"] as string | undefined;
        const limit = Math.min(parseInt(req.query["limit"] as string) || 20, 100);

        const taxon = await resolveTaxon(idOrName);
        if (!taxon) {
          res.status(404).json({ error: "Taxon not found" });
          return;
        }

        const rows = await this.db.getOccurrencesByTaxon(
          taxon.scientificName,
          taxon.rank,
          { limit, ...(cursor && { cursor }), ...(taxon.kingdom && { kingdom: taxon.kingdom }) },
        );

        const occurrences = await this.enrichOccurrences(rows);

        const nextCursor = rows.length === limit
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
    this.app.get("/api/taxa/:kingdom/:name", async (req, res) => {
      try {
        const kingdom = decodeURIComponent(req.params["kingdom"] ?? "");
        const name = decodeURIComponent(req.params["name"] ?? "");

        const taxon = await this.taxonomy.getByName(name, kingdom);
        if (!taxon) {
          res.status(404).json({ error: "Taxon not found" });
          return;
        }

        const observationCount = await this.db.countOccurrencesByTaxon(
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
    this.app.get("/api/taxa/:id", async (req, res) => {
      try {
        const idOrName = decodeURIComponent(req.params["id"] ?? "");

        const taxon = await resolveTaxon(idOrName);
        if (!taxon) {
          res.status(404).json({ error: "Taxon not found" });
          return;
        }

        const observationCount = await this.db.countOccurrencesByTaxon(
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
  }

  private async enrichOccurrences(
    rows: OccurrenceRow[],
  ): Promise<OccurrenceResponse[]> {
    if (rows.length === 0) return [];

    // Fetch all observers for all occurrences
    const observersByUri = new Map<string, Array<{ did: string; role: "owner" | "co-observer"; addedAt: Date }>>();
    await Promise.all(
      rows.map(async (row) => {
        const observers = await this.db.getOccurrenceObservers(row.uri);
        observersByUri.set(row.uri, observers);
      }),
    );

    // Collect all unique DIDs (owners and co-observers)
    const allDids = new Set<string>();
    rows.forEach((r) => allDids.add(r.did));
    observersByUri.forEach((observers) => {
      observers.forEach((o) => allDids.add(o.did));
    });

    const resolver = getIdentityResolver();
    const profiles = await resolver.getProfiles([...allDids]);

    return Promise.all(
      rows.map(async (row) => {
        const profile = profiles.get(row.did);
        const observerData = observersByUri.get(row.uri) || [];

        // Build observers array with profile info
        const observers: ObserverInfo[] = observerData.map((o) => {
          const p = profiles.get(o.did);
          return ({
            did: o.did,
            handle: p?.handle,
            displayName: p?.displayName,
            avatar: p?.avatar,
            role: o.role,
          });
        });

        // If no observers in table yet, add owner from occurrence
        if (observers.length === 0) {
          observers.push(({
            did: row.did,
            handle: profile?.handle,
            displayName: profile?.displayName,
            avatar: profile?.avatar,
            role: "owner" as const,
          }));
        }

        // Get all subjects for this occurrence
        const subjectData = await this.db.getSubjectsForOccurrence(row.uri);

        // Build subjects array with community IDs
        const subjects: SubjectResponse[] = [];

        // Always include subject 0
        if (!subjectData.some((s) => s.subjectIndex === 0)) {
          subjectData.unshift({
            subjectIndex: 0,
            identificationCount: 0,
            latestIdentification: null,
          });
        }

        for (const subject of subjectData) {
          const subjectCommunityId = await this.db.getCommunityId(
            row.uri,
            subject.subjectIndex,
          );
          subjects.push(({
            index: subject.subjectIndex,
            communityId: subjectCommunityId || undefined,
            identificationCount: subject.identificationCount,
          }));
        }

        // Get community ID for subject 0 (backward compat)
        const communityId = await this.db.getCommunityId(row.uri, 0);

        // Get effective taxonomy from winning identification or GBIF lookup
        let effectiveTaxonomy: EffectiveTaxonomy | undefined;
        const effectiveName = communityId || row.scientific_name;
        if (effectiveName) {
          const identifications = communityId
            ? await this.db.getIdentificationsForOccurrence(row.uri)
            : [];
          // Find identification that matches community ID
          const winningId = identifications.find(
            (id) =>
              id.subject_index === 0 &&
              id.scientific_name?.toLowerCase() === communityId?.toLowerCase()
          );
          if (winningId?.kingdom) {
            // Use winning identification taxonomy if it has kingdom data
            effectiveTaxonomy = {
              scientificName: winningId.scientific_name,
              taxonId: undefined,
              taxonRank: winningId.taxon_rank || undefined,
              vernacularName: winningId.vernacular_name || undefined,
              kingdom: winningId.kingdom,
              phylum: winningId.phylum || undefined,
              class: winningId.class || undefined,
              order: winningId.order || undefined,
              family: winningId.family || undefined,
              genus: winningId.genus || undefined,
            };
          } else {
            // Look up taxonomy from GBIF when winning identification lacks kingdom
            try {
              const taxonDetail = await this.taxonomy.getByName(effectiveName);
              if (taxonDetail) {
                effectiveTaxonomy = {
                  scientificName: taxonDetail.scientificName,
                  taxonId: undefined,
                  taxonRank: taxonDetail.rank || undefined,
                  vernacularName: taxonDetail.commonName || undefined,
                  kingdom: taxonDetail.kingdom || undefined,
                  phylum: taxonDetail.phylum || undefined,
                  class: taxonDetail.class || undefined,
                  order: taxonDetail.order || undefined,
                  family: taxonDetail.family || undefined,
                  genus: taxonDetail.genus || undefined,
                };
              }
            } catch {
              // GBIF lookup failed, leave effectiveTaxonomy undefined
            }
          }
        }

        return ({
          uri: row.uri,
          cid: row.cid,
          observer: ({
            did: row.did,
            handle: profile?.handle,
            displayName: profile?.displayName,
            avatar: profile?.avatar,
          }),
          observers,
          // Darwin Core fields
          scientificName: row.scientific_name || undefined,
          communityId: communityId || undefined,
          effectiveTaxonomy,
          subjects,
          eventDate: row.event_date.toISOString(),
          location: ({
            latitude: row.latitude,
            longitude: row.longitude,
            uncertaintyMeters: row.coordinate_uncertainty_meters || undefined,
            // Darwin Core administrative geography
            continent: row.continent || undefined,
            country: row.country || undefined,
            countryCode: row.country_code || undefined,
            stateProvince: row.state_province || undefined,
            county: row.county || undefined,
            municipality: row.municipality || undefined,
            locality: row.locality || undefined,
            waterBody: row.water_body || undefined,
          }),
          verbatimLocality: row.verbatim_locality || undefined,
          occurrenceRemarks: row.occurrence_remarks || undefined,
          // Taxonomy fields
          taxonId: row.taxon_id || undefined,
          taxonRank: row.taxon_rank || undefined,
          vernacularName: row.vernacular_name || undefined,
          kingdom: row.kingdom || undefined,
          phylum: row.phylum || undefined,
          class: row.class || undefined,
          order: row.order || undefined,
          family: row.family || undefined,
          genus: row.genus || undefined,
          images: (
            (row.associated_media || []) as Array<{
              image: { ref: string | { $link: string } };
            }>
          ).map((b) => {
            const ref = b.image?.ref;
            const cid =
              typeof ref === "string" ? ref : (ref as { $link: string })?.$link;
            return `/media/blob/${row.did}/${cid || ""}`;
          }),
          createdAt: row.created_at.toISOString(),
        });
      }),
    );
  }

  private async enrichIdentifications(
    rows: IdentificationRow[],
  ): Promise<Array<IdentificationRow & { identifier?: Partial<Profile> }>> {
    if (rows.length === 0) return [];

    const dids = [...new Set(rows.map((r) => r.did))];
    const resolver = getIdentityResolver();
    const profiles = await resolver.getProfiles(dids);

    return rows.map((row) => {
      const profile = profiles.get(row.did);
      return {
        ...row,
        ...(profile && {
          identifier: ({
            did: profile.did,
            handle: profile.handle,
            displayName: profile.displayName,
            avatar: profile.avatar,
          }),
        }),
      };
    });
  }

  private async enrichComments(
    rows: CommentRow[],
  ): Promise<Array<CommentRow & { commenter?: Partial<Profile> }>> {
    if (rows.length === 0) return [];

    const dids = [...new Set(rows.map((r) => r.did))];
    const resolver = getIdentityResolver();
    const profiles = await resolver.getProfiles(dids);

    return rows.map((row) => {
      const profile = profiles.get(row.did);
      return {
        ...row,
        ...(profile && {
          commenter: ({
            did: profile.did,
            handle: profile.handle,
            displayName: profile.displayName,
            avatar: profile.avatar,
          }),
        }),
      };
    });
  }

  private setupApiDocs(): void {
    // Load OpenAPI spec from observing-shared
    const openapiPath = path.join(__dirname, "../../observing-shared/openapi.json");
    try {
      const openapiSpec = JSON.parse(fs.readFileSync(openapiPath, "utf-8"));
      this.app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(openapiSpec, {
        customCss: ".swagger-ui .topbar { display: none }",
        customSiteTitle: "Observ.ing API Documentation",
      }));
      this.app.get("/api/openapi.json", (_req, res) => {
        res.json(openapiSpec);
      });
      logger.info("API documentation available at /api/docs");
    } catch (error) {
      logger.warn({ err: error }, "OpenAPI spec not found, /api/docs will not be available");
    }
  }

  private setupMediaProxy(): void {
    const mediaProxyUrl = process.env["MEDIA_PROXY_URL"] || "http://localhost:3001";

    this.app.get("/media/*", async (req, res) => {
      try {
        // Strip /media prefix and forward to media-proxy
        const targetPath = req.path.replace(/^\/media/, "");
        const targetUrl = `${mediaProxyUrl}${targetPath}`;

        const response = await fetch(targetUrl);

        if (!response.ok) {
          res.status(response.status).send(response.statusText);
          return;
        }

        // Forward relevant headers
        const contentType = response.headers.get("content-type");
        const cacheControl = response.headers.get("cache-control");

        if (contentType) res.setHeader("Content-Type", contentType);
        if (cacheControl) res.setHeader("Cache-Control", cacheControl);

        // Stream the response body
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
      } catch (error) {
        logger.error({ err: error, path: req.path }, "Media proxy error");
        res.status(502).json({ error: "Media proxy unavailable" });
      }
    });
  }

  async start(): Promise<void> {
    await this.db.connect();
    await this.db.migrate();
    await this.oauth.initialize();

    return new Promise((resolve) => {
      this.app.listen(this.config.port, () => {
        logger.info({ port: this.config.port }, "AppView server listening");
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await this.db.disconnect();
  }
}

// CLI entry point - only run when executed directly, not when imported
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('observing-appview/dist/api.js');

if (isMainModule) {
  const server = new AppViewServer({
    port: parseInt(process.env["PORT"] || "3000"),
    databaseUrl: getDatabaseUrl(),
    corsOrigins: process.env["CORS_ORIGINS"]?.split(",") || [
      "http://localhost:5173",
    ],
  });

  process.on("SIGINT", async () => {
    logger.info("Shutting down...");
    await server.stop();
    process.exit(0);
  });

  server.start().catch((error: unknown) => {
    logger.fatal({ err: error }, "Fatal error");
    process.exit(1);
  });
}
