import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Create mock agent methods that persist across tests
const mockResolveHandle = vi.fn();
const mockGetProfile = vi.fn();
const mockGetProfiles = vi.fn();
const mockGetFollows = vi.fn();

// Mock @atproto/api before importing the module
vi.mock("@atproto/api", () => {
  return {
    AtpAgent: class MockAtpAgent {
      resolveHandle = mockResolveHandle;
      getProfile = mockGetProfile;
      getProfiles = mockGetProfiles;
      getFollows = mockGetFollows;
      constructor(_config: { service: string }) {
        // Ignore config in mock
      }
    },
  };
});

import { IdentityResolver, getIdentityResolver } from "./identity.js";

describe("IdentityResolver", () => {
  let resolver: IdentityResolver;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    resolver = new IdentityResolver();
  });

  afterEach(() => {
    resolver.clearCache();
    vi.unstubAllGlobals();
  });

  describe("resolveHandle", () => {
    it("resolves handle to DID", async () => {
      mockResolveHandle.mockResolvedValue({
        data: { did: "did:plc:abc123" },
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "did:plc:abc123",
            service: [
              { id: "#atproto_pds", serviceEndpoint: "https://pds.example.com" },
            ],
          }),
      });

      const result = await resolver.resolveHandle("alice.bsky.social");

      expect(result).toEqual({
        did: "did:plc:abc123",
        handle: "alice.bsky.social",
        pdsEndpoint: "https://pds.example.com",
      });
      expect(mockResolveHandle).toHaveBeenCalledWith({
        handle: "alice.bsky.social",
      });
    });

    it("returns cached result on subsequent calls", async () => {
      mockResolveHandle.mockResolvedValue({
        data: { did: "did:plc:abc123" },
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "did:plc:abc123" }),
      });

      await resolver.resolveHandle("alice.bsky.social");
      await resolver.resolveHandle("alice.bsky.social");

      expect(mockResolveHandle).toHaveBeenCalledTimes(1);
    });

    it("returns null on error", async () => {
      mockResolveHandle.mockRejectedValue(new Error("Not found"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await resolver.resolveHandle("notfound.bsky.social");

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("resolveDid", () => {
    it("resolves DID to document and extracts handle", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "did:plc:abc123",
            alsoKnownAs: ["at://alice.bsky.social"],
            service: [
              { id: "#atproto_pds", serviceEndpoint: "https://pds.example.com" },
            ],
          }),
      });

      const result = await resolver.resolveDid("did:plc:abc123");

      expect(result).toEqual({
        did: "did:plc:abc123",
        handle: "alice.bsky.social",
        pdsEndpoint: "https://pds.example.com",
      });
    });

    it("returns cached result", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "did:plc:abc123",
            alsoKnownAs: ["at://alice.bsky.social"],
          }),
      });

      await resolver.resolveDid("did:plc:abc123");
      await resolver.resolveDid("did:plc:abc123");

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("handles missing alsoKnownAs", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "did:plc:abc123",
          }),
      });

      const result = await resolver.resolveDid("did:plc:abc123");

      expect(result?.handle).toBeUndefined();
    });

    it("returns null when DID document not found", async () => {
      mockFetch.mockResolvedValue({ ok: false });

      const result = await resolver.resolveDid("did:plc:notfound");

      expect(result).toBeNull();
    });

    it("returns null on error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await resolver.resolveDid("did:plc:abc123");

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("getDidDocument", () => {
    it("fetches did:plc from plc.directory", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "did:plc:abc123" }),
      });

      const doc = await resolver.getDidDocument("did:plc:abc123");

      expect(doc?.id).toBe("did:plc:abc123");
      expect(mockFetch).toHaveBeenCalledWith("https://plc.directory/did:plc:abc123");
    });

    it("fetches did:web from well-known endpoint", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "did:web:example.com" }),
      });

      const doc = await resolver.getDidDocument("did:web:example.com");

      expect(doc?.id).toBe("did:web:example.com");
      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/.well-known/did.json"
      );
    });

    it("handles did:web with encoded port", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "did:web:localhost:3000" }),
      });

      await resolver.getDidDocument("did:web:localhost%3A3000");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://localhost:3000/.well-known/did.json"
      );
    });

    it("returns null for unsupported DID methods", async () => {
      const doc = await resolver.getDidDocument("did:key:xyz123");

      expect(doc).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns null on fetch error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const doc = await resolver.getDidDocument("did:plc:abc123");

      expect(doc).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("getPdsEndpoint", () => {
    it("returns PDS endpoint from DID document", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "did:plc:abc123",
            service: [
              { id: "#atproto_pds", serviceEndpoint: "https://pds.example.com" },
            ],
          }),
      });

      const endpoint = await resolver.getPdsEndpoint("did:plc:abc123");

      expect(endpoint).toBe("https://pds.example.com");
    });

    it("returns null when no PDS service", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "did:plc:abc123",
            service: [{ id: "#other", serviceEndpoint: "https://other.com" }],
          }),
      });

      const endpoint = await resolver.getPdsEndpoint("did:plc:abc123");

      expect(endpoint).toBeNull();
    });

    it("returns null when DID not found", async () => {
      mockFetch.mockResolvedValue({ ok: false });

      const endpoint = await resolver.getPdsEndpoint("did:plc:notfound");

      expect(endpoint).toBeNull();
    });
  });

  describe("getProfile", () => {
    it("fetches and caches profile", async () => {
      const mockProfile = {
        did: "did:plc:abc123",
        handle: "alice.bsky.social",
        displayName: "Alice",
        description: "Bio here",
        avatar: "https://avatar.url",
        banner: "https://banner.url",
        followersCount: 100,
        followsCount: 50,
        postsCount: 200,
      };
      mockGetProfile.mockResolvedValue({ data: mockProfile });

      const profile = await resolver.getProfile("alice.bsky.social");

      expect(profile).toEqual(mockProfile);
      expect(mockGetProfile).toHaveBeenCalledWith({
        actor: "alice.bsky.social",
      });
    });

    it("returns cached profile", async () => {
      mockGetProfile.mockResolvedValue({
        data: {
          did: "did:plc:abc123",
          handle: "alice.bsky.social",
        },
      });

      await resolver.getProfile("alice.bsky.social");
      await resolver.getProfile("alice.bsky.social");

      expect(mockGetProfile).toHaveBeenCalledTimes(1);
    });

    it("caches by both DID and handle", async () => {
      mockGetProfile.mockResolvedValue({
        data: {
          did: "did:plc:abc123",
          handle: "alice.bsky.social",
        },
      });

      await resolver.getProfile("alice.bsky.social");
      const byDid = await resolver.getProfile("did:plc:abc123");

      expect(mockGetProfile).toHaveBeenCalledTimes(1);
      expect(byDid?.handle).toBe("alice.bsky.social");
    });

    it("returns null on error", async () => {
      mockGetProfile.mockRejectedValue(new Error("Not found"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const profile = await resolver.getProfile("notfound.bsky.social");

      expect(profile).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("getProfiles", () => {
    it("fetches multiple profiles in batch", async () => {
      mockGetProfiles.mockResolvedValue({
        data: {
          profiles: [
            { did: "did:plc:1", handle: "alice.bsky.social" },
            { did: "did:plc:2", handle: "bob.bsky.social" },
          ],
        },
      });

      const profiles = await resolver.getProfiles([
        "did:plc:1",
        "did:plc:2",
      ]);

      expect(profiles.size).toBe(4); // 2 by DID + 2 by handle
      expect(profiles.get("did:plc:1")?.handle).toBe("alice.bsky.social");
      expect(profiles.get("bob.bsky.social")?.did).toBe("did:plc:2");
    });

    it("uses cached profiles", async () => {
      mockGetProfile.mockResolvedValue({
        data: { did: "did:plc:1", handle: "alice.bsky.social" },
      });
      mockGetProfiles.mockResolvedValue({
        data: { profiles: [{ did: "did:plc:2", handle: "bob.bsky.social" }] },
      });

      // Cache alice
      await resolver.getProfile("did:plc:1");

      // Batch fetch should only fetch bob
      const profiles = await resolver.getProfiles(["did:plc:1", "did:plc:2"]);

      expect(mockGetProfiles).toHaveBeenCalledWith({
        actors: ["did:plc:2"],
      });
      expect(profiles.get("did:plc:1")).toBeDefined();
      expect(profiles.get("did:plc:2")).toBeDefined();
    });

    it("handles batch fetch errors gracefully", async () => {
      mockGetProfiles.mockRejectedValue(new Error("Batch failed"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const profiles = await resolver.getProfiles(["did:plc:1", "did:plc:2"]);

      expect(profiles.size).toBe(0);
      consoleSpy.mockRestore();
    });

    it("batches requests in groups of 25", async () => {
      const actors = Array.from({ length: 30 }, (_, i) => `did:plc:${i}`);
      mockGetProfiles.mockResolvedValue({ data: { profiles: [] } });

      await resolver.getProfiles(actors);

      expect(mockGetProfiles).toHaveBeenCalledTimes(2);
      expect(mockGetProfiles.mock.calls[0]?.[0].actors).toHaveLength(25);
      expect(mockGetProfiles.mock.calls[1]?.[0].actors).toHaveLength(5);
    });
  });

  describe("getFollows", () => {
    it("fetches follows with pagination", async () => {
      mockGetFollows
        .mockResolvedValueOnce({
          data: {
            follows: [{ did: "did:plc:1" }, { did: "did:plc:2" }],
            cursor: "next",
          },
        })
        .mockResolvedValueOnce({
          data: {
            follows: [{ did: "did:plc:3" }],
            cursor: undefined,
          },
        });

      const follows = await resolver.getFollows("alice.bsky.social");

      expect(follows).toEqual(["did:plc:1", "did:plc:2", "did:plc:3"]);
      expect(mockGetFollows).toHaveBeenCalledTimes(2);
    });

    it("caches follows", async () => {
      mockGetFollows.mockResolvedValue({
        data: { follows: [{ did: "did:plc:1" }], cursor: undefined },
      });

      await resolver.getFollows("alice.bsky.social");
      await resolver.getFollows("alice.bsky.social");

      expect(mockGetFollows).toHaveBeenCalledTimes(1);
    });

    it("uses authenticated agent when provided", async () => {
      const authAgent = {
        getFollows: vi.fn().mockResolvedValue({
          data: { follows: [{ did: "did:plc:1" }], cursor: undefined },
        }),
      };

      await resolver.getFollows("alice.bsky.social", authAgent as any);

      expect(authAgent.getFollows).toHaveBeenCalled();
      expect(mockGetFollows).not.toHaveBeenCalled();
    });

    it("returns empty array on error", async () => {
      mockGetFollows.mockRejectedValue(new Error("Failed"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const follows = await resolver.getFollows("alice.bsky.social");

      expect(follows).toEqual([]);
      consoleSpy.mockRestore();
    });
  });

  describe("clearCache", () => {
    it("clears all caches", async () => {
      mockResolveHandle.mockResolvedValue({
        data: { did: "did:plc:abc" },
      });
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ id: "did:plc:abc" }),
      });
      mockGetProfile.mockResolvedValue({
        data: { did: "did:plc:abc", handle: "alice" },
      });
      mockGetFollows.mockResolvedValue({
        data: { follows: [], cursor: undefined },
      });

      // Populate caches
      await resolver.resolveHandle("alice.bsky.social");
      await resolver.getProfile("did:plc:abc");
      await resolver.getFollows("alice.bsky.social");

      // Clear mocks count
      vi.clearAllMocks();

      // Clear cache
      resolver.clearCache();

      // Verify cache is cleared by calling again
      await resolver.resolveHandle("alice.bsky.social");
      await resolver.getProfile("did:plc:abc");
      await resolver.getFollows("alice.bsky.social");

      expect(mockResolveHandle).toHaveBeenCalledTimes(1);
      expect(mockGetProfile).toHaveBeenCalledTimes(1);
      expect(mockGetFollows).toHaveBeenCalledTimes(1);
    });
  });
});

describe("getIdentityResolver", () => {
  it("returns singleton instance", () => {
    const resolver1 = getIdentityResolver();
    const resolver2 = getIdentityResolver();

    expect(resolver1).toBe(resolver2);
  });
});
