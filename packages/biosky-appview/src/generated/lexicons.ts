/**
 * GENERATED CODE - DO NOT MODIFY
 */
import {
  type LexiconDoc,
  Lexicons,
  ValidationError,
  type ValidationResult,
} from '@atproto/lexicon'
import { type $Typed, is$typed, maybe$typed } from './util.js'

export const schemaDict = {
  OrgRwellTestIdentification: {
    lexicon: 1,
    id: 'org.rwell.test.identification',
    defs: {
      main: {
        type: 'record',
        description:
          'An identification suggestion for an existing observation. Used to propose or agree with a taxonomic identification.',
        key: 'tid',
        record: {
          type: 'object',
          required: ['subject', 'taxonName', 'createdAt'],
          properties: {
            subject: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description:
                'A strong reference (CID + URI) to the observation being identified.',
            },
            subjectIndex: {
              type: 'integer',
              description:
                'Index of the subject within the occurrence being identified. When multiple organisms are photographed together (e.g., butterfly on a flower), each gets a unique index starting from 0. Creating an identification with a new subjectIndex implicitly creates that subject.',
              minimum: 0,
              maximum: 99,
              default: 0,
            },
            taxonName: {
              type: 'string',
              description:
                'The scientific name being proposed for the observation.',
              maxLength: 256,
            },
            taxonRank: {
              type: 'string',
              description:
                'The taxonomic rank of the identification (e.g., species, genus, family).',
              knownValues: [
                'kingdom',
                'phylum',
                'class',
                'order',
                'family',
                'genus',
                'species',
                'subspecies',
                'variety',
                'form',
              ],
              default: 'species',
              maxLength: 32,
            },
            comment: {
              type: 'string',
              description: 'Explanation or reasoning for this identification.',
              maxLength: 3000,
            },
            isAgreement: {
              type: 'boolean',
              description:
                'If true, this identification agrees with the current community ID rather than proposing a new one.',
              default: false,
            },
            confidence: {
              type: 'string',
              description:
                "The identifier's confidence level in this identification.",
              enum: ['low', 'medium', 'high'],
              default: 'medium',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
              description: 'Timestamp when this identification was created.',
            },
          },
        },
      },
    },
  },
  OrgRwellTestLike: {
    lexicon: 1,
    id: 'org.rwell.test.like',
    defs: {
      main: {
        type: 'record',
        description: 'Record expressing appreciation of an observation.',
        key: 'tid',
        record: {
          type: 'object',
          required: ['subject', 'createdAt'],
          properties: {
            subject: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description: 'A strong reference to the observation being liked.',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
              description: 'Timestamp when this like was created.',
            },
          },
        },
      },
    },
  },
  OrgRwellTestOccurrence: {
    lexicon: 1,
    id: 'org.rwell.test.occurrence',
    defs: {
      main: {
        type: 'record',
        description:
          'A biodiversity observation record following Darwin Core standards. Represents a single occurrence of an organism at a specific place and time.',
        key: 'tid',
        record: {
          type: 'object',
          required: ['scientificName', 'eventDate', 'location', 'createdAt'],
          properties: {
            scientificName: {
              type: 'string',
              description:
                'The full scientific name of the observed organism, following Darwin Core dwc:scientificName.',
              maxLength: 256,
            },
            eventDate: {
              type: 'string',
              format: 'datetime',
              description:
                'The date-time when the observation occurred, in ISO 8601 format (Darwin Core dwc:eventDate).',
            },
            location: {
              type: 'ref',
              ref: 'lex:org.rwell.test.occurrence#location',
              description:
                'Geographic location information for the observation.',
            },
            verbatimLocality: {
              type: 'string',
              description:
                'The original textual description of the place (Darwin Core dwc:verbatimLocality).',
              maxLength: 1024,
            },
            blobs: {
              type: 'array',
              description:
                'Array of image references documenting the observation.',
              items: {
                type: 'ref',
                ref: 'lex:org.rwell.test.occurrence#imageEmbed',
              },
              maxLength: 10,
            },
            notes: {
              type: 'string',
              description:
                'Additional notes or comments about the observation.',
              maxLength: 3000,
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
              description: 'Timestamp when this record was created.',
            },
          },
        },
      },
      location: {
        type: 'object',
        description: 'Geographic coordinates following Darwin Core standards.',
        required: ['decimalLatitude', 'decimalLongitude'],
        properties: {
          decimalLatitude: {
            type: 'string',
            description:
              'The geographic latitude in decimal degrees (Darwin Core dwc:decimalLatitude). Valid range: -90 to 90.',
          },
          decimalLongitude: {
            type: 'string',
            description:
              'The geographic longitude in decimal degrees (Darwin Core dwc:decimalLongitude). Valid range: -180 to 180.',
          },
          coordinateUncertaintyInMeters: {
            type: 'integer',
            description:
              'The horizontal distance (in meters) from the given coordinates describing the smallest circle containing the whole of the Location (Darwin Core dwc:coordinateUncertaintyInMeters).',
            minimum: 0,
          },
          geodeticDatum: {
            type: 'string',
            description:
              'The ellipsoid, geodetic datum, or spatial reference system used (Darwin Core dwc:geodeticDatum). Defaults to WGS84.',
            default: 'WGS84',
            maxLength: 64,
          },
        },
      },
      imageEmbed: {
        type: 'object',
        description: 'A reference to an uploaded image blob.',
        required: ['image', 'alt'],
        properties: {
          image: {
            type: 'blob',
            accept: ['image/jpeg', 'image/png', 'image/webp'],
            maxSize: 10000000,
            description: 'The image blob reference.',
          },
          alt: {
            type: 'string',
            description: 'Alt text description of the image for accessibility.',
            maxLength: 1000,
          },
          aspectRatio: {
            type: 'ref',
            ref: 'lex:org.rwell.test.occurrence#aspectRatio',
          },
        },
      },
      aspectRatio: {
        type: 'object',
        description:
          'Width and height of an image, used for proper display before loading.',
        required: ['width', 'height'],
        properties: {
          width: {
            type: 'integer',
            minimum: 1,
          },
          height: {
            type: 'integer',
            minimum: 1,
          },
        },
      },
    },
  },
} as const satisfies Record<string, LexiconDoc>
export const schemas = Object.values(schemaDict) satisfies LexiconDoc[]
export const lexicons: Lexicons = new Lexicons(schemas)

export function validate<T extends { $type: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType: true,
): ValidationResult<T>
export function validate<T extends { $type?: string }>(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: false,
): ValidationResult<T>
export function validate(
  v: unknown,
  id: string,
  hash: string,
  requiredType?: boolean,
): ValidationResult {
  return (requiredType ? is$typed : maybe$typed)(v, id, hash)
    ? lexicons.validate(`${id}#${hash}`, v)
    : {
        success: false,
        error: new ValidationError(
          `Must be an object with "${hash === 'main' ? id : `${id}#${hash}`}" $type property`,
        ),
      }
}

export const ids = {
  OrgRwellTestIdentification: 'org.rwell.test.identification',
  OrgRwellTestLike: 'org.rwell.test.like',
  OrgRwellTestOccurrence: 'org.rwell.test.occurrence',
} as const
