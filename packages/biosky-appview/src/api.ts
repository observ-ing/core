/**
 * AppView REST API
 *
 * Provides geospatial and biodiversity data endpoints
 * for the BioSky frontend.
 */

import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
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
} from "./database/index.js";
import {
  getIdentityResolver,
  OAuthService,
  DatabaseStateStore,
  DatabaseSessionStore,
  type Profile,
} from "./auth/index.js";

// Utility to build DATABASE_URL from environment variables
function getDatabaseUrl(): string {
  // If DB_PASSWORD is set, construct URL from individual components (GCP Secret Manager)
  if (process.env.DB_PASSWORD) {
    const host = process.env.DB_HOST || "localhost";
    const name = process.env.DB_NAME || "biosky";
    const user = process.env.DB_USER || "postgres";
    const password = process.env.DB_PASSWORD;
    return `postgresql://${user}:${password}@/${name}?host=${host}`;
  }
  // Otherwise use DATABASE_URL directly (local dev)
  return process.env.DATABASE_URL || "postgresql://localhost:5432/biosky";
}
import { TaxonomyResolver } from "./taxonomy.js";
import { CommunityIdCalculator } from "./community-id.js";

interface AppViewConfig {
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  publicUrl: string;
}

interface SubjectResponse {
  index: number;
  communityId?: string;
  identificationCount: number;
}

interface OccurrenceResponse {
  uri: string;
  cid: string;
  observer: {
    did: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
  };
  // Darwin Core fields
  basisOfRecord: string;
  scientificName?: string;
  communityId?: string; // Keep for backward compat (refers to subject 0)
  subjects: SubjectResponse[]; // All subjects with their community IDs
  eventDate: string;
  location: {
    latitude: number;
    longitude: number;
    uncertaintyMeters?: number;
  };
  verbatimLocality?: string;
  habitat?: string;
  occurrenceStatus: string;
  occurrenceRemarks?: string;
  individualCount?: number;
  sex?: string;
  lifeStage?: string;
  behavior?: string;
  images: string[];
  createdAt: string;
  identificationCount?: number;
}

// Legacy alias
type ObservationResponse = OccurrenceResponse;

export class AppViewServer {
  private app: express.Application;
  private config: AppViewConfig;
  private db: Database;
  private oauth: OAuthService;
  private taxonomy: TaxonomyResolver;
  private communityId: CommunityIdCalculator;

  constructor(config: Partial<AppViewConfig> = {}) {
    this.config = {
      port: config.port || 3000,
      databaseUrl:
        config.databaseUrl ||
        process.env.DATABASE_URL ||
        "postgresql://localhost:5432/biosky",
      corsOrigins: config.corsOrigins || ["http://localhost:5173"],
      publicUrl: config.publicUrl || process.env.PUBLIC_URL || "http://localhost:3000",
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

    this.taxonomy = new TaxonomyResolver();
    this.communityId = new CommunityIdCalculator(this.db);

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

    // Taxonomy API
    this.setupTaxonomyRoutes();

    // Proxy media requests to media-proxy service
    this.setupMediaProxy();

    // Serve frontend static files in production
    // In dev: __dirname is packages/biosky-appview/src, public is at ../../dist/public
    // In prod: __dirname is /app/packages/biosky-appview/dist, public is at /app/dist/public
    const publicPath =
      process.env.NODE_ENV === "production"
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
        const {
          scientificName,
          latitude,
          longitude,
          notes,
          eventDate,
          images,
        } = req.body;

        if (!latitude || !longitude) {
          res.status(400).json({ error: "latitude and longitude are required" });
          return;
        }

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
          },
          notes: notes || undefined,
          createdAt: new Date().toISOString(),
        };

        // Add images if any were successfully uploaded
        if (associatedMedia.length > 0) {
          record.associatedMedia = associatedMedia;
        }

        // Create the record on the user's PDS
        const result = await agent.com.atproto.repo.createRecord({
          repo: sessionDid,
          collection: "org.rwell.test.occurrence",
          record,
        });

        logger.info({ uri: result.data.uri, imageCount: associatedMedia.length }, "Created AT Protocol record");

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
          eventDate,
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

        // Build the updated record
        const record = {
          $type: "org.rwell.test.occurrence",
          scientificName: scientificName || undefined,
          eventDate: eventDate || new Date().toISOString(),
          location: {
            decimalLatitude: String(latitude),
            decimalLongitude: String(longitude),
            coordinateUncertaintyInMeters: 50,
            geodeticDatum: "WGS84",
          },
          notes: notes || undefined,
          createdAt: new Date().toISOString(),
        };

        // Update the record on the user's PDS using putRecord
        const result = await agent.com.atproto.repo.putRecord({
          repo: sessionDid,
          collection,
          rkey,
          record,
        });

        logger.info({ uri: result.data.uri }, "Updated AT Protocol record");

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

    // Get occurrences nearby
    this.app.get("/api/occurrences/nearby", async (req, res) => {
      try {
        const lat = parseFloat(req.query.lat as string);
        const lng = parseFloat(req.query.lng as string);
        const radius = parseFloat(req.query.radius as string) || 10000; // default 10km
        const limit = parseInt(req.query.limit as string) || 100;
        const offset = parseInt(req.query.offset as string) || 0;

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
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const cursor = req.query.cursor as string | undefined;

        const rows = await this.db.getOccurrencesFeed(limit, cursor);
        const occurrences = await this.enrichOccurrences(rows);

        // Create cursor for next page
        const nextCursor =
          rows.length === limit
            ? rows[rows.length - 1].created_at.toISOString()
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
        const minLat = parseFloat(req.query.minLat as string);
        const minLng = parseFloat(req.query.minLng as string);
        const maxLat = parseFloat(req.query.maxLat as string);
        const maxLng = parseFloat(req.query.maxLng as string);
        const limit = parseInt(req.query.limit as string) || 1000;

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
        const minLat = parseFloat(req.query.minLat as string);
        const minLng = parseFloat(req.query.minLng as string);
        const maxLat = parseFloat(req.query.maxLat as string);
        const maxLng = parseFloat(req.query.maxLng as string);

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
            basisOfRecord: row.basis_of_record,
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
        const uri = req.params.uri;
        const row = await this.db.getOccurrence(uri);

        if (!row) {
          res.status(404).json({ error: "Occurrence not found" });
          return;
        }

        const [occurrence] = await this.enrichOccurrences([row]);
        const identifications =
          await this.db.getIdentificationsForOccurrence(uri);

        res.json({
          occurrence,
          identifications: await this.enrichIdentifications(identifications),
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
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const cursor = req.query.cursor as string | undefined;
        const taxon = req.query.taxon as string | undefined;
        const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
        const lng = req.query.lng ? parseFloat(req.query.lng as string) : undefined;
        const radius = req.query.radius
          ? parseFloat(req.query.radius as string)
          : undefined;

        const rows = await this.db.getExploreFeed({
          limit,
          cursor,
          taxon,
          lat,
          lng,
          radius,
        });

        const occurrences = await this.enrichOccurrences(rows);

        const nextCursor =
          rows.length === limit
            ? rows[rows.length - 1].created_at.toISOString()
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

        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const cursor = req.query.cursor as string | undefined;
        const lat = req.query.lat ? parseFloat(req.query.lat as string) : undefined;
        const lng = req.query.lng ? parseFloat(req.query.lng as string) : undefined;
        const nearbyRadius = req.query.nearbyRadius
          ? parseFloat(req.query.nearbyRadius as string)
          : undefined;

        // Fetch user's follows
        const resolver = getIdentityResolver();
        const followedDids = await resolver.getFollows(sessionDid, agent);

        const { rows, followedCount, nearbyCount } = await this.db.getHomeFeed(
          followedDids,
          { limit, cursor, lat, lng, nearbyRadius },
        );

        const occurrences = await this.enrichOccurrences(rows);

        const nextCursor =
          rows.length === limit
            ? rows[rows.length - 1].created_at.toISOString()
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
        const did = decodeURIComponent(req.params[0]);
        const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
        const cursor = req.query.cursor as string | undefined;
        const type = (req.query.type as "observations" | "identifications" | "all") || "all";

        const { occurrences, identifications, counts } = await this.db.getProfileFeed(
          did,
          { limit, cursor, type },
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
        if (type === "observations" && occurrences.length === limit) {
          nextCursor = occurrences[occurrences.length - 1].created_at.toISOString();
        } else if (type === "identifications" && identifications.length === limit) {
          nextCursor = identifications[identifications.length - 1].date_identified.toISOString();
        } else if (type === "all") {
          // For "all", use the oldest timestamp between the two
          const lastOcc = occurrences[occurrences.length - 1];
          const lastId = identifications[identifications.length - 1];
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

        // Require authentication
        const sessionDid = req.cookies?.session_did;
        const agent = sessionDid ? await this.oauth.getAgent(sessionDid) : null;

        if (!agent) {
          res.status(401).json({ error: "Authentication required to add identifications" });
          return;
        }

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
        const occurrenceUri = req.params.occurrenceUri;
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

  private setupTaxonomyRoutes(): void {
    // Search taxa
    this.app.get("/api/taxa/search", async (req, res) => {
      try {
        const query = req.query.q as string;
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
        const name = req.query.name as string;
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
  }

  private async enrichOccurrences(
    rows: OccurrenceRow[],
  ): Promise<OccurrenceResponse[]> {
    if (rows.length === 0) return [];

    // Fetch profiles for all observers
    const dids = [...new Set(rows.map((r) => r.did))];
    const resolver = getIdentityResolver();
    const profiles = await resolver.getProfiles(dids);

    return Promise.all(
      rows.map(async (row) => {
        const profile = profiles.get(row.did);

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
          subjects.push({
            index: subject.subjectIndex,
            communityId: subjectCommunityId || undefined,
            identificationCount: subject.identificationCount,
          });
        }

        // Get community ID for subject 0 (backward compat)
        const communityId = await this.db.getCommunityId(row.uri, 0);

        return {
          uri: row.uri,
          cid: row.cid,
          observer: {
            did: row.did,
            handle: profile?.handle,
            displayName: profile?.displayName,
            avatar: profile?.avatar,
          },
          // Darwin Core fields
          basisOfRecord: row.basis_of_record,
          scientificName: row.scientific_name || undefined,
          communityId: communityId || undefined,
          subjects,
          eventDate: row.event_date.toISOString(),
          location: {
            latitude: row.latitude,
            longitude: row.longitude,
            uncertaintyMeters: row.coordinate_uncertainty_meters || undefined,
          },
          verbatimLocality: row.verbatim_locality || undefined,
          habitat: row.habitat || undefined,
          occurrenceStatus: row.occurrence_status,
          occurrenceRemarks: row.occurrence_remarks || undefined,
          individualCount: row.individual_count || undefined,
          sex: row.sex || undefined,
          lifeStage: row.life_stage || undefined,
          behavior: row.behavior || undefined,
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
        };
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
        identifier: profile
          ? {
              did: profile.did,
              handle: profile.handle,
              displayName: profile.displayName,
              avatar: profile.avatar,
            }
          : undefined,
      };
    });
  }

  private setupMediaProxy(): void {
    const mediaProxyUrl = process.env.MEDIA_PROXY_URL || "http://localhost:3001";

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
  process.argv[1]?.endsWith('biosky-appview/dist/api.js');

if (isMainModule) {
  const server = new AppViewServer({
    port: parseInt(process.env.PORT || "3000"),
    databaseUrl: getDatabaseUrl(),
    corsOrigins: process.env.CORS_ORIGINS?.split(",") || [
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
