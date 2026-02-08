/**
 * API Types for Observ.ing Frontend
 *
 * Types generated from Rust via ts-rs are re-exported from ../bindings/.
 * Frontend-only types (UI state, wrapper responses) are defined below.
 */

// ============================================================================
// Generated types (from Rust via ts-rs)
// ============================================================================

export type { Profile } from "../bindings/Profile";
export type { Observer } from "../bindings/Observer";
export type { Location } from "../bindings/Location";
export type { EffectiveTaxonomy } from "../bindings/EffectiveTaxonomy";
export type { Occurrence } from "../bindings/Occurrence";
export type { Identification } from "../bindings/Identification";
export type { Comment } from "../bindings/Comment";
export type { EnrichedInteraction } from "../bindings/EnrichedInteraction";
export type { TaxaResult } from "../bindings/TaxaResult";
export type { ConservationStatus } from "../bindings/ConservationStatus";
export type { TaxonDetail } from "../bindings/TaxonDetail";
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

// Subject extends the generated type with communityId (populated client-side)
import type { Subject as GeneratedSubject } from "../bindings/Subject";
export type Subject = GeneratedSubject & { communityId?: string };

// ============================================================================
// Feed Types (frontend-only wrappers around API responses)
// ============================================================================

import type { Occurrence } from "../bindings/Occurrence";
import type { Identification } from "../bindings/Identification";
import type { Comment } from "../bindings/Comment";

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
