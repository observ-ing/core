import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IdentificationService } from './identification.js'
import type { AtpAgent } from '@atproto/api'

describe('IdentificationService', () => {
  let mockAgent: Partial<AtpAgent>
  let service: IdentificationService

  beforeEach(() => {
    mockAgent = {
      session: { did: 'did:plc:test', handle: 'test.bsky.social' } as AtpAgent['session'],
      com: {
        atproto: {
          repo: {
            createRecord: vi.fn().mockResolvedValue({
              data: { uri: 'at://did:plc:test/org.rwell.test.identification/1', cid: 'test-cid' }
            }),
            deleteRecord: vi.fn().mockResolvedValue({}),
            getRecord: vi.fn().mockResolvedValue({
              data: {
                value: {
                  $type: 'org.rwell.test.identification',
                  subject: { uri: 'at://did:plc:test/org.rwell.test.occurrence/1', cid: 'subject-cid' },
                  taxonName: 'Quercus alba',
                  taxonRank: 'species',
                  createdAt: '2024-01-01T00:00:00Z'
                }
              }
            }),
            putRecord: vi.fn().mockResolvedValue({
              data: { uri: 'at://did:plc:test/org.rwell.test.identification/1', cid: 'new-cid' }
            }),
            listRecords: vi.fn().mockResolvedValue({
              data: { records: [] }
            })
          }
        }
      } as unknown as AtpAgent['com']
    }
    service = new IdentificationService(mockAgent as AtpAgent)
  })

  describe('validateInput', () => {
    const validInput = {
      occurrenceUri: 'at://did:plc:test/org.rwell.test.occurrence/1',
      occurrenceCid: 'bafyrei123',
      taxonName: 'Quercus alba'
    }

    describe('occurrenceUri validation', () => {
      it('throws if occurrenceUri is missing', async () => {
        await expect(
          service.identify({ ...validInput, occurrenceUri: '' })
        ).rejects.toThrow('Occurrence URI is required')
      })

      it('throws if occurrenceUri does not start with at://', async () => {
        await expect(
          service.identify({ ...validInput, occurrenceUri: 'https://example.com/post' })
        ).rejects.toThrow('Invalid occurrence URI format')
      })

      it('throws for http:// URIs', async () => {
        await expect(
          service.identify({ ...validInput, occurrenceUri: 'http://did:plc:test/post' })
        ).rejects.toThrow('Invalid occurrence URI format')
      })

      it('accepts valid at:// URI', async () => {
        await service.identify(validInput)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })
    })

    describe('occurrenceCid validation', () => {
      it('throws if occurrenceCid is missing', async () => {
        await expect(
          service.identify({ ...validInput, occurrenceCid: '' })
        ).rejects.toThrow('Occurrence CID is required')
      })

      it('accepts valid CID', async () => {
        await service.identify(validInput)

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })
    })

    describe('taxonName validation', () => {
      it('throws if taxonName is missing', async () => {
        await expect(
          service.identify({ ...validInput, taxonName: '' })
        ).rejects.toThrow('Taxon name is required')
      })

      it('throws if taxonName is whitespace only', async () => {
        await expect(
          service.identify({ ...validInput, taxonName: '   ' })
        ).rejects.toThrow('Taxon name is required')
      })

      it('throws if taxonName exceeds 256 characters', async () => {
        const longName = 'A'.repeat(257)
        await expect(
          service.identify({ ...validInput, taxonName: longName })
        ).rejects.toThrow('Taxon name too long (max 256 characters)')
      })

      it('accepts taxonName at exactly 256 characters', async () => {
        const maxName = 'A'.repeat(256)
        await service.identify({ ...validInput, taxonName: maxName })

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })

      it('accepts typical species name', async () => {
        await service.identify({ ...validInput, taxonName: 'Homo sapiens' })

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })

      it('accepts subspecies with three parts', async () => {
        await service.identify({ ...validInput, taxonName: 'Canis lupus familiaris' })

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })
    })

    describe('comment validation', () => {
      it('throws if comment exceeds 3000 characters', async () => {
        const longComment = 'A'.repeat(3001)
        await expect(
          service.identify({ ...validInput, comment: longComment })
        ).rejects.toThrow('Comment too long (max 3000 characters)')
      })

      it('accepts comment at exactly 3000 characters', async () => {
        const maxComment = 'A'.repeat(3000)
        await service.identify({ ...validInput, comment: maxComment })

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })

      it('accepts empty comment (optional field)', async () => {
        await service.identify({ ...validInput, comment: undefined })

        expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalled()
      })
    })
  })

  describe('identify', () => {
    it('throws if not logged in', async () => {
      const noSessionAgent = { session: undefined } as AtpAgent
      const noSessionService = new IdentificationService(noSessionAgent)

      await expect(
        noSessionService.identify({
          occurrenceUri: 'at://did:plc:test/org.rwell.test.occurrence/1',
          occurrenceCid: 'bafyrei123',
          taxonName: 'Quercus alba'
        })
      ).rejects.toThrow('Not logged in')
    })

    it('returns uri and cid on success', async () => {
      const result = await service.identify({
        occurrenceUri: 'at://did:plc:test/org.rwell.test.occurrence/1',
        occurrenceCid: 'bafyrei123',
        taxonName: 'Quercus alba'
      })

      expect(result).toEqual({
        uri: 'at://did:plc:test/org.rwell.test.identification/1',
        cid: 'test-cid'
      })
    })

    it('creates record with correct structure', async () => {
      await service.identify({
        occurrenceUri: 'at://did:plc:test/org.rwell.test.occurrence/1',
        occurrenceCid: 'bafyrei123',
        taxonName: 'Quercus alba',
        taxonRank: 'species',
        comment: 'Distinctive bark pattern',
        isAgreement: true,
        confidence: 'high'
      })

      expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'did:plc:test',
          collection: 'org.rwell.test.identification',
          record: expect.objectContaining({
            $type: 'org.rwell.test.identification',
            subject: {
              uri: 'at://did:plc:test/org.rwell.test.occurrence/1',
              cid: 'bafyrei123'
            },
            taxonName: 'Quercus alba',
            taxonRank: 'species',
            comment: 'Distinctive bark pattern',
            isAgreement: true,
            confidence: 'high'
          })
        })
      )
    })

    it('uses default values when optional fields not provided', async () => {
      await service.identify({
        occurrenceUri: 'at://did:plc:test/org.rwell.test.occurrence/1',
        occurrenceCid: 'bafyrei123',
        taxonName: 'Quercus alba'
      })

      expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            taxonRank: 'species', // default
            isAgreement: false, // default
            confidence: 'medium' // default
          })
        })
      )
    })
  })

  describe('agree', () => {
    it('creates an agreement identification', async () => {
      await service.agree(
        'at://did:plc:test/org.rwell.test.occurrence/1',
        'bafyrei123',
        'Quercus alba'
      )

      expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            taxonName: 'Quercus alba',
            isAgreement: true,
            confidence: 'high'
          })
        })
      )
    })
  })

  describe('suggestId', () => {
    it('creates a non-agreement identification', async () => {
      await service.suggestId(
        'at://did:plc:test/org.rwell.test.occurrence/1',
        'bafyrei123',
        'Quercus rubra'
      )

      expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            taxonName: 'Quercus rubra',
            isAgreement: false
          })
        })
      )
    })

    it('accepts optional parameters', async () => {
      await service.suggestId(
        'at://did:plc:test/org.rwell.test.occurrence/1',
        'bafyrei123',
        'Quercus rubra',
        {
          taxonRank: 'species',
          comment: 'Red oak based on leaf shape',
          confidence: 'high'
        }
      )

      expect(mockAgent.com!.atproto.repo.createRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            taxonName: 'Quercus rubra',
            taxonRank: 'species',
            comment: 'Red oak based on leaf shape',
            confidence: 'high'
          })
        })
      )
    })
  })

  describe('withdraw', () => {
    it('throws if not logged in', async () => {
      const noSessionAgent = { session: undefined } as AtpAgent
      const noSessionService = new IdentificationService(noSessionAgent)

      await expect(
        noSessionService.withdraw('at://did:plc:test/org.rwell.test.identification/abc123')
      ).rejects.toThrow('Not logged in')
    })

    it('extracts rkey from URI and deletes record', async () => {
      await service.withdraw('at://did:plc:test/org.rwell.test.identification/abc123')

      expect(mockAgent.com!.atproto.repo.deleteRecord).toHaveBeenCalledWith({
        repo: 'did:plc:test',
        collection: 'org.rwell.test.identification',
        rkey: 'abc123'
      })
    })
  })

  describe('update', () => {
    it('throws if not logged in', async () => {
      const noSessionAgent = { session: undefined } as AtpAgent
      const noSessionService = new IdentificationService(noSessionAgent)

      await expect(
        noSessionService.update('at://did:plc:test/org.rwell.test.identification/abc123', {
          taxonName: 'Quercus rubra'
        })
      ).rejects.toThrow('Not logged in')
    })

    it('fetches existing record and updates it', async () => {
      const result = await service.update(
        'at://did:plc:test/org.rwell.test.identification/abc123',
        { taxonName: 'Quercus rubra' }
      )

      expect(mockAgent.com!.atproto.repo.getRecord).toHaveBeenCalledWith({
        repo: 'did:plc:test',
        collection: 'org.rwell.test.identification',
        rkey: 'abc123'
      })
      expect(mockAgent.com!.atproto.repo.putRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          repo: 'did:plc:test',
          collection: 'org.rwell.test.identification',
          rkey: 'abc123',
          record: expect.objectContaining({
            taxonName: 'Quercus rubra'
          })
        })
      )
      expect(result).toEqual({
        uri: 'at://did:plc:test/org.rwell.test.identification/1',
        cid: 'new-cid'
      })
    })

    it('preserves existing fields when not updated', async () => {
      await service.update(
        'at://did:plc:test/org.rwell.test.identification/abc123',
        { comment: 'New comment' }
      )

      expect(mockAgent.com!.atproto.repo.putRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            taxonName: 'Quercus alba', // preserved from existing
            taxonRank: 'species', // preserved from existing
            comment: 'New comment' // updated
          })
        })
      )
    })

    it('updates confidence when provided', async () => {
      await service.update(
        'at://did:plc:test/org.rwell.test.identification/abc123',
        { confidence: 'low' }
      )

      expect(mockAgent.com!.atproto.repo.putRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            confidence: 'low'
          })
        })
      )
    })

    it('clears comment when set to empty string', async () => {
      await service.update(
        'at://did:plc:test/org.rwell.test.identification/abc123',
        { comment: '' }
      )

      expect(mockAgent.com!.atproto.repo.putRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          record: expect.objectContaining({
            comment: ''
          })
        })
      )
    })
  })

  describe('getMyIdentifications', () => {
    it('throws if not logged in', async () => {
      const noSessionAgent = { session: undefined } as AtpAgent
      const noSessionService = new IdentificationService(noSessionAgent)

      await expect(
        noSessionService.getMyIdentifications()
      ).rejects.toThrow('Not logged in')
    })

    it('lists records with default limit', async () => {
      await service.getMyIdentifications()

      expect(mockAgent.com!.atproto.repo.listRecords).toHaveBeenCalledWith({
        repo: 'did:plc:test',
        collection: 'org.rwell.test.identification',
        limit: 50
      })
    })

    it('lists records with custom limit', async () => {
      await service.getMyIdentifications(100)

      expect(mockAgent.com!.atproto.repo.listRecords).toHaveBeenCalledWith({
        repo: 'did:plc:test',
        collection: 'org.rwell.test.identification',
        limit: 100
      })
    })

    it('returns records from response', async () => {
      const mockRecords = [
        { uri: 'at://test/1', cid: 'cid1', value: { taxonName: 'Species A' } },
        { uri: 'at://test/2', cid: 'cid2', value: { taxonName: 'Species B' } }
      ]
      vi.mocked(mockAgent.com!.atproto.repo.listRecords).mockResolvedValueOnce({
        data: { records: mockRecords }
      } as never)

      const result = await service.getMyIdentifications()

      expect(result).toEqual(mockRecords)
    })
  })
})
