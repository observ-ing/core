/**
 * GENERATED CODE - DO NOT MODIFY
 */
import { type BlobRef } from '@atproto/lexicon'
import { validate as _validate } from '../../../../lexicons.js'
import {
  is$typed as _is$typed,
} from '../../../../util.js'

const is$typed = _is$typed,
  validate = _validate
const id = 'org.rwell.test.occurrence'

export interface Main {
  $type: 'org.rwell.test.occurrence'
  /** The full scientific name of the observed organism, following Darwin Core dwc:scientificName. */
  scientificName: string
  /** The date-time when the observation occurred, in ISO 8601 format (Darwin Core dwc:eventDate). */
  eventDate: string
  location: Location
  /** The original textual description of the place (Darwin Core dwc:verbatimLocality). */
  verbatimLocality?: string
  /** Array of image references documenting the observation. */
  blobs?: ImageEmbed[]
  /** Additional notes or comments about the observation. */
  notes?: string
  /** SPDX license identifier for this observation (maps to Dublin Core dcterms:license). */
  license?:
    | 'CC0-1.0'
    | 'CC-BY-4.0'
    | 'CC-BY-NC-4.0'
    | 'CC-BY-SA-4.0'
    | 'CC-BY-NC-SA-4.0'
    | (string & {})
  /** Timestamp when this record was created. */
  createdAt: string
  /** External taxon identifier (e.g., gbif:2878688). Prefixed with source. */
  taxonId?: string
  /** The taxonomic rank of the scientific name (e.g., species, genus, family). */
  taxonRank:
    | 'kingdom'
    | 'phylum'
    | 'class'
    | 'order'
    | 'family'
    | 'genus'
    | 'species'
    | 'subspecies'
    | 'variety'
    | 'form'
    | (string & {})
  /** Common name for the taxon (Darwin Core dwc:vernacularName). */
  vernacularName?: string
  /** Taxonomic kingdom (e.g., Animalia, Plantae) (Darwin Core dwc:kingdom). */
  kingdom?: string
  /** Taxonomic phylum (Darwin Core dwc:phylum). */
  phylum?: string
  /** Taxonomic class (Darwin Core dwc:class). */
  class?: string
  /** Taxonomic order (Darwin Core dwc:order). */
  order?: string
  /** Taxonomic family (Darwin Core dwc:family). */
  family?: string
  /** Taxonomic genus (Darwin Core dwc:genus). */
  genus?: string
  /** DIDs of co-observers who participated in this observation. The record creator is the primary observer. */
  recordedBy?: string[]
  [k: string]: unknown
}

const hashMain = 'main'

export function isMain<V>(v: V) {
  return is$typed(v, id, hashMain)
}

export function validateMain<V>(v: V) {
  return validate<Main & V>(v, id, hashMain, true)
}

export {
  type Main as Record,
  isMain as isRecord,
  validateMain as validateRecord,
}

/** Geographic coordinates following Darwin Core standards. */
export interface Location {
  $type?: 'org.rwell.test.occurrence#location'
  /** The geographic latitude in decimal degrees (Darwin Core dwc:decimalLatitude). Valid range: -90 to 90. */
  decimalLatitude: string
  /** The geographic longitude in decimal degrees (Darwin Core dwc:decimalLongitude). Valid range: -180 to 180. */
  decimalLongitude: string
  /** The horizontal distance (in meters) from the given coordinates describing the smallest circle containing the whole of the Location (Darwin Core dwc:coordinateUncertaintyInMeters). */
  coordinateUncertaintyInMeters?: number
  /** The ellipsoid, geodetic datum, or spatial reference system used (Darwin Core dwc:geodeticDatum). Defaults to WGS84. */
  geodeticDatum: string
  /** The name of the continent (Darwin Core dwc:continent). */
  continent?:
    | 'Africa'
    | 'Antarctica'
    | 'Asia'
    | 'Europe'
    | 'North America'
    | 'Oceania'
    | 'South America'
    | (string & {})
  /** The name of the country or major administrative unit (Darwin Core dwc:country). */
  country?: string
  /** The standard code for the country (Darwin Core dwc:countryCode). ISO 3166-1-alpha-2. */
  countryCode?: string
  /** The name of the next smaller administrative region than country (Darwin Core dwc:stateProvince). */
  stateProvince?: string
  /** The full, unabbreviated name of the next smaller administrative region than stateProvince (Darwin Core dwc:county). */
  county?: string
  /** The full, unabbreviated name of the next smaller administrative region than county (Darwin Core dwc:municipality). */
  municipality?: string
  /** The specific description of the place (Darwin Core dwc:locality). */
  locality?: string
  /** The name of the water body in which the location occurs (Darwin Core dwc:waterBody). */
  waterBody?: string
  /** The lower limit of the range of elevation in meters (Darwin Core dwc:minimumElevationInMeters). */
  minimumElevationInMeters?: string
  /** The upper limit of the range of elevation in meters (Darwin Core dwc:maximumElevationInMeters). */
  maximumElevationInMeters?: string
  /** The lesser depth of a range of depth below the local surface in meters (Darwin Core dwc:minimumDepthInMeters). */
  minimumDepthInMeters?: string
  /** The greater depth of a range of depth below the local surface in meters (Darwin Core dwc:maximumDepthInMeters). */
  maximumDepthInMeters?: string
}

const hashLocation = 'location'

export function isLocation<V>(v: V) {
  return is$typed(v, id, hashLocation)
}

export function validateLocation<V>(v: V) {
  return validate<Location & V>(v, id, hashLocation)
}

/** A reference to an uploaded image blob. */
export interface ImageEmbed {
  $type?: 'org.rwell.test.occurrence#imageEmbed'
  /** The image blob reference. */
  image: BlobRef
  /** Alt text description of the image for accessibility. */
  alt: string
  aspectRatio?: AspectRatio
}

const hashImageEmbed = 'imageEmbed'

export function isImageEmbed<V>(v: V) {
  return is$typed(v, id, hashImageEmbed)
}

export function validateImageEmbed<V>(v: V) {
  return validate<ImageEmbed & V>(v, id, hashImageEmbed)
}

/** Width and height of an image, used for proper display before loading. */
export interface AspectRatio {
  $type?: 'org.rwell.test.occurrence#aspectRatio'
  width: number
  height: number
}

const hashAspectRatio = 'aspectRatio'

export function isAspectRatio<V>(v: V) {
  return is$typed(v, id, hashAspectRatio)
}

export function validateAspectRatio<V>(v: V) {
  return validate<AspectRatio & V>(v, id, hashAspectRatio)
}
