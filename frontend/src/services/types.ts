/**
 * API Types for Observ.ing Frontend
 *
 * Types generated from Rust via ts-rs are re-exported from ../bindings/.
 * Frontend-only types (UI state, wrapper responses) are defined below.
 *
 * Some generated types are extended here with fields that the API returns
 * but aren't yet in the Rust structs, or with client-side-only fields.
 */

// ============================================================================
// Generated types (from Rust via ts-rs) — re-exported as-is
// ============================================================================

export type { Profile } from "../bindings/Profile";
export type { Observer } from "../bindings/Observer";
export type { Location } from "../bindings/Location";
export type { EffectiveTaxonomy } from "../bindings/EffectiveTaxonomy";
export type { Identification } from "../bindings/Identification";
export type { Comment } from "../bindings/Comment";
export type { EnrichedInteraction } from "../bindings/EnrichedInteraction";
export type { ConservationStatus } from "../bindings/ConservationStatus";
export type { ValidateResponse } from "../bindings/ValidateResponse";
export type { CreateOccurrenceRequest } from "../bindings/CreateOccurrenceRequest";
export type { ImageUpload } from "../bindings/ImageUpload";
export type { CreateIdentificationRequest } from "../bindings/CreateIdentificationRequest";
export type { CreateCommentRequest } from "../bindings/CreateCommentRequest";
export type { CreateLikeRequest } from "../bindings/CreateLikeRequest";
export type { DeleteLikeRequest } from "../bindings/DeleteLikeRequest";
export type { InteractionSubjectRequest } from "../bindings/InteractionSubjectRequest";
export type { CreateInteractionRequest } from "../bindings/CreateInteractionRequest";
export type { ObserverRole } from "../bindings/ObserverRole";
export type { Confidence } from "../bindings/Confidence";
export type { InteractionDirection } from "../bindings/InteractionDirection";

// ============================================================================
// Extended generated types
// ============================================================================

// Subject: extends with communityId (populated client-side from identification consensus)
import type { Subject as GeneratedSubject } from "../bindings/Subject";
export type Subject = GeneratedSubject & { communityId?: string };

// Occurrence: override subjects to use the extended Subject type
import type { Occurrence as GeneratedOccurrence } from "../bindings/Occurrence";
export type Occurrence = Omit<GeneratedOccurrence, "subjects"> & {
  subjects: Subject[];
};

// TaxonDetail: extends with fields returned by the API's enriched taxon endpoint
import type { TaxonDetail as GeneratedTaxonDetail } from "../bindings/TaxonDetail";
export type TaxonDetail = GeneratedTaxonDetail & {
  ancestors?: TaxonAncestor[];
  children?: TaxonChild[];
  gbifUrl?: string;
  wikidataUrl?: string;
  extinct?: boolean;
  observationCount?: number;
  numDescendants?: number;
  descriptions?: TaxonDescription[];
  references?: TaxonReference[];
};

// TaxaResult: extends with synonym resolution fields
import type { TaxaResult as GeneratedTaxaResult } from "../bindings/TaxaResult";
export type TaxaResult = GeneratedTaxaResult & {
  isSynonym?: boolean;
  acceptedName?: string;
};

// ============================================================================
// Feed Types (frontend-only wrappers around API responses)
// ============================================================================

export interface FeedFilters {
  taxon?: string;
  lat?: number;
  lng?: number;
  radius?: number;
  kingdom?: string;
  startDate?: string;
  endDate?: string;
}

export interface FeedResponse {
  occurrences: Occurrence[];
  cursor?: string;
}

export interface ExploreFeedResponse extends FeedResponse {
  meta?: { filters?: FeedFilters };
}

export interface HomeFeedResponse extends FeedResponse {
  meta?: {
    followedCount: number;
    nearbyCount: number;
    totalFollows: number;
  };
}

// ============================================================================
// Profile Types
// ============================================================================

export interface ProfileData {
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
}

export interface ProfileFeedResponse {
  profile: ProfileData;
  counts: {
    observations: number;
    identifications: number;
    species: number;
  };
  occurrences: Occurrence[];
  identifications: Identification[];
  cursor?: string;
}

// ============================================================================
// Taxonomy Types (frontend-only)
// ============================================================================

export type IUCNCategory =
  | "EX"
  | "EW"
  | "CR"
  | "EN"
  | "VU"
  | "NT"
  | "LC"
  | "DD"
  | "NE";

export interface TaxonAncestor {
  id: string;
  name: string;
  rank: string;
}

export interface TaxonChild {
  id: string;
  scientificName: string;
  rank: string;
  photoUrl?: string;
}

export interface TaxonDescription {
  description: string;
  source?: string;
}

export interface TaxonReference {
  citation: string;
  link?: string;
  doi?: string;
}

// ============================================================================
// GeoJSON Types
// ============================================================================

export interface GeoJSONFeature {
  type: "Feature";
  geometry: {
    type: "Point";
    coordinates: [number, number];
  };
  properties: {
    uri: string;
    scientificName?: string;
    eventDate?: string;
    point_count?: number;
    cluster_id?: number;
  };
}

export interface GeoJSONFeatureCollection {
  type: "FeatureCollection";
  features: GeoJSONFeature[];
}

// ============================================================================
// Auth Types
// ============================================================================

export interface User {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export interface AuthResponse {
  user?: User;
}

export interface ErrorResponse {
  error: string;
}

// ============================================================================
// Response wrapper types
// ============================================================================

import type { Identification } from "../bindings/Identification";
import type { Comment } from "../bindings/Comment";

export interface CreateOccurrenceResponse {
  success: boolean;
  uri: string;
  cid: string;
  message?: string;
}

export interface OccurrenceDetailResponse {
  occurrence: Occurrence;
  identifications: Identification[];
  comments: Comment[];
}

// ============================================================================
// Frontend-only types (UI state, not part of API contract)
// ============================================================================

export type ViewMode = "feed" | "map";
export type FeedTab = "home" | "explore";
