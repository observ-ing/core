import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { TaxonomyResolver } from "./taxonomy.js";

describe("TaxonomyResolver", () => {
  let resolver: TaxonomyResolver;
  let mockFetch: ReturnType<typeof vi.fn>;
  let testId = 0; // Unique ID to avoid cache hits between tests

  const createGbifSuggestResult = (overrides = {}) => ({
    key: 12345,
    usageKey: 12345,
    scientificName: "Quercus alba L.",
    canonicalName: "Quercus alba",
    vernacularName: "White Oak",
    rank: "SPECIES",
    kingdom: "Plantae",
    phylum: "Tracheophyta",
    class: "Magnoliopsida",
    order: "Fagales",
    family: "Fagaceae",
    genus: "Quercus",
    species: "Quercus alba",
    ...overrides,
  });

  const createGbifV2MatchResult = (overrides = {}) => ({
    synonym: false,
    usage: {
      key: 12345,
      name: "Quercus alba",
      canonicalName: "Quercus alba",
      rank: "SPECIES",
    },
    classification: [
      { key: 1, name: "Plantae", rank: "KINGDOM" },
      { key: 2, name: "Tracheophyta", rank: "PHYLUM" },
      { key: 3, name: "Fagaceae", rank: "FAMILY" },
      { key: 4, name: "Quercus", rank: "GENUS" },
    ],
    diagnostics: {
      matchType: "EXACT",
      confidence: 100,
    },
    ...overrides,
  });

  const createGbifSpeciesDetail = (overrides = {}) => ({
    key: 12345,
    scientificName: "Quercus alba L.",
    canonicalName: "Quercus alba",
    vernacularName: "White Oak",
    rank: "SPECIES",
    kingdom: "Plantae",
    phylum: "Tracheophyta",
    class: "Magnoliopsida",
    order: "Fagales",
    family: "Fagaceae",
    genus: "Quercus",
    species: "Quercus alba",
    kingdomKey: 1,
    phylumKey: 2,
    classKey: 3,
    orderKey: 4,
    familyKey: 5,
    genusKey: 6,
    numDescendants: 0,
    extinct: false,
    ...overrides,
  });

  beforeEach(() => {
    testId++;
    mockFetch = vi.fn();
    vi.stubGlobal("fetch", mockFetch);
    resolver = new TaxonomyResolver();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("search", () => {
    it("returns search results from GBIF", async () => {
      const query = `Quercus_search_${testId}`;
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/species/suggest")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([createGbifSuggestResult()]),
          });
        }
        // v2 match API for conservation status
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createGbifV2MatchResult()),
        });
      });

      const results = await resolver.search(query);

      expect(results).toHaveLength(1);
      expect(results[0].scientificName).toBe("Quercus alba");
      expect(results[0].id).toBe("Plantae/Quercus alba");
      expect(results[0].source).toBe("gbif");
    });

    it("includes conservation status when available", async () => {
      const query = `Quercus_cons_${testId}`;
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/species/suggest")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([createGbifSuggestResult()]),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ...createGbifV2MatchResult(),
              additionalStatus: [{ datasetAlias: "IUCN", statusCode: "VU" }],
            }),
        });
      });

      const results = await resolver.search(query);

      expect(results[0].conservationStatus).toEqual({
        category: "VU",
        source: "IUCN",
      });
    });

    it("respects limit parameter", async () => {
      const query = `Quercus_limit_${testId}`;
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve([]),
        })
      );

      await resolver.search(query, 5);

      expect(mockFetch).toHaveBeenCalledWith(expect.stringContaining("limit=5"));
    });

    it("returns empty array on API error", async () => {
      const query = `Quercus_error_${testId}`;
      mockFetch.mockResolvedValue({ ok: false });

      const results = await resolver.search(query);

      expect(results).toEqual([]);
    });

    it("returns empty array on network error", async () => {
      const query = `Quercus_network_${testId}`;
      mockFetch.mockRejectedValue(new Error("Network error"));

      const results = await resolver.search(query);

      expect(results).toEqual([]);
    });

    it("uses cache for repeated queries", async () => {
      const query = `Quercus_cache_${testId}`;
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/species/suggest")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve([createGbifSuggestResult()]),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createGbifV2MatchResult()),
        });
      });

      await resolver.search(query);
      const callCount = mockFetch.mock.calls.length;

      // Second call should use cache
      await resolver.search(query);
      expect(mockFetch.mock.calls.length).toBe(callCount);
    });
  });

  describe("validate", () => {
    it("returns valid for exact match", async () => {
      const name = `Quercus alba_validate_${testId}`;
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createGbifV2MatchResult()),
      });

      const result = await resolver.validate(name);

      expect(result.valid).toBe(true);
      expect(result.matchedName).toBe("Quercus alba");
      expect(result.taxon?.scientificName).toBe("Quercus alba");
    });

    it("returns suggestions for fuzzy match", async () => {
      const name = `Quercus alb_fuzzy_${testId}`;
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            ...createGbifV2MatchResult(),
            diagnostics: { matchType: "FUZZY" },
          }),
      });

      const result = await resolver.validate(name);

      expect(result.valid).toBe(false);
      expect(result.suggestions).toHaveLength(1);
      expect(result.suggestions?.[0].scientificName).toBe("Quercus alba");
    });

    it("returns invalid with no suggestions when no match", async () => {
      const name = `Nonexistent_${testId}`;
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ synonym: false }),
      });

      const result = await resolver.validate(name);

      expect(result.valid).toBe(false);
      expect(result.suggestions).toEqual([]);
    });

    it("extracts taxonomy from classification array", async () => {
      const name = `Quercus alba_class_${testId}`;
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(createGbifV2MatchResult()),
      });

      const result = await resolver.validate(name);

      expect(result.taxon?.kingdom).toBe("Plantae");
      expect(result.taxon?.family).toBe("Fagaceae");
      expect(result.taxon?.genus).toBe("Quercus");
    });
  });

  describe("getById", () => {
    const setupGetByIdMocks = (detailOverrides = {}, matchOverrides = {}) => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/children")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ results: [] }),
          });
        }
        if (url.includes("/descriptions")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ results: [] }),
          });
        }
        if (url.includes("/references")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ results: [] }),
          });
        }
        if (url.includes("/media")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ results: [] }),
          });
        }
        if (url.includes("/v2/species/match")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ ...createGbifV2MatchResult(), ...matchOverrides }),
          });
        }
        // Main species detail endpoint
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ...createGbifSpeciesDetail(), ...detailOverrides }),
        });
      });
    };

    it("returns taxon details by GBIF ID", async () => {
      const id = `gbif:${10000 + testId}`;
      setupGetByIdMocks();

      const result = await resolver.getById(id);

      expect(result).not.toBeNull();
      expect(result?.scientificName).toBe("Quercus alba");
      expect(result?.source).toBe("gbif");
      expect(result?.ancestors).toBeDefined();
    });

    it("handles numeric ID without prefix", async () => {
      const numericId = `${20000 + testId}`;
      setupGetByIdMocks();

      await resolver.getById(numericId);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/species/${numericId}`)
      );
    });

    it("builds ancestor hierarchy from key fields", async () => {
      const id = `gbif:${30000 + testId}`;
      setupGetByIdMocks({
        key: 30000 + testId,
        kingdomKey: 100,
        kingdom: "Plantae",
        phylumKey: 200,
        phylum: "Tracheophyta",
        familyKey: 500,
        family: "Fagaceae",
      });

      const result = await resolver.getById(id);

      expect(result?.ancestors).toContainEqual({
        id: "Plantae",
        name: "Plantae",
        rank: "kingdom",
      });
      expect(result?.ancestors).toContainEqual({
        id: "Plantae/Fagaceae",
        name: "Fagaceae",
        rank: "family",
      });
    });

    it("includes descriptions when available", async () => {
      const id = `gbif:${40000 + testId}`;
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/descriptions")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                results: [
                  { description: "A large deciduous tree", type: "general", source: "Wikipedia" },
                ],
              }),
          });
        }
        if (url.includes("/children") || url.includes("/references") || url.includes("/media")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ results: [] }),
          });
        }
        if (url.includes("/v2/species/match")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(createGbifV2MatchResult()),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createGbifSpeciesDetail({ key: 40000 + testId })),
        });
      });

      const result = await resolver.getById(id);

      expect(result?.descriptions).toHaveLength(1);
      expect(result?.descriptions?.[0].description).toBe("A large deciduous tree");
    });

    it("includes media when available", async () => {
      const id = `gbif:${50000 + testId}`;
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/media")) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                results: [{ identifier: "https://example.com/photo.jpg", type: "StillImage" }],
              }),
          });
        }
        if (url.includes("/children") || url.includes("/references") || url.includes("/descriptions")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ results: [] }),
          });
        }
        if (url.includes("/v2/species/match")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve(createGbifV2MatchResult()),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createGbifSpeciesDetail({ key: 50000 + testId })),
        });
      });

      const result = await resolver.getById(id);

      expect(result?.media).toHaveLength(1);
      expect(result?.media?.[0].url).toBe("https://example.com/photo.jpg");
    });

    it("returns null on API error for main endpoint", async () => {
      const id = `gbif:${60000 + testId}`;
      mockFetch.mockImplementation((url: string) => {
        if (url.includes(`/species/${60000 + testId}`) && !url.includes("/")) {
          return Promise.resolve({ ok: false });
        }
        // First call is the main species endpoint
        if (mockFetch.mock.calls.length === 1) {
          return Promise.resolve({ ok: false });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ results: [] }),
        });
      });
      mockFetch.mockResolvedValueOnce({ ok: false });

      const result = await resolver.getById(id);

      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      const id = `gbif:${70000 + testId}`;
      mockFetch.mockRejectedValue(new Error("Network error"));

      const result = await resolver.getById(id);

      expect(result).toBeNull();
    });
  });

  describe("getByName", () => {
    it("resolves a taxon by scientific name and kingdom", async () => {
      mockFetch.mockImplementation((url: string) => {
        if (url.includes("/v2/species/match")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({
              ...createGbifV2MatchResult(),
              usage: { key: 200000 + testId, name: "Quercus alba", canonicalName: "Quercus alba", rank: "SPECIES" },
            }),
          });
        }
        if (url.includes("/children") || url.includes("/descriptions") || url.includes("/references") || url.includes("/media")) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ results: [] }),
          });
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve(createGbifSpeciesDetail({ key: 200000 + testId })),
        });
      });

      const result = await resolver.getByName("Quercus alba", "Plantae");

      expect(result).not.toBeNull();
      expect(result?.scientificName).toBe("Quercus alba");
      expect(result?.id).toBe("Plantae/Quercus alba");
    });

    it("returns null when no match found", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ synonym: false }),
      });

      const result = await resolver.getByName("Nonexistent species");

      expect(result).toBeNull();
    });
  });

  describe("getChildren", () => {
    it("returns child taxa", async () => {
      const id = `gbif:${80000 + testId}`;
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            results: [
              createGbifSuggestResult({ key: 111, canonicalName: "Quercus alba" }),
              createGbifSuggestResult({ key: 222, canonicalName: "Quercus rubra" }),
            ],
          }),
      });

      const children = await resolver.getChildren(id);

      expect(children).toHaveLength(2);
      expect(children[0].scientificName).toBe("Quercus alba");
      expect(children[1].scientificName).toBe("Quercus rubra");
    });

    it("handles numeric ID", async () => {
      const numericId = `${90000 + testId}`;
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ results: [] }),
      });

      await resolver.getChildren(numericId, 10);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining(`/species/${numericId}/children?limit=10`)
      );
    });

    it("returns empty array on error", async () => {
      const id = `gbif:${100000 + testId}`;
      mockFetch.mockResolvedValue({ ok: false });

      const children = await resolver.getChildren(id);

      expect(children).toEqual([]);
    });
  });
});
