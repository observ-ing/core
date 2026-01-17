/**
 * Ingester Service
 *
 * Main entry point for the firehose ingester that monitors the
 * AT Protocol network for biodiversity records.
 */

import { createServer } from "http";
import {
  Database,
  getDatabaseUrl,
  type OccurrenceEvent,
  type IdentificationEvent,
} from "biosky-shared";
import { FirehoseSubscription } from "./firehose.js";

interface IngesterConfig {
  relay?: string;
  databaseUrl: string;
  cursor?: number;
  port?: number;
}

export class Ingester {
  private firehose!: FirehoseSubscription;
  private db: Database;
  private config: IngesterConfig;
  private isRunning = false;
  private httpServer?: ReturnType<typeof createServer>;

  constructor(config: IngesterConfig) {
    this.db = new Database(config.databaseUrl);
    this.config = config;
  }

  async start(): Promise<void> {
    console.log("Starting ingester...");

    // Initialize database
    await this.db.connect();
    await this.db.migrate();

    // Load last cursor from database (for resumption after restart)
    const savedCursor = await this.db.getCursor();
    const cursor = this.config.cursor ?? savedCursor ?? undefined;

    if (cursor) {
      console.log(`Resuming from cursor: ${cursor}`);
    } else {
      console.log("Starting from current firehose position (no cursor)");
    }

    // Create firehose subscription with cursor
    this.firehose = new FirehoseSubscription({
      relay: this.config.relay,
      cursor,
      onOccurrence: (event) => this.handleOccurrence(event),
      onIdentification: (event) => this.handleIdentification(event),
    });

    // Set up event handlers
    this.firehose.on("connected", () => {
      console.log("Ingester connected to firehose");
    });

    this.firehose.on("disconnected", () => {
      console.log("Ingester disconnected from firehose");
    });

    this.firehose.on("error", (error) => {
      console.error("Firehose error:", error);
    });

    // Start firehose subscription
    await this.firehose.start();
    this.isRunning = true;

    // Periodically save cursor
    setInterval(() => this.saveCursor(), 30000);

    // Start health check HTTP server for Cloud Run
    if (this.config.port) {
      this.httpServer = createServer((req, res) => {
        if (req.url === "/health" || req.url === "/") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "ok",
              connected: this.firehose.isConnected(),
              cursor: this.firehose.getCursor(),
            }),
          );
        } else {
          res.writeHead(404);
          res.end();
        }
      });
      this.httpServer.listen(this.config.port, () => {
        console.log(`Health server listening on port ${this.config.port}`);
      });
    }
  }

  async stop(): Promise<void> {
    console.log("Stopping ingester...");
    this.isRunning = false;
    if (this.httpServer) {
      this.httpServer.close();
    }
    await this.firehose.stop();
    await this.saveCursor();
    await this.db.disconnect();
  }

  private async handleOccurrence(event: OccurrenceEvent): Promise<void> {
    try {
      if (event.action === "create" || event.action === "update") {
        await this.db.upsertOccurrence(event);
      } else if (event.action === "delete") {
        await this.db.deleteOccurrence(event.uri);
      }
    } catch (error) {
      console.error("Error handling occurrence:", error);
    }
  }

  private async handleIdentification(
    event: IdentificationEvent,
  ): Promise<void> {
    try {
      if (event.action === "create" || event.action === "update") {
        await this.db.upsertIdentification(event);
      } else if (event.action === "delete") {
        await this.db.deleteIdentification(event.uri);
      }
    } catch (error) {
      console.error("Error handling identification:", error);
    }
  }

  private async saveCursor(): Promise<void> {
    const cursor = this.firehose.getCursor();
    if (cursor !== undefined) {
      await this.db.saveCursor(cursor);
    }
  }
}

// CLI entry point
async function main() {
  const config: IngesterConfig = {
    relay: process.env.RELAY_URL || "wss://bsky.network",
    databaseUrl: getDatabaseUrl(),
    cursor: process.env.CURSOR ? parseInt(process.env.CURSOR) : undefined,
    port: process.env.PORT ? parseInt(process.env.PORT) : undefined,
  };

  const ingester = new Ingester(config);

  // Handle shutdown gracefully
  process.on("SIGINT", async () => {
    console.log("\nReceived SIGINT, shutting down...");
    await ingester.stop();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    console.log("\nReceived SIGTERM, shutting down...");
    await ingester.stop();
    process.exit(0);
  });

  await ingester.start();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
