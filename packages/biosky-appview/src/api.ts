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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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

          console.log("Created AT Protocol record:", result.data.uri);

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
        console.error("Error creating occurrence:", error);
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
        console.error("Error fetching nearby occurrences:", error);
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
        console.error("Error fetching feed:", error);
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
        console.error("Error fetching bbox occurrences:", error);
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
        console.error("Error generating GeoJSON:", error);
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
        console.error("Error fetching occurrence:", error);
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
        console.error("Error fetching identifications:", error);
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
        console.error("Error searching taxa:", error);
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
        console.error("Error validating taxon:", error);
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
            row.associated_media as Array<{ image: { ref: string } }>
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
        console.log(`AppView server listening on port ${this.config.port}`);
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
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  });

  server.start().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    process.stderr.write(`Fatal error: ${message}\n`);
    if (stack) process.stderr.write(`${stack}\n`);
    process.exit(1);
  });
}
