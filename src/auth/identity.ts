/**
 * Identity Resolution Utilities
 *
 * Resolves handles to DIDs and fetches profile information
 * for displaying observer names alongside observations.
 */

import { AtpAgent } from "@atproto/api";

interface DidDocument {
  id: string;
  alsoKnownAs?: string[];
  verificationMethod?: Array<{
    id: string;
    type: string;
    controller: string;
    publicKeyMultibase?: string;
  }>;
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
}

interface Profile {
  did: string;
  handle: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  banner?: string;
  followersCount?: number;
  followsCount?: number;
  postsCount?: number;
}

interface ResolveResult {
  did: string;
  pdsEndpoint?: string;
  handle?: string;
}

// Cache for resolved identities
const identityCache = new Map<
  string,
  { result: ResolveResult; timestamp: number }
>();
const profileCache = new Map<string, { profile: Profile; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export class IdentityResolver {
  private agent: AtpAgent;

  constructor(serviceUrl = "https://bsky.social") {
    this.agent = new AtpAgent({ service: serviceUrl });
  }

  /**
   * Resolve a handle to a DID
   */
  async resolveHandle(handle: string): Promise<ResolveResult | null> {
    // Check cache
    const cached = identityCache.get(handle);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.result;
    }

    try {
      // Use com.atproto.identity.resolveHandle
      const response = await this.agent.resolveHandle({ handle });

      const result: ResolveResult = {
        did: response.data.did,
        handle,
      };

      // Get PDS endpoint from DID document
      const pdsEndpoint = await this.getPdsEndpoint(response.data.did);
      if (pdsEndpoint) {
        result.pdsEndpoint = pdsEndpoint;
      }

      // Cache result
      identityCache.set(handle, { result, timestamp: Date.now() });
      identityCache.set(result.did, { result, timestamp: Date.now() });

      return result;
    } catch (error) {
      console.error(`Failed to resolve handle ${handle}:`, error);
      return null;
    }
  }

  /**
   * Resolve a DID to its document and extract handle
   */
  async resolveDid(did: string): Promise<ResolveResult | null> {
    // Check cache
    const cached = identityCache.get(did);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.result;
    }

    try {
      const doc = await this.getDidDocument(did);
      if (!doc) return null;

      const result: ResolveResult = {
        did,
      };

      // Extract handle from alsoKnownAs
      if (doc.alsoKnownAs) {
        for (const aka of doc.alsoKnownAs) {
          if (aka.startsWith("at://")) {
            result.handle = aka.replace("at://", "");
            break;
          }
        }
      }

      // Extract PDS endpoint
      const pdsService = doc.service?.find((s) => s.id === "#atproto_pds");
      if (pdsService) {
        result.pdsEndpoint = pdsService.serviceEndpoint;
      }

      // Cache result
      identityCache.set(did, { result, timestamp: Date.now() });
      if (result.handle) {
        identityCache.set(result.handle, { result, timestamp: Date.now() });
      }

      return result;
    } catch (error) {
      console.error(`Failed to resolve DID ${did}:`, error);
      return null;
    }
  }

  /**
   * Get the DID document for a DID
   */
  async getDidDocument(did: string): Promise<DidDocument | null> {
    try {
      if (did.startsWith("did:plc:")) {
        const response = await fetch(`https://plc.directory/${did}`);
        if (!response.ok) return null;
        return (await response.json()) as DidDocument;
      }

      if (did.startsWith("did:web:")) {
        const domain = did.replace("did:web:", "").replace(/%3A/g, ":");
        const response = await fetch(`https://${domain}/.well-known/did.json`);
        if (!response.ok) return null;
        return (await response.json()) as DidDocument;
      }

      return null;
    } catch (error) {
      console.error(`Failed to fetch DID document for ${did}:`, error);
      return null;
    }
  }

  /**
   * Get the PDS endpoint for a DID
   */
  async getPdsEndpoint(did: string): Promise<string | null> {
    const doc = await this.getDidDocument(did);
    if (!doc) return null;

    const pdsService = doc.service?.find((s) => s.id === "#atproto_pds");
    return pdsService?.serviceEndpoint || null;
  }

  /**
   * Get a user's profile
   */
  async getProfile(actor: string): Promise<Profile | null> {
    // Check cache
    const cached = profileCache.get(actor);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.profile;
    }

    try {
      const response = await this.agent.getProfile({ actor });
      const data = response.data;

      const profile: Profile = {
        did: data.did,
        handle: data.handle,
        displayName: data.displayName,
        description: data.description,
        avatar: data.avatar,
        banner: data.banner,
        followersCount: data.followersCount,
        followsCount: data.followsCount,
        postsCount: data.postsCount,
      };

      // Cache by both DID and handle
      profileCache.set(data.did, { profile, timestamp: Date.now() });
      profileCache.set(data.handle, { profile, timestamp: Date.now() });

      return profile;
    } catch (error) {
      console.error(`Failed to get profile for ${actor}:`, error);
      return null;
    }
  }

  /**
   * Batch resolve multiple DIDs to profiles
   */
  async getProfiles(actors: string[]): Promise<Map<string, Profile>> {
    const results = new Map<string, Profile>();
    const toFetch: string[] = [];

    // Check cache first
    for (const actor of actors) {
      const cached = profileCache.get(actor);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        results.set(actor, cached.profile);
      } else {
        toFetch.push(actor);
      }
    }

    // Fetch uncached profiles in batches
    const batchSize = 25;
    for (let i = 0; i < toFetch.length; i += batchSize) {
      const batch = toFetch.slice(i, i + batchSize);
      try {
        const response = await this.agent.getProfiles({ actors: batch });
        for (const data of response.data.profiles) {
          const profile: Profile = {
            did: data.did,
            handle: data.handle,
            displayName: data.displayName,
            description: data.description,
            avatar: data.avatar,
            banner: data.banner,
            followersCount: data.followersCount,
            followsCount: data.followsCount,
            postsCount: data.postsCount,
          };

          results.set(data.did, profile);
          results.set(data.handle, profile);

          // Cache
          profileCache.set(data.did, { profile, timestamp: Date.now() });
          profileCache.set(data.handle, { profile, timestamp: Date.now() });
        }
      } catch (error) {
        console.error(`Failed to fetch batch of profiles:`, error);
      }
    }

    return results;
  }

  /**
   * Clear caches
   */
  clearCache(): void {
    identityCache.clear();
    profileCache.clear();
  }
}

// Singleton instance
let defaultResolver: IdentityResolver | null = null;

export function getIdentityResolver(
  serviceUrl?: string
): IdentityResolver {
  if (!defaultResolver) {
    defaultResolver = new IdentityResolver(serviceUrl);
  }
  return defaultResolver;
}

export type { DidDocument, Profile, ResolveResult };
