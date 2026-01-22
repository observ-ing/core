/**
 * Taxonomy Resolver
 *
 * Integrates with GBIF API to validate and search for taxonomic names.
 */

interface TaxonResult {
  id: string;
  scientificName: string;
  commonName?: string;
  rank: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  source: "gbif";
}

interface ValidationResult {
  valid: boolean;
  matchedName?: string;
  taxon?: TaxonResult;
  suggestions?: TaxonResult[];
}

// Simple in-memory cache
const searchCache = new Map<string, { results: TaxonResult[]; timestamp: number }>();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export class TaxonomyResolver {
  private gbifV1BaseUrl = "https://api.gbif.org/v1";
  private gbifV2BaseUrl = "https://api.gbif.org/v2";

  /**
   * Search for taxa matching a query
   */
  async search(query: string, limit = 10): Promise<TaxonResult[]> {
    const cacheKey = `search:${query.toLowerCase()}:${limit}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.results;
    }

    const results = await this.searchGbif(query, limit);

    searchCache.set(cacheKey, { results, timestamp: Date.now() });
    return results;
  }

  /**
   * Validate a scientific name
   */
  async validate(name: string): Promise<ValidationResult> {
    const gbifMatch = await this.matchGbif(name);
    if (!gbifMatch || !gbifMatch.usage) {
      return { valid: false, suggestions: [] };
    }

    const matchType = gbifMatch.diagnostics?.matchType;
    const taxon = this.gbifV2ToTaxon(gbifMatch.usage);

    if (matchType === "EXACT") {
      return {
        valid: true,
        matchedName: gbifMatch.usage.canonicalName || gbifMatch.usage.name,
        taxon,
      };
    }

    // If we have a fuzzy or higher rank match, return it as a suggestion
    return {
      valid: false,
      suggestions: [taxon],
    };
  }

  /**
   * Search GBIF species API
   */
  private async searchGbif(query: string, limit: number): Promise<TaxonResult[]> {
    try {
      // Filter to accepted names only to avoid synonyms cluttering results
      const url = `${this.gbifV1BaseUrl}/species/suggest?q=${encodeURIComponent(query)}&limit=${limit}&status=ACCEPTED`;
      const response = await fetch(url);
      if (!response.ok) return [];

      const data = (await response.json()) as GbifSuggestResult[];
      return data.map((item) => this.gbifToTaxon(item));
    } catch (error) {
      console.error("GBIF search error:", error);
      return [];
    }
  }

  /**
   * Match a name against GBIF backbone taxonomy (v2 API)
   */
  private async matchGbif(name: string): Promise<GbifV2MatchResult | null> {
    try {
      const url = `${this.gbifV2BaseUrl}/species/match?scientificName=${encodeURIComponent(name)}`;
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = (await response.json()) as GbifV2MatchResult;
      if (!data.usage) return null;
      return data;
    } catch (error) {
      console.error("GBIF match error:", error);
      return null;
    }
  }

  /**
   * Convert GBIF v1 result to TaxonResult
   */
  private gbifToTaxon(item: GbifSuggestResult | GbifMatchResult): TaxonResult {
    return {
      id: `gbif:${item.usageKey || item.key}`,
      scientificName: item.canonicalName || item.scientificName || "",
      commonName: item.vernacularName,
      rank: item.rank?.toLowerCase() || "unknown",
      kingdom: item.kingdom,
      phylum: item.phylum,
      class: item.class,
      order: item.order,
      family: item.family,
      genus: item.genus,
      species: item.species,
      source: "gbif",
    };
  }

  /**
   * Convert GBIF v2 result to TaxonResult
   */
  private gbifV2ToTaxon(usage: GbifV2NameUsage): TaxonResult {
    return {
      id: `gbif:${usage.key}`,
      scientificName: usage.canonicalName || usage.name || "",
      rank: usage.rank?.toLowerCase() || "unknown",
      kingdom: usage.kingdom,
      phylum: usage.phylum,
      class: usage.class,
      order: usage.order,
      family: usage.family,
      genus: usage.genus,
      species: usage.species,
      source: "gbif",
    };
  }
}

// GBIF API types
interface GbifSuggestResult {
  key?: number;
  usageKey?: number;
  scientificName?: string;
  canonicalName?: string;
  vernacularName?: string;
  rank?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
}

interface GbifMatchResult extends GbifSuggestResult {
  matchType: "EXACT" | "FUZZY" | "HIGHERRANK" | "NONE";
  confidence?: number;
}

// GBIF v2 API types
interface GbifV2NameUsage {
  key?: number;
  name?: string;
  canonicalName?: string;
  rank?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
}

interface GbifV2MatchResult {
  synonym: boolean;
  usage?: GbifV2NameUsage;
  classification?: GbifV2NameUsage[];
  diagnostics?: {
    matchType?: "EXACT" | "FUZZY" | "HIGHERRANK" | "NONE";
    confidence?: number;
  };
}

export type { TaxonResult, ValidationResult };
