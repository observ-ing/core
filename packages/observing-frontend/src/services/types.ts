/**
 * API Types for Observ.ing Frontend
 *
 * These types define the API contract between the frontend and the Rust appview.
 */

// ============================================================================
// Common Types
// ============================================================================

export interface Profile {
  did: string;
  handle?: string;
  displayName?: string;
  avatar?: string;
}

export interface Observer extends Profile {
  role: "owner" | "co-observer";
}

export interface Subject {
  index: number;
  communityId?: string;
  identificationCount: number;
}

export interface Location {
  latitude: number;
  longitude: number;
  uncertaintyMeters?: number;
  continent?: string;
  country?: string;
  countryCode?: string;
  stateProvince?: string;
  county?: string;
  municipality?: string;
  locality?: string;
  waterBody?: string;
}

// ============================================================================
// Occurrence Types
// ============================================================================

export interface EffectiveTaxonomy {
  scientificName: string;
  taxonId?: string;
  taxonRank?: string;
  vernacularName?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
}

export interface Occurrence {
  uri: string;
  cid: string;
  observer: Profile;
  observers: Observer[];
  scientificName?: string;
  communityId?: string;
  subjects: Subject[];
  eventDate: string;
  location: Location;
  verbatimLocality?: string;
  occurrenceRemarks?: string;
  taxonId?: string;
  taxonRank?: string;
  vernacularName?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  effectiveTaxonomy?: EffectiveTaxonomy;
  images: string[];
  createdAt: string;
  identificationCount?: number;
  likeCount?: number;
  viewerHasLiked?: boolean;
}

export interface CreateOccurrenceRequest {
  scientificName?: string;
  latitude: number;
  longitude: number;
  coordinateUncertaintyInMeters?: number;
  notes?: string;
  license?: string;
  eventDate?: string;
  images?: { data: string; mimeType: string }[];
  taxonId?: string;
  taxonRank?: string;
  vernacularName?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  recordedBy?: string[];
}

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
// Identification Types
// ============================================================================

export interface Identification {
  uri: string;
  cid: string;
  did: string;
  subject_uri: string;
  subject_index: number;
  scientific_name: string;
  taxon_rank?: string;
  identification_remarks?: string;
  is_agreement: boolean;
  date_identified: string;
  identifier?: Profile;
  kingdom?: string;
}

export interface CreateIdentificationRequest {
  occurrenceUri: string;
  occurrenceCid: string;
  subjectIndex?: number;
  taxonName: string;
  taxonRank?: string;
  comment?: string;
  isAgreement?: boolean;
  confidence?: "low" | "medium" | "high";
}

// ============================================================================
// Comment Types
// ============================================================================

export interface Comment {
  uri: string;
  cid: string;
  did: string;
  subject_uri: string;
  subject_cid: string;
  body: string;
  reply_to_uri?: string;
  reply_to_cid?: string;
  created_at: string;
  commenter?: Profile;
}

export interface CreateCommentRequest {
  occurrenceUri: string;
  occurrenceCid: string;
  body: string;
  replyToUri?: string;
  replyToCid?: string;
}

// ============================================================================
// Interaction Types
// ============================================================================

export interface InteractionSubject {
  occurrenceUri?: string;
  occurrenceCid?: string;
  subjectIndex?: number;
  taxonName?: string;
  kingdom?: string;
}

export interface Interaction {
  uri: string;
  cid: string;
  did: string;
  subjectA: InteractionSubject;
  subjectB: InteractionSubject;
  interactionType: string;
  direction: "AtoB" | "BtoA" | "bidirectional";
  confidence?: "low" | "medium" | "high";
  comment?: string;
  createdAt: string;
  creator?: Profile;
}

export interface CreateInteractionRequest {
  subjectA: InteractionSubject;
  subjectB: InteractionSubject;
  interactionType: string;
  direction?: "AtoB" | "BtoA" | "bidirectional";
  confidence?: "low" | "medium" | "high";
  comment?: string;
}

// ============================================================================
// Feed Types
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
// Taxonomy Types
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

export interface ConservationStatus {
  category: IUCNCategory;
  source: string;
}

export interface TaxaResult {
  id: string;
  scientificName: string;
  commonName?: string;
  photoUrl?: string;
  rank?: string;
  conservationStatus?: ConservationStatus;
  isSynonym?: boolean;
  acceptedName?: string;
}

export interface TaxonAncestor {
  id: string;
  name: string;
  rank: string;
}

export interface TaxonDetail {
  id: string;
  scientificName: string;
  commonName?: string;
  rank: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
  ancestors: TaxonAncestor[];
  children: TaxaResult[];
  conservationStatus?: ConservationStatus;
  numDescendants?: number;
  extinct?: boolean;
  observationCount: number;
  gbifUrl?: string;
  wikidataUrl?: string;
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
// Frontend-only types (UI state, not part of API contract)
// ============================================================================

export type ViewMode = "feed" | "map";
export type FeedTab = "home" | "explore";
