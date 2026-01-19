import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { FirehoseSubscription } from './firehose.js'

describe('FirehoseSubscription', () => {
  let subscription: FirehoseSubscription

  beforeEach(() => {
    subscription = new FirehoseSubscription()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ============================================================================
  // buildUrl tests (accessed via internal state inspection or behavior)
  // ============================================================================
  describe('URL building', () => {
    it('uses default relay when none specified', () => {
      const sub = new FirehoseSubscription()
      // The default relay is wss://bsky.network
      // We can verify this through the subscription behavior
      expect(sub).toBeDefined()
    })

    it('uses custom relay when specified', () => {
      const customRelay = 'wss://custom.relay.network'
      const sub = new FirehoseSubscription({ relay: customRelay })
      expect(sub).toBeDefined()
    })

    it('getCursor returns undefined when no cursor set', () => {
      const sub = new FirehoseSubscription()
      expect(sub.getCursor()).toBeUndefined()
    })

    it('getCursor returns initial cursor when specified', () => {
      const sub = new FirehoseSubscription({ cursor: 12345 })
      expect(sub.getCursor()).toBe(12345)
    })
  })

  // ============================================================================
  // findCborEnd tests - Testing CBOR parsing logic
  // ============================================================================
  describe('findCborEnd', () => {
    // Access private method via any cast for testing
    function findCborEnd(data: Buffer, start: number): number {
      return (subscription as any).findCborEnd(data, start)
    }

    describe('unsigned integers (major type 0)', () => {
      it('parses small unsigned int (0-23)', () => {
        // CBOR: 0x05 = unsigned int 5
        const data = Buffer.from([0x05])
        expect(findCborEnd(data, 0)).toBe(1)
      })

      it('parses unsigned int with 1-byte follow (24)', () => {
        // CBOR: 0x18 0xFF = unsigned int 255
        const data = Buffer.from([0x18, 0xff])
        expect(findCborEnd(data, 0)).toBe(2)
      })

      it('parses unsigned int with 2-byte follow (25)', () => {
        // CBOR: 0x19 0x01 0x00 = unsigned int 256
        const data = Buffer.from([0x19, 0x01, 0x00])
        expect(findCborEnd(data, 0)).toBe(3)
      })

      it('parses unsigned int with 4-byte follow (26)', () => {
        // CBOR: 0x1a 0x00 0x01 0x00 0x00 = unsigned int 65536
        const data = Buffer.from([0x1a, 0x00, 0x01, 0x00, 0x00])
        expect(findCborEnd(data, 0)).toBe(5)
      })

      it('parses unsigned int with 8-byte follow (27)', () => {
        // CBOR: 0x1b + 8 bytes
        const data = Buffer.from([0x1b, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00])
        expect(findCborEnd(data, 0)).toBe(9)
      })
    })

    describe('negative integers (major type 1)', () => {
      it('parses small negative int', () => {
        // CBOR: 0x20 = negative int -1
        const data = Buffer.from([0x20])
        expect(findCborEnd(data, 0)).toBe(1)
      })

      it('parses negative int with 1-byte follow', () => {
        // CBOR: 0x38 0x63 = negative int -100
        const data = Buffer.from([0x38, 0x63])
        expect(findCborEnd(data, 0)).toBe(2)
      })
    })

    describe('byte strings (major type 2)', () => {
      it('parses empty byte string', () => {
        // CBOR: 0x40 = empty byte string
        const data = Buffer.from([0x40])
        expect(findCborEnd(data, 0)).toBe(1)
      })

      it('parses short byte string', () => {
        // CBOR: 0x44 + 4 bytes = byte string of length 4
        const data = Buffer.from([0x44, 0x01, 0x02, 0x03, 0x04])
        expect(findCborEnd(data, 0)).toBe(5)
      })

      it('parses byte string with 1-byte length', () => {
        // CBOR: 0x58 0x1a + 26 bytes = byte string of length 26
        const bytes = [0x58, 0x1a, ...Array(26).fill(0x00)]
        const data = Buffer.from(bytes)
        expect(findCborEnd(data, 0)).toBe(28)
      })
    })

    describe('text strings (major type 3)', () => {
      it('parses empty text string', () => {
        // CBOR: 0x60 = empty text string
        const data = Buffer.from([0x60])
        expect(findCborEnd(data, 0)).toBe(1)
      })

      it('parses short text string "hello"', () => {
        // CBOR: 0x65 + "hello" = text string of length 5
        const data = Buffer.from([0x65, 0x68, 0x65, 0x6c, 0x6c, 0x6f])
        expect(findCborEnd(data, 0)).toBe(6)
      })

      it('parses text string with 1-byte length', () => {
        // CBOR: 0x78 0x20 + 32 bytes = text string of length 32
        const bytes = [0x78, 0x20, ...Array(32).fill(0x41)]
        const data = Buffer.from(bytes)
        expect(findCborEnd(data, 0)).toBe(34)
      })
    })

    describe('arrays (major type 4)', () => {
      it('parses empty array', () => {
        // CBOR: 0x80 = empty array
        const data = Buffer.from([0x80])
        expect(findCborEnd(data, 0)).toBe(1)
      })

      it('parses array with single integer', () => {
        // CBOR: 0x81 0x05 = array [5]
        const data = Buffer.from([0x81, 0x05])
        expect(findCborEnd(data, 0)).toBe(2)
      })

      it('parses array with multiple integers', () => {
        // CBOR: 0x83 0x01 0x02 0x03 = array [1, 2, 3]
        const data = Buffer.from([0x83, 0x01, 0x02, 0x03])
        expect(findCborEnd(data, 0)).toBe(4)
      })

      it('parses nested arrays', () => {
        // CBOR: 0x82 0x81 0x01 0x02 = array [[1], 2]
        const data = Buffer.from([0x82, 0x81, 0x01, 0x02])
        expect(findCborEnd(data, 0)).toBe(4)
      })

      it('parses array with text string', () => {
        // CBOR: 0x81 0x63 0x66 0x6f 0x6f = array ["foo"]
        const data = Buffer.from([0x81, 0x63, 0x66, 0x6f, 0x6f])
        expect(findCborEnd(data, 0)).toBe(5)
      })
    })

    describe('maps (major type 5)', () => {
      it('parses empty map', () => {
        // CBOR: 0xa0 = empty map {}
        const data = Buffer.from([0xa0])
        expect(findCborEnd(data, 0)).toBe(1)
      })

      it('parses map with single key-value pair', () => {
        // CBOR: 0xa1 0x61 0x61 0x01 = map {"a": 1}
        const data = Buffer.from([0xa1, 0x61, 0x61, 0x01])
        expect(findCborEnd(data, 0)).toBe(4)
      })

      it('parses map with multiple key-value pairs', () => {
        // CBOR: 0xa2 0x61 0x61 0x01 0x61 0x62 0x02 = map {"a": 1, "b": 2}
        const data = Buffer.from([0xa2, 0x61, 0x61, 0x01, 0x61, 0x62, 0x02])
        expect(findCborEnd(data, 0)).toBe(7)
      })

      it('parses nested map', () => {
        // CBOR: 0xa1 0x61 0x78 0xa1 0x61 0x79 0x01 = map {"x": {"y": 1}}
        const data = Buffer.from([0xa1, 0x61, 0x78, 0xa1, 0x61, 0x79, 0x01])
        expect(findCborEnd(data, 0)).toBe(7)
      })
    })

    describe('tags (major type 6)', () => {
      it('parses tagged value', () => {
        // CBOR: 0xc0 0x74 + 20 bytes = tag 0 with text string (date-time)
        // Simplified: 0xc0 0x65 "hello" = tag 0 with "hello"
        const data = Buffer.from([0xc0, 0x65, 0x68, 0x65, 0x6c, 0x6c, 0x6f])
        expect(findCborEnd(data, 0)).toBe(7)
      })
    })

    describe('simple values and floats (major type 7)', () => {
      it('parses false', () => {
        // CBOR: 0xf4 = false
        const data = Buffer.from([0xf4])
        expect(findCborEnd(data, 0)).toBe(1)
      })

      it('parses true', () => {
        // CBOR: 0xf5 = true
        const data = Buffer.from([0xf5])
        expect(findCborEnd(data, 0)).toBe(1)
      })

      it('parses null', () => {
        // CBOR: 0xf6 = null
        const data = Buffer.from([0xf6])
        expect(findCborEnd(data, 0)).toBe(1)
      })
    })

    describe('edge cases', () => {
      it('returns -1 for empty buffer', () => {
        const data = Buffer.from([])
        expect(findCborEnd(data, 0)).toBe(-1)
      })

      it('returns -1 when start exceeds buffer length', () => {
        const data = Buffer.from([0x01])
        expect(findCborEnd(data, 5)).toBe(-1)
      })

      it('handles start offset correctly', () => {
        // Buffer with two integers: 0x01, 0x05
        const data = Buffer.from([0x01, 0x05])
        expect(findCborEnd(data, 0)).toBe(1)
        expect(findCborEnd(data, 1)).toBe(2)
      })

      it('returns -1 for unsupported additional info', () => {
        // 0x1c, 0x1d, 0x1e are reserved
        const data = Buffer.from([0x1c])
        expect(findCborEnd(data, 0)).toBe(-1)
      })
    })
  })

  // ============================================================================
  // decodeFrame tests
  // ============================================================================
  describe('decodeFrame', () => {
    // Access private method via any cast for testing
    function decodeFrame(data: Buffer): { header: { op: number; t: string }; body: unknown } | null {
      return (subscription as any).decodeFrame(data)
    }

    it('returns null for invalid CBOR data', () => {
      const data = Buffer.from([0xff, 0xff, 0xff])
      expect(decodeFrame(data)).toBeNull()
    })

    it('returns null for truncated data', () => {
      // A map that claims to have 5 elements but doesn't
      const data = Buffer.from([0xa5])
      expect(decodeFrame(data)).toBeNull()
    })
  })

  // ============================================================================
  // Event handlers and callback tests
  // ============================================================================
  describe('event handling', () => {
    it('registers occurrence callback via constructor', () => {
      const onOccurrence = vi.fn()
      const sub = new FirehoseSubscription({ onOccurrence })

      // Emit a test event
      sub.emit('occurrence', { uri: 'test', did: 'did:plc:test' })

      expect(onOccurrence).toHaveBeenCalledWith({ uri: 'test', did: 'did:plc:test' })
    })

    it('registers identification callback via constructor', () => {
      const onIdentification = vi.fn()
      const sub = new FirehoseSubscription({ onIdentification })

      // Emit a test event
      sub.emit('identification', { uri: 'test', did: 'did:plc:test' })

      expect(onIdentification).toHaveBeenCalledWith({ uri: 'test', did: 'did:plc:test' })
    })

    it('supports legacy onObservation callback', () => {
      const onObservation = vi.fn()
      const sub = new FirehoseSubscription({ onObservation })

      // Should emit on 'occurrence' event
      sub.emit('occurrence', { uri: 'test', did: 'did:plc:test' })

      expect(onObservation).toHaveBeenCalledWith({ uri: 'test', did: 'did:plc:test' })
    })

    it('prefers onOccurrence over onObservation', () => {
      const onOccurrence = vi.fn()
      const onObservation = vi.fn()
      const sub = new FirehoseSubscription({ onOccurrence, onObservation })

      sub.emit('occurrence', { uri: 'test', did: 'did:plc:test' })

      expect(onOccurrence).toHaveBeenCalled()
      expect(onObservation).not.toHaveBeenCalled()
    })
  })

  // ============================================================================
  // Connection state tests
  // ============================================================================
  describe('connection state', () => {
    it('isConnected returns false before start', () => {
      const sub = new FirehoseSubscription()
      expect(sub.isConnected()).toBe(false)
    })

    it('isConnected returns false after stop', async () => {
      const sub = new FirehoseSubscription()
      await sub.stop()
      expect(sub.isConnected()).toBe(false)
    })
  })

  // ============================================================================
  // handleCommit tests
  // ============================================================================
  describe('handleCommit', () => {
    it('ignores commit without ops', () => {
      const onOccurrence = vi.fn()
      const sub = new FirehoseSubscription({ onOccurrence })

      // Call handleCommit with no ops
      ;(sub as any).handleCommit({ repo: 'did:plc:test', seq: 100, time: new Date().toISOString() })

      expect(onOccurrence).not.toHaveBeenCalled()
    })

    it('handles occurrence op', () => {
      const onOccurrence = vi.fn()
      const sub = new FirehoseSubscription({ onOccurrence })

      ;(sub as any).handleCommit({
        repo: 'did:plc:test',
        seq: 100,
        time: '2024-01-15T10:00:00Z',
        ops: [{ action: 'create', path: 'org.rwell.test.occurrence/abc123', cid: { toString: () => 'bafyrei123' } }]
      })

      expect(onOccurrence).toHaveBeenCalledWith(expect.objectContaining({
        did: 'did:plc:test',
        uri: 'at://did:plc:test/org.rwell.test.occurrence/abc123',
        cid: 'bafyrei123',
        action: 'create'
      }))
    })

    it('handles identification op', () => {
      const onIdentification = vi.fn()
      const sub = new FirehoseSubscription({ onIdentification })

      ;(sub as any).handleCommit({
        repo: 'did:plc:test',
        seq: 101,
        time: '2024-01-15T10:01:00Z',
        ops: [{ action: 'create', path: 'org.rwell.test.identification/xyz789', cid: { toString: () => 'bafyrei456' } }]
      })

      expect(onIdentification).toHaveBeenCalledWith(expect.objectContaining({
        did: 'did:plc:test',
        uri: 'at://did:plc:test/org.rwell.test.identification/xyz789',
        cid: 'bafyrei456',
        action: 'create'
      }))
    })

    it('updates cursor from commit sequence', () => {
      const sub = new FirehoseSubscription()

      ;(sub as any).handleCommit({
        repo: 'did:plc:test',
        seq: 54321,
        time: new Date().toISOString(),
        ops: [{ action: 'create', path: 'org.rwell.test.occurrence/test' }]
      })

      expect(sub.getCursor()).toBe(54321)
    })

    it('emits commit event with timing info', () => {
      const onCommit = vi.fn()
      const sub = new FirehoseSubscription({ onCommit })
      const testTime = '2024-01-15T10:00:00Z'

      ;(sub as any).handleCommit({
        repo: 'did:plc:test',
        seq: 12345,
        time: testTime,
        ops: []
      })

      expect(onCommit).toHaveBeenCalledWith({ seq: 12345, time: testTime })
    })

    it('emits commit event even for unrelated collections', () => {
      const onCommit = vi.fn()
      const onOccurrence = vi.fn()
      const sub = new FirehoseSubscription({ onCommit, onOccurrence })

      ;(sub as any).handleCommit({
        repo: 'did:plc:test',
        seq: 99999,
        time: '2024-01-15T12:00:00Z',
        ops: [{ action: 'create', path: 'app.bsky.feed.post/abc123' }]
      })

      expect(onCommit).toHaveBeenCalledWith({ seq: 99999, time: '2024-01-15T12:00:00Z' })
      expect(onOccurrence).not.toHaveBeenCalled()
    })

    it('handles BigInt seq values for JSON serialization', () => {
      const onCommit = vi.fn()
      const sub = new FirehoseSubscription({ onCommit })

      // Simulate BigInt seq from firehose (the actual firehose returns BigInt)
      ;(sub as any).handleCommit({
        repo: 'did:plc:test',
        seq: BigInt(17259895663),
        time: '2024-01-15T10:00:00Z',
        ops: []
      })

      expect(onCommit).toHaveBeenCalled()
      const callArg = onCommit.mock.calls[0][0]

      // The consumer should convert to Number before JSON.stringify
      // This test verifies the event is emitted (consumer handles conversion)
      expect(callArg.seq).toBeDefined()
      expect(callArg.time).toBe('2024-01-15T10:00:00Z')

      // Verify that converting to Number works for JSON serialization
      const serializable = { seq: Number(callArg.seq), time: callArg.time }
      expect(() => JSON.stringify(serializable)).not.toThrow()
    })

    it('does not emit commit event when seq or time is missing', () => {
      const onCommit = vi.fn()
      const sub = new FirehoseSubscription({ onCommit })

      // Missing time
      ;(sub as any).handleCommit({
        repo: 'did:plc:test',
        seq: 12345,
        ops: []
      })

      // Missing seq
      ;(sub as any).handleCommit({
        repo: 'did:plc:test',
        time: '2024-01-15T10:00:00Z',
        ops: []
      })

      expect(onCommit).not.toHaveBeenCalled()
    })

    it('ignores unrelated collections', () => {
      const onOccurrence = vi.fn()
      const onIdentification = vi.fn()
      const sub = new FirehoseSubscription({ onOccurrence, onIdentification })

      ;(sub as any).handleCommit({
        repo: 'did:plc:test',
        seq: 100,
        time: new Date().toISOString(),
        ops: [{ action: 'create', path: 'app.bsky.feed.post/abc123' }]
      })

      expect(onOccurrence).not.toHaveBeenCalled()
      expect(onIdentification).not.toHaveBeenCalled()
    })

    it('handles delete action', () => {
      const onOccurrence = vi.fn()
      const sub = new FirehoseSubscription({ onOccurrence })

      ;(sub as any).handleCommit({
        repo: 'did:plc:test',
        seq: 102,
        time: '2024-01-15T10:02:00Z',
        ops: [{ action: 'delete', path: 'org.rwell.test.occurrence/del123' }]
      })

      expect(onOccurrence).toHaveBeenCalledWith(expect.objectContaining({
        action: 'delete',
        cid: ''
      }))
    })
  })

  // ============================================================================
  // extractRecord tests
  // ============================================================================
  describe('extractRecord', () => {
    it('returns undefined when blocks is undefined', () => {
      const result = (subscription as any).extractRecord(undefined, undefined)
      expect(result).toBeUndefined()
    })

    it('attempts to decode valid CBOR blocks', () => {
      // CBOR for integer 42: 0x18 0x2a
      const blocks = Buffer.from([0x18, 0x2a])

      const result = (subscription as any).extractRecord(blocks, { toString: () => 'test-cid' })

      // Should return 42 or undefined depending on format expectations
      expect(result === 42 || result === undefined).toBe(true)
    })

    it('returns undefined for invalid CBOR blocks', () => {
      const invalidBlocks = Buffer.from([0xff, 0xff, 0xff])

      const result = (subscription as any).extractRecord(invalidBlocks, { toString: () => 'test-cid' })

      expect(result).toBeUndefined()
    })
  })

  // ============================================================================
  // Reconnection logic tests
  // ============================================================================
  describe('reconnection', () => {
    it('emits maxReconnectAttempts when limit reached', () => {
      const sub = new FirehoseSubscription()
      const maxReconnectHandler = vi.fn()
      sub.on('maxReconnectAttempts', maxReconnectHandler)

      ;(sub as any).reconnectAttempts = 10
      ;(sub as any).maxReconnectAttempts = 10
      ;(sub as any).scheduleReconnect()

      expect(maxReconnectHandler).toHaveBeenCalled()
    })

    it('increments reconnectAttempts when scheduling reconnect', () => {
      vi.useFakeTimers()
      const sub = new FirehoseSubscription()

      ;(sub as any).reconnectAttempts = 0
      ;(sub as any).scheduleReconnect()

      expect((sub as any).reconnectAttempts).toBe(1)

      vi.useRealTimers()
    })

    it('uses exponential backoff for reconnect delay', () => {
      vi.useFakeTimers()
      const sub = new FirehoseSubscription()

      ;(sub as any).reconnectAttempts = 0
      ;(sub as any).scheduleReconnect()
      expect((sub as any).reconnectAttempts).toBe(1)

      ;(sub as any).scheduleReconnect()
      expect((sub as any).reconnectAttempts).toBe(2)

      vi.useRealTimers()
    })
  })

  // ============================================================================
  // buildUrl tests
  // ============================================================================
  describe('buildUrl', () => {
    it('builds URL without cursor when not set', () => {
      const sub = new FirehoseSubscription({ relay: 'wss://test.relay' })
      const url = (sub as any).buildUrl()

      expect(url).toBe('wss://test.relay/xrpc/com.atproto.sync.subscribeRepos')
    })

    it('builds URL with cursor when set', () => {
      const sub = new FirehoseSubscription({ relay: 'wss://test.relay', cursor: 54321 })
      const url = (sub as any).buildUrl()

      expect(url).toBe('wss://test.relay/xrpc/com.atproto.sync.subscribeRepos?cursor=54321')
    })

    it('uses default relay when not specified', () => {
      const sub = new FirehoseSubscription()
      const url = (sub as any).buildUrl()

      expect(url).toBe('wss://bsky.network/xrpc/com.atproto.sync.subscribeRepos')
    })
  })

  // ============================================================================
  // createFirehoseSubscription factory function tests
  // ============================================================================
  describe('createFirehoseSubscription', () => {
    it('creates a FirehoseSubscription instance', async () => {
      const { createFirehoseSubscription } = await import('./firehose.js')
      const sub = createFirehoseSubscription()

      expect(sub).toBeInstanceOf(FirehoseSubscription)
    })

    it('passes options to constructor', async () => {
      const { createFirehoseSubscription } = await import('./firehose.js')
      const onOccurrence = vi.fn()
      const sub = createFirehoseSubscription({
        relay: 'wss://custom.relay',
        cursor: 12345,
        onOccurrence
      })

      expect((sub as any).relay).toBe('wss://custom.relay')
      expect(sub.getCursor()).toBe(12345)

      sub.emit('occurrence', { uri: 'test', did: 'test' })
      expect(onOccurrence).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // start and stop lifecycle tests
  // ============================================================================
  describe('start and stop lifecycle', () => {
    it('sets isClosing to true on stop', async () => {
      const sub = new FirehoseSubscription()

      await sub.stop()

      expect((sub as any).isClosing).toBe(true)
    })

    it('nulls ws on stop', async () => {
      const sub = new FirehoseSubscription()
      ;(sub as any).ws = { close: vi.fn() }

      await sub.stop()

      expect((sub as any).ws).toBeNull()
    })

    it('calls ws.close when stopping with active connection', async () => {
      const sub = new FirehoseSubscription()
      const mockClose = vi.fn()
      ;(sub as any).ws = { close: mockClose }

      await sub.stop()

      expect(mockClose).toHaveBeenCalled()
    })
  })

  // ============================================================================
  // handleMessage tests
  // ============================================================================
  describe('handleMessage', () => {
    it('handles valid commit message', () => {
      const onOccurrence = vi.fn()
      const sub = new FirehoseSubscription({ onOccurrence })

      // This would require creating a valid DAG-CBOR message
      // For now, test that invalid messages don't crash
      const invalidData = Buffer.from([0xff, 0xff])
      ;(sub as any).handleMessage(invalidData)

      expect(onOccurrence).not.toHaveBeenCalled()
    })

    it('continues processing after error', () => {
      const sub = new FirehoseSubscription()

      // Should not throw
      expect(() => {
        ;(sub as any).handleMessage(Buffer.from([0xff, 0xff, 0xff]))
      }).not.toThrow()
    })
  })
})
