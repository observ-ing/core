/**
 * Taxonomy Resolver
 *
 * Integrates with GBIF API to validate and search for taxonomic names.
 */

/**
 * IUCN Red List conservation status categories
 * @see https://www.iucnredlist.org/resources/categories-and-criteria
 */
type IUCNCategory =
  | "EX" // Extinct
  | "EW" // Extinct in the Wild
  | "CR" // Critically Endangered
  | "EN" // Endangered
  | "VU" // Vulnerable
  | "NT" // Near Threatened
  | "LC" // Least Concern
  | "DD" // Data Deficient
  | "NE"; // Not Evaluated

interface ConservationStatus {
  category: IUCNCategory;
  source: string;
}

interface TaxonResult {
  id: string;
  scientificName: string;
  commonName?: string | undefined;
  rank: string;
  kingdom?: string | undefined;
  phylum?: string | undefined;
  class?: string | undefined;
  order?: string | undefined;
  family?: string | undefined;
  genus?: string | undefined;
  species?: string | undefined;
  source: "gbif";
  conservationStatus?: ConservationStatus | undefined;
}

interface TaxonAncestor {
  id: string;
  name: string;
  rank: string;
}

interface TaxonDescription {
  description: string;
  type?: string | undefined;
  source?: string | undefined;
}

interface TaxonReference {
  citation: string;
  doi?: string | undefined;
  link?: string | undefined;
}

interface TaxonMedia {
  type: string;
  url: string;
  title?: string | undefined;
  description?: string | undefined;
  source?: string | undefined;
  creator?: string | undefined;
  license?: string | undefined;
}

interface TaxonDetail extends TaxonResult {
  ancestors: TaxonAncestor[];
  children: TaxonResult[];
  numDescendants?: number | undefined;
  extinct?: boolean | undefined;
  descriptions?: TaxonDescription[] | undefined;
  references?: TaxonReference[] | undefined;
  media?: TaxonMedia[] | undefined;
}

interface ValidationResult {
  valid: boolean;
  matchedName?: string | undefined;
  taxon?: TaxonResult | undefined;
  suggestions?: TaxonResult[] | undefined;
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
   * Get detailed taxon information by GBIF ID
   */
  async getById(taxonId: string): Promise<TaxonDetail | null> {
    // Extract numeric ID from "gbif:NNNN" format
    const numericId = taxonId.startsWith("gbif:") ? taxonId.slice(5) : taxonId;

    const cacheKey = `detail:${numericId}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.results[0] as unknown as TaxonDetail;
    }

    try {
      const url = `${this.gbifV1BaseUrl}/species/${numericId}`;
      const response = await fetch(url);
      if (!response.ok) return null;

      const data = (await response.json()) as GbifSpeciesDetail;

      // Fetch children, descriptions, references, and media in parallel
      const [children, descriptions, references, media] = await Promise.all([
        this.getChildren(taxonId, 20),
        this.getDescriptions(numericId),
        this.getReferences(numericId),
        this.getMedia(numericId),
      ]);

      // Build ancestors from individual key fields (kingdomKey, phylumKey, etc.)
      // higherClassificationMap is often null, so we use the individual fields instead
      const ancestors: TaxonAncestor[] = [];
      const rankFields: Array<{ rank: string; keyField: keyof GbifSpeciesDetail; nameField: keyof GbifSpeciesDetail }> = [
        { rank: "kingdom", keyField: "kingdomKey", nameField: "kingdom" },
        { rank: "phylum", keyField: "phylumKey", nameField: "phylum" },
        { rank: "class", keyField: "classKey", nameField: "class" },
        { rank: "order", keyField: "orderKey", nameField: "order" },
        { rank: "family", keyField: "familyKey", nameField: "family" },
        { rank: "genus", keyField: "genusKey", nameField: "genus" },
      ];

      for (const { rank, keyField, nameField } of rankFields) {
        const key = data[keyField];
        const name = data[nameField];
        // Skip if this is the current taxon (by key) or if no key/name
        if (key && name && String(key) !== numericId) {
          ancestors.push({
            id: `gbif:${key}`,
            name: String(name),
            rank,
          });
        }
      }

      // Get conservation status
      const match = await this.matchGbif(data.canonicalName || data.scientificName || "");
      const iucnStatus = match?.additionalStatus?.find((s) => s.datasetAlias === "IUCN");
      const conservationStatus: ConservationStatus | undefined = iucnStatus?.statusCode
        ? { category: iucnStatus.statusCode as IUCNCategory, source: "IUCN" }
        : undefined;

      const taxonDetail: TaxonDetail = ({
        id: `gbif:${data.key}`,
        scientificName: data.canonicalName || data.scientificName || "",
        commonName: data.vernacularName,
        rank: data.rank?.toLowerCase() || "unknown",
        kingdom: data.kingdom,
        phylum: data.phylum,
        class: data.class,
        order: data.order,
        family: data.family,
        genus: data.genus,
        species: data.species,
        source: "gbif" as const,
        conservationStatus,
        ancestors,
        children,
        numDescendants: data.numDescendants,
        extinct: data.extinct,
        descriptions: descriptions.length > 0 ? descriptions : undefined,
        references: references.length > 0 ? references : undefined,
        media: media.length > 0 ? media : undefined,
      });

      searchCache.set(cacheKey, { results: [taxonDetail as unknown as TaxonResult], timestamp: Date.now() });
      return taxonDetail;
    } catch (error) {
      console.error("GBIF getById error:", error);
      return null;
    }
  }

  /**
   * Get descriptions for a taxon
   */
  private async getDescriptions(numericId: string): Promise<TaxonDescription[]> {
    try {
      const url = `${this.gbifV1BaseUrl}/species/${numericId}/descriptions?limit=5`;
      const response = await fetch(url);
      if (!response.ok) return [];

      const data = (await response.json()) as { results: GbifDescription[] };
      return data.results
        .filter((d) => d.description)
        .map((d) => ({
          description: d.description!,
          type: d.type,
          source: d.source,
        }));
    } catch (error) {
      console.error("GBIF getDescriptions error:", error);
      return [];
    }
  }

  /**
   * Get references for a taxon
   */
  private async getReferences(numericId: string): Promise<TaxonReference[]> {
    try {
      const url = `${this.gbifV1BaseUrl}/species/${numericId}/references?limit=10`;
      const response = await fetch(url);
      if (!response.ok) return [];

      const data = (await response.json()) as { results: GbifReference[] };
      return data.results
        .filter((r) => r.citation)
        .map((r) => ({
          citation: r.citation!,
          doi: r.doi,
          link: r.link,
        }));
    } catch (error) {
      console.error("GBIF getReferences error:", error);
      return [];
    }
  }

  /**
   * Get media for a taxon
   */
  private async getMedia(numericId: string): Promise<TaxonMedia[]> {
    try {
      const url = `${this.gbifV1BaseUrl}/species/${numericId}/media?limit=10`;
      const response = await fetch(url);
      if (!response.ok) return [];

      const data = (await response.json()) as { results: GbifMedia[] };
      return data.results
        .filter((m) => m.identifier)
        .map((m) => ({
          type: m.type || "StillImage",
          url: m.identifier!,
          title: m.title,
          description: m.description,
          source: m.source,
          creator: m.creator,
          license: m.license,
        }));
    } catch (error) {
      console.error("GBIF getMedia error:", error);
      return [];
    }
  }

  /**
   * Get children taxa for a parent taxon
   */
  async getChildren(taxonId: string, limit = 20): Promise<TaxonResult[]> {
    const numericId = taxonId.startsWith("gbif:") ? taxonId.slice(5) : taxonId;

    const cacheKey = `children:${numericId}:${limit}`;
    const cached = searchCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
      return cached.results;
    }

    try {
      const url = `${this.gbifV1BaseUrl}/species/${numericId}/children?limit=${limit}`;
      const response = await fetch(url);
      if (!response.ok) return [];

      const data = (await response.json()) as { results: GbifSuggestResult[] };
      const results = data.results.map((item) => this.gbifToTaxon(item));

      searchCache.set(cacheKey, { results, timestamp: Date.now() });
      return results;
    } catch (error) {
      console.error("GBIF getChildren error:", error);
      return [];
    }
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
    const taxon = this.gbifV2ToTaxon(gbifMatch.usage, gbifMatch.additionalStatus, gbifMatch.classification);

    if (matchType === "EXACT") {
      return ({
        valid: true,
        matchedName: gbifMatch.usage.canonicalName || gbifMatch.usage.name,
        taxon,
      });
    }

    // If we have a fuzzy or higher rank match, return it as a suggestion
    return {
      valid: false,
      suggestions: [taxon],
    };
  }

  /**
   * Search GBIF species API and enrich with conservation status
   */
  private async searchGbif(query: string, limit: number): Promise<TaxonResult[]> {
    try {
      // Filter to accepted names only to avoid synonyms cluttering results
      const url = `${this.gbifV1BaseUrl}/species/suggest?q=${encodeURIComponent(query)}&limit=${limit}&status=ACCEPTED`;
      const response = await fetch(url);
      if (!response.ok) return [];

      const data = (await response.json()) as GbifSuggestResult[];
      const basicResults = data.map((item) => this.gbifToTaxon(item));

      // Enrich with conservation status from v2 API (in parallel)
      const enrichedResults = await Promise.all(
        basicResults.map(async (result) => {
          const match = await this.matchGbif(result.scientificName);
          if (match?.additionalStatus) {
            const iucnStatus = match.additionalStatus.find((s) => s.datasetAlias === "IUCN");
            if (iucnStatus?.statusCode) {
              return {
                ...result,
                conservationStatus: {
                  category: iucnStatus.statusCode as IUCNCategory,
                  source: "IUCN",
                },
              };
            }
          }
          return result;
        }),
      );

      return enrichedResults;
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
    return ({
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
      source: "gbif" as const,
    });
  }

  /**
   * Convert GBIF v2 result to TaxonResult
   */
  private gbifV2ToTaxon(
    usage: GbifV2NameUsage,
    additionalStatus?: GbifV2AdditionalStatus[],
    classification?: GbifV2NameUsage[],
  ): TaxonResult {
    // Extract IUCN conservation status if available
    const iucnStatus = additionalStatus?.find((s) => s.datasetAlias === "IUCN");
    const conservationStatus: ConservationStatus | undefined = iucnStatus?.statusCode
      ? {
          category: iucnStatus.statusCode as IUCNCategory,
          source: "IUCN",
        }
      : undefined;

    // Extract taxonomy from classification array
    const classificationByRank = new Map<string, string>();
    if (classification) {
      for (const item of classification) {
        if (item.rank && item.name) {
          classificationByRank.set(item.rank.toUpperCase(), item.name);
        }
      }
    }

    return ({
      id: `gbif:${usage.key}`,
      scientificName: usage.canonicalName || usage.name || "",
      rank: usage.rank?.toLowerCase() || "unknown",
      kingdom: classificationByRank.get("KINGDOM") || usage.kingdom,
      phylum: classificationByRank.get("PHYLUM") || usage.phylum,
      class: classificationByRank.get("CLASS") || usage.class,
      order: classificationByRank.get("ORDER") || usage.order,
      family: classificationByRank.get("FAMILY") || usage.family,
      genus: classificationByRank.get("GENUS") || usage.genus,
      species: classificationByRank.get("SPECIES") || usage.species,
      source: "gbif" as const,
      conservationStatus,
    });
  }
}

// GBIF API types
interface GbifSpeciesDetail {
  key?: number;
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
  // Individual taxon keys for building ancestor hierarchy
  kingdomKey?: number;
  phylumKey?: number;
  classKey?: number;
  orderKey?: number;
  familyKey?: number;
  genusKey?: number;
  speciesKey?: number;
  numDescendants?: number;
  extinct?: boolean;
}

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

interface GbifV2AdditionalStatus {
  status?: string;
  statusCode?: string;
  datasetAlias?: string;
}

interface GbifV2MatchResult {
  synonym: boolean;
  usage?: GbifV2NameUsage;
  classification?: GbifV2NameUsage[];
  additionalStatus?: GbifV2AdditionalStatus[];
  diagnostics?: {
    matchType?: "EXACT" | "FUZZY" | "HIGHERRANK" | "NONE";
    confidence?: number;
  };
}

// GBIF additional data types
interface GbifDescription {
  description?: string;
  type?: string;
  language?: string;
  source?: string;
  sourceTaxonKey?: number;
}

interface GbifReference {
  citation?: string;
  type?: string;
  source?: string;
  doi?: string;
  link?: string;
}

interface GbifMedia {
  type?: string;
  format?: string;
  identifier?: string;
  title?: string;
  description?: string;
  source?: string;
  creator?: string;
  license?: string;
  rightsHolder?: string;
}

export type { TaxonResult, TaxonDetail, TaxonAncestor, TaxonDescription, TaxonReference, TaxonMedia, ValidationResult, ConservationStatus, IUCNCategory };
