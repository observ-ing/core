/**
 * Media Proxy Service
 *
 * Proxies and caches image blobs from various PDS servers
 * for performant frontend loading.
 */

import express from "express";
import { createHash } from "crypto";
import { mkdir, readFile, writeFile, stat } from "fs/promises";
import { join } from "path";

interface MediaProxyConfig {
  port: number;
  cacheDir: string;
  maxCacheSize: number; // in bytes
  cacheTtlMs: number;
}

interface CacheEntry {
  path: string;
  contentType: string;
  size: number;
  createdAt: number;
}

export class MediaProxy {
  private app: express.Application;
  private config: MediaProxyConfig;
  private cache: Map<string, CacheEntry> = new Map();
  private currentCacheSize = 0;

  constructor(config: Partial<MediaProxyConfig> = {}) {
    this.config = {
      port: config.port || 3001,
      cacheDir: config.cacheDir || "./cache/media",
      maxCacheSize: config.maxCacheSize || 1024 * 1024 * 1024, // 1GB default
      cacheTtlMs: config.cacheTtlMs || 24 * 60 * 60 * 1000, // 24 hours
    };

    this.app = express();
    this.setupRoutes();
  }

  private setupRoutes(): void {
    // Health check
    this.app.get("/health", (_req, res) => {
      res.json({ status: "ok", cacheSize: this.currentCacheSize });
    });

    // Proxy endpoint: /blob/:did/:cid
    // Example: /blob/did:plc:abc123/bafyreiabc...
    this.app.get("/blob/:did/:cid", async (req, res) => {
      try {
        const { did, cid } = req.params;
        const blob = await this.getBlob(did, cid);

        if (!blob) {
          res.status(404).json({ error: "Blob not found" });
          return;
        }

        res.setHeader("Content-Type", blob.contentType);
        res.setHeader("Cache-Control", "public, max-age=86400"); // 1 day
        res.setHeader("X-Cache", blob.fromCache ? "HIT" : "MISS");
        res.send(blob.data);
      } catch (error) {
        console.error("Error fetching blob:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });

    // Thumbnail endpoint: /thumb/:did/:cid?size=256
    this.app.get("/thumb/:did/:cid", async (req, res) => {
      try {
        const { did, cid } = req.params;
        const size = parseInt(req.query.size as string) || 256;

        // For thumbnails, we'd integrate sharp or similar
        // For now, just proxy the original
        const blob = await this.getBlob(did, cid);

        if (!blob) {
          res.status(404).json({ error: "Blob not found" });
          return;
        }

        res.setHeader("Content-Type", blob.contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        res.setHeader("X-Requested-Size", size.toString());
        res.send(blob.data);
      } catch (error) {
        console.error("Error fetching thumbnail:", error);
        res.status(500).json({ error: "Internal server error" });
      }
    });
  }

  private async getBlob(
    did: string,
    cid: string,
  ): Promise<{ data: Buffer; contentType: string; fromCache: boolean } | null> {
    const cacheKey = this.getCacheKey(did, cid);

    // Check cache
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.createdAt < this.config.cacheTtlMs) {
      try {
        const data = await readFile(cached.path);
        return { data, contentType: cached.contentType, fromCache: true };
      } catch {
        // Cache miss - file might have been deleted
        this.cache.delete(cacheKey);
      }
    }

    // Fetch from PDS
    const pdsUrl = await this.resolvePdsUrl(did);
    if (!pdsUrl) {
      console.error(`Could not resolve PDS for DID: ${did}`);
      return null;
    }

    const blob = await this.fetchFromPds(pdsUrl, did, cid);
    if (!blob) {
      return null;
    }

    // Cache the blob
    await this.cacheBlob(cacheKey, blob.data, blob.contentType);

    return { ...blob, fromCache: false };
  }

  private getCacheKey(did: string, cid: string): string {
    return createHash("sha256").update(`${did}:${cid}`).digest("hex");
  }

  private async resolvePdsUrl(did: string): Promise<string | null> {
    try {
      // For did:plc, resolve via plc.directory
      if (did.startsWith("did:plc:")) {
        const response = await fetch(`https://plc.directory/${did}`);
        if (!response.ok) return null;

        const doc = (await response.json()) as {
          service?: Array<{ id: string; serviceEndpoint: string }>;
        };
        const pdsService = doc.service?.find((s) => s.id === "#atproto_pds");
        return pdsService?.serviceEndpoint || null;
      }

      // For did:web, construct URL directly
      if (did.startsWith("did:web:")) {
        const domain = did.replace("did:web:", "").replace(/%3A/g, ":");
        return `https://${domain}`;
      }

      return null;
    } catch (error) {
      console.error(`Error resolving PDS for ${did}:`, error);
      return null;
    }
  }

  private async fetchFromPds(
    pdsUrl: string,
    did: string,
    cid: string,
  ): Promise<{ data: Buffer; contentType: string } | null> {
    try {
      const url = `${pdsUrl}/xrpc/com.atproto.sync.getBlob?did=${encodeURIComponent(did)}&cid=${encodeURIComponent(cid)}`;
      const response = await fetch(url);

      if (!response.ok) {
        console.error(`Failed to fetch blob: ${response.status}`);
        return null;
      }

      const contentType =
        response.headers.get("content-type") || "application/octet-stream";
      const arrayBuffer = await response.arrayBuffer();
      const data = Buffer.from(arrayBuffer);

      return { data, contentType };
    } catch (error) {
      console.error(`Error fetching blob from PDS:`, error);
      return null;
    }
  }

  private async cacheBlob(
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<void> {
    // Ensure cache directory exists
    await mkdir(this.config.cacheDir, { recursive: true });

    // Evict old entries if needed
    while (this.currentCacheSize + data.length > this.config.maxCacheSize) {
      await this.evictOldest();
    }

    const path = join(this.config.cacheDir, key);
    await writeFile(path, data);

    const entry: CacheEntry = {
      path,
      contentType,
      size: data.length,
      createdAt: Date.now(),
    };

    this.cache.set(key, entry);
    this.currentCacheSize += data.length;
  }

  private async evictOldest(): Promise<void> {
    let oldest: { key: string; entry: CacheEntry } | null = null;

    for (const [key, entry] of this.cache) {
      if (!oldest || entry.createdAt < oldest.entry.createdAt) {
        oldest = { key, entry };
      }
    }

    if (oldest) {
      this.cache.delete(oldest.key);
      this.currentCacheSize -= oldest.entry.size;
      // File cleanup could be done here
    }
  }

  async start(): Promise<void> {
    // Load existing cache entries
    await this.loadCacheIndex();

    return new Promise((resolve) => {
      this.app.listen(this.config.port, () => {
        console.log(`Media proxy listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  private async loadCacheIndex(): Promise<void> {
    try {
      await mkdir(this.config.cacheDir, { recursive: true });
      // In a production system, we'd persist the cache index
      // For now, we start fresh on each restart
      console.log("Cache initialized");
    } catch (error) {
      console.error("Error loading cache:", error);
    }
  }
}

// CLI entry point
async function main() {
  const proxy = new MediaProxy({
    port: parseInt(process.env.MEDIA_PROXY_PORT || "3001"),
    cacheDir: process.env.CACHE_DIR || "./cache/media",
  });

  await proxy.start();
}

if (process.argv[1]?.endsWith("media-proxy.ts")) {
  main().catch(console.error);
}
