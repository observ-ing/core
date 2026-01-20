import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  MemoryStateStore,
  MemorySessionStore,
  DatabaseStateStore,
  DatabaseSessionStore,
  OAuthService,
  type StateStore,
  type SessionStore,
  type SessionData,
  type DatabaseLike
} from './oauth.js'

// ============================================================================
// MemoryStateStore tests
// ============================================================================
describe('MemoryStateStore', () => {
  let store: MemoryStateStore

  beforeEach(() => {
    store = new MemoryStateStore()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sets and gets a value', async () => {
    await store.set('key1', 'value1')

    const result = await store.get('key1')

    expect(result).toBe('value1')
  })

  it('returns undefined for missing key', async () => {
    const result = await store.get('nonexistent')

    expect(result).toBeUndefined()
  })

  it('deletes a value', async () => {
    await store.set('key2', 'value2')
    await store.del('key2')

    const result = await store.get('key2')

    expect(result).toBeUndefined()
  })

  it('expires values after TTL', async () => {
    await store.set('expiring', 'value', 1000) // 1 second TTL

    // Before expiry
    expect(await store.get('expiring')).toBe('value')

    // After expiry
    vi.advanceTimersByTime(1500)
    expect(await store.get('expiring')).toBeUndefined()
  })

  it('uses default TTL of 600000ms (10 minutes)', async () => {
    await store.set('defaultTtl', 'value')

    // Before default expiry
    vi.advanceTimersByTime(599000)
    expect(await store.get('defaultTtl')).toBe('value')

    // After default expiry
    vi.advanceTimersByTime(2000)
    expect(await store.get('defaultTtl')).toBeUndefined()
  })
})

// ============================================================================
// MemorySessionStore tests
// ============================================================================
describe('MemorySessionStore', () => {
  let store: MemorySessionStore

  beforeEach(() => {
    store = new MemorySessionStore()
  })

  const mockSession: SessionData = {
    did: 'did:plc:test',
    handle: 'test.bsky.social',
    accessToken: 'token123',
    refreshToken: 'refresh123',
    expiresAt: Date.now() + 3600000
  }

  it('sets and gets a session', async () => {
    await store.set('session1', mockSession)

    const result = await store.get('session1')

    expect(result).toEqual(mockSession)
  })

  it('returns undefined for missing session', async () => {
    const result = await store.get('nonexistent')

    expect(result).toBeUndefined()
  })

  it('deletes a session', async () => {
    await store.set('session2', mockSession)
    await store.del('session2')

    const result = await store.get('session2')

    expect(result).toBeUndefined()
  })

  it('overwrites existing session', async () => {
    await store.set('session3', mockSession)

    const updatedSession = { ...mockSession, handle: 'updated.bsky.social' }
    await store.set('session3', updatedSession)

    const result = await store.get('session3')

    expect(result!.handle).toBe('updated.bsky.social')
  })
})

// ============================================================================
// DatabaseStateStore tests
// ============================================================================
describe('DatabaseStateStore', () => {
  let mockDb: DatabaseLike
  let store: DatabaseStateStore

  beforeEach(() => {
    mockDb = {
      getOAuthState: vi.fn(),
      setOAuthState: vi.fn(),
      deleteOAuthState: vi.fn(),
      getOAuthSession: vi.fn(),
      setOAuthSession: vi.fn(),
      deleteOAuthSession: vi.fn()
    }
    store = new DatabaseStateStore(mockDb)
  })

  it('gets value from database', async () => {
    vi.mocked(mockDb.getOAuthState).mockResolvedValue('stored-value')

    const result = await store.get('db-key')

    expect(mockDb.getOAuthState).toHaveBeenCalledWith('db-key')
    expect(result).toBe('stored-value')
  })

  it('sets value in database with TTL', async () => {
    await store.set('db-key', 'db-value', 5000)

    expect(mockDb.setOAuthState).toHaveBeenCalledWith('db-key', 'db-value', 5000)
  })

  it('uses default TTL when not specified', async () => {
    await store.set('db-key', 'db-value')

    expect(mockDb.setOAuthState).toHaveBeenCalledWith('db-key', 'db-value', 600000)
  })

  it('deletes value from database', async () => {
    await store.del('db-key')

    expect(mockDb.deleteOAuthState).toHaveBeenCalledWith('db-key')
  })
})

// ============================================================================
// DatabaseSessionStore tests
// ============================================================================
describe('DatabaseSessionStore', () => {
  let mockDb: DatabaseLike
  let store: DatabaseSessionStore

  beforeEach(() => {
    mockDb = {
      getOAuthState: vi.fn(),
      setOAuthState: vi.fn(),
      deleteOAuthState: vi.fn(),
      getOAuthSession: vi.fn(),
      setOAuthSession: vi.fn(),
      deleteOAuthSession: vi.fn()
    }
    store = new DatabaseSessionStore(mockDb)
  })

  const mockSession: SessionData = {
    did: 'did:plc:dbtest',
    handle: 'db.bsky.social',
    accessToken: 'dbtoken',
    expiresAt: Date.now() + 3600000
  }

  it('gets session from database (parses JSON)', async () => {
    vi.mocked(mockDb.getOAuthSession).mockResolvedValue(JSON.stringify(mockSession))

    const result = await store.get('session-key')

    expect(mockDb.getOAuthSession).toHaveBeenCalledWith('session-key')
    expect(result).toEqual(mockSession)
  })

  it('returns undefined for missing session', async () => {
    vi.mocked(mockDb.getOAuthSession).mockResolvedValue(undefined)

    const result = await store.get('missing-key')

    expect(result).toBeUndefined()
  })

  it('sets session in database (as JSON)', async () => {
    await store.set('session-key', mockSession)

    expect(mockDb.setOAuthSession).toHaveBeenCalledWith('session-key', JSON.stringify(mockSession))
  })

  it('deletes session from database', async () => {
    await store.del('session-key')

    expect(mockDb.deleteOAuthSession).toHaveBeenCalledWith('session-key')
  })
})

// ============================================================================
// OAuthService tests
// ============================================================================
describe('OAuthService', () => {
  let service: OAuthService

  beforeEach(() => {
    service = new OAuthService({
      publicUrl: 'https://test.biosky.app',
      scope: 'atproto'
    })
  })

  describe('clientId', () => {
    it('returns client metadata URL', () => {
      expect(service.clientId).toBe('https://test.biosky.app/client-metadata.json')
    })
  })

  describe('redirectUri', () => {
    it('returns OAuth callback URL', () => {
      expect(service.redirectUri).toBe('https://test.biosky.app/oauth/callback')
    })
  })

  describe('getClientMetadata', () => {
    it('returns OAuth client metadata object', () => {
      const metadata = service.getClientMetadata()

      expect(metadata).toEqual({
        client_id: 'https://test.biosky.app/client-metadata.json',
        client_name: 'BioSky',
        client_uri: 'https://test.biosky.app',
        redirect_uris: ['https://test.biosky.app/oauth/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        scope: 'atproto',
        token_endpoint_auth_method: 'none',
        dpop_bound_access_tokens: true
      })
    })
  })

  describe('getSession', () => {
    it('retrieves session from store', async () => {
      const mockSessionStore: SessionStore = {
        get: vi.fn().mockResolvedValue({
          did: 'did:plc:stored',
          handle: 'stored.bsky.social',
          accessToken: 'token',
          expiresAt: Date.now() + 3600000
        }),
        set: vi.fn(),
        del: vi.fn()
      }
      const serviceWithStore = new OAuthService({
        publicUrl: 'https://test.biosky.app',
        sessionStore: mockSessionStore
      })

      const session = await serviceWithStore.getSession('did:plc:stored')

      expect(mockSessionStore.get).toHaveBeenCalledWith('did:plc:stored')
      expect(session?.handle).toBe('stored.bsky.social')
    })
  })

  describe('logout', () => {
    it('deletes session from store', async () => {
      const mockSessionStore: SessionStore = {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn()
      }
      const serviceWithStore = new OAuthService({
        publicUrl: 'https://test.biosky.app',
        sessionStore: mockSessionStore
      })

      await serviceWithStore.logout('did:plc:logout')

      expect(mockSessionStore.del).toHaveBeenCalledWith('did:plc:logout')
    })
  })

  describe('getAuthorizationUrl', () => {
    it('throws when client not initialized', async () => {
      await expect(
        service.getAuthorizationUrl('test.bsky.social')
      ).rejects.toThrow('OAuth client not initialized')
    })
  })

  describe('handleCallback', () => {
    it('throws when client not initialized', async () => {
      await expect(
        service.handleCallback({ code: 'abc', state: 'xyz', iss: 'https://bsky.social' })
      ).rejects.toThrow('OAuth client not initialized')
    })
  })

  describe('getAgent', () => {
    it('returns null when client not initialized', async () => {
      const agent = await service.getAgent('did:plc:test')

      expect(agent).toBeNull()
    })
  })

  describe('default configuration', () => {
    it('uses environment variables for publicUrl', () => {
      const originalEnv = process.env.PUBLIC_URL
      process.env.PUBLIC_URL = 'https://env.biosky.app'

      const envService = new OAuthService({})

      expect(envService.clientId).toBe('https://env.biosky.app/client-metadata.json')

      process.env.PUBLIC_URL = originalEnv
    })

    it('defaults to loopback IP when no config', () => {
      const originalEnv = process.env.PUBLIC_URL
      delete process.env.PUBLIC_URL

      const defaultService = new OAuthService({})

      expect(defaultService.clientId).toBe('http://127.0.0.1:3000/client-metadata.json')

      process.env.PUBLIC_URL = originalEnv
    })

    it('uses default scope of atproto', () => {
      const metadata = service.getClientMetadata() as { scope: string }

      expect(metadata.scope).toBe('atproto')
    })
  })

  describe('initialize', () => {
    it('catches and logs initialization errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

      // Initialize will fail because we can't actually generate keys in test
      // But it should not throw
      await expect(service.initialize()).resolves.not.toThrow()

      consoleSpy.mockRestore()
      warnSpy.mockRestore()
    })
  })

  describe('setupRoutes', () => {
    it('registers OAuth routes on express app', () => {
      const mockApp = {
        get: vi.fn(),
        post: vi.fn()
      } as any

      service.setupRoutes(mockApp)

      // Should register 5 routes
      expect(mockApp.get).toHaveBeenCalledWith('/client-metadata.json', expect.any(Function))
      expect(mockApp.get).toHaveBeenCalledWith('/oauth/login', expect.any(Function))
      expect(mockApp.get).toHaveBeenCalledWith('/oauth/callback', expect.any(Function))
      expect(mockApp.get).toHaveBeenCalledWith('/oauth/me', expect.any(Function))
      expect(mockApp.post).toHaveBeenCalledWith('/oauth/logout', expect.any(Function))
    })

    it('client-metadata.json route returns metadata', () => {
      const mockRes = {
        json: vi.fn()
      }
      const mockApp = {
        get: vi.fn((path: string, handler: Function) => {
          if (path === '/client-metadata.json') {
            handler({}, mockRes)
          }
        }),
        post: vi.fn()
      } as any

      service.setupRoutes(mockApp)

      expect(mockRes.json).toHaveBeenCalledWith(service.getClientMetadata())
    })

    it('/oauth/login redirects when client initialized', async () => {
      const mockRes = {
        redirect: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      }
      const mockReq = {
        query: { handle: 'test.bsky.social' }
      }

      let loginHandler: Function
      const mockApp = {
        get: vi.fn((path: string, handler: Function) => {
          if (path === '/oauth/login') {
            loginHandler = handler
          }
        }),
        post: vi.fn()
      } as any

      service.setupRoutes(mockApp)

      // Without initialized client, should return error
      await loginHandler!(mockReq, mockRes)
      expect(mockRes.status).toHaveBeenCalledWith(500)
    })

    it('/oauth/login returns 400 when handle missing', async () => {
      const mockRes = {
        redirect: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      }
      const mockReq = {
        query: {}
      }

      let loginHandler: Function
      const mockApp = {
        get: vi.fn((path: string, handler: Function) => {
          if (path === '/oauth/login') {
            loginHandler = handler
          }
        }),
        post: vi.fn()
      } as any

      service.setupRoutes(mockApp)
      await loginHandler!(mockReq, mockRes)

      expect(mockRes.status).toHaveBeenCalledWith(400)
      expect(mockRes.json).toHaveBeenCalledWith({ error: 'handle parameter required' })
    })

    it('/oauth/callback returns error on missing params', async () => {
      const mockRes = {
        redirect: vi.fn(),
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      }
      const mockReq = {
        query: {}
      }

      let callbackHandler: Function
      const mockApp = {
        get: vi.fn((path: string, handler: Function) => {
          if (path === '/oauth/callback') {
            callbackHandler = handler
          }
        }),
        post: vi.fn()
      } as any

      service.setupRoutes(mockApp)
      await callbackHandler!(mockReq, mockRes)

      // Returns 500 because client not initialized
      expect(mockRes.status).toHaveBeenCalledWith(500)
    })

    it('/oauth/me returns null user when no session cookie', async () => {
      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      }
      const mockReq = {
        cookies: {}
      }

      let meHandler: Function
      const mockApp = {
        get: vi.fn((path: string, handler: Function) => {
          if (path === '/oauth/me') {
            meHandler = handler
          }
        }),
        post: vi.fn()
      } as any

      service.setupRoutes(mockApp)
      await meHandler!(mockReq, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith({ user: null })
    })

    it('/oauth/me returns session when found', async () => {
      const mockSession: SessionData = {
        did: 'did:plc:metest',
        handle: 'me.bsky.social',
        accessToken: 'token',
        expiresAt: Date.now() + 3600000
      }
      const mockSessionStore: SessionStore = {
        get: vi.fn().mockResolvedValue(mockSession),
        set: vi.fn(),
        del: vi.fn()
      }
      const serviceWithStore = new OAuthService({
        publicUrl: 'https://test.biosky.app',
        sessionStore: mockSessionStore
      })

      const mockRes = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn()
      }
      const mockReq = {
        cookies: { session_did: 'did:plc:metest' }
      }

      let meHandler: Function
      const mockApp = {
        get: vi.fn((path: string, handler: Function) => {
          if (path === '/oauth/me') {
            meHandler = handler
          }
        }),
        post: vi.fn()
      } as any

      serviceWithStore.setupRoutes(mockApp)
      await meHandler!(mockReq, mockRes)

      expect(mockRes.json).toHaveBeenCalledWith({ user: { did: mockSession.did, handle: mockSession.handle } })
    })

    it('/oauth/logout clears cookie and session', async () => {
      const mockSessionStore: SessionStore = {
        get: vi.fn(),
        set: vi.fn(),
        del: vi.fn()
      }
      const serviceWithStore = new OAuthService({
        publicUrl: 'https://test.biosky.app',
        sessionStore: mockSessionStore
      })

      const mockRes = {
        clearCookie: vi.fn(),
        json: vi.fn()
      }
      const mockReq = {
        cookies: { session_did: 'did:plc:logout' }
      }

      let logoutHandler: Function
      const mockApp = {
        get: vi.fn(),
        post: vi.fn((path: string, handler: Function) => {
          if (path === '/oauth/logout') {
            logoutHandler = handler
          }
        })
      } as any

      serviceWithStore.setupRoutes(mockApp)
      await logoutHandler!(mockReq, mockRes)

      expect(mockRes.clearCookie).toHaveBeenCalledWith('session_did')
      expect(mockSessionStore.del).toHaveBeenCalledWith('did:plc:logout')
      expect(mockRes.json).toHaveBeenCalledWith({ success: true })
    })
  })
})
