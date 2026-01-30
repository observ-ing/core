/**
 * Observ.ing API Server
 *
 * Standalone REST API service for biodiversity data endpoints.
 * Uses internal RPC to appview for AT Protocol write operations.
 */

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import {
  Database,
  TaxonomyClient,
  CommunityIdCalculator,
  GeocodingService,
} from "observing-shared";
import { createOccurrenceRoutes } from "./routes/occurrences.js";
import { createFeedRoutes } from "./routes/feeds.js";
import { createIdentificationRoutes } from "./routes/identifications.js";
import { createTaxonomyRoutes } from "./routes/taxonomy.js";
import { createProfileRoutes } from "./routes/profiles.js";
import { createCommentRoutes } from "./routes/comments.js";
import { logger } from "./middleware/logging.js";
import { errorHandler } from "./middleware/error-handler.js";
import { createSessionMiddleware } from "./middleware/auth.js";
import { InternalClient } from "./internal-client.js";

// Utility to build DATABASE_URL from environment variables
function getDatabaseUrl(): string {
  if (process.env["DB_PASSWORD"]) {
    const host = process.env["DB_HOST"] || "localhost";
    const name = process.env["DB_NAME"] || "observing";
    const user = process.env["DB_USER"] || "postgres";
    const password = process.env["DB_PASSWORD"];
    return `postgresql://${user}:${password}@/${name}?host=${host}`;
  }
  return process.env["DATABASE_URL"] || "postgresql://localhost:5432/observing";
}

interface ApiServerConfig {
  port: number;
  databaseUrl: string;
  corsOrigins: string[];
  appviewUrl: string;
  internalSecret?: string | undefined;
}

export class ApiServer {
  private app: express.Application;
  private config: ApiServerConfig;
  private db: Database;
  private taxonomy: TaxonomyClient;
  private communityId: CommunityIdCalculator;
  private geocoding: GeocodingService;
  private internalClient: InternalClient;

  constructor(config: ApiServerConfig) {
    this.config = config;
    this.app = express();
    this.db = new Database(config.databaseUrl);
    this.taxonomy = new TaxonomyClient();
    this.communityId = new CommunityIdCalculator(this.db);
    this.geocoding = new GeocodingService();
    this.internalClient = new InternalClient({
      appviewUrl: config.appviewUrl,
      internalSecret: config.internalSecret,
    });

    this.setupMiddleware();
    this.setupRoutes();
  }

  private setupMiddleware(): void {
    // JSON body parsing
    this.app.use(express.json({ limit: "50mb" }));

    // CORS
    this.app.use(
      cors({
        origin: this.config.corsOrigins,
        credentials: true,
      })
    );

    // Cookie parsing
    this.app.use(cookieParser());

    // Session verification - attaches req.user if valid session
    this.app.use(createSessionMiddleware(this.db));
  }

  private setupRoutes(): void {
    // Health check
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok" });
    });

    // API routes
    this.app.use(
      "/api/occurrences",
      createOccurrenceRoutes(this.db, this.taxonomy, this.geocoding, this.internalClient)
    );
    this.app.use("/api/feeds", createFeedRoutes(this.db));
    this.app.use(
      "/api/identifications",
      createIdentificationRoutes(this.db, this.communityId, this.taxonomy, this.internalClient)
    );
    this.app.use("/api/taxa", createTaxonomyRoutes(this.db, this.taxonomy));
    this.app.use("/api/profiles", createProfileRoutes(this.db));
    this.app.use("/api/comments", createCommentRoutes(this.internalClient));

    // Error handler (must be last)
    this.app.use(errorHandler);
  }

  async start(): Promise<void> {
    await this.db.connect();

    return new Promise((resolve) => {
      this.app.listen(this.config.port, () => {
        logger.info({ port: this.config.port }, "API server listening");
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    await this.db.disconnect();
  }
}

// Main entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new ApiServer({
    port: parseInt(process.env["PORT"] || "3002"),
    databaseUrl: getDatabaseUrl(),
    corsOrigins: (process.env["CORS_ORIGINS"] || "http://localhost:5173,http://localhost:3000").split(","),
    appviewUrl: process.env["APPVIEW_URL"] || "http://localhost:3000",
    internalSecret: process.env["INTERNAL_SECRET"],
  });

  process.on("SIGTERM", async () => {
    logger.info("Received SIGTERM, shutting down");
    await server.stop();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    logger.info("Received SIGINT, shutting down");
    await server.stop();
    process.exit(0);
  });

  server.start().catch((error: unknown) => {
    logger.fatal({ err: error }, "Fatal error");
    process.exit(1);
  });
}
