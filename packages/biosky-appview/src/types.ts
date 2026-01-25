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

export interface CommentEvent {
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
  scientific_name: string | null;
  event_date: Date;
  latitude: number;
  longitude: number;
  coordinate_uncertainty_meters: number | null;
  // Darwin Core administrative geography fields
  continent: string | null;
  country: string | null;
  country_code: string | null;
  state_province: string | null;
  county: string | null;
  municipality: string | null;
  locality: string | null;
  water_body: string | null;
  verbatim_locality: string | null;
  occurrence_remarks: string | null;
  associated_media: unknown[];
  recorded_by: string | null;
  taxon_id: string | null;
  taxon_rank: string | null;
  vernacular_name: string | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
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
  // Darwin Core taxonomy fields
  vernacular_name: string | null;
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  confidence: string | null;
}

export interface CommentRow {
  uri: string;
  cid: string;
  did: string;
  subject_uri: string;
  subject_cid: string;
  body: string;
  reply_to_uri: string | null;
  reply_to_cid: string | null;
  created_at: Date;
}

// Legacy type aliases
export type ObservationRow = OccurrenceRow;
