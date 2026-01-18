import { describe, it, expect } from 'vitest'
import { is$typed, maybe$typed, asPredicate, type $Typed, type Un$Typed, type $Type } from '../generated/util.js'

describe('util', () => {
  // ============================================================================
  // is$typed tests
  // ============================================================================
  describe('is$typed', () => {
    it('returns true for object with matching $type (main hash)', () => {
      const value = { $type: 'org.rwell.test.occurrence', data: 'test' }

      const result = is$typed(value, 'org.rwell.test.occurrence', 'main')

      expect(result).toBe(true)
    })

    it('returns true for object with matching $type (non-main hash)', () => {
      const value = { $type: 'org.rwell.test.occurrence#location', lat: 0, lng: 0 }

      const result = is$typed(value, 'org.rwell.test.occurrence', 'location')

      expect(result).toBe(true)
    })

    it('returns false for object with non-matching $type', () => {
      const value = { $type: 'org.rwell.test.identification', data: 'test' }

      const result = is$typed(value, 'org.rwell.test.occurrence', 'main')

      expect(result).toBe(false)
    })

    it('returns false for object without $type', () => {
      const value = { data: 'test' }

      const result = is$typed(value, 'org.rwell.test.occurrence', 'main')

      expect(result).toBe(false)
    })

    it('returns false for null', () => {
      const result = is$typed(null, 'org.rwell.test.occurrence', 'main')

      expect(result).toBe(false)
    })

    it('returns false for undefined', () => {
      const result = is$typed(undefined, 'org.rwell.test.occurrence', 'main')

      expect(result).toBe(false)
    })

    it('returns false for primitive values', () => {
      expect(is$typed('string', 'org.rwell.test.occurrence', 'main')).toBe(false)
      expect(is$typed(123, 'org.rwell.test.occurrence', 'main')).toBe(false)
      expect(is$typed(true, 'org.rwell.test.occurrence', 'main')).toBe(false)
    })

    it('returns false for arrays', () => {
      const result = is$typed(['test'], 'org.rwell.test.occurrence', 'main')

      expect(result).toBe(false)
    })

    it('correctly validates hash part of type', () => {
      const value = { $type: 'org.rwell.test.occurrence#imageEmbed' }

      expect(is$typed(value, 'org.rwell.test.occurrence', 'imageEmbed')).toBe(true)
      expect(is$typed(value, 'org.rwell.test.occurrence', 'location')).toBe(false)
    })
  })

  // ============================================================================
  // maybe$typed tests
  // ============================================================================
  describe('maybe$typed', () => {
    it('returns true for object with matching $type', () => {
      const value = { $type: 'org.rwell.test.occurrence', data: 'test' }

      const result = maybe$typed(value, 'org.rwell.test.occurrence', 'main')

      expect(result).toBe(true)
    })

    it('returns true for object without $type (optional)', () => {
      const value = { data: 'test' }

      const result = maybe$typed(value, 'org.rwell.test.occurrence', 'main')

      expect(result).toBe(true)
    })

    it('returns true for object with undefined $type', () => {
      const value = { $type: undefined, data: 'test' }

      const result = maybe$typed(value, 'org.rwell.test.occurrence', 'main')

      expect(result).toBe(true)
    })

    it('returns false for object with non-matching $type', () => {
      const value = { $type: 'org.rwell.test.identification', data: 'test' }

      const result = maybe$typed(value, 'org.rwell.test.occurrence', 'main')

      expect(result).toBe(false)
    })

    it('returns false for null', () => {
      const result = maybe$typed(null, 'org.rwell.test.occurrence', 'main')

      expect(result).toBe(false)
    })

    it('returns false for primitives', () => {
      expect(maybe$typed('string', 'org.rwell.test.occurrence', 'main')).toBe(false)
      expect(maybe$typed(123, 'org.rwell.test.occurrence', 'main')).toBe(false)
    })

    it('handles hash correctly', () => {
      const value = { $type: 'org.rwell.test.occurrence#location' }

      expect(maybe$typed(value, 'org.rwell.test.occurrence', 'location')).toBe(true)
      expect(maybe$typed(value, 'org.rwell.test.occurrence', 'main')).toBe(false)
    })
  })

  // ============================================================================
  // asPredicate tests
  // ============================================================================
  describe('asPredicate', () => {
    it('converts validator to type predicate returning true on success', () => {
      const mockValidator = (v: unknown) => ({
        success: true as const,
        value: v as { name: string }
      })

      const predicate = asPredicate(mockValidator)
      const result = predicate({ name: 'test' })

      expect(result).toBe(true)
    })

    it('converts validator to type predicate returning false on failure', () => {
      const mockValidator = () => ({
        success: false as const,
        error: new Error('Validation failed')
      })

      const predicate = asPredicate(mockValidator)
      const result = predicate({ invalid: 'data' })

      expect(result).toBe(false)
    })

    it('predicate narrows type correctly', () => {
      type MyType = { name: string; value: number }

      const mockValidator = (v: unknown) => {
        if (typeof v === 'object' && v !== null && 'name' in v && 'value' in v) {
          return { success: true as const, value: v as MyType }
        }
        return { success: false as const, error: new Error('Invalid') }
      }

      const predicate = asPredicate(mockValidator)
      const value: unknown = { name: 'test', value: 42 }

      if (predicate(value)) {
        // TypeScript should now know value is MyType
        expect(value.name).toBe('test')
        expect(value.value).toBe(42)
      }
    })
  })

  // ============================================================================
  // Type tests (compile-time, these just ensure types work)
  // ============================================================================
  describe('types', () => {
    it('$Typed type adds $type property', () => {
      type Original = { data: string }
      type Typed = $Typed<Original, 'test.type'>

      const value: Typed = { $type: 'test.type', data: 'test' }

      expect(value.$type).toBe('test.type')
    })

    it('Un$Typed type removes $type property', () => {
      type Typed = { $type: 'test.type'; data: string }
      type Untyped = Un$Typed<Typed>

      const value: Untyped = { data: 'test' }

      expect(value).toEqual({ data: 'test' })
    })

    it('$Type creates correct type string', () => {
      type MainType = $Type<'org.rwell.test', 'main'>
      type HashType = $Type<'org.rwell.test', 'location'>

      const main: MainType = 'org.rwell.test'
      const hash: HashType = 'org.rwell.test#location'

      expect(main).toBe('org.rwell.test')
      expect(hash).toBe('org.rwell.test#location')
    })
  })
})
