/**
 * Taxonomy Client
 *
 * HTTP client for the observing-taxonomy Rust service.
 * Replaces direct GBIF API calls with calls to the local taxonomy service.
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
  gbifUrl?: string | undefined;
}

interface ValidationResult {
  valid: boolean;
  matchedName?: string | undefined;
  taxon?: TaxonResult | undefined;
  suggestions?: TaxonResult[] | undefined;
}

export class TaxonomyClient {
  private baseUrl: string;

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || process.env["TAXONOMY_SERVICE_URL"] || "http://localhost:3003";
  }

  /**
   * Search for taxa matching a query
   */
  async search(query: string, limit = 10): Promise<TaxonResult[]> {
    try {
      const params = new URLSearchParams({ q: query, limit: String(limit) });
      const response = await fetch(`${this.baseUrl}/search?${params}`);
      if (!response.ok) return [];
      return await response.json();
    } catch (error) {
      console.error("Taxonomy search error:", error);
      return [];
    }
  }

  /**
   * Validate a scientific name
   */
  async validate(name: string): Promise<ValidationResult> {
    try {
      const params = new URLSearchParams({ name });
      const response = await fetch(`${this.baseUrl}/validate?${params}`);
      if (!response.ok) {
        return { valid: false, suggestions: [] };
      }
      return await response.json();
    } catch (error) {
      console.error("Taxonomy validate error:", error);
      return { valid: false, suggestions: [] };
    }
  }

  /**
   * Get detailed taxon information by GBIF ID
   */
  async getById(taxonId: string): Promise<TaxonDetail | null> {
    try {
      const response = await fetch(`${this.baseUrl}/taxon/${encodeURIComponent(taxonId)}`);
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error("Taxonomy getById error:", error);
      return null;
    }
  }

  /**
   * Get detailed taxon information by scientific name
   */
  async getByName(scientificName: string, kingdom?: string): Promise<TaxonDetail | null> {
    try {
      const params = new URLSearchParams();
      if (kingdom) {
        params.set("kingdom", kingdom);
      }
      const query = params.toString() ? `?${params}` : "";
      const response = await fetch(
        `${this.baseUrl}/taxon/${encodeURIComponent(scientificName)}${query}`
      );
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error("Taxonomy getByName error:", error);
      return null;
    }
  }

  /**
   * Get children taxa for a parent taxon
   */
  async getChildren(taxonId: string, limit = 20): Promise<TaxonResult[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/taxon/${encodeURIComponent(taxonId)}/children`
      );
      if (!response.ok) return [];
      return await response.json();
    } catch (error) {
      console.error("Taxonomy getChildren error:", error);
      return [];
    }
  }
}

export type { TaxonResult, TaxonDetail, TaxonAncestor, TaxonDescription, TaxonReference, TaxonMedia, ValidationResult, ConservationStatus, IUCNCategory };
