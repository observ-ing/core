import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CommunityIdCalculator, TaxonomicHierarchy, type Database, type IdentificationRow } from 'observing-shared'

// ============================================================================
// TaxonomicHierarchy Tests
// ============================================================================

describe('TaxonomicHierarchy', () => {
  describe('getRankLevel', () => {
    it('returns correct index for subspecies (most specific)', () => {
      expect(TaxonomicHierarchy.getRankLevel('subspecies')).toBe(0)
    })

    it('returns correct index for species', () => {
      expect(TaxonomicHierarchy.getRankLevel('species')).toBe(2)
    })

    it('returns correct index for genus', () => {
      expect(TaxonomicHierarchy.getRankLevel('genus')).toBe(3)
    })

    it('returns correct index for family', () => {
      expect(TaxonomicHierarchy.getRankLevel('family')).toBe(4)
    })

    it('returns correct index for kingdom (least specific)', () => {
      expect(TaxonomicHierarchy.getRankLevel('kingdom')).toBe(8)
    })

    it('returns 0 for unknown ranks', () => {
      expect(TaxonomicHierarchy.getRankLevel('unknown')).toBe(0)
      expect(TaxonomicHierarchy.getRankLevel('superorder')).toBe(0)
    })

    it('is case-insensitive', () => {
      expect(TaxonomicHierarchy.getRankLevel('SPECIES')).toBe(2)
      expect(TaxonomicHierarchy.getRankLevel('Species')).toBe(2)
      expect(TaxonomicHierarchy.getRankLevel('GENUS')).toBe(3)
    })
  })

  describe('isMoreSpecific', () => {
    it('returns true when species compared to genus', () => {
      expect(TaxonomicHierarchy.isMoreSpecific('species', 'genus')).toBe(true)
    })

    it('returns true when subspecies compared to species', () => {
      expect(TaxonomicHierarchy.isMoreSpecific('subspecies', 'species')).toBe(true)
    })

    it('returns true when genus compared to family', () => {
      expect(TaxonomicHierarchy.isMoreSpecific('genus', 'family')).toBe(true)
    })

    it('returns false when genus compared to species', () => {
      expect(TaxonomicHierarchy.isMoreSpecific('genus', 'species')).toBe(false)
    })

    it('returns false when comparing same rank', () => {
      expect(TaxonomicHierarchy.isMoreSpecific('species', 'species')).toBe(false)
    })

    it('returns false when kingdom compared to any other rank', () => {
      expect(TaxonomicHierarchy.isMoreSpecific('kingdom', 'phylum')).toBe(false)
      expect(TaxonomicHierarchy.isMoreSpecific('kingdom', 'species')).toBe(false)
    })
  })

  describe('couldBeAncestor', () => {
    it('returns true when genus could be ancestor of species', () => {
      expect(TaxonomicHierarchy.couldBeAncestor('Homo', 'Homo sapiens')).toBe(true)
    })

    it('returns true when genus matches species binomial (case-insensitive)', () => {
      expect(TaxonomicHierarchy.couldBeAncestor('homo', 'Homo sapiens')).toBe(true)
      expect(TaxonomicHierarchy.couldBeAncestor('HOMO', 'Homo sapiens')).toBe(true)
    })

    it('returns false when genus does not match', () => {
      expect(TaxonomicHierarchy.couldBeAncestor('Pan', 'Homo sapiens')).toBe(false)
    })

    it('returns false when comparing two species', () => {
      expect(TaxonomicHierarchy.couldBeAncestor('Homo erectus', 'Homo sapiens')).toBe(false)
    })

    it('returns false when species compared to genus', () => {
      expect(TaxonomicHierarchy.couldBeAncestor('Homo sapiens', 'Homo')).toBe(false)
    })

    it('handles subspecies correctly', () => {
      expect(TaxonomicHierarchy.couldBeAncestor('Canis', 'Canis lupus familiaris')).toBe(true)
    })
  })
})

// ============================================================================
// CommunityIdCalculator Tests
// ============================================================================

describe('CommunityIdCalculator', () => {
  let mockDb: Partial<Database>
  let calculator: CommunityIdCalculator

  beforeEach(() => {
    mockDb = {
      getIdentificationsForOccurrence: vi.fn()
    }
    calculator = new CommunityIdCalculator(mockDb as Database)
  })

  // Helper to create mock identification rows
  function createIdentification(
    scientificName: string,
    options: { taxonRank?: string; isAgreement?: boolean; subjectIndex?: number; did?: string } = {}
  ): IdentificationRow {
    return {
      uri: `at://did:plc:test/org.rwell.test.identification/${Math.random()}`,
      cid: 'test-cid',
      did: options.did || 'did:plc:test',
      subject_uri: 'at://did:plc:test/org.rwell.test.occurrence/1',
      subject_cid: 'subject-cid',
      subject_index: options.subjectIndex ?? 0,
      scientific_name: scientificName,
      taxon_rank: options.taxonRank || 'species',
      identification_qualifier: null,
      taxon_id: null,
      identification_remarks: null,
      identification_verification_status: null,
      type_status: null,
      is_agreement: options.isAgreement ?? false,
      date_identified: new Date(),
      vernacular_name: null,
      kingdom: null,
      phylum: null,
      class: null,
      order: null,
      family: null,
      genus: null,
      confidence: null,
    }
  }

  describe('groupByTaxon (via calculate)', () => {
    it('groups identifications by scientific name case-insensitively', async () => {
      const identifications = [
        createIdentification('Homo sapiens', { did: 'did:plc:user1' }),
        createIdentification('homo sapiens', { did: 'did:plc:user2' }),
        createIdentification('HOMO SAPIENS', { did: 'did:plc:user3' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.calculate('test-uri')

      expect(result).not.toBeNull()
      expect(result!.scientificName).toBe('Homo sapiens')
      expect(result!.agreementCount).toBe(3)
    })

    it('counts agreements correctly', async () => {
      const identifications = [
        createIdentification('Quercus alba', { isAgreement: false, did: 'did:plc:user1' }),
        createIdentification('Quercus alba', { isAgreement: true, did: 'did:plc:user2' }),
        createIdentification('Quercus alba', { isAgreement: true, did: 'did:plc:user3' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.calculate('test-uri')

      expect(result).not.toBeNull()
      expect(result!.agreementCount).toBe(3)
      expect(result!.identificationCount).toBe(3)
    })

    it('handles empty array', async () => {
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue([])

      const result = await calculator.calculate('test-uri')

      expect(result).toBeNull()
    })

    it('handles single identification', async () => {
      const identifications = [createIdentification('Acer rubrum')]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.calculate('test-uri')

      expect(result).not.toBeNull()
      expect(result!.scientificName).toBe('Acer rubrum')
      expect(result!.identificationCount).toBe(1)
      expect(result!.confidence).toBe(1)
      expect(result!.isResearchGrade).toBe(false) // needs 2+ IDs
    })

    it('tracks multiple taxa separately', async () => {
      const identifications = [
        createIdentification('Quercus alba', { did: 'did:plc:user1' }),
        createIdentification('Quercus alba', { did: 'did:plc:user2' }),
        createIdentification('Quercus rubra', { did: 'did:plc:user3' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.calculate('test-uri')

      expect(result).not.toBeNull()
      expect(result!.scientificName).toBe('Quercus alba')
      expect(result!.agreementCount).toBe(2)
      expect(result!.identificationCount).toBe(3)
    })
  })

  describe('findWinner (via calculate)', () => {
    it('returns leader when 2/3 threshold met', async () => {
      const identifications = [
        createIdentification('Pinus strobus', { did: 'did:plc:user1' }),
        createIdentification('Pinus strobus', { did: 'did:plc:user2' }),
        createIdentification('Pinus rigida', { did: 'did:plc:user3' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.calculate('test-uri')

      expect(result).not.toBeNull()
      expect(result!.scientificName).toBe('Pinus strobus')
      expect(result!.isResearchGrade).toBe(true) // 2/3 = 66.7%, threshold met
    })

    it('returns leader even when threshold not met (needs_id state)', async () => {
      const identifications = [
        createIdentification('Betula papyrifera', { did: 'did:plc:user1' }),
        createIdentification('Betula alleghaniensis', { did: 'did:plc:user2' }),
        createIdentification('Betula lenta', { did: 'did:plc:user3' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.calculate('test-uri')

      expect(result).not.toBeNull()
      expect(result!.scientificName).toBe('Betula papyrifera') // first one wins tie
      expect(result!.isResearchGrade).toBe(false)
    })

    it('handles tie by returning first (stable sort)', async () => {
      const identifications = [
        createIdentification('Species A', { did: 'did:plc:user1' }),
        createIdentification('Species B', { did: 'did:plc:user2' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.calculate('test-uri')

      expect(result).not.toBeNull()
      // Both have count 1, first in sort order wins
      expect(result!.agreementCount).toBe(1)
    })
  })

  describe('calculate', () => {
    it('returns null for no identifications', async () => {
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue([])

      const result = await calculator.calculate('test-uri')

      expect(result).toBeNull()
    })

    it('calculates confidence correctly', async () => {
      const identifications = [
        createIdentification('Fagus grandifolia', { did: 'did:plc:user1' }),
        createIdentification('Fagus grandifolia', { did: 'did:plc:user2' }),
        createIdentification('Fagus sylvatica', { did: 'did:plc:user3' }),
        createIdentification('Fagus sylvatica', { did: 'did:plc:user4' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.calculate('test-uri')

      expect(result).not.toBeNull()
      expect(result!.confidence).toBe(0.5) // 2/4 = 50%
    })

    it('sets isResearchGrade true when threshold met with 2+ IDs', async () => {
      const identifications = [
        createIdentification('Tsuga canadensis', { did: 'did:plc:user1' }),
        createIdentification('Tsuga canadensis', { did: 'did:plc:user2' }),
        createIdentification('Tsuga canadensis', { did: 'did:plc:user3' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.calculate('test-uri')

      expect(result).not.toBeNull()
      expect(result!.isResearchGrade).toBe(true)
      expect(result!.confidence).toBe(1)
    })

    it('sets isResearchGrade false when only 1 ID even with 100% confidence', async () => {
      const identifications = [createIdentification('Picea rubens')]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.calculate('test-uri')

      expect(result).not.toBeNull()
      expect(result!.confidence).toBe(1)
      expect(result!.isResearchGrade).toBe(false) // needs MIN_IDS_FOR_RESEARCH_GRADE
    })

    it('preserves taxonRank from winning identification', async () => {
      const identifications = [
        createIdentification('Carya ovata', { taxonRank: 'species', did: 'did:plc:user1' }),
        createIdentification('Carya ovata', { taxonRank: 'species', did: 'did:plc:user2' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.calculate('test-uri')

      expect(result).not.toBeNull()
      expect(result!.taxonRank).toBe('species')
    })
  })

  describe('isResearchGrade', () => {
    it('returns true when criteria met', async () => {
      const identifications = [
        createIdentification('Liriodendron tulipifera', { did: 'did:plc:user1' }),
        createIdentification('Liriodendron tulipifera', { did: 'did:plc:user2' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.isResearchGrade('test-uri')

      expect(result).toBe(true)
    })

    it('returns false when no identifications', async () => {
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue([])

      const result = await calculator.isResearchGrade('test-uri')

      expect(result).toBe(false)
    })
  })

  describe('getQualityGrade', () => {
    it('returns "research" when research grade', async () => {
      const identifications = [
        createIdentification('Platanus occidentalis', { did: 'did:plc:user1' }),
        createIdentification('Platanus occidentalis', { did: 'did:plc:user2' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.getQualityGrade('test-uri')

      expect(result).toBe('research')
    })

    it('returns "needs_id" when has IDs but not research grade', async () => {
      const identifications = [
        createIdentification('Ulmus americana', { did: 'did:plc:user1' }),
        createIdentification('Ulmus rubra', { did: 'did:plc:user2' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.getQualityGrade('test-uri')

      expect(result).toBe('needs_id')
    })

    it('returns "casual" when no identifications', async () => {
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue([])

      const result = await calculator.getQualityGrade('test-uri')

      expect(result).toBe('casual')
    })
  })

  describe('calculateBatch', () => {
    it('returns results for multiple occurrence URIs', async () => {
      const identifications1 = [
        createIdentification('Quercus alba', { did: 'did:plc:user1' }),
        createIdentification('Quercus alba', { did: 'did:plc:user2' })
      ]
      const identifications2 = [
        createIdentification('Acer rubrum')
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!)
        .mockResolvedValueOnce(identifications1)
        .mockResolvedValueOnce(identifications2)
        .mockResolvedValueOnce([])

      const results = await calculator.calculateBatch(['uri1', 'uri2', 'uri3'])

      expect(results.size).toBe(3)
      expect(results.get('uri1')?.scientificName).toBe('Quercus alba')
      expect(results.get('uri1')?.isResearchGrade).toBe(true)
      expect(results.get('uri2')?.scientificName).toBe('Acer rubrum')
      expect(results.get('uri2')?.isResearchGrade).toBe(false)
      expect(results.get('uri3')).toBeNull()
    })

    it('returns empty map for empty input', async () => {
      const results = await calculator.calculateBatch([])

      expect(results.size).toBe(0)
    })
  })

  describe('calculateWeighted', () => {
    it('delegates to calculate for now', async () => {
      const identifications = [
        createIdentification('Pinus strobus', { did: 'did:plc:user1' }),
        createIdentification('Pinus strobus', { did: 'did:plc:user2' })
      ]
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue(identifications)

      const result = await calculator.calculateWeighted('test-uri')

      expect(result).not.toBeNull()
      expect(result!.scientificName).toBe('Pinus strobus')
      expect(result!.isResearchGrade).toBe(true)
    })
  })

  describe('findWinner edge cases', () => {
    it('returns null when taxonCounts is empty (via internal groupByTaxon)', async () => {
      // This tests the findWinner([], 0) path
      vi.mocked(mockDb.getIdentificationsForOccurrence!).mockResolvedValue([])

      const result = await calculator.calculate('test-uri')

      expect(result).toBeNull()
    })
  })
})
