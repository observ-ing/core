/**
 * Zod schemas for Observ.ing API
 *
 * These schemas serve as the single source of truth for:
 * 1. TypeScript types (via z.infer)
 * 2. Runtime validation
 * 3. OpenAPI spec generation
 */

import { z } from "zod";
import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";

// Extend Zod with OpenAPI support
extendZodWithOpenApi(z);

// ============================================================================
// Common Schemas
// ============================================================================

export const ProfileSchema = z
  .object({
    did: z.string().describe("Decentralized identifier"),
    handle: z.string().optional().describe("User handle"),
    displayName: z.string().optional().describe("Display name"),
    avatar: z.string().optional().describe("Avatar URL"),
  })
  .openapi("Profile");

export const ObserverSchema = ProfileSchema.extend({
  role: z.enum(["owner", "co-observer"]).describe("Observer role"),
}).openapi("Observer");

export const SubjectSchema = z
  .object({
    index: z.number().int().min(0).describe("Subject index within the observation"),
    communityId: z.string().optional().describe("Community-agreed taxon name"),
    identificationCount: z.number().int().describe("Number of identifications"),
  })
  .openapi("Subject");

export const LocationSchema = z
  .object({
    latitude: z.number().min(-90).max(90).describe("Decimal latitude"),
    longitude: z.number().min(-180).max(180).describe("Decimal longitude"),
    uncertaintyMeters: z.number().optional().describe("Coordinate uncertainty in meters"),
    continent: z.string().optional(),
    country: z.string().optional(),
    countryCode: z.string().optional(),
    stateProvince: z.string().optional(),
    county: z.string().optional(),
    municipality: z.string().optional(),
    locality: z.string().optional(),
    waterBody: z.string().optional(),
  })
  .openapi("Location");

// ============================================================================
// Occurrence Schemas
// ============================================================================

export const EffectiveTaxonomySchema = z
  .object({
    scientificName: z.string(),
    taxonId: z.string().optional(),
    taxonRank: z.string().optional(),
    vernacularName: z.string().optional(),
    kingdom: z.string().optional(),
    phylum: z.string().optional(),
    class: z.string().optional(),
    order: z.string().optional(),
    family: z.string().optional(),
    genus: z.string().optional(),
  })
  .openapi("EffectiveTaxonomy");

export const OccurrenceSchema = z
  .object({
    uri: z.string().describe("AT Protocol URI"),
    cid: z.string().describe("Content identifier"),
    observer: ProfileSchema.describe("Primary observer"),
    observers: z.array(ObserverSchema).describe("All observers including co-observers"),
    scientificName: z.string().optional().describe("[DEPRECATED] Scientific name from record - use effectiveTaxonomy instead"),
    communityId: z.string().optional().describe("Community ID for subject 0 (backward compat)"),
    subjects: z.array(SubjectSchema).describe("All subjects with their community IDs"),
    eventDate: z.string().datetime().describe("Date of observation"),
    location: LocationSchema,
    verbatimLocality: z.string().optional(),
    occurrenceRemarks: z.string().optional(),
    taxonId: z.string().optional().describe("[DEPRECATED] Use effectiveTaxonomy instead"),
    taxonRank: z.string().optional().describe("[DEPRECATED] Use effectiveTaxonomy instead"),
    vernacularName: z.string().optional().describe("[DEPRECATED] Use effectiveTaxonomy instead"),
    kingdom: z.string().optional().describe("[DEPRECATED] Use effectiveTaxonomy instead"),
    phylum: z.string().optional().describe("[DEPRECATED] Use effectiveTaxonomy instead"),
    class: z.string().optional().describe("[DEPRECATED] Use effectiveTaxonomy instead"),
    order: z.string().optional().describe("[DEPRECATED] Use effectiveTaxonomy instead"),
    family: z.string().optional().describe("[DEPRECATED] Use effectiveTaxonomy instead"),
    genus: z.string().optional().describe("[DEPRECATED] Use effectiveTaxonomy instead"),
    effectiveTaxonomy: EffectiveTaxonomySchema.optional().describe("Taxonomy from winning identification"),
    images: z.array(z.string()).describe("Image URLs"),
    createdAt: z.string().datetime(),
    identificationCount: z.number().int().optional(),
  })
  .openapi("Occurrence");

export const CreateOccurrenceRequestSchema = z
  .object({
    scientificName: z.string().optional(),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    notes: z.string().optional(),
    license: z.string().optional(),
    eventDate: z.string().datetime().optional(),
    images: z
      .array(
        z.object({
          data: z.string().describe("Base64 encoded image data"),
          mimeType: z.string().describe("MIME type of the image"),
        })
      )
      .optional(),
    taxonId: z.string().optional(),
    taxonRank: z.string().optional(),
    vernacularName: z.string().optional(),
    kingdom: z.string().optional(),
    phylum: z.string().optional(),
    class: z.string().optional(),
    order: z.string().optional(),
    family: z.string().optional(),
    genus: z.string().optional(),
    recordedBy: z.array(z.string()).optional().describe("Co-observer DIDs"),
  })
  .openapi("CreateOccurrenceRequest");

export const CreateOccurrenceResponseSchema = z
  .object({
    success: z.boolean(),
    uri: z.string(),
    cid: z.string(),
    message: z.string().optional(),
  })
  .openapi("CreateOccurrenceResponse");

export const OccurrenceDetailResponseSchema = z
  .object({
    occurrence: OccurrenceSchema,
    identifications: z.array(z.lazy(() => IdentificationSchema)),
    comments: z.array(z.lazy(() => CommentSchema)),
  })
  .openapi("OccurrenceDetailResponse");

// ============================================================================
// Identification Schemas
// ============================================================================

export const IdentificationSchema = z
  .object({
    uri: z.string(),
    cid: z.string(),
    did: z.string(),
    subject_uri: z.string(),
    subject_index: z.number().int(),
    scientific_name: z.string(),
    taxon_rank: z.string().optional(),
    identification_remarks: z.string().optional(),
    is_agreement: z.boolean(),
    date_identified: z.string().datetime(),
    identifier: ProfileSchema.optional(),
    // Taxonomy fields from GBIF (may be populated for newer identifications)
    kingdom: z.string().optional(),
  })
  .openapi("Identification");

export const CreateIdentificationRequestSchema = z
  .object({
    occurrenceUri: z.string(),
    occurrenceCid: z.string(),
    subjectIndex: z.number().int().min(0).max(99).default(0),
    taxonName: z.string().min(1).max(256),
    taxonRank: z.string().default("species"),
    comment: z.string().max(3000).optional(),
    isAgreement: z.boolean().default(false),
    confidence: z.enum(["low", "medium", "high"]).default("medium"),
  })
  .openapi("CreateIdentificationRequest");

// ============================================================================
// Comment Schemas
// ============================================================================

export const CommentSchema = z
  .object({
    uri: z.string(),
    cid: z.string(),
    did: z.string(),
    subject_uri: z.string(),
    subject_cid: z.string(),
    body: z.string(),
    reply_to_uri: z.string().optional(),
    reply_to_cid: z.string().optional(),
    created_at: z.string().datetime(),
    commenter: ProfileSchema.optional(),
  })
  .openapi("Comment");

export const CreateCommentRequestSchema = z
  .object({
    occurrenceUri: z.string(),
    occurrenceCid: z.string(),
    body: z.string().min(1).max(3000),
    replyToUri: z.string().optional(),
    replyToCid: z.string().optional(),
  })
  .openapi("CreateCommentRequest");

// ============================================================================
// Interaction Schemas
// ============================================================================

export const InteractionSubjectSchema = z
  .object({
    occurrenceUri: z.string().optional().describe("URI of the related occurrence"),
    occurrenceCid: z.string().optional().describe("CID of the related occurrence"),
    subjectIndex: z.number().int().min(0).max(99).default(0).describe("Subject index within the occurrence"),
    taxonName: z.string().max(256).optional().describe("Scientific name of the organism"),
    kingdom: z.string().max(64).optional().describe("Taxonomic kingdom"),
  })
  .openapi("InteractionSubject");

export const InteractionSchema = z
  .object({
    uri: z.string(),
    cid: z.string(),
    did: z.string(),
    subjectA: InteractionSubjectSchema,
    subjectB: InteractionSubjectSchema,
    interactionType: z.string(),
    direction: z.enum(["AtoB", "BtoA", "bidirectional"]),
    confidence: z.enum(["low", "medium", "high"]).optional(),
    comment: z.string().optional(),
    createdAt: z.string().datetime(),
    creator: ProfileSchema.optional(),
  })
  .openapi("Interaction");

export const CreateInteractionRequestSchema = z
  .object({
    subjectA: InteractionSubjectSchema,
    subjectB: InteractionSubjectSchema,
    interactionType: z.string().max(64),
    direction: z.enum(["AtoB", "BtoA", "bidirectional"]).default("AtoB"),
    confidence: z.enum(["low", "medium", "high"]).default("medium"),
    comment: z.string().max(3000).optional(),
  })
  .openapi("CreateInteractionRequest");

// ============================================================================
// Feed Schemas
// ============================================================================

export const FeedFiltersSchema = z
  .object({
    taxon: z.string().optional(),
    lat: z.number().optional(),
    lng: z.number().optional(),
    radius: z.number().optional(),
  })
  .openapi("FeedFilters");

export const FeedResponseSchema = z
  .object({
    occurrences: z.array(OccurrenceSchema),
    cursor: z.string().optional().describe("Cursor for pagination"),
  })
  .openapi("FeedResponse");

export const ExploreFeedResponseSchema = FeedResponseSchema.extend({
  meta: z
    .object({
      filters: FeedFiltersSchema.optional(),
    })
    .optional(),
}).openapi("ExploreFeedResponse");

export const HomeFeedResponseSchema = FeedResponseSchema.extend({
  meta: z
    .object({
      followedCount: z.number().int(),
      nearbyCount: z.number().int(),
      totalFollows: z.number().int(),
    })
    .optional(),
}).openapi("HomeFeedResponse");

// ============================================================================
// Profile Schemas
// ============================================================================

export const ProfileDataSchema = z
  .object({
    did: z.string(),
    handle: z.string().optional(),
    displayName: z.string().optional(),
    avatar: z.string().optional(),
  })
  .openapi("ProfileData");

export const ProfileFeedResponseSchema = z
  .object({
    profile: ProfileDataSchema,
    counts: z.object({
      observations: z.number().int(),
      identifications: z.number().int(),
      species: z.number().int(),
    }),
    occurrences: z.array(OccurrenceSchema),
    identifications: z.array(IdentificationSchema),
    cursor: z.string().optional(),
  })
  .openapi("ProfileFeedResponse");

// ============================================================================
// Taxonomy Schemas
// ============================================================================

export const IUCNCategorySchema = z
  .enum(["EX", "EW", "CR", "EN", "VU", "NT", "LC", "DD", "NE"])
  .openapi("IUCNCategory");

export const ConservationStatusSchema = z
  .object({
    category: IUCNCategorySchema,
    source: z.string(),
  })
  .openapi("ConservationStatus");

export const TaxaResultSchema = z
  .object({
    id: z.string(),
    scientificName: z.string(),
    commonName: z.string().optional(),
    photoUrl: z.string().optional(),
    rank: z.string().optional(),
    conservationStatus: ConservationStatusSchema.optional(),
  })
  .openapi("TaxaResult");

export const TaxonAncestorSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    rank: z.string(),
  })
  .openapi("TaxonAncestor");

export const TaxonDetailSchema = z
  .object({
    id: z.string(),
    scientificName: z.string(),
    commonName: z.string().optional(),
    rank: z.string(),
    kingdom: z.string().optional(),
    phylum: z.string().optional(),
    class: z.string().optional(),
    order: z.string().optional(),
    family: z.string().optional(),
    genus: z.string().optional(),
    species: z.string().optional(),
    ancestors: z.array(TaxonAncestorSchema),
    children: z.array(TaxaResultSchema),
    conservationStatus: ConservationStatusSchema.optional(),
    numDescendants: z.number().int().optional(),
    extinct: z.boolean().optional(),
    observationCount: z.number().int(),
    gbifUrl: z.string().optional().describe("URL to the GBIF species page"),
  })
  .openapi("TaxonDetail");

// ============================================================================
// GeoJSON Schema
// ============================================================================

export const GeoJSONFeatureSchema = z
  .object({
    type: z.literal("Feature"),
    geometry: z.object({
      type: z.literal("Point"),
      coordinates: z.tuple([z.number(), z.number()]),
    }),
    properties: z.object({
      uri: z.string(),
      scientificName: z.string().optional(),
      eventDate: z.string().optional(),
      point_count: z.number().int().optional(),
      cluster_id: z.number().int().optional(),
    }),
  })
  .openapi("GeoJSONFeature");

export const GeoJSONFeatureCollectionSchema = z
  .object({
    type: z.literal("FeatureCollection"),
    features: z.array(GeoJSONFeatureSchema),
  })
  .openapi("GeoJSONFeatureCollection");

// ============================================================================
// Auth Schemas
// ============================================================================

export const UserSchema = z
  .object({
    did: z.string(),
    handle: z.string(),
  })
  .openapi("User");

export const AuthResponseSchema = z
  .object({
    user: UserSchema.optional(),
  })
  .openapi("AuthResponse");

// ============================================================================
// Error Schema
// ============================================================================

export const ErrorResponseSchema = z
  .object({
    error: z.string(),
  })
  .openapi("ErrorResponse");

// ============================================================================
// Inferred Types
// ============================================================================

export type Profile = z.infer<typeof ProfileSchema>;
export type Observer = z.infer<typeof ObserverSchema>;
export type Subject = z.infer<typeof SubjectSchema>;
export type Location = z.infer<typeof LocationSchema>;
export type EffectiveTaxonomy = z.infer<typeof EffectiveTaxonomySchema>;
export type Occurrence = z.infer<typeof OccurrenceSchema>;
export type CreateOccurrenceRequest = z.infer<typeof CreateOccurrenceRequestSchema>;
export type CreateOccurrenceResponse = z.infer<typeof CreateOccurrenceResponseSchema>;
export type OccurrenceDetailResponse = z.infer<typeof OccurrenceDetailResponseSchema>;
export type Identification = z.infer<typeof IdentificationSchema>;
export type CreateIdentificationRequest = z.infer<typeof CreateIdentificationRequestSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type CreateCommentRequest = z.infer<typeof CreateCommentRequestSchema>;
export type InteractionSubject = z.infer<typeof InteractionSubjectSchema>;
export type Interaction = z.infer<typeof InteractionSchema>;
export type CreateInteractionRequest = z.infer<typeof CreateInteractionRequestSchema>;
export type FeedFilters = z.infer<typeof FeedFiltersSchema>;
export type FeedResponse = z.infer<typeof FeedResponseSchema>;
export type ExploreFeedResponse = z.infer<typeof ExploreFeedResponseSchema>;
export type HomeFeedResponse = z.infer<typeof HomeFeedResponseSchema>;
export type ProfileData = z.infer<typeof ProfileDataSchema>;
export type ProfileFeedResponse = z.infer<typeof ProfileFeedResponseSchema>;
export type IUCNCategory = z.infer<typeof IUCNCategorySchema>;
export type ConservationStatus = z.infer<typeof ConservationStatusSchema>;
export type TaxaResult = z.infer<typeof TaxaResultSchema>;
export type TaxonAncestor = z.infer<typeof TaxonAncestorSchema>;
export type TaxonDetail = z.infer<typeof TaxonDetailSchema>;
export type GeoJSONFeature = z.infer<typeof GeoJSONFeatureSchema>;
export type GeoJSONFeatureCollection = z.infer<typeof GeoJSONFeatureCollectionSchema>;
export type User = z.infer<typeof UserSchema>;
export type AuthResponse = z.infer<typeof AuthResponseSchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
