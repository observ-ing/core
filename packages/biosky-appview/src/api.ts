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
  getDatabaseUrl,
  getIdentityResolver,
  OAuthService,
  DatabaseStateStore,
  DatabaseSessionStore,
  type OccurrenceRow,
  type IdentificationRow,
  type Profile,
} from "biosky-shared";
import { TaxonomyResolver } from "./taxonomy.js";
import { CommunityIdCalculator } from "./community-id.js";

interface AppViewConfig {
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  publicUrl: string;
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
  communityId?: string;
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
    this.app.use(express.json());
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
        } = req.body;

        if (!latitude || !longitude) {
          res.status(400).json({ error: "latitude and longitude are required" });
          return;
        }

        // Check if user is authenticated
        const sessionDid = req.cookies?.session_did;
        const agent = sessionDid ? await this.oauth.getAgent(sessionDid) : null;

        if (agent) {
          // User is authenticated - post to AT Protocol network
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

          // Create the record on the user's PDS
          const result = await agent.com.atproto.repo.createRecord({
            repo: sessionDid,
            collection: "org.rwell.test.occurrence",
            record,
          });

          logger.info({ uri: result.data.uri }, "Created AT Protocol record");

          res.status(201).json({
            success: true,
            uri: result.data.uri,
            cid: result.data.cid,
            message: "Observation posted to AT Protocol network",
          });
        } else {
          // Demo mode - insert directly into database with fake DID
          const did = "did:plc:demo-user-" + Math.random().toString(36).slice(2, 10);
          const rkey = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          const uri = `at://${did}/org.rwell.test.occurrence/${rkey}`;
          const cid = "bafyrei" + Math.random().toString(36).slice(2, 50);

          await this.db.upsertOccurrence({
            uri,
            cid,
            did,
            action: "create",
            seq: Date.now(),
            time: new Date().toISOString(),
            record: {
              $type: "org.rwell.test.occurrence",
              basisOfRecord: "HumanObservation",
              scientificName: scientificName || undefined,
              eventDate: eventDate || new Date().toISOString(),
              location: {
                decimalLatitude: latitude,
                decimalLongitude: longitude,
                coordinateUncertaintyInMeters: 50,
                geodeticDatum: "WGS84",
              },
              occurrenceStatus: "present",
              notes: notes || undefined,
              blobs: [],
              createdAt: new Date().toISOString(),
            },
          });

          res.status(201).json({
            success: true,
            uri,
            message: "Observation created (demo mode - login to post to AT Protocol)",
          });
        }
      } catch (error) {
        logger.error({ err: error }, "Error creating occurrence");
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
        const communityId = await this.db.getCommunityId(row.uri);

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
            (row.associated_media || []) as Array<{ image: { ref: string } }>
          ).map((b) => `/media/blob/${row.did}/${b.image?.ref || ""}`),
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

  async start(): Promise<void> {
    await this.db.connect();
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
