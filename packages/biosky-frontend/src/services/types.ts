/**
 * API Types for BioSky Frontend
 *
 * Re-exports types from biosky-shared for API contract sync.
 * Additional frontend-only types are defined here.
 */

// Re-export API types from shared package (single source of truth)
export type {
  // Core types
  Profile,
  Observer,
  Subject,
  Location,
  Occurrence,
  Identification,
  Comment,

  // Request/Response types
  CreateOccurrenceRequest,
  CreateOccurrenceResponse,
  OccurrenceDetailResponse,
  CreateIdentificationRequest,
  CreateCommentRequest,

  // Feed types
  FeedFilters,
  FeedResponse,
  ExploreFeedResponse,
  HomeFeedResponse,

  // Profile types
  ProfileData,
  ProfileFeedResponse,

  // Taxonomy types
  IUCNCategory,
  ConservationStatus,
  TaxaResult,
  TaxonAncestor,
  TaxonDetail,

  // GeoJSON types
  GeoJSONFeature,
  GeoJSONFeatureCollection,

  // Auth types
  User,
  AuthResponse,
  ErrorResponse,
} from "biosky-shared";

// ============================================================================
// Frontend-only types (UI state, not part of API contract)
// ============================================================================

export type ViewMode = "feed" | "map";
export type FeedTab = "home" | "explore";
