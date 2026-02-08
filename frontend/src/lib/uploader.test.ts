import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OccurrenceUploader } from './uploader.js'
import type { AtpAgent } from '@atproto/api'

// Mock File class for Node.js environment
class MockFile {
  name: string
  type: string
  size: number
  lastModified: number

  constructor(
    parts: BlobPart[],
    name: string,
    options: { type?: string; lastModified?: number } = {}
  ) {
    this.name = name
    this.type = options.type || ''
    this.lastModified = options.lastModified || Date.now()
    // Calculate size from parts
    this.size = parts.reduce((acc, part) => {
      if (typeof part === 'string') return acc + part.length
      if (part instanceof ArrayBuffer) return acc + part.byteLength
      return acc
    }, 0)
  }

  async arrayBuffer(): Promise<ArrayBuffer> {
    return new ArrayBuffer(this.size)
  }
}

// Helper to create mock files
function createMockFile(
  name: string,
  type: string,
  sizeInBytes: number
): File {
  const file = new MockFile(['x'.repeat(sizeInBytes)], name, { type }) as unknown as File
  return file
}

// Helper to create valid occurrence data
function createValidOccurrence(overrides: Partial<Parameters<OccurrenceUploader['upload']>[0]> = {}) {
  return {
    eventDate: '2024-06-15',
    location: {
      decimalLatitude: 40.7128,
      decimalLongitude: -74.006
    },
    images: [createMockFile('photo.jpg', 'image/jpeg', 1000)],
    ...overrides
  }
}

describe('OccurrenceUploader', () => {
  let mockAgent: Partial<AtpAgent>
  let uploader: OccurrenceUploader

  beforeEach(() => {
    mockAgent = {
      session: { did: 'did:plc:test', handle: 'test.bsky.social' } as AtpAgent['session'],
      uploadBlob: vi.fn().mockResolvedValue({
        data: { blob: { ref: { $link: 'blobref' }, mimeType: 'image/jpeg', size: 1000 } }
      }),
      com: {
        atproto: {
          repo: {
            createRecord: vi.fn().mockResolvedValue({
              data: { uri: 'at://did:plc:test/org.rwell.test.occurrence/1', cid: 'test-cid' }
            })
          }
        }
      } as unknown as AtpAgent['com']
    }
    uploader = new OccurrenceUploader(mockAgent as AtpAgent)
  })

  describe('validateOccurrence', () => {
    describe('eventDate validation', () => {
      it('throws if eventDate is missing', async () => {
        const data = createValidOccurrence({ eventDate: '' })

        await expect(uploader.upload(data)).rejects.toThrow('Event date is required')
      })

      it('throws if eventDate is invalid format', async () => {
        const data = createValidOccurrence({ eventDate: 'not-a-date' })

        await expect(uploader.upload(data)).rejects.toThrow('Invalid event date format')
      })

      it('throws if eventDate is in the future', async () => {
        const futureDate = new Date()
        futureDate.setFullYear(futureDate.getFullYear() + 1)
        const data = createValidOccurrence({ eventDate: futureDate.toISOString() })

        await expect(uploader.upload(data)).rejects.toThrow('Event date cannot be in the future')
      })

      it('accepts valid past date', async () => {
        const data = createValidOccurrence({ eventDate: '2020-01-15' })

        await uploader.upload(data)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })

      it('accepts today\'s date', async () => {
        const today = new Date().toISOString().split('T')[0]
        const data = createValidOccurrence({ eventDate: today })

        await uploader.upload(data)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })
    })

    describe('location validation', () => {
      it('throws if location is missing', async () => {
        const data = createValidOccurrence()
        // @ts-expect-error - intentionally setting to undefined for test
        data.location = undefined

        await expect(uploader.upload(data)).rejects.toThrow('Location is required')
      })

      it('throws if latitude is below -90', async () => {
        const data = createValidOccurrence({
          location: { decimalLatitude: -91, decimalLongitude: 0 }
        })

        await expect(uploader.upload(data)).rejects.toThrow('Latitude must be between -90 and 90')
      })

      it('throws if latitude is above 90', async () => {
        const data = createValidOccurrence({
          location: { decimalLatitude: 91, decimalLongitude: 0 }
        })

        await expect(uploader.upload(data)).rejects.toThrow('Latitude must be between -90 and 90')
      })

      it('throws if longitude is below -180', async () => {
        const data = createValidOccurrence({
          location: { decimalLatitude: 0, decimalLongitude: -181 }
        })

        await expect(uploader.upload(data)).rejects.toThrow('Longitude must be between -180 and 180')
      })

      it('throws if longitude is above 180', async () => {
        const data = createValidOccurrence({
          location: { decimalLatitude: 0, decimalLongitude: 181 }
        })

        await expect(uploader.upload(data)).rejects.toThrow('Longitude must be between -180 and 180')
      })

      it('accepts latitude at boundary -90', async () => {
        const data = createValidOccurrence({
          location: { decimalLatitude: -90, decimalLongitude: 0 }
        })

        await uploader.upload(data)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })

      it('accepts latitude at boundary 90', async () => {
        const data = createValidOccurrence({
          location: { decimalLatitude: 90, decimalLongitude: 0 }
        })

        await uploader.upload(data)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })

      it('accepts longitude at boundary -180', async () => {
        const data = createValidOccurrence({
          location: { decimalLatitude: 0, decimalLongitude: -180 }
        })

        await uploader.upload(data)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })

      it('accepts longitude at boundary 180', async () => {
        const data = createValidOccurrence({
          location: { decimalLatitude: 0, decimalLongitude: 180 }
        })

        await uploader.upload(data)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })
    })

    describe('images validation', () => {
      it('throws if no images provided', async () => {
        const data = createValidOccurrence({ images: [] })

        await expect(uploader.upload(data)).rejects.toThrow('At least one photo is required')
      })

      it('throws if image type is invalid', async () => {
        const data = createValidOccurrence({
          images: [createMockFile('document.pdf', 'application/pdf', 1000)]
        })

        await expect(uploader.upload(data)).rejects.toThrow('Invalid image type: application/pdf')
      })

      it('throws if image type is gif (not allowed)', async () => {
        const data = createValidOccurrence({
          images: [createMockFile('animation.gif', 'image/gif', 1000)]
        })

        await expect(uploader.upload(data)).rejects.toThrow('Invalid image type: image/gif')
      })

      it('throws if image is too large (>10MB)', async () => {
        const largeSize = 11 * 1024 * 1024 // 11MB
        const data = createValidOccurrence({
          images: [createMockFile('huge.jpg', 'image/jpeg', largeSize)]
        })

        await expect(uploader.upload(data)).rejects.toThrow('Image file too large (max 10MB)')
      })

      it('accepts jpeg images', async () => {
        const data = createValidOccurrence({
          images: [createMockFile('photo.jpg', 'image/jpeg', 1000)]
        })

        await uploader.upload(data)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })

      it('accepts png images', async () => {
        const data = createValidOccurrence({
          images: [createMockFile('photo.png', 'image/png', 1000)]
        })

        await uploader.upload(data)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })

      it('accepts webp images', async () => {
        const data = createValidOccurrence({
          images: [createMockFile('photo.webp', 'image/webp', 1000)]
        })

        await uploader.upload(data)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })

      it('accepts image at exactly 10MB', async () => {
        const exactSize = 10 * 1024 * 1024 // exactly 10MB
        const data = createValidOccurrence({
          images: [createMockFile('maxsize.jpg', 'image/jpeg', exactSize)]
        })

        await uploader.upload(data)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })

      it('accepts multiple valid images', async () => {
        const data = createValidOccurrence({
          images: [
            createMockFile('photo1.jpg', 'image/jpeg', 1000),
            createMockFile('photo2.png', 'image/png', 2000),
            createMockFile('photo3.webp', 'image/webp', 3000)
          ]
        })

        await uploader.upload(data)

        expect(mockAgent.uploadBlob).toHaveBeenCalledTimes(3)
      })

      it('throws if any image in array is invalid type', async () => {
        const data = createValidOccurrence({
          images: [
            createMockFile('photo1.jpg', 'image/jpeg', 1000),
            createMockFile('document.pdf', 'application/pdf', 1000)
          ]
        })

        await expect(uploader.upload(data)).rejects.toThrow('Invalid image type: application/pdf')
      })

      it('throws if any image in array is too large', async () => {
        const data = createValidOccurrence({
          images: [
            createMockFile('small.jpg', 'image/jpeg', 1000),
            createMockFile('huge.jpg', 'image/jpeg', 11 * 1024 * 1024)
          ]
        })

        await expect(uploader.upload(data)).rejects.toThrow('Image file too large (max 10MB)')
      })
    })

    describe('successful upload', () => {
      it('returns uri and cid on successful upload', async () => {
        const data = createValidOccurrence()

        const result = await uploader.upload(data)

        expect(result).toEqual({
          uri: 'at://did:plc:test/org.rwell.test.occurrence/1',
          cid: 'test-cid'
        })
      })

      it('includes optional fields in record', async () => {
        const data = createValidOccurrence({
          scientificName: 'Quercus alba',
          basisOfRecord: 'HumanObservation',
          verbatimLocality: 'Central Park, NYC',
          habitat: 'Urban forest',
          occurrenceRemarks: 'Large mature tree'
        })

        await uploader.upload(data)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalledWith(
          expect.objectContaining({
            record: expect.objectContaining({
              scientificName: 'Quercus alba',
              basisOfRecord: 'HumanObservation',
              verbatimLocality: 'Central Park, NYC',
              habitat: 'Urban forest',
              occurrenceRemarks: 'Large mature tree'
            })
          })
        )
      })
    })
  })

  describe('extractExif', () => {
    // Helper to create a mock file with specific bytes
    function createMockFileWithBytes(bytes: number[], lastModified?: number): File {
      const buffer = new ArrayBuffer(bytes.length)
      const view = new Uint8Array(buffer)
      bytes.forEach((b, i) => { view[i] = b })

      const file = {
        name: 'test.jpg',
        type: 'image/jpeg',
        size: bytes.length,
        lastModified: lastModified || Date.now(),
        arrayBuffer: () => Promise.resolve(buffer)
      } as unknown as File

      return file
    }

    it('returns empty object for non-JPEG file', async () => {
      // PNG file signature (not JPEG)
      const pngFile = createMockFileWithBytes([0x89, 0x50, 0x4e, 0x47])

      const result = await uploader.extractExif(pngFile)

      expect(result).toEqual({})
    })

    it('returns dateTime from lastModified when no EXIF', async () => {
      // Valid JPEG without EXIF data
      const lastModified = new Date('2024-01-15T10:30:00Z').getTime()
      const jpegNoExif = createMockFileWithBytes([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10], lastModified)

      const result = await uploader.extractExif(jpegNoExif)

      expect(result.dateTime).toEqual(new Date(lastModified))
    })

    it('handles JPEG with EXIF marker', async () => {
      // JPEG with EXIF marker 0xffe1
      const jpegWithExif = createMockFileWithBytes([
        0xff, 0xd8, // JPEG SOI
        0xff, 0xe1, // EXIF marker
        0x00, 0x08, // length
        0x45, 0x78, 0x69, 0x66, 0x00, 0x00 // "Exif\0\0"
      ])

      const result = await uploader.extractExif(jpegWithExif)

      // Should parse without error, even if EXIF data is incomplete
      expect(result).toBeDefined()
    })

    it('handles JPEG with non-EXIF marker before EXIF', async () => {
      // JPEG with APP0 (0xffe0) before EXIF
      const lastModified = new Date('2024-03-20T15:00:00Z').getTime()
      const jpegWithApp0 = createMockFileWithBytes([
        0xff, 0xd8, // JPEG SOI
        0xff, 0xe0, // APP0 marker
        0x00, 0x04, // length = 4 (including length bytes)
        0x00, 0x00, // data
        0xff, 0xe1, // EXIF marker
        0x00, 0x08, // length
        0x45, 0x78, 0x69, 0x66, 0x00, 0x00 // "Exif\0\0"
      ], lastModified)

      const result = await uploader.extractExif(jpegWithApp0)

      // Should fallback to lastModified if no EXIF datetime found
      expect(result.dateTime).toEqual(new Date(lastModified))
    })

    it('handles error during parsing gracefully', async () => {
      const errorFile = {
        name: 'test.jpg',
        type: 'image/jpeg',
        size: 100,
        lastModified: Date.now(),
        arrayBuffer: () => Promise.reject(new Error('Read error'))
      } as unknown as File

      const result = await uploader.extractExif(errorFile)

      expect(result).toEqual({})
    })

    it('handles very short JPEG file', async () => {
      const shortJpeg = createMockFileWithBytes([0xff, 0xd8])

      const result = await uploader.extractExif(shortJpeg)

      // Should not crash, may return empty or partial data
      expect(result).toBeDefined()
    })
  })

  describe('compressImage', () => {
    // Note: compressImage uses browser APIs (Image, canvas) which aren't available in Node
    // These tests verify the method exists and document expected behavior
    // Full testing would require jsdom or a browser environment

    it('method exists on uploader', () => {
      expect(typeof uploader.compressImage).toBe('function')
    })

    // In a browser environment, we would test:
    // - Image scaling when width > maxWidth
    // - Quality parameter affects output size
    // - Returns a File with type image/jpeg
    // - Rejects when image fails to load
    // - Rejects when canvas.toBlob returns null
  })
})
