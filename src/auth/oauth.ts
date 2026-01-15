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
import { AtpAgent } from "@atproto/api";
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

export class OAuthService {
  private client: NodeOAuthClient | null = null;
  private config: OAuthConfig;
  private stateStore: StateStore;
  private sessionStore: SessionStore;
  private privateKey: JoseKey | null = null;
  private publicJwk: Record<string, unknown> | null = null;

  constructor(config: Partial<OAuthConfig> = {}) {
    this.stateStore = config.stateStore || new MemoryStateStore();
    this.sessionStore = config.sessionStore || new MemorySessionStore();

    this.config = {
      publicUrl:
        config.publicUrl ||
        process.env.PUBLIC_URL ||
        "http://localhost:3000",
      scope: config.scope || "atproto",
      stateStore: this.stateStore,
      sessionStore: this.sessionStore,
    };
  }

  get clientId(): string {
    return `${this.config.publicUrl}/client-metadata.json`;
  }

  get redirectUri(): string {
    return `${this.config.publicUrl}/oauth/callback`;
  }

  async initialize(): Promise<void> {
    // Skip OAuth initialization in development if it fails
    try {
      await this.initializeClient();
    } catch (error) {
      console.error("OAuth initialization failed:", error);
      console.error("Stack trace:", (error as Error).stack);
      console.warn("OAuth login will not be available");
    }
  }

  private async initializeClient(): Promise<void> {
    // Generate a key pair for the OAuth client with a kid
    const kid = `biosky-${Date.now()}`;
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

    const options: NodeOAuthClientOptions = {
      clientMetadata: {
        client_id: this.clientId,
        client_name: "BioSky",
        client_uri: this.config.publicUrl,
        redirect_uris: [this.redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: this.config.scope,
        token_endpoint_auth_method: "none",
        dpop_bound_access_tokens: true,
      },
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
          const session = await this.sessionStore.get(key);
          return session as unknown as undefined;
        },
        set: async (key: string, value: unknown) => {
          await this.sessionStore.set(key, value as SessionData);
        },
        del: async (key: string) => {
          await this.sessionStore.del(key);
        },
      },
    };

    console.log("Creating NodeOAuthClient with options...");
    this.client = new NodeOAuthClient(options);
    console.log("OAuth client created successfully with client_id:", this.clientId);
  }

  getClientMetadata(): object {
    return {
      client_id: this.clientId,
      client_name: "BioSky",
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

  async logout(did: string): Promise<void> {
    await this.sessionStore.del(did);
  }

  setupRoutes(app: express.Application): void {
    // Serve client metadata for AT Protocol OAuth discovery
    app.get("/client-metadata.json", (_req, res) => {
      res.json(this.getClientMetadata());
    });

    // Login initiation
    app.get("/oauth/login", async (req, res) => {
      try {
        const handle = req.query.handle as string;
        if (!handle) {
          res.status(400).json({ error: "handle parameter required" });
          return;
        }

        const { url } = await this.getAuthorizationUrl(handle);

        console.log("OAuth login: redirecting to", url);
        res.redirect(url);
      } catch (error) {
        console.error("OAuth login error:", error);
        res.status(500).json({ error: "Failed to initiate login" });
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
          secure: process.env.NODE_ENV === "production",
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
          res.status(401).json({ error: "Not authenticated" });
          return;
        }

        const session = await this.getSession(did);
        if (!session) {
          res.status(401).json({ error: "Session expired" });
          return;
        }

        res.json({
          did: session.did,
          handle: session.handle,
        });
      } catch (error) {
        console.error("Get user error:", error);
        res.status(500).json({ error: "Failed to get user" });
      }
    });
  }
}

export { MemoryStateStore, MemorySessionStore };
export type { StateStore, SessionStore, SessionData };
