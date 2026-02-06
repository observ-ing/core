import { describe, it, expect, vi, beforeEach } from "vitest";
import { CommunityIdCalculator, TaxonomicHierarchy } from "./community-id.js";
import type { IdentificationRow } from "../database/index.js";

describe("CommunityIdCalculator", () => {
  let calculator: CommunityIdCalculator;
  let mockDb: {
    getIdentificationsForOccurrence: ReturnType<typeof vi.fn>;
    getIdentificationsForSubject: ReturnType<typeof vi.fn>;
    getSubjectsForOccurrence: ReturnType<typeof vi.fn>;
  };

  const createMockIdentification = (overrides = {}): IdentificationRow => ({
    uri: "at://did:plc:test/org.rwell.test.identification/1",
    cid: "cid123",
    did: "did:plc:identifier",
    subject_uri: "at://did:plc:test/org.rwell.test.occurrence/1",
    subject_cid: "subcid",
    subject_index: 0,
    scientific_name: "Quercus alba",
    taxon_rank: "species",
    identification_qualifier: null,
    taxon_id: null,
    identification_remarks: null,
    identification_verification_status: null,
    type_status: null,
    is_agreement: false,
    date_identified: new Date(),
    vernacular_name: null,
    kingdom: null,
    phylum: null,
    class: null,
    order: null,
    family: null,
    genus: null,
    confidence: null,
    ...overrides,
  });

  beforeEach(() => {
    mockDb = {
      getIdentificationsForOccurrence: vi.fn(),
      getIdentificationsForSubject: vi.fn(),
      getSubjectsForOccurrence: vi.fn(),
    };
    calculator = new CommunityIdCalculator(mockDb as any);
  });

  describe("calculate", () => {
    it("returns null when no identifications exist", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([]);

      const result = await calculator.calculate("at://test/occurrence/1");

      expect(result).toBeNull();
    });

    it("returns single identification as winner", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba" }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1");

      expect(result).not.toBeNull();
      expect(result?.scientificName).toBe("Quercus alba");
      expect(result?.identificationCount).toBe(1);
      expect(result?.agreementCount).toBe(1);
      expect(result?.confidence).toBe(1);
      expect(result?.isResearchGrade).toBe(false); // Need 2+ IDs
    });

    it("reaches research grade with 2/3 majority and 2+ IDs", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba", did: "did:plc:user1" }),
        createMockIdentification({ scientific_name: "Quercus alba", did: "did:plc:user2" }),
        createMockIdentification({ scientific_name: "Quercus rubra", did: "did:plc:user3" }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1");

      expect(result?.scientificName).toBe("Quercus alba");
      expect(result?.agreementCount).toBe(2);
      expect(result?.confidence).toBeCloseTo(0.667, 2);
      expect(result?.isResearchGrade).toBe(true);
    });

    it("does not reach research grade without 2/3 majority", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba", did: "did:plc:user1" }),
        createMockIdentification({ scientific_name: "Quercus rubra", did: "did:plc:user2" }),
        createMockIdentification({ scientific_name: "Quercus velutina", did: "did:plc:user3" }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1");

      expect(result?.isResearchGrade).toBe(false);
      expect(result?.confidence).toBeCloseTo(0.333, 2);
    });

    it("groups identifications case-insensitively", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba", did: "did:plc:user1" }),
        createMockIdentification({ scientific_name: "QUERCUS ALBA", did: "did:plc:user2" }),
        createMockIdentification({ scientific_name: "quercus alba", did: "did:plc:user3" }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1");

      expect(result?.agreementCount).toBe(3);
      expect(result?.isResearchGrade).toBe(true);
    });

    it("uses subjectIndex when provided", async () => {
      mockDb.getIdentificationsForSubject.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba", subject_index: 1 }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1", 1);

      expect(mockDb.getIdentificationsForSubject).toHaveBeenCalledWith(
        "at://test/occurrence/1",
        1
      );
      expect(result?.scientificName).toBe("Quercus alba");
    });

    it("separates cross-kingdom homonyms into distinct groups", async () => {
      // "Ficus" exists as both a plant genus and a gastropod genus
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Ficus", kingdom: "Plantae", did: "did:plc:user1" }),
        createMockIdentification({ scientific_name: "Ficus", kingdom: "Plantae", did: "did:plc:user2" }),
        createMockIdentification({ scientific_name: "Ficus", kingdom: "Animalia", did: "did:plc:user3" }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1");

      // Plantae Ficus should win with 2 votes vs Animalia Ficus with 1
      expect(result?.scientificName).toBe("Ficus");
      expect(result?.kingdom).toBe("Plantae");
      expect(result?.agreementCount).toBe(2);
      expect(result?.identificationCount).toBe(3);
    });

    it("does not conflate same name across kingdoms for research grade", async () => {
      // Same name, different kingdoms — should not count as 3 agreeing IDs
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Ficus", kingdom: "Plantae", did: "did:plc:user1" }),
        createMockIdentification({ scientific_name: "Ficus", kingdom: "Animalia", did: "did:plc:user2" }),
        createMockIdentification({ scientific_name: "Ficus", kingdom: "Fungi", did: "did:plc:user3" }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1");

      // Each kingdom group has only 1 vote, so no 2/3 majority
      expect(result?.agreementCount).toBe(1);
      expect(result?.isResearchGrade).toBe(false);
    });

    it("groups same name with same kingdom together", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba", kingdom: "Plantae", did: "did:plc:user1" }),
        createMockIdentification({ scientific_name: "Quercus alba", kingdom: "Plantae", did: "did:plc:user2" }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1");

      expect(result?.scientificName).toBe("Quercus alba");
      expect(result?.kingdom).toBe("Plantae");
      expect(result?.agreementCount).toBe(2);
      expect(result?.isResearchGrade).toBe(true);
    });

    it("treats null kingdom identifications as a single group", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba", kingdom: null, did: "did:plc:user1" }),
        createMockIdentification({ scientific_name: "Quercus alba", kingdom: null, did: "did:plc:user2" }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1");

      expect(result?.agreementCount).toBe(2);
      expect(result?.isResearchGrade).toBe(true);
    });

    it("preserves taxon rank from identification", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus", taxon_rank: "genus" }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1");

      expect(result?.taxonRank).toBe("genus");
    });

    it("counts agreement identifications", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba", is_agreement: false, did: "did:plc:user1" }),
        createMockIdentification({ scientific_name: "Quercus alba", is_agreement: true, did: "did:plc:user2" }),
        createMockIdentification({ scientific_name: "Quercus alba", is_agreement: true, did: "did:plc:user3" }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1");

      expect(result?.agreementCount).toBe(3); // All count toward total
    });

    it("only counts each user's latest identification", async () => {
      // User1 first says Quercus alba, then changes to Quercus rubra
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({
          scientific_name: "Quercus alba",
          did: "did:plc:user1",
          date_identified: new Date("2026-01-01"),
        }),
        createMockIdentification({
          scientific_name: "Quercus rubra",
          did: "did:plc:user1",
          date_identified: new Date("2026-01-02"),
        }),
        createMockIdentification({
          scientific_name: "Quercus rubra",
          did: "did:plc:user2",
          date_identified: new Date("2026-01-01"),
        }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1");

      // User1's latest is Quercus rubra, user2 is Quercus rubra → 2 votes rubra
      expect(result?.scientificName).toBe("Quercus rubra");
      expect(result?.agreementCount).toBe(2);
      expect(result?.identificationCount).toBe(2);
      expect(result?.isResearchGrade).toBe(true);
    });

    it("user's earlier identification does not count when superseded", async () => {
      // User1 changes their mind from alba to rubra, user2 says alba
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({
          scientific_name: "Quercus alba",
          did: "did:plc:user1",
          date_identified: new Date("2026-01-01"),
        }),
        createMockIdentification({
          scientific_name: "Quercus rubra",
          did: "did:plc:user1",
          date_identified: new Date("2026-01-02"),
        }),
        createMockIdentification({
          scientific_name: "Quercus alba",
          did: "did:plc:user2",
          date_identified: new Date("2026-01-01"),
        }),
      ]);

      const result = await calculator.calculate("at://test/occurrence/1");

      // User1's latest is rubra, user2 is alba → 1 each, tie
      expect(result?.identificationCount).toBe(2);
      expect(result?.agreementCount).toBe(1);
      expect(result?.isResearchGrade).toBe(false);
    });
  });

  describe("calculateAllSubjects", () => {
    it("calculates community ID for all subjects", async () => {
      mockDb.getSubjectsForOccurrence.mockResolvedValue([
        { subjectIndex: 0, identificationCount: 2 },
        { subjectIndex: 1, identificationCount: 1 },
      ]);
      mockDb.getIdentificationsForSubject
        .mockResolvedValueOnce([
          createMockIdentification({ scientific_name: "Quercus alba", subject_index: 0, did: "did:plc:user1" }),
          createMockIdentification({ scientific_name: "Quercus alba", subject_index: 0, did: "did:plc:user2" }),
        ])
        .mockResolvedValueOnce([
          createMockIdentification({ scientific_name: "Acer rubrum", subject_index: 1 }),
        ]);

      const results = await calculator.calculateAllSubjects("at://test/occurrence/1");

      expect(results.size).toBe(2);
      expect(results.get(0)?.scientificName).toBe("Quercus alba");
      expect(results.get(1)?.scientificName).toBe("Acer rubrum");
    });

    it("always includes subject 0", async () => {
      mockDb.getSubjectsForOccurrence.mockResolvedValue([
        { subjectIndex: 1, identificationCount: 1 },
      ]);
      mockDb.getIdentificationsForSubject.mockResolvedValue([]);

      const results = await calculator.calculateAllSubjects("at://test/occurrence/1");

      expect(results.has(0)).toBe(true);
      expect(results.get(0)).toBeNull();
    });
  });

  describe("isResearchGrade", () => {
    it("returns true when research grade criteria met", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba", did: "did:plc:user1" }),
        createMockIdentification({ scientific_name: "Quercus alba", did: "did:plc:user2" }),
      ]);

      const result = await calculator.isResearchGrade("at://test/occurrence/1");

      expect(result).toBe(true);
    });

    it("returns false when not research grade", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba" }),
      ]);

      const result = await calculator.isResearchGrade("at://test/occurrence/1");

      expect(result).toBe(false);
    });

    it("returns false when no identifications", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([]);

      const result = await calculator.isResearchGrade("at://test/occurrence/1");

      expect(result).toBe(false);
    });
  });

  describe("getQualityGrade", () => {
    it("returns 'research' for research grade occurrences", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba", did: "did:plc:user1" }),
        createMockIdentification({ scientific_name: "Quercus alba", did: "did:plc:user2" }),
      ]);

      const result = await calculator.getQualityGrade("at://test/occurrence/1");

      expect(result).toBe("research");
    });

    it("returns 'needs_id' when identifications exist but not research grade", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba" }),
      ]);

      const result = await calculator.getQualityGrade("at://test/occurrence/1");

      expect(result).toBe("needs_id");
    });

    it("returns 'casual' when no identifications", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([]);

      const result = await calculator.getQualityGrade("at://test/occurrence/1");

      expect(result).toBe("casual");
    });
  });

  describe("calculateBatch", () => {
    it("calculates community ID for multiple occurrences", async () => {
      mockDb.getIdentificationsForOccurrence
        .mockResolvedValueOnce([createMockIdentification({ scientific_name: "Quercus alba" })])
        .mockResolvedValueOnce([createMockIdentification({ scientific_name: "Acer rubrum" })])
        .mockResolvedValueOnce([]);

      const results = await calculator.calculateBatch([
        "at://test/occurrence/1",
        "at://test/occurrence/2",
        "at://test/occurrence/3",
      ]);

      expect(results.size).toBe(3);
      expect(results.get("at://test/occurrence/1")?.scientificName).toBe("Quercus alba");
      expect(results.get("at://test/occurrence/2")?.scientificName).toBe("Acer rubrum");
      expect(results.get("at://test/occurrence/3")).toBeNull();
    });
  });

  describe("calculateWeighted", () => {
    it("delegates to calculate (future enhancement)", async () => {
      mockDb.getIdentificationsForOccurrence.mockResolvedValue([
        createMockIdentification({ scientific_name: "Quercus alba" }),
      ]);

      const result = await calculator.calculateWeighted("at://test/occurrence/1");

      expect(result?.scientificName).toBe("Quercus alba");
    });
  });
});

describe("TaxonomicHierarchy", () => {
  describe("getRankLevel", () => {
    it("returns correct level for known ranks", () => {
      expect(TaxonomicHierarchy.getRankLevel("species")).toBe(2);
      expect(TaxonomicHierarchy.getRankLevel("genus")).toBe(3);
      expect(TaxonomicHierarchy.getRankLevel("family")).toBe(4);
      expect(TaxonomicHierarchy.getRankLevel("kingdom")).toBe(8);
    });

    it("is case insensitive", () => {
      expect(TaxonomicHierarchy.getRankLevel("SPECIES")).toBe(2);
      expect(TaxonomicHierarchy.getRankLevel("Species")).toBe(2);
    });

    it("returns 0 for unknown ranks", () => {
      expect(TaxonomicHierarchy.getRankLevel("unknown")).toBe(0);
      expect(TaxonomicHierarchy.getRankLevel("invalid")).toBe(0);
    });
  });

  describe("isMoreSpecific", () => {
    it("returns true when first rank is more specific", () => {
      expect(TaxonomicHierarchy.isMoreSpecific("species", "genus")).toBe(true);
      expect(TaxonomicHierarchy.isMoreSpecific("genus", "family")).toBe(true);
      expect(TaxonomicHierarchy.isMoreSpecific("subspecies", "species")).toBe(true);
    });

    it("returns false when first rank is less specific", () => {
      expect(TaxonomicHierarchy.isMoreSpecific("genus", "species")).toBe(false);
      expect(TaxonomicHierarchy.isMoreSpecific("family", "genus")).toBe(false);
      expect(TaxonomicHierarchy.isMoreSpecific("kingdom", "phylum")).toBe(false);
    });

    it("returns false for same rank", () => {
      expect(TaxonomicHierarchy.isMoreSpecific("species", "species")).toBe(false);
    });
  });

  describe("couldBeAncestor", () => {
    it("detects genus as potential ancestor of species", () => {
      expect(TaxonomicHierarchy.couldBeAncestor("Quercus", "Quercus alba")).toBe(true);
      expect(TaxonomicHierarchy.couldBeAncestor("Acer", "Acer rubrum")).toBe(true);
    });

    it("is case insensitive", () => {
      expect(TaxonomicHierarchy.couldBeAncestor("quercus", "Quercus alba")).toBe(true);
      expect(TaxonomicHierarchy.couldBeAncestor("QUERCUS", "quercus alba")).toBe(true);
    });

    it("returns false for non-matching genus", () => {
      expect(TaxonomicHierarchy.couldBeAncestor("Acer", "Quercus alba")).toBe(false);
    });

    it("returns false when both are species", () => {
      expect(TaxonomicHierarchy.couldBeAncestor("Quercus alba", "Quercus rubra")).toBe(false);
    });

    it("returns false when ancestor has multiple words", () => {
      expect(TaxonomicHierarchy.couldBeAncestor("Quercus alba", "Quercus alba var. latiloba")).toBe(false);
    });
  });
});
