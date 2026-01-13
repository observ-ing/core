/**
 * Taxonomy Resolver
 *
 * Integrates with GBIF and iNaturalist APIs to validate
 * and search for taxonomic names.
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
  source: "gbif" | "inaturalist";
  iconicTaxon?: string;
  photoUrl?: string;
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
  private gbifBaseUrl = "https://api.gbif.org/v1";
  private inatBaseUrl = "https://api.inaturalist.org/v1";

  /**
   * Search for taxa matching a query
   */
  async search(query: string, limit = 10): Promise<TaxonResult[]> {
    const cacheKey = `search:${query.toLowerCase()}:${limit}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.results;
    }

    // Search both GBIF and iNaturalist in parallel
    const [gbifResults, inatResults] = await Promise.all([
      this.searchGbif(query, limit),
      this.searchInat(query, limit),
    ]);

    // Merge and deduplicate results
    const results = this.mergeResults(gbifResults, inatResults, limit);

    searchCache.set(cacheKey, { results, timestamp: Date.now() });
    return results;
  }

  /**
   * Validate a scientific name
   */
  async validate(name: string): Promise<ValidationResult> {
    // Try GBIF first for authoritative taxonomic data
    const gbifMatch = await this.matchGbif(name);
    if (gbifMatch && gbifMatch.matchType === "EXACT") {
      return {
        valid: true,
        matchedName: gbifMatch.scientificName,
        taxon: this.gbifToTaxon(gbifMatch),
      };
    }

    // Try iNaturalist
    const inatResults = await this.searchInat(name, 5);
    const exactMatch = inatResults.find(
      (r) => r.scientificName.toLowerCase() === name.toLowerCase()
    );
    if (exactMatch) {
      return {
        valid: true,
        matchedName: exactMatch.scientificName,
        taxon: exactMatch,
      };
    }

    // If we have a fuzzy GBIF match, return it as a suggestion
    if (gbifMatch) {
      return {
        valid: false,
        suggestions: [this.gbifToTaxon(gbifMatch), ...inatResults.slice(0, 4)],
      };
    }

    // Return iNaturalist results as suggestions
    return {
      valid: false,
      suggestions: inatResults,
    };
  }

  /**
   * Search GBIF species API
   */
  private async searchGbif(query: string, limit: number): Promise<TaxonResult[]> {
    try {
      const url = `${this.gbifBaseUrl}/species/suggest?q=${encodeURIComponent(query)}&limit=${limit}`;
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
   * Match a name against GBIF backbone taxonomy
   */
  private async matchGbif(name: string): Promise<GbifMatchResult | null> {
    try {
      const url = `${this.gbifBaseUrl}/species/match?name=${encodeURIComponent(name)}`;
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = (await response.json()) as GbifMatchResult;
      if (data.matchType === "NONE") return null;
      return data;
    } catch (error) {
      console.error("GBIF match error:", error);
      return null;
    }
  }

  /**
   * Search iNaturalist taxa API
   */
  private async searchInat(query: string, limit: number): Promise<TaxonResult[]> {
    try {
      const url = `${this.inatBaseUrl}/taxa/autocomplete?q=${encodeURIComponent(query)}&per_page=${limit}`;
      const response = await fetch(url);
      if (!response.ok) return [];

      const data = (await response.json()) as { results: InatTaxon[] };
      return data.results.map((item) => this.inatToTaxon(item));
    } catch (error) {
      console.error("iNaturalist search error:", error);
      return [];
    }
  }

  /**
   * Convert GBIF result to TaxonResult
   */
  private gbifToTaxon(item: GbifSuggestResult | GbifMatchResult): TaxonResult {
    return {
      id: `gbif:${item.usageKey || item.key}`,
      scientificName: item.scientificName || item.canonicalName || "",
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
   * Convert iNaturalist result to TaxonResult
   */
  private inatToTaxon(item: InatTaxon): TaxonResult {
    return {
      id: `inat:${item.id}`,
      scientificName: item.name,
      commonName: item.preferred_common_name,
      rank: item.rank || "unknown",
      iconicTaxon: item.iconic_taxon_name,
      photoUrl: item.default_photo?.square_url,
      source: "inaturalist",
    };
  }

  /**
   * Merge and deduplicate results from multiple sources
   */
  private mergeResults(
    gbifResults: TaxonResult[],
    inatResults: TaxonResult[],
    limit: number
  ): TaxonResult[] {
    const seen = new Set<string>();
    const merged: TaxonResult[] = [];

    // Interleave results, preferring iNaturalist for common names and photos
    const maxLen = Math.max(gbifResults.length, inatResults.length);
    for (let i = 0; i < maxLen && merged.length < limit; i++) {
      if (i < inatResults.length) {
        const key = inatResults[i].scientificName.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(inatResults[i]);
        }
      }
      if (i < gbifResults.length && merged.length < limit) {
        const key = gbifResults[i].scientificName.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          merged.push(gbifResults[i]);
        }
      }
    }

    return merged;
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

// iNaturalist API types
interface InatTaxon {
  id: number;
  name: string;
  rank?: string;
  preferred_common_name?: string;
  iconic_taxon_name?: string;
  default_photo?: {
    square_url?: string;
    medium_url?: string;
  };
}

export type { TaxonResult, ValidationResult };
