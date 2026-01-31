/**
 * Observ.ing Shared - Common code for Observ.ing services
 */

// Types
export * from "./types.js";

// API Schemas (Zod) - single source of truth for API types
export * from "./schemas/index.js";

// Database
export { Database, type OccurrenceRow, type IdentificationRow, type CommentRow, type InteractionRow, type ObservationRow } from "./database/index.js";

// Services
export { TaxonomyClient, type TaxonResult, type TaxonDetail as TaxonDetailService, type TaxonAncestor as TaxonAncestorService, type TaxonDescription, type TaxonReference, type TaxonMedia, type ValidationResult, type ConservationStatus as ConservationStatusService, type IUCNCategory as IUCNCategoryService } from "./services/taxonomy.js";
export { GeocodingService, type GeocodedLocation } from "./services/geocoding.js";
export { CommunityIdCalculator, TaxonomicHierarchy, type CommunityIdResult, type TaxonCount } from "./services/community-id.js";
export { IdentityResolver, getIdentityResolver, type DidDocument, type Profile as IdentityProfile, type ResolveResult } from "./services/identity.js";

// Generated types
export * from "./generated/index.js";
