/**
 * Community ID Calculation
 *
 * Implements logic to determine the consensus taxon for an occurrence
 * based on multiple org.rwell.test.identification records.
 *
 * The algorithm follows iNaturalist's approach:
 * - 2/3 majority required for species-level ID
 * - Ancestor taxa can win if descendants don't reach threshold
 * - More recent IDs and expert identifiers could be weighted (future)
 */

import { Database, type IdentificationRow } from "../database/index.js";

interface CommunityIdResult {
  scientificName: string;
  kingdom?: string | undefined;
  taxonRank?: string | undefined;
  identificationCount: number;
  agreementCount: number;
  confidence: number;
  isResearchGrade: boolean;
}

interface TaxonCount {
  scientificName: string;
  kingdom?: string | undefined;
  taxonRank?: string | undefined;
  count: number;
  agreementCount: number;
}

export class CommunityIdCalculator {
  private db: Database;
  private readonly RESEARCH_GRADE_THRESHOLD = 2 / 3;
  private readonly MIN_IDS_FOR_RESEARCH_GRADE = 2;

  constructor(db: Database) {
    this.db = db;
  }

  /**
   * Calculate the community ID for an occurrence (or a specific subject within it)
   * @param occurrenceUri - The occurrence URI
   * @param subjectIndex - Optional subject index (default 0 for single-subject occurrences)
   */
  async calculate(
    occurrenceUri: string,
    subjectIndex?: number,
  ): Promise<CommunityIdResult | null> {
    // If subjectIndex is specified, get identifications for that subject only
    const identifications =
      subjectIndex !== undefined
        ? await this.db.getIdentificationsForSubject(occurrenceUri, subjectIndex)
        : await this.db.getIdentificationsForOccurrence(occurrenceUri);

    if (identifications.length === 0) {
      return null;
    }

    // Keep only each user's most recent identification
    const deduplicated = this.deduplicateByUser(identifications);

    // Group identifications by taxon
    const taxonCounts = this.groupByTaxon(deduplicated);

    // Find the winning taxon
    const winner = this.findWinner(taxonCounts, deduplicated.length);

    if (!winner) {
      return null;
    }

    const confidence = winner.count / deduplicated.length;
    const isResearchGrade =
      deduplicated.length >= this.MIN_IDS_FOR_RESEARCH_GRADE &&
      confidence >= this.RESEARCH_GRADE_THRESHOLD;

    return {
      scientificName: winner.scientificName,
      kingdom: winner.kingdom,
      taxonRank: winner.taxonRank,
      identificationCount: deduplicated.length,
      agreementCount: winner.count,
      confidence,
      isResearchGrade,
    };
  }

  /**
   * Calculate community ID for all subjects in an occurrence
   */
  async calculateAllSubjects(
    occurrenceUri: string,
  ): Promise<Map<number, CommunityIdResult | null>> {
    const subjects = await this.db.getSubjectsForOccurrence(occurrenceUri);
    const results = new Map<number, CommunityIdResult | null>();

    for (const subject of subjects) {
      const result = await this.calculate(occurrenceUri, subject.subjectIndex);
      results.set(subject.subjectIndex, result);
    }

    // Ensure subject 0 is always included
    if (!results.has(0)) {
      results.set(0, null);
    }

    return results;
  }

  /**
   * Keep only each user's most recent identification.
   * A user's new identification supersedes their previous one.
   */
  private deduplicateByUser(identifications: IdentificationRow[]): IdentificationRow[] {
    const latestByUser = new Map<string, IdentificationRow>();

    for (const id of identifications) {
      const existing = latestByUser.get(id.did);
      if (!existing || id.date_identified > existing.date_identified) {
        latestByUser.set(id.did, id);
      }
    }

    return Array.from(latestByUser.values());
  }

  /**
   * Group identifications by scientific name and kingdom to avoid
   * conflating cross-kingdom homonyms (hemihomonyms).
   */
  private groupByTaxon(identifications: IdentificationRow[]): TaxonCount[] {
    const counts = new Map<string, TaxonCount>();

    for (const id of identifications) {
      const kingdom = (id.kingdom || "").toLowerCase();
      const key = `${id.scientific_name.toLowerCase()}|${kingdom}`;
      const existing = counts.get(key);

      if (existing) {
        existing.count++;
        if (id.is_agreement) {
          existing.agreementCount++;
        }
      } else {
        counts.set(key, {
          scientificName: id.scientific_name,
          kingdom: id.kingdom || undefined,
          taxonRank: id.taxon_rank || undefined,
          count: 1,
          agreementCount: id.is_agreement ? 1 : 0,
        });
      }
    }

    return Array.from(counts.values());
  }

  /**
   * Find the winning taxon based on consensus rules
   */
  private findWinner(
    taxonCounts: TaxonCount[],
    totalIds: number,
  ): TaxonCount | null {
    if (taxonCounts.length === 0) {
      return null;
    }

    // Sort by count descending
    const sorted = [...taxonCounts].sort((a, b) => b.count - a.count);

    // Check if the leading taxon meets the threshold
    const leader = sorted[0];
    if (!leader) {
      return null;
    }
    const threshold = Math.ceil(totalIds * this.RESEARCH_GRADE_THRESHOLD);

    if (leader.count >= threshold) {
      return leader;
    }

    // If no taxon meets the threshold, return the one with most votes
    // This is a "needs ID" state
    return leader;
  }

  /**
   * Calculate community ID for multiple occurrences (batch)
   */
  async calculateBatch(
    occurrenceUris: string[],
  ): Promise<Map<string, CommunityIdResult | null>> {
    const results = new Map<string, CommunityIdResult | null>();

    // For efficiency, we could do this with a single SQL query
    // For now, calculate individually
    for (const uri of occurrenceUris) {
      const result = await this.calculate(uri);
      results.set(uri, result);
    }

    return results;
  }

  /**
   * Determine if an occurrence (or subject) qualifies for "Research Grade" status
   *
   * Criteria:
   * - Has at least 2 identifications
   * - 2/3 or more agree on the same species-level taxon
   * - Has date and location data (checked elsewhere)
   * - Has at least one photo (checked elsewhere)
   */
  async isResearchGrade(
    occurrenceUri: string,
    subjectIndex?: number,
  ): Promise<boolean> {
    const result = await this.calculate(occurrenceUri, subjectIndex);
    return result?.isResearchGrade || false;
  }

  /**
   * Get quality grade for an occurrence (or subject)
   */
  async getQualityGrade(
    occurrenceUri: string,
    subjectIndex?: number,
  ): Promise<"research" | "needs_id" | "casual"> {
    const result = await this.calculate(occurrenceUri, subjectIndex);

    if (!result) {
      return "casual"; // No identifications
    }

    if (result.isResearchGrade) {
      return "research";
    }

    return "needs_id";
  }

  /**
   * Calculate weighted community ID (future enhancement)
   *
   * Could consider:
   * - User expertise/reputation
   * - Recency of identification
   * - Whether user has verified email
   * - Species-specific expertise
   */
  async calculateWeighted(
    occurrenceUri: string,
    subjectIndex?: number,
  ): Promise<CommunityIdResult | null> {
    // Future implementation with weighted voting
    // For now, delegate to simple calculation
    return this.calculate(occurrenceUri, subjectIndex);
  }
}

/**
 * Taxonomic hierarchy utilities for ancestor-based consensus
 */
export class TaxonomicHierarchy {
  // Rank ordering from most specific to least specific
  private static readonly RANK_ORDER = [
    "subspecies",
    "variety",
    "species",
    "genus",
    "family",
    "order",
    "class",
    "phylum",
    "kingdom",
  ];

  /**
   * Get the rank level (lower = more specific)
   */
  static getRankLevel(rank: string): number {
    const index = this.RANK_ORDER.indexOf(rank.toLowerCase());
    return index === -1 ? 0 : index;
  }

  /**
   * Check if rank1 is more specific than rank2
   */
  static isMoreSpecific(rank1: string, rank2: string): boolean {
    return this.getRankLevel(rank1) < this.getRankLevel(rank2);
  }

  /**
   * Check if a taxon name could be an ancestor of another
   * This is a simple heuristic - real implementation would use taxonomy DB
   */
  static couldBeAncestor(possibleAncestor: string, taxonName: string): boolean {
    // Simple genus check for species names
    const ancestorParts = possibleAncestor.split(" ");
    const taxonParts = taxonName.split(" ");

    if (ancestorParts.length === 1 && taxonParts.length >= 2) {
      // possibleAncestor might be a genus
      const ancestorFirst = ancestorParts[0];
      const taxonFirst = taxonParts[0];
      if (ancestorFirst && taxonFirst) {
        return taxonFirst.toLowerCase() === ancestorFirst.toLowerCase();
      }
    }

    return false;
  }
}

export type { CommunityIdResult, TaxonCount };
