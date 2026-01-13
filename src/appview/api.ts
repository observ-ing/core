/**
 * AppView REST API
 *
 * Provides geospatial and biodiversity data endpoints
 * for the BioSky frontend.
 */

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import {
  Database,
  ObservationRow,
  IdentificationRow,
} from "../ingester/database.js";
import { getIdentityResolver, Profile } from "../auth/identity.js";
import { OAuthService } from "../auth/oauth.js";
import { TaxonomyResolver } from "./taxonomy.js";
import { CommunityIdCalculator } from "./community-id.js";

interface AppViewConfig {
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
}

interface ObservationResponse {
  uri: string;
  cid: string;
  observer: {
    did: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
  };
  scientificName: string;
  communityId?: string;
  eventDate: string;
  location: {
    latitude: number;
    longitude: number;
    uncertaintyMeters?: number;
  };
  verbatimLocality?: string;
  notes?: string;
  images: string[];
  createdAt: string;
  identificationCount?: number;
}

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
    };

    this.app = express();
    this.db = new Database(this.config.databaseUrl);
    this.oauth = new OAuthService();
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

    // Observations API
    this.setupObservationRoutes();

    // Identifications API
    this.setupIdentificationRoutes();

    // Taxonomy API
    this.setupTaxonomyRoutes();
  }

  private setupObservationRoutes(): void {
    // Get observations nearby
    this.app.get("/api/observations/nearby", async (req, res) => {
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

        const rows = await this.db.getObservationsNearby(
          lat,
          lng,
          radius,
          limit,
          offset,
        );

        const observations = await this.enrichObservations(rows);

        res.json({
          observations,
          meta: {
            lat,
            lng,
            radius,
            limit,
            offset,
            count: observations.length,
          },
        });
      } catch (error) {
        console.error("Error fetching nearby observations:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Get observations in bounding box
    this.app.get("/api/observations/bbox", async (req, res) => {
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

        const rows = await this.db.getObservationsByBoundingBox(
          minLat,
          minLng,
          maxLat,
          maxLng,
          limit,
        );

        const observations = await this.enrichObservations(rows);

        res.json({
          observations,
          meta: {
            bounds: { minLat, minLng, maxLat, maxLng },
            count: observations.length,
          },
        });
      } catch (error) {
        console.error("Error fetching bbox observations:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Get single observation
    this.app.get("/api/observations/:uri(*)", async (req, res) => {
      try {
        const uri = req.params.uri;
        const row = await this.db.getObservation(uri);

        if (!row) {
          res.status(404).json({ error: "Observation not found" });
          return;
        }

        const [observation] = await this.enrichObservations([row]);
        const identifications =
          await this.db.getIdentificationsForObservation(uri);

        res.json({
          observation,
          identifications: await this.enrichIdentifications(identifications),
        });
      } catch (error) {
        console.error("Error fetching observation:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Get GeoJSON for map clustering
    this.app.get("/api/observations/geojson", async (req, res) => {
      try {
        const minLat = parseFloat(req.query.minLat as string);
        const minLng = parseFloat(req.query.minLng as string);
        const maxLat = parseFloat(req.query.maxLat as string);
        const maxLng = parseFloat(req.query.maxLng as string);

        if (isNaN(minLat) || isNaN(minLng) || isNaN(maxLat) || isNaN(maxLng)) {
          res.status(400).json({ error: "Bounding box required" });
          return;
        }

        const rows = await this.db.getObservationsByBoundingBox(
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
        console.error("Error generating GeoJSON:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
  }

  private setupIdentificationRoutes(): void {
    // Get identifications for an observation
    this.app.get(
      "/api/identifications/:observationUri(*)",
      async (req, res) => {
        try {
          const observationUri = req.params.observationUri;
          const rows =
            await this.db.getIdentificationsForObservation(observationUri);
          const identifications = await this.enrichIdentifications(rows);

          // Calculate community ID
          const communityTaxon =
            await this.communityId.calculate(observationUri);

          res.json({
            identifications,
            communityId: communityTaxon,
          });
        } catch (error) {
          console.error("Error fetching identifications:", error);
          res.status(500).json({ error: "Internal server error" });
        }
      },
    );
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

  private async enrichObservations(
    rows: ObservationRow[],
  ): Promise<ObservationResponse[]> {
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
          scientificName: row.scientific_name,
          communityId: communityId || undefined,
          eventDate: row.event_date.toISOString(),
          location: {
            latitude: row.latitude,
            longitude: row.longitude,
            uncertaintyMeters: row.coordinate_uncertainty_meters || undefined,
          },
          verbatimLocality: row.verbatim_locality || undefined,
          notes: row.notes || undefined,
          images: (row.blobs as Array<{ image: { ref: string } }>).map(
            (b) => `/media/blob/${row.did}/${b.image?.ref || ""}`,
          ),
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

// CLI entry point
async function main() {
  const server = new AppViewServer({
    port: parseInt(process.env.PORT || "3000"),
    databaseUrl: process.env.DATABASE_URL,
    corsOrigins: process.env.CORS_ORIGINS?.split(",") || [
      "http://localhost:5173",
    ],
  });

  process.on("SIGINT", async () => {
    console.log("\nShutting down...");
    await server.stop();
    process.exit(0);
  });

  await server.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
