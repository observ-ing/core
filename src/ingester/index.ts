/**
 * Ingester Service
 *
 * Main entry point for the firehose ingester that monitors the
 * AT Protocol network for biodiversity records.
 */

import {
  FirehoseSubscription,
  ObservationEvent,
  IdentificationEvent,
} from "./firehose.js";
import { Database } from "./database.js";

interface IngesterConfig {
  relay?: string;
  databaseUrl: string;
  cursor?: number;
}

export class Ingester {
  private firehose: FirehoseSubscription;
  private db: Database;
  private isRunning = false;

  constructor(config: IngesterConfig) {
    this.db = new Database(config.databaseUrl);
    this.firehose = new FirehoseSubscription({
      relay: config.relay,
      cursor: config.cursor,
      onObservation: (event) => this.handleObservation(event),
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
  }

  async start(): Promise<void> {
    console.log("Starting ingester...");

    // Initialize database
    await this.db.connect();
    await this.db.migrate();

    // Load last cursor from database
    const savedCursor = await this.db.getCursor();
    if (savedCursor) {
      console.log(`Resuming from cursor: ${savedCursor}`);
    }

    // Start firehose subscription
    await this.firehose.start();
    this.isRunning = true;

    // Periodically save cursor
    setInterval(() => this.saveCursor(), 30000);
  }

  async stop(): Promise<void> {
    console.log("Stopping ingester...");
    this.isRunning = false;
    await this.firehose.stop();
    await this.saveCursor();
    await this.db.disconnect();
  }

  private async handleObservation(event: ObservationEvent): Promise<void> {
    try {
      if (event.action === "create" || event.action === "update") {
        await this.db.upsertObservation(event);
      } else if (event.action === "delete") {
        await this.db.deleteObservation(event.uri);
      }
    } catch (error) {
      console.error("Error handling observation:", error);
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
    databaseUrl:
      process.env.DATABASE_URL || "postgresql://localhost:5432/biosky",
    cursor: process.env.CURSOR ? parseInt(process.env.CURSOR) : undefined,
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
