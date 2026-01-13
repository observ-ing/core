/**
 * Firehose Subscription Service
 *
 * Connects to an AT Protocol relay (e.g., bsky.network) and filters
 * for net.inat.* collection records.
 */

import WebSocket from "ws";
import { decode } from "cbor-x";
import { EventEmitter } from "events";

const DEFAULT_RELAY = "wss://bsky.network";

export interface FirehoseEvent {
  type: "commit" | "handle" | "identity" | "tombstone";
  seq: number;
  time: string;
  repo?: string;
}

export interface CommitEvent extends FirehoseEvent {
  type: "commit";
  repo: string;
  commit: string;
  ops: CommitOp[];
}

export interface CommitOp {
  action: "create" | "update" | "delete";
  path: string;
  cid?: string;
  record?: unknown;
}

export interface ObservationEvent {
  did: string;
  uri: string;
  cid: string;
  action: "create" | "update" | "delete";
  record?: unknown;
  seq: number;
  time: string;
}

export interface IdentificationEvent {
  did: string;
  uri: string;
  cid: string;
  action: "create" | "update" | "delete";
  record?: unknown;
  seq: number;
  time: string;
}

interface FirehoseOptions {
  relay?: string;
  cursor?: number;
  onObservation?: (event: ObservationEvent) => void | Promise<void>;
  onIdentification?: (event: IdentificationEvent) => void | Promise<void>;
}

export class FirehoseSubscription extends EventEmitter {
  private ws: WebSocket | null = null;
  private relay: string;
  private cursor?: number;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isClosing = false;

  constructor(options: FirehoseOptions = {}) {
    super();
    this.relay = options.relay || DEFAULT_RELAY;
    this.cursor = options.cursor;

    if (options.onObservation) {
      this.on("observation", options.onObservation);
    }
    if (options.onIdentification) {
      this.on("identification", options.onIdentification);
    }
  }

  async start(): Promise<void> {
    this.isClosing = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.isClosing = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private async connect(): Promise<void> {
    const url = this.buildUrl();
    console.log(`Connecting to firehose: ${url}`);

    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      console.log("Firehose connection established");
      this.reconnectAttempts = 0;
      this.emit("connected");
    });

    this.ws.on("message", (data: Buffer) => {
      this.handleMessage(data);
    });

    this.ws.on("close", () => {
      console.log("Firehose connection closed");
      this.emit("disconnected");
      if (!this.isClosing) {
        this.scheduleReconnect();
      }
    });

    this.ws.on("error", (error) => {
      console.error("Firehose error:", error.message);
      this.emit("error", error);
    });
  }

  private buildUrl(): string {
    const endpoint = `${this.relay}/xrpc/com.atproto.sync.subscribeRepos`;
    if (this.cursor !== undefined) {
      return `${endpoint}?cursor=${this.cursor}`;
    }
    return endpoint;
  }

  private handleMessage(data: Buffer): void {
    try {
      // AT Protocol firehose uses CBOR-encoded DAG-CBOR messages
      // The message is a frame with header and body
      const decoded = this.decodeFrame(data);
      if (!decoded) return;

      const { header, body } = decoded;

      if (header.op === 1 && header.t === "#commit") {
        this.handleCommit(body);
      }
    } catch (error) {
      // Log but don't crash on individual message errors
      console.error("Error processing firehose message:", error);
    }
  }

  private decodeFrame(
    data: Buffer
  ): { header: { op: number; t: string }; body: unknown } | null {
    try {
      // Messages come as concatenated CBOR objects
      let offset = 0;
      const header = decode(data.subarray(offset));
      offset += this.getCborLength(data.subarray(offset));
      const body = decode(data.subarray(offset));
      return { header, body };
    } catch {
      return null;
    }
  }

  private getCborLength(data: Buffer): number {
    // Simple CBOR length detection - this is a simplified version
    // In production, use a proper CBOR streaming decoder
    let i = 0;
    const initial = data[i++];
    const type = initial >> 5;
    const additional = initial & 0x1f;

    if (additional < 24) {
      return this.skipCborValue(data, type, additional, i);
    } else if (additional === 24) {
      return this.skipCborValue(data, type, data[i++], i);
    } else if (additional === 25) {
      const len = data.readUInt16BE(i);
      return this.skipCborValue(data, type, len, i + 2);
    } else if (additional === 26) {
      const len = data.readUInt32BE(i);
      return this.skipCborValue(data, type, len, i + 4);
    }

    // For complex cases, try to decode and measure
    const decoded = decode(data);
    const reencoded = Buffer.from(JSON.stringify(decoded));
    return reencoded.length + 10; // Rough estimate
  }

  private skipCborValue(
    data: Buffer,
    type: number,
    len: number,
    offset: number
  ): number {
    switch (type) {
      case 2: // bytes
      case 3: // string
        return offset + len;
      case 4: // array
      case 5: // map
        // For simplicity, decode the whole thing
        decode(data);
        return data.length;
      default:
        return offset;
    }
  }

  private handleCommit(body: unknown): void {
    const commit = body as {
      repo: string;
      ops: Array<{
        action: string;
        path: string;
        cid?: { toString(): string };
      }>;
      blocks?: Buffer;
      seq: number;
      time: string;
    };

    if (!commit.ops) return;

    for (const op of commit.ops) {
      const [collection, rkey] = op.path.split("/");

      // Filter for our collections
      if (collection === "net.inat.observation") {
        this.handleObservationOp(commit, op, rkey);
      } else if (collection === "net.inat.identification") {
        this.handleIdentificationOp(commit, op, rkey);
      }
    }

    // Update cursor for resumption
    this.cursor = commit.seq;
  }

  private handleObservationOp(
    commit: { repo: string; blocks?: Buffer; seq: number; time: string },
    op: { action: string; path: string; cid?: { toString(): string } },
    rkey: string
  ): void {
    const event: ObservationEvent = {
      did: commit.repo,
      uri: `at://${commit.repo}/net.inat.observation/${rkey}`,
      cid: op.cid?.toString() || "",
      action: op.action as "create" | "update" | "delete",
      record: this.extractRecord(commit.blocks, op.cid),
      seq: commit.seq,
      time: commit.time,
    };

    console.log(`[Observation] ${event.action}: ${event.uri}`);
    this.emit("observation", event);
  }

  private handleIdentificationOp(
    commit: { repo: string; blocks?: Buffer; seq: number; time: string },
    op: { action: string; path: string; cid?: { toString(): string } },
    rkey: string
  ): void {
    const event: IdentificationEvent = {
      did: commit.repo,
      uri: `at://${commit.repo}/net.inat.identification/${rkey}`,
      cid: op.cid?.toString() || "",
      action: op.action as "create" | "update" | "delete",
      record: this.extractRecord(commit.blocks, op.cid),
      seq: commit.seq,
      time: commit.time,
    };

    console.log(`[Identification] ${event.action}: ${event.uri}`);
    this.emit("identification", event);
  }

  private extractRecord(
    blocks: Buffer | undefined,
    _cid: { toString(): string } | undefined
  ): unknown {
    // In a full implementation, we'd decode the CAR blocks and look up the CID
    // For now, return undefined - the appview can fetch the record separately
    if (!blocks) return undefined;

    try {
      // Attempt to decode blocks - this is simplified
      return decode(blocks);
    } catch {
      return undefined;
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error("Max reconnection attempts reached");
      this.emit("maxReconnectAttempts");
      return;
    }

    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts);
    this.reconnectAttempts++;

    console.log(
      `Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`
    );
    setTimeout(() => this.connect(), delay);
  }

  getCursor(): number | undefined {
    return this.cursor;
  }
}

export function createFirehoseSubscription(
  options?: FirehoseOptions
): FirehoseSubscription {
  return new FirehoseSubscription(options);
}
