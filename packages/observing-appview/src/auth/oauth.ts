/**
 * OAuth Authentication for AT Protocol
 *
 * Handles user login with their atproto identity (e.g., @name.bsky.social)
 * using the OAuth client flow.
 */

import {
  NodeOAuthClient,
  type NodeOAuthClientOptions,
} from "@atproto/oauth-client-node";
import { JoseKey } from "@atproto/jwk-jose";
import { Agent, AtpAgent } from "@atproto/api";
import express from "express";
import { randomBytes } from "crypto";

interface OAuthConfig {
  publicUrl: string;
  scope: string;
  stateStore: StateStore;
  sessionStore: SessionStore;
}

interface StateStore {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  del(key: string): Promise<void>;
}

interface SessionStore {
  get(key: string): Promise<SessionData | undefined>;
  set(key: string, value: SessionData): Promise<void>;
  del(key: string): Promise<void>;
}

interface SessionData {
  did: string;
  handle: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

// In-memory stores for development
class MemoryStateStore implements StateStore {
  private store = new Map<string, { value: string; expires: number }>();

  async get(key: string): Promise<string | undefined> {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  async set(key: string, value: string, ttl = 600000): Promise<void> {
    this.store.set(key, { value, expires: Date.now() + ttl });
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

class MemorySessionStore implements SessionStore {
  private store = new Map<string, SessionData>();

  async get(key: string): Promise<SessionData | undefined> {
    return this.store.get(key);
  }

  async set(key: string, value: SessionData): Promise<void> {
    this.store.set(key, value);
  }

  async del(key: string): Promise<void> {
    this.store.delete(key);
  }
}

// Database-backed stores for production (persist across deploys)
interface DatabaseLike {
  getOAuthState(key: string): Promise<string | undefined>;
  setOAuthState(key: string, value: string, ttlMs?: number): Promise<void>;
  deleteOAuthState(key: string): Promise<void>;
  getOAuthSession(key: string): Promise<string | undefined>;
  setOAuthSession(key: string, value: string): Promise<void>;
  deleteOAuthSession(key: string): Promise<void>;
}

class DatabaseStateStore implements StateStore {
  constructor(private db: DatabaseLike) {}

  async get(key: string): Promise<string | undefined> {
    return this.db.getOAuthState(key);
  }

  async set(key: string, value: string, ttl = 600000): Promise<void> {
    await this.db.setOAuthState(key, value, ttl);
  }

  async del(key: string): Promise<void> {
    await this.db.deleteOAuthState(key);
  }
}

// Stores AT Protocol session data as JSON string
class DatabaseSessionStore implements SessionStore {
  constructor(private db: DatabaseLike) {}

  async get(key: string): Promise<SessionData | undefined> {
    const value = await this.db.getOAuthSession(key);
    return value ? JSON.parse(value) : undefined;
  }

  async set(key: string, value: SessionData): Promise<void> {
    await this.db.setOAuthSession(key, JSON.stringify(value));
  }

  async del(key: string): Promise<void> {
    await this.db.deleteOAuthSession(key);
  }
}

export class OAuthService {
  private client: NodeOAuthClient | null = null;
  private config: OAuthConfig;
  private stateStore: StateStore;
  private sessionStore: SessionStore;
  private privateKey: JoseKey | null = null;
  private publicJwk: Record<string, unknown> | null = null;
  private isLoopbackMode: boolean;

  constructor(config: Partial<OAuthConfig> = {}) {
    this.stateStore = config.stateStore || new MemoryStateStore();
    this.sessionStore = config.sessionStore || new MemorySessionStore();

    const publicUrl = config.publicUrl || process.env["PUBLIC_URL"] || "http://127.0.0.1:3000";

    // Detect if we're in loopback mode (local development)
    // Loopback mode uses http://localhost client_id format per AT Protocol spec
    this.isLoopbackMode = this.isLoopbackUrl(publicUrl);

    this.config = {
      publicUrl,
      scope: config.scope || "atproto",
      stateStore: this.stateStore,
      sessionStore: this.sessionStore,
    };
  }

  private isLoopbackUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.hostname === "localhost" ||
             parsed.hostname === "127.0.0.1" ||
             parsed.hostname === "[::1]";
    } catch {
      return false;
    }
  }

  get clientId(): string {
    if (this.isLoopbackMode) {
      // Loopback client ID format: http://localhost?redirect_uri=...&scope=...
      const params = new URLSearchParams();
      params.set("redirect_uri", this.redirectUri);
      params.set("scope", this.config.scope);
      return `http://localhost?${params.toString()}`;
    }
    return `${this.config.publicUrl}/client-metadata.json`;
  }

  get redirectUri(): string {
    if (this.isLoopbackMode) {
      // For loopback mode, use 127.0.0.1 (not localhost) per RFC 8252
      const parsed = new URL(this.config.publicUrl);
      return `http://127.0.0.1:${parsed.port}/oauth/callback`;
    }
    return `${this.config.publicUrl}/oauth/callback`;
  }

  async initialize(): Promise<void> {
    // Skip OAuth initialization in development if it fails
    try {
      await this.initializeClient();
    } catch (error: unknown) {
      // Avoid console.error with error objects from @atproto - they can crash Node's inspect
      const message = error instanceof Error ? error.message : "Unknown error";
      const stack = error instanceof Error ? error.stack : undefined;
      process.stderr.write(`OAuth initialization failed: ${message}\n`);
      if (stack) process.stderr.write(`Stack: ${stack}\n`);
      process.stderr.write("OAuth login will not be available\n");
    }
  }

  private async initializeClient(): Promise<void> {
    // Generate a key pair for the OAuth client with a kid
    const kid = `observing-${Date.now()}`;
    this.privateKey = await JoseKey.generate(["ES256"], kid);

    // Get the full JWK with all required properties
    const fullJwk = this.privateKey.jwk as Record<string, unknown>;

    // Extract public JWK by removing private key components and adding required fields
    const { d, ...publicComponents } = fullJwk;
    this.publicJwk = {
      ...publicComponents,
      kid,
      alg: "ES256",
      key_ops: ["verify"],
    };
    console.log("Public JWK:", JSON.stringify(this.publicJwk, null, 2));

    // Create a modified JWK for the keyset with all required fields
    const keysetJwk = {
      ...fullJwk,
      kid,
      alg: "ES256",
      key_ops: ["sign"],
    };

    // Create a JoseKey from the modified JWK
    const keyWithAlg = await JoseKey.fromJWK(keysetJwk);
    console.log("Keyset key jwk:", JSON.stringify(keyWithAlg.jwk, null, 2));

    // Build client metadata based on mode
    let clientMetadata;
    if (this.isLoopbackMode) {
      // Use loopback client metadata for local development
      // This uses the special http://localhost?... client_id format
      console.log("Using loopback mode for local development");
      // Build loopback client_id: http://localhost?redirect_uri=...&scope=...
      const loopbackClientId = this.clientId;
      clientMetadata = {
        client_id: loopbackClientId as `http://localhost${string}`,
        redirect_uris: [this.redirectUri as `http://127.0.0.1${string}`] as [`http://127.0.0.1${string}`],
        scope: this.config.scope,
        grant_types: ["authorization_code", "refresh_token"] as ["authorization_code", "refresh_token"],
        response_types: ["code"] as ["code"],
        token_endpoint_auth_method: "none" as const,
        dpop_bound_access_tokens: true,
      };
    } else {
      // Production mode: use discoverable client_id pointing to client-metadata.json
      clientMetadata = {
        client_id: this.clientId,
        client_name: "Observ.ing",
        client_uri: this.config.publicUrl as `https://${string}`,
        redirect_uris: [this.redirectUri as `https://${string}`] as [`https://${string}`],
        grant_types: ["authorization_code", "refresh_token"] as ["authorization_code", "refresh_token"],
        response_types: ["code"] as ["code"],
        scope: this.config.scope,
        token_endpoint_auth_method: "none" as const,
        dpop_bound_access_tokens: true,
      };
    }

    const options: NodeOAuthClientOptions = {
      clientMetadata,
      // Allow HTTP connections in loopback mode (local development)
      allowHttp: this.isLoopbackMode,
      stateStore: {
        get: async (key: string) => {
          const value = await this.stateStore.get(key);
          return value ? JSON.parse(value) : undefined;
        },
        set: async (key: string, value: unknown) => {
          await this.stateStore.set(key, JSON.stringify(value));
        },
        del: async (key: string) => {
          await this.stateStore.del(key);
        },
      },
      sessionStore: {
        get: async (key: string) => {
          // The OAuth client stores its own internal session format (with tokens)
          // Use a prefix to avoid conflicts with our SessionData storage
          const value = await this.stateStore.get(`atproto_session:${key}`);
          return value ? JSON.parse(value) : undefined;
        },
        set: async (key: string, value: unknown) => {
          // Store OAuth client's internal session data with 30-day TTL
          await this.stateStore.set(`atproto_session:${key}`, JSON.stringify(value), 30 * 24 * 60 * 60 * 1000);
        },
        del: async (key: string) => {
          await this.stateStore.del(`atproto_session:${key}`);
        },
      },
    };

    console.log("Creating NodeOAuthClient with options...");
    console.log("Client ID:", this.clientId);
    console.log("Redirect URI:", this.redirectUri);
    console.log("Loopback mode:", this.isLoopbackMode);
    try {
      this.client = new NodeOAuthClient(options);
      console.log("OAuth client created successfully");
    } catch (e) {
      console.error("NodeOAuthClient constructor failed:", String((e as Error)?.message || e));
      throw e;
    }
  }

  getClientMetadata(): object {
    if (this.isLoopbackMode) {
      // Return loopback client metadata
      return {
        client_id: this.clientId,
        redirect_uris: [this.redirectUri],
        scope: this.config.scope,
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
        dpop_bound_access_tokens: true,
      };
    }
    return {
      client_id: this.clientId,
      client_name: "Observ.ing",
      client_uri: this.config.publicUrl,
      redirect_uris: [this.redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: this.config.scope,
      token_endpoint_auth_method: "none",
      dpop_bound_access_tokens: true,
    };
  }

  async getAuthorizationUrl(
    handle: string,
  ): Promise<{ url: string; state: string }> {
    if (!this.client) {
      throw new Error("OAuth client not initialized");
    }

    const state = randomBytes(16).toString("hex");

    const url = await this.client.authorize(handle, {
      scope: this.config.scope,
      state,
    });

    return { url: url.toString(), state };
  }

  async handleCallback(params: {
    code: string;
    state: string;
    iss: string;
  }): Promise<SessionData> {
    if (!this.client) {
      throw new Error("OAuth client not initialized");
    }

    const { session } = await this.client.callback(new URLSearchParams(params));

    // Resolve handle from DID using the public AT Protocol API
    let handle = "";
    try {
      const agent = new AtpAgent({ service: "https://public.api.bsky.app" });
      const profile = await agent.getProfile({ actor: session.did });
      handle = profile.data.handle;
    } catch (error) {
      console.error("Failed to resolve handle:", error);
    }

    const sessionData: SessionData = {
      did: session.did,
      handle,
      accessToken: "",
      expiresAt: Date.now() + 3600000,
    };

    // Store session
    await this.sessionStore.set(session.did, sessionData);

    return sessionData;
  }

  async getSession(did: string): Promise<SessionData | undefined> {
    return this.sessionStore.get(did);
  }

  /**
   * Get an authenticated Agent for making AT Protocol API calls on behalf of a user.
   * Returns null if the OAuth client is not initialized or session cannot be restored.
   */
  async getAgent(did: string): Promise<Agent | null> {
    if (!this.client) {
      console.error("OAuth client not initialized");
      return null;
    }

    try {
      const oauthSession = await this.client.restore(did);
      return new Agent(oauthSession);
    } catch (error) {
      console.error("Failed to restore OAuth session for", did, error);
      return null;
    }
  }

  async logout(did: string): Promise<void> {
    await this.sessionStore.del(did);
  }

  setupRoutes(app: express.Application): void {
    // Serve client metadata for AT Protocol OAuth discovery
    app.get("/client-metadata.json", (_req, res) => {
      res.json(this.getClientMetadata());
    });

    // Login initiation - returns auth URL as JSON for frontend handling
    app.get("/oauth/login", async (req, res) => {
      try {
        const handle = req.query["handle"] as string;
        if (!handle) {
          res.status(400).json({ error: "Handle is required" });
          return;
        }

        const { url } = await this.getAuthorizationUrl(handle);

        console.log("OAuth login: returning auth URL for", handle);
        res.json({ url });
      } catch (error) {
        console.error("OAuth login error:", error);
        // Provide a user-friendly error message
        const message = error instanceof Error ? error.message : "Unknown error";
        if (message.includes("could not resolve") || message.includes("Unable to resolve")) {
          res.status(400).json({ error: `Could not find handle "${req.query["handle"]}". Please check the spelling and try again.` });
        } else if (message.includes("not initialized")) {
          res.status(503).json({ error: "Login service is temporarily unavailable. Please try again later." });
        } else {
          res.status(400).json({ error: "Could not initiate login. Please verify your handle is correct." });
        }
      }
    });

    // OAuth callback
    app.get("/oauth/callback", async (req, res) => {
      try {
        const { code, state, iss } = req.query as {
          code: string;
          state: string;
          iss: string;
        };

        console.log("OAuth callback received with code and state");

        // The OAuth client handles state verification internally via its stateStore
        const session = await this.handleCallback({ code, state, iss });

        // Set session cookie
        res.cookie("session_did", session.did, {
          httpOnly: true,
          secure: process.env["NODE_ENV"] === "production",
          maxAge: session.expiresAt - Date.now(),
        });

        res.redirect("/");
      } catch (error) {
        console.error("OAuth callback error:", error);
        res.status(500).json({ error: "Authentication failed" });
      }
    });

    // Logout
    app.post("/oauth/logout", async (req, res) => {
      try {
        const did = req.cookies?.session_did;
        if (did) {
          await this.logout(did);
        }
        res.clearCookie("session_did");
        res.json({ success: true });
      } catch (error) {
        console.error("Logout error:", error);
        res.status(500).json({ error: "Logout failed" });
      }
    });

    // Get current user
    app.get("/oauth/me", async (req, res) => {
      try {
        const did = req.cookies?.session_did;
        if (!did) {
          res.json({ user: null });
          return;
        }

        const session = await this.getSession(did);
        if (!session) {
          res.json({ user: null });
          return;
        }

        res.json({
          user: {
            did: session.did,
            handle: session.handle,
          },
        });
      } catch (error) {
        console.error("Get user error:", error);
        res.status(500).json({ error: "Failed to get user" });
      }
    });
  }
}

export { MemoryStateStore, MemorySessionStore, DatabaseStateStore, DatabaseSessionStore, Agent };
export type { StateStore, SessionStore, SessionData, DatabaseLike };
