/**
 * Generated types from org.rwell.test.* Lexicons
 * These types follow Darwin Core standards for biodiversity data
 */

import { BlobRef } from "@atproto/api";

// ============================================
// org.rwell.test.occurrence types (Darwin Core Occurrence class)
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
  /** ISO 3166-1-alpha-2 country code, Darwin Core dwc:countryCode */
  countryCode?: string;
  /** State/Province name, Darwin Core dwc:stateProvince */
  stateProvince?: string;
  /** County name, Darwin Core dwc:county */
  county?: string;
  /** Municipality name, Darwin Core dwc:municipality */
  municipality?: string;
  /** Water body name, Darwin Core dwc:waterBody */
  waterBody?: string;
  /** Minimum elevation in meters, Darwin Core dwc:minimumElevationInMeters */
  minimumElevationInMeters?: number;
  /** Maximum elevation in meters, Darwin Core dwc:maximumElevationInMeters */
  maximumElevationInMeters?: number;
  /** Minimum depth in meters, Darwin Core dwc:minimumDepthInMeters */
  minimumDepthInMeters?: number;
  /** Maximum depth in meters, Darwin Core dwc:maximumDepthInMeters */
  maximumDepthInMeters?: number;
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

/** Darwin Core dwc:basisOfRecord values */
export type BasisOfRecord =
  | "HumanObservation"
  | "MachineObservation"
  | "MaterialSample"
  | "PreservedSpecimen"
  | "LivingSpecimen"
  | "FossilSpecimen";

/** Darwin Core dwc:occurrenceStatus values */
export type OccurrenceStatus = "present" | "absent";

/** Darwin Core dwc:sex values */
export type Sex = "male" | "female" | "hermaphrodite" | "unknown";

/** Darwin Core dwc:establishmentMeans values */
export type EstablishmentMeans =
  | "native"
  | "nativeReintroduced"
  | "introduced"
  | "introducedAssistedColonisation"
  | "vagrant"
  | "uncertain";

export interface Occurrence {
  /** Collection identifier */
  $type: "org.rwell.test.occurrence";
  /** The specific nature of the data record, Darwin Core dwc:basisOfRecord */
  basisOfRecord: BasisOfRecord;
  /** Scientific name of the observed organism, Darwin Core dwc:scientificName */
  scientificName?: string;
  /** Date-time of occurrence in ISO 8601, Darwin Core dwc:eventDate */
  eventDate: string;
  /** Geographic location of the occurrence */
  location: Location;
  /** Original textual description of the place, Darwin Core dwc:verbatimLocality */
  verbatimLocality?: string;
  /** Habitat description, Darwin Core dwc:habitat */
  habitat?: string;
  /** Presence or absence, Darwin Core dwc:occurrenceStatus */
  occurrenceStatus?: OccurrenceStatus;
  /** Notes about the occurrence, Darwin Core dwc:occurrenceRemarks */
  occurrenceRemarks?: string;
  /** Number of individuals, Darwin Core dwc:individualCount */
  individualCount?: number;
  /** Sex of the organism, Darwin Core dwc:sex */
  sex?: Sex;
  /** Life stage of the organism, Darwin Core dwc:lifeStage */
  lifeStage?: string;
  /** Reproductive condition, Darwin Core dwc:reproductiveCondition */
  reproductiveCondition?: string;
  /** Observed behavior, Darwin Core dwc:behavior */
  behavior?: string;
  /** How the organism came to be in the location, Darwin Core dwc:establishmentMeans */
  establishmentMeans?: EstablishmentMeans;
  /** Array of image references, Darwin Core dwc:associatedMedia */
  associatedMedia?: ImageEmbed[];
  /** Person/group who recorded the occurrence, Darwin Core dwc:recordedBy */
  recordedBy?: string;
  /** Timestamp when record was created */
  createdAt: string;
}

// Input type for creating occurrences (without $type, handled by API)
export type OccurrenceInput = Omit<Occurrence, "$type">;

// Legacy alias for backwards compatibility
export type Observation = Occurrence;
export type ObservationInput = OccurrenceInput;

// ============================================
// org.rwell.test.identification types (Darwin Core Identification class)
// ============================================

export interface StrongRef {
  /** The URI of the referenced record */
  uri: string;
  /** The CID of the referenced record */
  cid: string;
}

/** Darwin Core dwc:taxonRank values */
export type TaxonRank =
  | "kingdom"
  | "phylum"
  | "class"
  | "order"
  | "family"
  | "subfamily"
  | "tribe"
  | "genus"
  | "subgenus"
  | "species"
  | "subspecies"
  | "variety"
  | "form";

/** Darwin Core dwc:identificationVerificationStatus values */
export type IdentificationVerificationStatus =
  | "verified"
  | "unverified"
  | "questionable";

export interface Identification {
  /** Collection identifier */
  $type: "org.rwell.test.identification";
  /** Strong reference to the occurrence being identified */
  subject: StrongRef;
  /** The scientific name being proposed, Darwin Core dwc:scientificName */
  scientificName: string;
  /** The taxonomic rank, Darwin Core dwc:taxonRank */
  taxonRank?: TaxonRank;
  /** Qualification phrase like 'cf.' or 'aff.', Darwin Core dwc:identificationQualifier */
  identificationQualifier?: string;
  /** URI to taxonomic authority (GBIF, iNaturalist), Darwin Core dwc:taxonID */
  taxonID?: string;
  /** Notes about the identification, Darwin Core dwc:identificationRemarks */
  identificationRemarks?: string;
  /** Verification status, Darwin Core dwc:identificationVerificationStatus */
  identificationVerificationStatus?: IdentificationVerificationStatus;
  /** Nomenclatural type designation, Darwin Core dwc:typeStatus */
  typeStatus?: string;
  /** Whether this agrees with the current leading ID (not a Darwin Core term) */
  isAgreement?: boolean;
  /** Date identification was made, Darwin Core dwc:dateIdentified */
  dateIdentified: string;
}

// Input type for creating identifications (without $type)
export type IdentificationInput = Omit<Identification, "$type">;

// ============================================
// Record types for API responses
// ============================================

export interface OccurrenceRecord {
  uri: string;
  cid: string;
  value: Occurrence;
}

export interface IdentificationRecord {
  uri: string;
  cid: string;
  value: Identification;
}

// Legacy alias
export type ObservationRecord = OccurrenceRecord;

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

export function validateOccurrence(occ: OccurrenceInput): string[] {
  const errors: string[] = [];

  if (!occ.basisOfRecord) {
    errors.push("basisOfRecord is required");
  }

  if (!occ.eventDate) {
    errors.push("eventDate is required");
  } else {
    const date = new Date(occ.eventDate);
    if (isNaN(date.getTime())) {
      errors.push("eventDate must be a valid ISO 8601 date");
    }
  }

  if (!occ.location) {
    errors.push("location is required");
  } else if (!isValidLocation(occ.location)) {
    errors.push("location must have valid coordinates");
  }

  return errors;
}

// Legacy alias
export const validateObservation = validateOccurrence;
