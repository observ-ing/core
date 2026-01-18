import { describe, it, expect } from 'vitest'
import { schemaDict, schemas, lexicons, validate, ids } from '../generated/lexicons.js'

describe('lexicons', () => {
  // ============================================================================
  // schemaDict tests
  // ============================================================================
  describe('schemaDict', () => {
    it('contains OrgRwellTestIdentification schema', () => {
      expect(schemaDict.OrgRwellTestIdentification).toBeDefined()
      expect(schemaDict.OrgRwellTestIdentification.id).toBe('org.rwell.test.identification')
      expect(schemaDict.OrgRwellTestIdentification.lexicon).toBe(1)
    })

    it('contains OrgRwellTestOccurrence schema', () => {
      expect(schemaDict.OrgRwellTestOccurrence).toBeDefined()
      expect(schemaDict.OrgRwellTestOccurrence.id).toBe('org.rwell.test.occurrence')
      expect(schemaDict.OrgRwellTestOccurrence.lexicon).toBe(1)
    })

    it('identification schema has required fields', () => {
      const schema = schemaDict.OrgRwellTestIdentification
      const record = schema.defs.main.record as { required: string[] }

      expect(record.required).toContain('subject')
      expect(record.required).toContain('taxonName')
      expect(record.required).toContain('createdAt')
    })

    it('occurrence schema has required fields', () => {
      const schema = schemaDict.OrgRwellTestOccurrence
      const record = schema.defs.main.record as { required: string[] }

      expect(record.required).toContain('scientificName')
      expect(record.required).toContain('eventDate')
      expect(record.required).toContain('location')
      expect(record.required).toContain('createdAt')
    })

    it('occurrence has location def', () => {
      const schema = schemaDict.OrgRwellTestOccurrence

      expect(schema.defs.location).toBeDefined()
      expect(schema.defs.location.type).toBe('object')
    })

    it('occurrence has imageEmbed def', () => {
      const schema = schemaDict.OrgRwellTestOccurrence

      expect(schema.defs.imageEmbed).toBeDefined()
      expect(schema.defs.imageEmbed.type).toBe('object')
    })

    it('occurrence has aspectRatio def', () => {
      const schema = schemaDict.OrgRwellTestOccurrence

      expect(schema.defs.aspectRatio).toBeDefined()
    })
  })

  // ============================================================================
  // schemas tests
  // ============================================================================
  describe('schemas', () => {
    it('is an array of lexicon documents', () => {
      expect(Array.isArray(schemas)).toBe(true)
      expect(schemas.length).toBe(2)
    })

    it('contains all schemas from schemaDict', () => {
      const ids = schemas.map((s) => s.id)

      expect(ids).toContain('org.rwell.test.identification')
      expect(ids).toContain('org.rwell.test.occurrence')
    })
  })

  // ============================================================================
  // lexicons tests
  // ============================================================================
  describe('lexicons', () => {
    it('is a Lexicons instance', () => {
      expect(lexicons).toBeDefined()
      expect(typeof lexicons.validate).toBe('function')
    })

    it('can validate occurrence', () => {
      const validOccurrence = {
        $type: 'org.rwell.test.occurrence',
        scientificName: 'Quercus alba',
        eventDate: '2024-01-15T10:00:00Z',
        location: {
          decimalLatitude: '40.7128',
          decimalLongitude: '-74.0060'
        },
        createdAt: '2024-01-15T10:00:00Z'
      }

      const result = lexicons.validate('org.rwell.test.occurrence', validOccurrence)

      expect(result.success).toBe(true)
    })

    it('rejects invalid occurrence (missing required field)', () => {
      const invalidOccurrence = {
        $type: 'org.rwell.test.occurrence',
        scientificName: 'Quercus alba',
        // missing eventDate
        location: {
          decimalLatitude: '40.7128',
          decimalLongitude: '-74.0060'
        },
        createdAt: '2024-01-15T10:00:00Z'
      }

      const result = lexicons.validate('org.rwell.test.occurrence', invalidOccurrence)

      expect(result.success).toBe(false)
    })

    it('can validate identification schema exists', () => {
      // Note: Full validation requires the com.atproto.repo.strongRef lexicon
      // which is not included in this package's schema. Testing schema structure instead.
      const schema = schemaDict.OrgRwellTestIdentification
      const record = schema.defs.main.record as { properties: Record<string, unknown> }

      expect(record.properties.subject).toBeDefined()
      expect(record.properties.taxonName).toBeDefined()
      expect(record.properties.createdAt).toBeDefined()
    })
  })

  // ============================================================================
  // validate function tests
  // ============================================================================
  describe('validate', () => {
    it('validates object with required $type', () => {
      const value = {
        $type: 'org.rwell.test.occurrence',
        scientificName: 'Quercus alba',
        eventDate: '2024-01-15T10:00:00Z',
        location: {
          decimalLatitude: '40.7128',
          decimalLongitude: '-74.0060'
        },
        createdAt: '2024-01-15T10:00:00Z'
      }

      const result = validate(value, 'org.rwell.test.occurrence', 'main', true)

      expect(result.success).toBe(true)
    })

    it('validates object with optional $type', () => {
      const value = {
        scientificName: 'Quercus alba',
        eventDate: '2024-01-15T10:00:00Z',
        location: {
          decimalLatitude: '40.7128',
          decimalLongitude: '-74.0060'
        },
        createdAt: '2024-01-15T10:00:00Z'
      }

      const result = validate(value, 'org.rwell.test.occurrence', 'main', false)

      expect(result.success).toBe(true)
    })

    it('fails when required $type is missing', () => {
      const value = {
        scientificName: 'Quercus alba',
        eventDate: '2024-01-15T10:00:00Z',
        location: {
          decimalLatitude: '40.7128',
          decimalLongitude: '-74.0060'
        },
        createdAt: '2024-01-15T10:00:00Z'
      }

      const result = validate(value, 'org.rwell.test.occurrence', 'main', true)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error?.message).toContain('$type')
      }
    })

    it('fails when $type does not match', () => {
      const value = {
        $type: 'org.rwell.test.identification', // wrong type
        scientificName: 'Quercus alba'
      }

      const result = validate(value, 'org.rwell.test.occurrence', 'main', true)

      expect(result.success).toBe(false)
    })

    it('validates nested type with hash', () => {
      const value = {
        $type: 'org.rwell.test.occurrence#location',
        decimalLatitude: '40.7128',
        decimalLongitude: '-74.0060'
      }

      const result = validate(value, 'org.rwell.test.occurrence', 'location', true)

      expect(result.success).toBe(true)
    })

    it('handles non-main hash in error message', () => {
      const value = { invalid: 'data' }

      const result = validate(value, 'org.rwell.test.occurrence', 'location', true)

      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error?.message).toContain('org.rwell.test.occurrence#location')
      }
    })
  })

  // ============================================================================
  // ids tests
  // ============================================================================
  describe('ids', () => {
    it('contains identification id', () => {
      expect(ids.OrgRwellTestIdentification).toBe('org.rwell.test.identification')
    })

    it('contains occurrence id', () => {
      expect(ids.OrgRwellTestOccurrence).toBe('org.rwell.test.occurrence')
    })
  })
})
