/**
 * API Types for Observ.ing Frontend
 *
 * Re-exports types from observing-shared for API contract sync.
 * Additional frontend-only types are defined here.
 */

// Re-export API types from shared package (single source of truth)
export type {
  // Core types
  Profile,
  Observer,
  Subject,
  Location,
  EffectiveTaxonomy,
  Occurrence,
  Identification,
  Comment,
  Interaction,
  InteractionSubject,

  // Request/Response types
  CreateOccurrenceRequest,
  CreateOccurrenceResponse,
  OccurrenceDetailResponse,
  CreateIdentificationRequest,
  CreateCommentRequest,
  CreateInteractionRequest,

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
} from "observing-shared";

// ============================================================================
// Frontend-only types (UI state, not part of API contract)
// ============================================================================

export type ViewMode = "feed" | "map";
export type FeedTab = "home" | "explore";
