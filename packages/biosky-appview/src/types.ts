/**
 * Shared types for BioSky services
 */

// Re-export generated types
export * from "./generated/index.js";

/**
 * Event types for firehose operations
 */
export interface OccurrenceEvent {
  did: string;
  uri: string;
  cid: string;
  action: "create" | "update" | "delete";
  record?: unknown;
  seq: number;
  time: string;
}

// Legacy alias
export type ObservationEvent = OccurrenceEvent;

export interface IdentificationEvent {
  did: string;
  uri: string;
  cid: string;
  action: "create" | "update" | "delete";
  record?: unknown;
  seq: number;
  time: string;
}

/**
 * Database row types
 */
export interface OccurrenceRow {
  uri: string;
  cid: string;
  did: string;
  basis_of_record: string;
  scientific_name: string | null;
  event_date: Date;
  latitude: number;
  longitude: number;
  coordinate_uncertainty_meters: number | null;
  verbatim_locality: string | null;
  habitat: string | null;
  occurrence_status: string;
  occurrence_remarks: string | null;
  individual_count: number | null;
  sex: string | null;
  life_stage: string | null;
  reproductive_condition: string | null;
  behavior: string | null;
  establishment_means: string | null;
  associated_media: unknown[];
  recorded_by: string | null;
  created_at: Date;
  distance_meters?: number;
}

export interface IdentificationRow {
  uri: string;
  cid: string;
  did: string;
  subject_uri: string;
  subject_cid: string;
  subject_index: number;
  scientific_name: string;
  taxon_rank: string | null;
  identification_qualifier: string | null;
  taxon_id: string | null;
  identification_remarks: string | null;
  identification_verification_status: string | null;
  type_status: string | null;
  is_agreement: boolean;
  date_identified: Date;
}

// Legacy type aliases
export type ObservationRow = OccurrenceRow;
