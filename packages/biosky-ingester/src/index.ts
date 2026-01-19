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

interface RecentEvent {
  type: "occurrence" | "identification";
  action: string;
  uri: string;
  time: string;
}

interface LastProcessedInfo {
  time: string; // ISO timestamp from the firehose event
  seq: number;
}

export class Ingester {
  private firehose!: FirehoseSubscription;
  private db: Database;
  private config: IngesterConfig;
  private isRunning = false;
  private httpServer?: ReturnType<typeof createServer>;
  private startedAt: Date = new Date();
  private stats = { occurrences: 0, identifications: 0, errors: 0 };
  private recentEvents: RecentEvent[] = [];
  private readonly maxRecentEvents = 10;
  private lastProcessed: LastProcessedInfo | null = null;

  constructor(config: IngesterConfig) {
    this.db = new Database(config.databaseUrl);
    this.config = config;
  }

  private addRecentEvent(event: RecentEvent): void {
    this.recentEvents.unshift(event);
    if (this.recentEvents.length > this.maxRecentEvents) {
      this.recentEvents.pop();
    }
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
        if (req.url === "/health") {
          const cursor = this.firehose.getCursor();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              status: "ok",
              connected: this.firehose.isConnected(),
              cursor: cursor !== undefined ? Number(cursor) : undefined,
            }),
          );
        } else if (req.url === "/api/stats") {
          const cursor = this.firehose.getCursor();
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              connected: this.firehose.isConnected(),
              cursor: cursor !== undefined ? Number(cursor) : undefined,
              uptime: Math.floor(
                (Date.now() - this.startedAt.getTime()) / 1000,
              ),
              stats: this.stats,
              recentEvents: this.recentEvents,
              lastProcessed: this.lastProcessed,
            }),
          );
        } else if (req.url === "/") {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(this.renderDashboard());
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

  private renderDashboard(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>BioSky Ingester</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f172a;
      color: #e2e8f0;
      padding: 2rem;
      min-height: 100vh;
    }
    .container { max-width: 800px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 1.5rem; color: #38bdf8; }
    .card {
      background: #1e293b;
      border-radius: 0.5rem;
      padding: 1.5rem;
      margin-bottom: 1rem;
    }
    .status-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 0.5rem 0;
      border-bottom: 1px solid #334155;
    }
    .status-row:last-child { border-bottom: none; }
    .label { color: #94a3b8; }
    .value { font-weight: 600; font-family: monospace; }
    .status-dot {
      display: inline-block;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      margin-right: 0.5rem;
    }
    .status-dot.connected { background: #22c55e; }
    .status-dot.disconnected { background: #ef4444; }
    .events { margin-top: 1rem; }
    .event {
      padding: 0.75rem;
      background: #0f172a;
      border-radius: 0.25rem;
      margin-bottom: 0.5rem;
      font-family: monospace;
      font-size: 0.875rem;
    }
    .event-time { color: #64748b; }
    .event-type {
      display: inline-block;
      padding: 0.125rem 0.5rem;
      border-radius: 0.25rem;
      font-size: 0.75rem;
      margin-right: 0.5rem;
    }
    .event-type.occurrence { background: #166534; color: #bbf7d0; }
    .event-type.identification { background: #1e40af; color: #bfdbfe; }
    .event-action { color: #fbbf24; }
    .event-uri {
      color: #94a3b8;
      word-break: break-all;
      display: block;
      margin-top: 0.25rem;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 1rem;
      margin-top: 1rem;
    }
    .stat {
      text-align: center;
      padding: 1rem;
      background: #0f172a;
      border-radius: 0.25rem;
    }
    .stat-value { font-size: 2rem; font-weight: bold; color: #38bdf8; }
    .stat-label { color: #64748b; font-size: 0.875rem; }
    .no-events { color: #64748b; font-style: italic; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🌿 BioSky Ingester</h1>

    <div class="card">
      <div class="status-row">
        <span class="label">Status</span>
        <span class="value" id="status">Loading...</span>
      </div>
      <div class="status-row">
        <span class="label">Cursor</span>
        <span class="value" id="cursor">-</span>
      </div>
      <div class="status-row">
        <span class="label">Uptime</span>
        <span class="value" id="uptime">-</span>
      </div>
      <div class="status-row">
        <span class="label">Lag</span>
        <span class="value" id="lag">-</span>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-bottom: 0.5rem; color: #94a3b8; font-size: 0.875rem; text-transform: uppercase;">Session Stats</h2>
      <div class="stats-grid">
        <div class="stat">
          <div class="stat-value" id="occurrences">0</div>
          <div class="stat-label">Occurrences</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="identifications">0</div>
          <div class="stat-label">Identifications</div>
        </div>
        <div class="stat">
          <div class="stat-value" id="errors">0</div>
          <div class="stat-label">Errors</div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2 style="margin-bottom: 0.5rem; color: #94a3b8; font-size: 0.875rem; text-transform: uppercase;">Recent Events</h2>
      <div class="events" id="events">
        <div class="no-events">No events yet...</div>
      </div>
    </div>
  </div>

  <script>
    function formatDuration(seconds) {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
      if (m > 0) return m + 'm ' + s + 's';
      return s + 's';
    }

    function formatLag(lastProcessed) {
      if (!lastProcessed || !lastProcessed.time) return '-';
      const eventTime = new Date(lastProcessed.time).getTime();
      const now = Date.now();
      const lagMs = now - eventTime;
      if (lagMs < 0) return '0s';
      const lagSeconds = Math.floor(lagMs / 1000);
      return formatDuration(lagSeconds);
    }

    function formatTime(iso) {
      return new Date(iso).toLocaleTimeString();
    }

    async function refresh() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();

        document.getElementById('status').innerHTML =
          '<span class="status-dot ' + (data.connected ? 'connected' : 'disconnected') + '"></span>' +
          (data.connected ? 'Connected' : 'Disconnected');
        document.getElementById('cursor').textContent = data.cursor?.toLocaleString() || '-';
        document.getElementById('uptime').textContent = formatDuration(data.uptime);
        document.getElementById('lag').textContent = formatLag(data.lastProcessed);
        document.getElementById('occurrences').textContent = data.stats.occurrences.toLocaleString();
        document.getElementById('identifications').textContent = data.stats.identifications.toLocaleString();
        document.getElementById('errors').textContent = data.stats.errors.toLocaleString();

        const eventsEl = document.getElementById('events');
        if (data.recentEvents.length === 0) {
          eventsEl.innerHTML = '<div class="no-events">No events yet...</div>';
        } else {
          eventsEl.innerHTML = data.recentEvents.map(e =>
            '<div class="event">' +
              '<span class="event-time">' + formatTime(e.time) + '</span> ' +
              '<span class="event-type ' + e.type + '">' + e.type + '</span>' +
              '<span class="event-action">' + e.action + '</span>' +
              '<span class="event-uri">' + e.uri + '</span>' +
            '</div>'
          ).join('');
        }
      } catch (err) {
        document.getElementById('status').innerHTML =
          '<span class="status-dot disconnected"></span>Error';
      }
    }

    refresh();
    setInterval(refresh, 2000);
  </script>
</body>
</html>`;
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
      this.stats.occurrences++;
      this.lastProcessed = { time: event.time, seq: event.seq };
      this.addRecentEvent({
        type: "occurrence",
        action: event.action,
        uri: event.uri,
        time: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error handling occurrence:", error);
      this.stats.errors++;
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
      this.stats.identifications++;
      this.lastProcessed = { time: event.time, seq: event.seq };
      this.addRecentEvent({
        type: "identification",
        action: event.action,
        uri: event.uri,
        time: new Date().toISOString(),
      });
    } catch (error) {
      console.error("Error handling identification:", error);
      this.stats.errors++;
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
