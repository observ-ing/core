import { describe, it, expect } from 'vitest'

/**
 * Regression tests for user display formatting.
 *
 * Bug: When a user is logged in but the handle is not properly resolved,
 * the UI was displaying `@undefined` instead of a proper fallback.
 *
 * Fix: Display the user's DID when handle is unavailable.
 *
 * These tests verify the display logic used in:
 * - Header.tsx (line 25)
 * - UploadModal.tsx (line 118)
 */

// Extract the display logic used in Header.tsx and UploadModal.tsx
function formatUserDisplay(user: { did: string; handle?: string } | null): string | null {
  if (!user) return null
  return user.handle ? `@${user.handle}` : user.did
}

function formatPostingAs(user: { did: string; handle?: string } | null): string {
  if (!user) return 'Demo Mode - Login to post to AT Protocol'
  return `Posting as ${user.handle ? `@${user.handle}` : user.did}`
}

describe('User display fallback', () => {
  describe('formatUserDisplay (Header)', () => {
    it('returns null when user is null', () => {
      expect(formatUserDisplay(null)).toBeNull()
    })

    it('displays @handle when handle is available', () => {
      const user = { did: 'did:plc:abc123', handle: 'alice.bsky.social' }
      expect(formatUserDisplay(user)).toBe('@alice.bsky.social')
    })

    it('displays DID when handle is undefined', () => {
      const user = { did: 'did:plc:abc123', handle: undefined }
      expect(formatUserDisplay(user)).toBe('did:plc:abc123')
    })

    it('displays DID when handle is empty string', () => {
      const user = { did: 'did:plc:abc123', handle: '' }
      expect(formatUserDisplay(user)).toBe('did:plc:abc123')
    })

    it('does not display @undefined (regression test)', () => {
      const user = { did: 'did:plc:abc123', handle: undefined }
      const result = formatUserDisplay(user)
      expect(result).not.toBe('@undefined')
      expect(result).not.toContain('undefined')
    })
  })

  describe('formatPostingAs (UploadModal)', () => {
    it('returns demo mode message when user is null', () => {
      expect(formatPostingAs(null)).toBe('Demo Mode - Login to post to AT Protocol')
    })

    it('displays Posting as @handle when handle is available', () => {
      const user = { did: 'did:plc:abc123', handle: 'bob.bsky.social' }
      expect(formatPostingAs(user)).toBe('Posting as @bob.bsky.social')
    })

    it('displays Posting as DID when handle is undefined', () => {
      const user = { did: 'did:plc:xyz789', handle: undefined }
      expect(formatPostingAs(user)).toBe('Posting as did:plc:xyz789')
    })

    it('displays Posting as DID when handle is empty string', () => {
      const user = { did: 'did:plc:xyz789', handle: '' }
      expect(formatPostingAs(user)).toBe('Posting as did:plc:xyz789')
    })

    it('does not display Posting as @undefined (regression test)', () => {
      const user = { did: 'did:plc:abc123', handle: undefined }
      const result = formatPostingAs(user)
      expect(result).not.toBe('Posting as @undefined')
      expect(result).not.toContain('undefined')
    })
  })
})
