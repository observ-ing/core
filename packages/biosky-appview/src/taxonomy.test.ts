import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TaxonomyResolver } from './taxonomy.js'

describe('TaxonomyResolver', () => {
  let resolver: TaxonomyResolver
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    resolver = new TaxonomyResolver()
    originalFetch = global.fetch
    vi.useFakeTimers()
  })

  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // Helper to create mock fetch responses
  function mockFetch(gbifData: unknown[]) {
    global.fetch = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(gbifData)
      })
  }

  // ============================================================================
  // gbifToTaxon tests
  // ============================================================================
  describe('gbifToTaxon transformation', () => {
    it('maps all GBIF fields correctly', async () => {
      const gbifResponse = [
        {
          key: 12345,
          usageKey: 12345,
          scientificName: 'Quercus alba L.',
          canonicalName: 'Quercus alba',
          vernacularName: 'White Oak',
          rank: 'SPECIES',
          kingdom: 'Plantae',
          phylum: 'Tracheophyta',
          class: 'Magnoliopsida',
          order: 'Fagales',
          family: 'Fagaceae',
          genus: 'Quercus',
          species: 'Quercus alba'
        }
      ]

      mockFetch(gbifResponse)

      const results = await resolver.search('unique-gbif-1', 10)

      const gbifResult = results.find(r => r.source === 'gbif')
      expect(gbifResult).toBeDefined()
      expect(gbifResult).toMatchObject({
        id: 'gbif:12345',
        scientificName: 'Quercus alba',  // uses canonicalName when available
        commonName: 'White Oak',
        rank: 'species',
        kingdom: 'Plantae',
        phylum: 'Tracheophyta',
        class: 'Magnoliopsida',
        order: 'Fagales',
        family: 'Fagaceae',
        genus: 'Quercus',
        species: 'Quercus alba',
        source: 'gbif'
      })
    })

    it('handles missing optional fields', async () => {
      const gbifResponse = [
        {
          key: 99999,
          canonicalName: 'Unknown species'
          // no vernacularName, rank, or taxonomy fields
        }
      ]

      mockFetch(gbifResponse)

      const results = await resolver.search('unique-gbif-2', 10)

      const gbifResult = results.find(r => r.source === 'gbif')
      expect(gbifResult).toBeDefined()
      expect(gbifResult!.scientificName).toBe('Unknown species')
      expect(gbifResult!.commonName).toBeUndefined()
      expect(gbifResult!.rank).toBe('unknown')
    })

    it('uses usageKey when key is not present', async () => {
      const gbifResponse = [
        {
          usageKey: 54321,
          scientificName: 'Test species usageKey'
        }
      ]

      mockFetch(gbifResponse)

      const results = await resolver.search('unique-gbif-3', 10)

      const gbifResult = results.find(r => r.source === 'gbif')
      expect(gbifResult).toBeDefined()
      expect(gbifResult!.id).toBe('gbif:54321')
    })

    it('lowercases rank from GBIF', async () => {
      const gbifResponse = [
        {
          key: 1,
          scientificName: 'Test Genus',
          rank: 'GENUS'
        }
      ]

      mockFetch(gbifResponse)

      const results = await resolver.search('unique-gbif-4', 10)

      const gbifResult = results.find(r => r.source === 'gbif')
      expect(gbifResult).toBeDefined()
      expect(gbifResult!.rank).toBe('genus')
    })
  })

  // ============================================================================
  // search results tests
  // ============================================================================
  describe('search results', () => {
    it('returns multiple results', async () => {
      const gbifResponse = [
        { key: 1, scientificName: 'GBIF Species 1' },
        { key: 2, scientificName: 'GBIF Species 2' }
      ]

      mockFetch(gbifResponse)

      const results = await resolver.search('unique-search-1', 10)

      expect(results.length).toBe(2)
      expect(results.every(r => r.source === 'gbif')).toBe(true)
    })

    it('respects limit parameter', async () => {
      const gbifResponse = [
        { key: 1, scientificName: 'GBIF Limit 1' },
        { key: 2, scientificName: 'GBIF Limit 2' },
        { key: 3, scientificName: 'GBIF Limit 3' }
      ]

      mockFetch(gbifResponse)

      const results = await resolver.search('unique-search-2', 3)

      expect(results.length).toBe(3)
    })

    it('handles empty results gracefully', async () => {
      mockFetch([])

      const results = await resolver.search('unique-search-3', 10)

      expect(results).toEqual([])
    })
  })

  // ============================================================================
  // validate tests
  // ============================================================================
  describe('validate', () => {
    it('returns valid=true for exact GBIF match', async () => {
      const gbifV2Match = {
        synonym: false,
        usage: {
          key: 12345,
          name: 'Quercus alba validate',
          canonicalName: 'Quercus alba validate',
          rank: 'SPECIES'
        },
        diagnostics: {
          matchType: 'EXACT'
        }
      }

      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(gbifV2Match)
      })

      const result = await resolver.validate('Quercus alba validate')

      expect(result.valid).toBe(true)
      expect(result.matchedName).toBe('Quercus alba validate')
      expect(result.taxon?.source).toBe('gbif')
    })

    it('returns valid=false with suggestions for fuzzy GBIF match', async () => {
      const gbifV2Match = {
        synonym: false,
        usage: {
          key: 12345,
          name: 'Quercus alba suggest',
          canonicalName: 'Quercus alba suggest',
          rank: 'SPECIES'
        },
        diagnostics: {
          matchType: 'FUZZY'
        }
      }

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(gbifV2Match)
        })

      const result = await resolver.validate('Quercus alb suggest') // typo

      expect(result.valid).toBe(false)
      expect(result.suggestions).toBeDefined()
      expect(result.suggestions!.length).toBeGreaterThan(0)
    })

    it('returns NONE match as invalid', async () => {
      const gbifV2Match = {
        synonym: false,
        // no usage means no match
        diagnostics: {
          matchType: 'NONE'
        }
      }

      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve(gbifV2Match)
        })

      const result = await resolver.validate('Nonexistent species xyz')

      expect(result.valid).toBe(false)
      expect(result.suggestions).toEqual([])
    })
  })

  // ============================================================================
  // Error handling tests
  // ============================================================================
  describe('error handling', () => {
    it('returns empty array when GBIF fails', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 500
        })

      const results = await resolver.search('unique-error-1', 10)

      expect(results).toEqual([])
    })

    it('returns empty array when request throws', async () => {
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error('Network error'))

      const results = await resolver.search('unique-error-2', 10)

      expect(results).toEqual([])
    })

    it('handles matchGbif network error gracefully in validate', async () => {
      global.fetch = vi.fn()
        .mockRejectedValueOnce(new Error('GBIF match network error'))

      const result = await resolver.validate('Test species matcherror')

      expect(result.valid).toBe(false)
      expect(result.suggestions).toEqual([])
    })

    it('handles matchGbif non-ok response in validate', async () => {
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 503
        })

      const result = await resolver.validate('Test species notok')

      expect(result.valid).toBe(false)
    })
  })

  // ============================================================================
  // Caching tests
  // ============================================================================
  describe('caching', () => {
    it('returns cached results for same query within TTL', async () => {
      mockFetch([{ key: 1, scientificName: 'Cached Species Test' }])

      // First call
      const results1 = await resolver.search('unique-cache-1', 10)

      // Second call should use cache
      const results2 = await resolver.search('unique-cache-1', 10)

      // Should only have made 1 fetch call total (for first search)
      expect(global.fetch).toHaveBeenCalledTimes(1)
      expect(results1).toEqual(results2)
    })

    it('makes new request after TTL expires', async () => {
      mockFetch([{ key: 1, scientificName: 'TTL Test Species' }])

      // First call
      await resolver.search('unique-cache-2', 10)

      // Advance time past TTL (30 minutes)
      vi.advanceTimersByTime(31 * 60 * 1000)

      // Setup new mock for second call
      global.fetch = vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve([{ key: 2, scientificName: 'New Species' }])
        })

      // Second call after TTL should make new requests
      await resolver.search('unique-cache-2', 10)

      expect(global.fetch).toHaveBeenCalledTimes(1)
    })
  })
})
