/**
 * Generated types from net.inat.* Lexicons
 * These types follow Darwin Core standards for biodiversity data
 */

import { BlobRef } from "@atproto/api";

// ============================================
// net.inat.observation types
// ============================================

export interface Location {
  /** Decimal latitude (-90 to 90), Darwin Core dwc:decimalLatitude */
  decimalLatitude: number;
  /** Decimal longitude (-180 to 180), Darwin Core dwc:decimalLongitude */
  decimalLongitude: number;
  /** Coordinate uncertainty in meters, Darwin Core dwc:coordinateUncertaintyInMeters */
  coordinateUncertaintyInMeters?: number;
  /** Geodetic datum (defaults to WGS84), Darwin Core dwc:geodeticDatum */
  geodeticDatum?: string;
}

export interface AspectRatio {
  width: number;
  height: number;
}

export interface ImageEmbed {
  /** The image blob reference */
  image: BlobRef;
  /** Alt text for accessibility */
  alt: string;
  /** Optional aspect ratio */
  aspectRatio?: AspectRatio;
}

export interface Observation {
  /** Collection identifier */
  $type: "net.inat.observation";
  /** Scientific name of the observed organism, Darwin Core dwc:scientificName */
  scientificName: string;
  /** Date-time of observation in ISO 8601, Darwin Core dwc:eventDate */
  eventDate: string;
  /** Geographic location of the observation */
  location: Location;
  /** Original textual description of the place, Darwin Core dwc:verbatimLocality */
  verbatimLocality?: string;
  /** Array of image references */
  blobs?: ImageEmbed[];
  /** Additional notes about the observation */
  notes?: string;
  /** Timestamp when record was created */
  createdAt: string;
}

// Input type for creating observations (without $type, handled by API)
export type ObservationInput = Omit<Observation, "$type">;

// ============================================
// net.inat.identification types
// ============================================

export interface StrongRef {
  /** The URI of the referenced record */
  uri: string;
  /** The CID of the referenced record */
  cid: string;
}

export type TaxonRank =
  | "kingdom"
  | "phylum"
  | "class"
  | "order"
  | "family"
  | "genus"
  | "species"
  | "subspecies"
  | "variety";

export type ConfidenceLevel = "low" | "medium" | "high";

export interface Identification {
  /** Collection identifier */
  $type: "net.inat.identification";
  /** Strong reference to the observation being identified */
  subject: StrongRef;
  /** The scientific name being proposed */
  taxonName: string;
  /** The taxonomic rank of the identification */
  taxonRank?: TaxonRank;
  /** Explanation for this identification */
  comment?: string;
  /** Whether this agrees with the current community ID */
  isAgreement?: boolean;
  /** Confidence level */
  confidence?: ConfidenceLevel;
  /** Timestamp when identification was created */
  createdAt: string;
}

// Input type for creating identifications (without $type)
export type IdentificationInput = Omit<Identification, "$type">;

// ============================================
// Record types for API responses
// ============================================

export interface ObservationRecord {
  uri: string;
  cid: string;
  value: Observation;
}

export interface IdentificationRecord {
  uri: string;
  cid: string;
  value: Identification;
}

// ============================================
// Validation helpers
// ============================================

export function isValidLatitude(lat: number): boolean {
  return lat >= -90 && lat <= 90;
}

export function isValidLongitude(lng: number): boolean {
  return lng >= -180 && lng <= 180;
}

export function isValidLocation(location: Location): boolean {
  return (
    isValidLatitude(location.decimalLatitude) &&
    isValidLongitude(location.decimalLongitude)
  );
}

export function validateObservation(obs: ObservationInput): string[] {
  const errors: string[] = [];

  if (!obs.scientificName || obs.scientificName.trim().length === 0) {
    errors.push("scientificName is required");
  }

  if (!obs.eventDate) {
    errors.push("eventDate is required");
  } else {
    const date = new Date(obs.eventDate);
    if (isNaN(date.getTime())) {
      errors.push("eventDate must be a valid ISO 8601 date");
    }
  }

  if (!obs.location) {
    errors.push("location is required");
  } else if (!isValidLocation(obs.location)) {
    errors.push("location must have valid coordinates");
  }

  return errors;
}
