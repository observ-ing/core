import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as api from "./api";

describe("api", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("checkAuth", () => {
    it("returns user when authenticated", async () => {
      const mockUser = {
        did: "did:plc:test123",
        handle: "alice.bsky.social",
        displayName: "Alice",
        avatar: "https://example.com/avatar.jpg",
      };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ user: mockUser }),
      });

      const result = await api.checkAuth();

      expect(result).toEqual(mockUser);
      expect(mockFetch).toHaveBeenCalledWith("/oauth/me", {
        credentials: "include",
      });
    });

    it("returns null when user is not in response", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await api.checkAuth();

      expect(result).toBeNull();
    });

    it("returns null when not authenticated", async () => {
      mockFetch.mockResolvedValue({ ok: false });

      const result = await api.checkAuth();

      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await api.checkAuth();

      expect(result).toBeNull();
    });
  });

  describe("logout", () => {
    it("calls logout endpoint with POST", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await api.logout();

      expect(mockFetch).toHaveBeenCalledWith("/oauth/logout", {
        method: "POST",
        credentials: "include",
      });
    });
  });

  describe("initiateLogin", () => {
    it("returns auth URL on success", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ url: "https://auth.example.com/authorize" }),
      });

      const result = await api.initiateLogin("alice.bsky.social");

      expect(result).toEqual({ url: "https://auth.example.com/authorize" });
      expect(mockFetch).toHaveBeenCalledWith("/oauth/login?handle=alice.bsky.social");
    });

    it("encodes special characters in handle", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ url: "https://auth.example.com/authorize" }),
      });

      await api.initiateLogin("user+test@example.com");

      expect(mockFetch).toHaveBeenCalledWith("/oauth/login?handle=user%2Btest%40example.com");
    });

    it("throws error with message from server", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Could not find handle" }),
      });

      await expect(api.initiateLogin("invalid")).rejects.toThrow("Could not find handle");
    });

    it("throws generic error when no message", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      });

      await expect(api.initiateLogin("invalid")).rejects.toThrow("Failed to initiate login");
    });
  });

  describe("fetchFeed", () => {
    it("fetches feed without cursor", async () => {
      const mockData = { occurrences: [], cursor: null };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const result = await api.fetchFeed();

      expect(result).toEqual(mockData);
      expect(mockFetch).toHaveBeenCalledWith("/api/occurrences/feed?limit=20");
    });

    it("fetches feed with cursor", async () => {
      const mockData = { occurrences: [], cursor: "next" };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      await api.fetchFeed("abc123");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/occurrences/feed?limit=20&cursor=abc123"
      );
    });

    it("throws on error response", async () => {
      mockFetch.mockResolvedValue({ ok: false });

      await expect(api.fetchFeed()).rejects.toThrow("Failed to load feed");
    });
  });

  describe("fetchExploreFeed", () => {
    it("fetches explore feed without params", async () => {
      const mockData = { occurrences: [], meta: {} };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const result = await api.fetchExploreFeed();

      expect(result).toEqual(mockData);
      expect(mockFetch).toHaveBeenCalledWith("/api/feeds/explore?limit=20");
    });

    it("includes all filter parameters", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api.fetchExploreFeed("cursor123", {
        taxon: "Quercus",
        lat: 40.7128,
        lng: -74.006,
        radius: 50,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feeds/explore?limit=20&cursor=cursor123&taxon=Quercus&lat=40.7128&lng=-74.006&radius=50"
      );
    });

    it("throws on error", async () => {
      mockFetch.mockResolvedValue({ ok: false });

      await expect(api.fetchExploreFeed()).rejects.toThrow(
        "Failed to load explore feed"
      );
    });
  });

  describe("fetchHomeFeed", () => {
    it("fetches home feed without location", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api.fetchHomeFeed();

      expect(mockFetch).toHaveBeenCalledWith("/api/feeds/home?limit=20", {
        credentials: "include",
      });
    });

    it("includes location parameters", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api.fetchHomeFeed("cursor", { lat: 40, lng: -74, nearbyRadius: 100 });

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/feeds/home?limit=20&cursor=cursor&lat=40&lng=-74&nearbyRadius=100",
        { credentials: "include" }
      );
    });

    it("throws authentication error on 401", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 401 });

      await expect(api.fetchHomeFeed()).rejects.toThrow(
        "Authentication required"
      );
    });

    it("throws generic error on other failures", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      await expect(api.fetchHomeFeed()).rejects.toThrow(
        "Failed to load home feed"
      );
    });
  });

  describe("fetchProfileFeed", () => {
    it("fetches profile feed by DID", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api.fetchProfileFeed("did:plc:test123");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/profiles/did%3Aplc%3Atest123/feed?limit=20"
      );
    });

    it("includes cursor and type", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      await api.fetchProfileFeed("did:plc:test", "cursor123", "identifications");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/profiles/did%3Aplc%3Atest/feed?limit=20&cursor=cursor123&type=identifications"
      );
    });

    it("throws on error", async () => {
      mockFetch.mockResolvedValue({ ok: false });

      await expect(api.fetchProfileFeed("did:plc:test")).rejects.toThrow(
        "Failed to load profile feed"
      );
    });
  });

  describe("fetchObservation", () => {
    it("fetches single occurrence", async () => {
      const mockData = { occurrence: { uri: "at://test" } };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const result = await api.fetchObservation("at://test/occurrence/123");

      expect(result).toEqual(mockData);
    });

    it("returns null on 404", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const result = await api.fetchObservation("at://test/occurrence/notfound");

      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await api.fetchObservation("at://test/occurrence/123");

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("fetchObservationsGeoJSON", () => {
    it("fetches GeoJSON with bounds", async () => {
      const mockData = { type: "FeatureCollection", features: [] };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const result = await api.fetchObservationsGeoJSON({
        minLat: 40,
        minLng: -75,
        maxLat: 41,
        maxLng: -74,
      });

      expect(result).toEqual(mockData);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/occurrences/geojson?minLat=40&minLng=-75&maxLat=41&maxLng=-74"
      );
    });

    it("throws on error", async () => {
      mockFetch.mockResolvedValue({ ok: false });

      await expect(
        api.fetchObservationsGeoJSON({
          minLat: 40,
          minLng: -75,
          maxLat: 41,
          maxLng: -74,
        })
      ).rejects.toThrow("Failed to load observations");
    });
  });

  describe("searchTaxa", () => {
    it("returns empty array for short queries", async () => {
      const result = await api.searchTaxa("a");

      expect(result).toEqual([]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("searches taxa by query", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ results: [{ id: 1, name: "Quercus alba" }] }),
      });

      const result = await api.searchTaxa("Quercus");

      expect(result).toEqual([{ id: 1, name: "Quercus alba" }]);
      expect(mockFetch).toHaveBeenCalledWith("/api/taxa/search?q=Quercus");
    });

    it("returns empty array on error", async () => {
      mockFetch.mockResolvedValue({ ok: false });

      const result = await api.searchTaxa("Quercus");

      expect(result).toEqual([]);
    });

    it("returns empty array when results is undefined", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({}),
      });

      const result = await api.searchTaxa("Quercus");

      expect(result).toEqual([]);
    });
  });

  describe("submitObservation", () => {
    it("submits occurrence data", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ uri: "at://test", cid: "cid123" }),
      });

      const result = await api.submitObservation({
        scientificName: "Quercus alba",
        latitude: 40.7128,
        longitude: -74.006,
        eventDate: "2024-01-15",
      });

      expect(result).toEqual({ uri: "at://test", cid: "cid123" });
      expect(mockFetch).toHaveBeenCalledWith("/api/occurrences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: expect.any(String),
      });
    });

    it("throws with error message from server", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Invalid coordinates" }),
      });

      await expect(
        api.submitObservation({
          scientificName: "Test",
          latitude: 999,
          longitude: -74,
          eventDate: "2024-01-15",
        })
      ).rejects.toThrow("Invalid coordinates");
    });

    it("throws generic error when no message", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      });

      await expect(
        api.submitObservation({
          scientificName: "Test",
          latitude: 40,
          longitude: -74,
          eventDate: "2024-01-15",
        })
      ).rejects.toThrow("Failed to submit");
    });
  });

  describe("updateObservation", () => {
    it("updates occurrence with PUT", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ uri: "at://test", cid: "cid456" }),
      });

      const result = await api.updateObservation({
        uri: "at://test/occurrence/123",
        scientificName: "Quercus rubra",
        latitude: 40,
        longitude: -74,
        eventDate: "2024-01-15",
      });

      expect(result).toEqual({ uri: "at://test", cid: "cid456" });
      expect(mockFetch).toHaveBeenCalledWith("/api/occurrences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: expect.any(String),
      });
    });

    it("throws on error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Not found" }),
      });

      await expect(
        api.updateObservation({
          uri: "at://test",
          scientificName: "Test",
          latitude: 40,
          longitude: -74,
          eventDate: "2024-01-15",
        })
      ).rejects.toThrow("Not found");
    });
  });

  describe("deleteObservation", () => {
    it("deletes occurrence", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ success: true }),
      });

      const result = await api.deleteObservation("at://test/occurrence/123");

      expect(result).toEqual({ success: true });
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/occurrences/at%3A%2F%2Ftest%2Foccurrence%2F123",
        { method: "DELETE", credentials: "include" }
      );
    });

    it("throws on error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Unauthorized" }),
      });

      await expect(api.deleteObservation("at://test")).rejects.toThrow(
        "Unauthorized"
      );
    });
  });

  describe("getImageUrl", () => {
    it("returns full image URL", () => {
      const url = api.getImageUrl("/images/photo.jpg");

      expect(url).toBe("/images/photo.jpg");
    });
  });

  describe("submitIdentification", () => {
    it("submits identification", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ uri: "at://id", cid: "cid" }),
      });

      const result = await api.submitIdentification({
        occurrenceUri: "at://occ",
        occurrenceCid: "cidocc",
        taxonName: "Quercus alba",
        taxonRank: "species",
        isAgreement: true,
        confidence: "high",
      });

      expect(result).toEqual({ uri: "at://id", cid: "cid" });
      expect(mockFetch).toHaveBeenCalledWith("/api/identifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: expect.any(String),
      });
    });

    it("throws on error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({ error: "Missing taxon" }),
      });

      await expect(
        api.submitIdentification({
          occurrenceUri: "at://occ",
          occurrenceCid: "cid",
          taxonName: "",
        })
      ).rejects.toThrow("Missing taxon");
    });
  });

  describe("submitComment", () => {
    it("submits comment", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ uri: "at://comment", cid: "cid" }),
      });

      const result = await api.submitComment({
        occurrenceUri: "at://occ",
        occurrenceCid: "cidocc",
        body: "Great observation!",
      });

      expect(result).toEqual({ uri: "at://comment", cid: "cid" });
    });

    it("submits reply comment", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ uri: "at://reply", cid: "cid" }),
      });

      await api.submitComment({
        occurrenceUri: "at://occ",
        occurrenceCid: "cidocc",
        body: "Thanks!",
        replyToUri: "at://parent",
        replyToCid: "cidparent",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.replyToUri).toBe("at://parent");
      expect(body.replyToCid).toBe("cidparent");
    });

    it("throws on error", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        json: () => Promise.resolve({}),
      });

      await expect(
        api.submitComment({
          occurrenceUri: "at://occ",
          occurrenceCid: "cid",
          body: "Test",
        })
      ).rejects.toThrow("Failed to submit comment");
    });
  });

  describe("fetchTaxon", () => {
    it("fetches taxon details", async () => {
      const mockTaxon = { id: "123", name: "Quercus alba" };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockTaxon),
      });

      const result = await api.fetchTaxon("123");

      expect(result).toEqual(mockTaxon);
      expect(mockFetch).toHaveBeenCalledWith("/api/taxa/123");
    });

    it("returns null on 404", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const result = await api.fetchTaxon("notfound");

      expect(result).toBeNull();
    });

    it("returns null on error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const result = await api.fetchTaxon("123");

      expect(result).toBeNull();
      consoleSpy.mockRestore();
    });
  });

  describe("fetchTaxonObservations", () => {
    it("fetches occurrences for taxon", async () => {
      const mockData = { occurrences: [], cursor: "next" };
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockData),
      });

      const result = await api.fetchTaxonObservations("123");

      expect(result).toEqual(mockData);
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/taxa/123/occurrences?limit=20"
      );
    });

    it("includes cursor", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ occurrences: [] }),
      });

      await api.fetchTaxonObservations("123", undefined, "cursor456");

      expect(mockFetch).toHaveBeenCalledWith(
        "/api/taxa/123/occurrences?limit=20&cursor=cursor456"
      );
    });

    it("throws on error", async () => {
      mockFetch.mockResolvedValue({ ok: false });

      await expect(api.fetchTaxonObservations("123")).rejects.toThrow(
        "Failed to fetch taxon observations"
      );
    });
  });
});
