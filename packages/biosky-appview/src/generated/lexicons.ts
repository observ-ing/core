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
  OrgRwellTestComment: {
    lexicon: 1,
    id: 'org.rwell.test.comment',
    defs: {
      main: {
        type: 'record',
        description:
          'A comment on an observation. Used for general discussion, questions, or additional context about an observation.',
        key: 'tid',
        record: {
          type: 'object',
          required: ['subject', 'body', 'createdAt'],
          properties: {
            subject: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description:
                'A strong reference (CID + URI) to the observation being commented on.',
            },
            body: {
              type: 'string',
              description: 'The text content of the comment.',
              maxLength: 3000,
            },
            replyTo: {
              type: 'ref',
              ref: 'lex:com.atproto.repo.strongRef',
              description:
                'Optional reference to another comment this is replying to, for threaded discussions.',
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
              description: 'Timestamp when this comment was created.',
            },
          },
        },
      },
    },
  },
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
            taxonId: {
              type: 'string',
              description:
                '[DEPRECATED: Use kingdom + scientificName for taxon resolution] External taxon identifier (e.g., gbif:2878688). Prefixed with source.',
              maxLength: 64,
            },
            vernacularName: {
              type: 'string',
              description:
                "Common name for the taxon in the identifier's language.",
              maxLength: 256,
            },
            kingdom: {
              type: 'string',
              description: 'Taxonomic kingdom (e.g., Animalia, Plantae).',
              maxLength: 64,
            },
            phylum: {
              type: 'string',
              description: 'Taxonomic phylum.',
              maxLength: 64,
            },
            class: {
              type: 'string',
              description: 'Taxonomic class.',
              maxLength: 64,
            },
            order: {
              type: 'string',
              description: 'Taxonomic order.',
              maxLength: 64,
            },
            family: {
              type: 'string',
              description: 'Taxonomic family.',
              maxLength: 64,
            },
            genus: {
              type: 'string',
              description: 'Taxonomic genus.',
              maxLength: 64,
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
          required: ['eventDate', 'location', 'createdAt'],
          properties: {
            scientificName: {
              type: 'string',
              description:
                '[DEPRECATED: Use identification records instead] The full scientific name of the observed organism, following Darwin Core dwc:scientificName.',
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
            license: {
              type: 'string',
              description:
                'SPDX license identifier for this observation (maps to Dublin Core dcterms:license).',
              knownValues: [
                'CC0-1.0',
                'CC-BY-4.0',
                'CC-BY-NC-4.0',
                'CC-BY-SA-4.0',
                'CC-BY-NC-SA-4.0',
              ],
              maxLength: 32,
            },
            createdAt: {
              type: 'string',
              format: 'datetime',
              description: 'Timestamp when this record was created.',
            },
            taxonId: {
              type: 'string',
              description:
                '[DEPRECATED: Use identification records instead] External taxon identifier (e.g., gbif:2878688). Prefixed with source.',
              maxLength: 64,
            },
            taxonRank: {
              type: 'string',
              description:
                '[DEPRECATED: Use identification records instead] The taxonomic rank of the scientific name (e.g., species, genus, family).',
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
            vernacularName: {
              type: 'string',
              description:
                '[DEPRECATED: Use identification records instead] Common name for the taxon (Darwin Core dwc:vernacularName).',
              maxLength: 256,
            },
            kingdom: {
              type: 'string',
              description:
                '[DEPRECATED: Use identification records instead] Taxonomic kingdom (e.g., Animalia, Plantae) (Darwin Core dwc:kingdom).',
              maxLength: 64,
            },
            phylum: {
              type: 'string',
              description:
                '[DEPRECATED: Use identification records instead] Taxonomic phylum (Darwin Core dwc:phylum).',
              maxLength: 64,
            },
            class: {
              type: 'string',
              description:
                '[DEPRECATED: Use identification records instead] Taxonomic class (Darwin Core dwc:class).',
              maxLength: 64,
            },
            order: {
              type: 'string',
              description:
                '[DEPRECATED: Use identification records instead] Taxonomic order (Darwin Core dwc:order).',
              maxLength: 64,
            },
            family: {
              type: 'string',
              description:
                '[DEPRECATED: Use identification records instead] Taxonomic family (Darwin Core dwc:family).',
              maxLength: 64,
            },
            genus: {
              type: 'string',
              description:
                '[DEPRECATED: Use identification records instead] Taxonomic genus (Darwin Core dwc:genus).',
              maxLength: 64,
            },
            recordedBy: {
              type: 'array',
              description:
                'DIDs of co-observers who participated in this observation. The record creator is the primary observer.',
              items: {
                type: 'string',
              },
              maxLength: 10,
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
          continent: {
            type: 'string',
            description:
              'The name of the continent (Darwin Core dwc:continent).',
            knownValues: [
              'Africa',
              'Antarctica',
              'Asia',
              'Europe',
              'North America',
              'Oceania',
              'South America',
            ],
            maxLength: 32,
          },
          country: {
            type: 'string',
            description:
              'The name of the country or major administrative unit (Darwin Core dwc:country).',
            maxLength: 128,
          },
          countryCode: {
            type: 'string',
            description:
              'The standard code for the country (Darwin Core dwc:countryCode). ISO 3166-1-alpha-2.',
            maxLength: 2,
          },
          stateProvince: {
            type: 'string',
            description:
              'The name of the next smaller administrative region than country (Darwin Core dwc:stateProvince).',
            maxLength: 128,
          },
          county: {
            type: 'string',
            description:
              'The full, unabbreviated name of the next smaller administrative region than stateProvince (Darwin Core dwc:county).',
            maxLength: 128,
          },
          municipality: {
            type: 'string',
            description:
              'The full, unabbreviated name of the next smaller administrative region than county (Darwin Core dwc:municipality).',
            maxLength: 128,
          },
          locality: {
            type: 'string',
            description:
              'The specific description of the place (Darwin Core dwc:locality).',
            maxLength: 512,
          },
          waterBody: {
            type: 'string',
            description:
              'The name of the water body in which the location occurs (Darwin Core dwc:waterBody).',
            maxLength: 128,
          },
          minimumElevationInMeters: {
            type: 'string',
            description:
              'The lower limit of the range of elevation in meters (Darwin Core dwc:minimumElevationInMeters).',
          },
          maximumElevationInMeters: {
            type: 'string',
            description:
              'The upper limit of the range of elevation in meters (Darwin Core dwc:maximumElevationInMeters).',
          },
          minimumDepthInMeters: {
            type: 'string',
            description:
              'The lesser depth of a range of depth below the local surface in meters (Darwin Core dwc:minimumDepthInMeters).',
          },
          maximumDepthInMeters: {
            type: 'string',
            description:
              'The greater depth of a range of depth below the local surface in meters (Darwin Core dwc:maximumDepthInMeters).',
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
  OrgRwellTestComment: 'org.rwell.test.comment',
  OrgRwellTestIdentification: 'org.rwell.test.identification',
  OrgRwellTestLike: 'org.rwell.test.like',
  OrgRwellTestOccurrence: 'org.rwell.test.occurrence',
} as const
