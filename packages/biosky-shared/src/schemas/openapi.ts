/**
 * OpenAPI spec generation for BioSky API
 *
 * Run with: npx tsx src/schemas/openapi.ts
 */

import {
  OpenAPIRegistry,
  OpenApiGeneratorV3,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

import {
  // Schemas
  ProfileSchema,
  ObserverSchema,
  SubjectSchema,
  LocationSchema,
  OccurrenceSchema,
  CreateOccurrenceRequestSchema,
  CreateOccurrenceResponseSchema,
  OccurrenceDetailResponseSchema,
  IdentificationSchema,
  CreateIdentificationRequestSchema,
  CommentSchema,
  CreateCommentRequestSchema,
  FeedFiltersSchema,
  FeedResponseSchema,
  ExploreFeedResponseSchema,
  HomeFeedResponseSchema,
  ProfileDataSchema,
  ProfileFeedResponseSchema,
  IUCNCategorySchema,
  ConservationStatusSchema,
  TaxaResultSchema,
  TaxonAncestorSchema,
  TaxonDetailSchema,
  GeoJSONFeatureSchema,
  GeoJSONFeatureCollectionSchema,
  UserSchema,
  AuthResponseSchema,
  ErrorResponseSchema,
} from "./index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const registry = new OpenAPIRegistry();

// Register all schemas
registry.register("Profile", ProfileSchema);
registry.register("Observer", ObserverSchema);
registry.register("Subject", SubjectSchema);
registry.register("Location", LocationSchema);
registry.register("Occurrence", OccurrenceSchema);
registry.register("CreateOccurrenceRequest", CreateOccurrenceRequestSchema);
registry.register("CreateOccurrenceResponse", CreateOccurrenceResponseSchema);
registry.register("Identification", IdentificationSchema);
registry.register("CreateIdentificationRequest", CreateIdentificationRequestSchema);
registry.register("Comment", CommentSchema);
registry.register("CreateCommentRequest", CreateCommentRequestSchema);
registry.register("FeedFilters", FeedFiltersSchema);
registry.register("FeedResponse", FeedResponseSchema);
registry.register("ExploreFeedResponse", ExploreFeedResponseSchema);
registry.register("HomeFeedResponse", HomeFeedResponseSchema);
registry.register("ProfileData", ProfileDataSchema);
registry.register("ProfileFeedResponse", ProfileFeedResponseSchema);
registry.register("IUCNCategory", IUCNCategorySchema);
registry.register("ConservationStatus", ConservationStatusSchema);
registry.register("TaxaResult", TaxaResultSchema);
registry.register("TaxonAncestor", TaxonAncestorSchema);
registry.register("TaxonDetail", TaxonDetailSchema);
registry.register("GeoJSONFeature", GeoJSONFeatureSchema);
registry.register("GeoJSONFeatureCollection", GeoJSONFeatureCollectionSchema);
registry.register("User", UserSchema);
registry.register("AuthResponse", AuthResponseSchema);
registry.register("ErrorResponse", ErrorResponseSchema);

// Register API paths
registry.registerPath({
  method: "get",
  path: "/oauth/me",
  tags: ["Auth"],
  summary: "Get current authenticated user",
  responses: {
    200: {
      description: "Current user info",
      content: { "application/json": { schema: AuthResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/oauth/logout",
  tags: ["Auth"],
  summary: "Logout current user",
  responses: {
    200: { description: "Logged out successfully" },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/occurrences/feed",
  tags: ["Occurrences"],
  summary: "Get chronological occurrence feed",
  request: {
    query: z.object({
      limit: z.string().optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Feed of occurrences",
      content: { "application/json": { schema: FeedResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/occurrences/nearby",
  tags: ["Occurrences"],
  summary: "Get occurrences near a location",
  request: {
    query: z.object({
      lat: z.string(),
      lng: z.string(),
      radius: z.string().optional(),
      limit: z.string().optional(),
      offset: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Nearby occurrences",
      content: { "application/json": { schema: FeedResponseSchema } },
    },
    400: {
      description: "Invalid parameters",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/occurrences/geojson",
  tags: ["Occurrences"],
  summary: "Get occurrences as GeoJSON for mapping",
  request: {
    query: z.object({
      minLat: z.string(),
      minLng: z.string(),
      maxLat: z.string(),
      maxLng: z.string(),
    }),
  },
  responses: {
    200: {
      description: "GeoJSON feature collection",
      content: { "application/json": { schema: GeoJSONFeatureCollectionSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/occurrences/{uri}",
  tags: ["Occurrences"],
  summary: "Get single occurrence with identifications and comments",
  request: {
    params: z.object({ uri: z.string() }),
  },
  responses: {
    200: {
      description: "Occurrence detail",
      content: { "application/json": { schema: OccurrenceDetailResponseSchema } },
    },
    404: {
      description: "Occurrence not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/occurrences",
  tags: ["Occurrences"],
  summary: "Create a new occurrence",
  request: {
    body: {
      content: { "application/json": { schema: CreateOccurrenceRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Occurrence created",
      content: { "application/json": { schema: CreateOccurrenceResponseSchema } },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Authentication required",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/feeds/explore",
  tags: ["Feeds"],
  summary: "Get explore feed with optional filters",
  request: {
    query: z.object({
      limit: z.string().optional(),
      cursor: z.string().optional(),
      taxon: z.string().optional(),
      lat: z.string().optional(),
      lng: z.string().optional(),
      radius: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Explore feed",
      content: { "application/json": { schema: ExploreFeedResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/feeds/home",
  tags: ["Feeds"],
  summary: "Get personalized home feed (requires auth)",
  request: {
    query: z.object({
      limit: z.string().optional(),
      cursor: z.string().optional(),
      lat: z.string().optional(),
      lng: z.string().optional(),
      nearbyRadius: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Home feed",
      content: { "application/json": { schema: HomeFeedResponseSchema } },
    },
    401: {
      description: "Authentication required",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/profiles/{did}/feed",
  tags: ["Profiles"],
  summary: "Get user profile feed",
  request: {
    params: z.object({ did: z.string() }),
    query: z.object({
      limit: z.string().optional(),
      cursor: z.string().optional(),
      type: z.enum(["observations", "identifications", "all"]).optional(),
    }),
  },
  responses: {
    200: {
      description: "Profile feed",
      content: { "application/json": { schema: ProfileFeedResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/identifications",
  tags: ["Identifications"],
  summary: "Create identification for an occurrence",
  request: {
    body: {
      content: { "application/json": { schema: CreateIdentificationRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Identification created",
      content: { "application/json": { schema: CreateOccurrenceResponseSchema } },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Authentication required",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "post",
  path: "/api/comments",
  tags: ["Comments"],
  summary: "Create comment on an occurrence",
  request: {
    body: {
      content: { "application/json": { schema: CreateCommentRequestSchema } },
    },
  },
  responses: {
    201: {
      description: "Comment created",
      content: { "application/json": { schema: CreateOccurrenceResponseSchema } },
    },
    400: {
      description: "Invalid request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Authentication required",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/taxa/search",
  tags: ["Taxonomy"],
  summary: "Search taxa by name",
  request: {
    query: z.object({ q: z.string().min(2) }),
  },
  responses: {
    200: {
      description: "Search results",
      content: {
        "application/json": {
          schema: z.object({ results: z.array(TaxaResultSchema) }),
        },
      },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/taxa/{id}",
  tags: ["Taxonomy"],
  summary: "Get taxon details",
  request: {
    params: z.object({ id: z.string() }),
  },
  responses: {
    200: {
      description: "Taxon details",
      content: { "application/json": { schema: TaxonDetailSchema } },
    },
    404: {
      description: "Taxon not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

registry.registerPath({
  method: "get",
  path: "/api/taxa/{id}/occurrences",
  tags: ["Taxonomy"],
  summary: "Get occurrences for a taxon",
  request: {
    params: z.object({ id: z.string() }),
    query: z.object({
      limit: z.string().optional(),
      cursor: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: "Taxon occurrences",
      content: { "application/json": { schema: FeedResponseSchema } },
    },
  },
});

// Generate the OpenAPI document
const generator = new OpenApiGeneratorV3(registry.definitions);

const doc = generator.generateDocument({
  openapi: "3.0.3",
  info: {
    title: "BioSky API",
    version: "1.0.0",
    description: "Decentralized biodiversity observation platform API",
  },
  servers: [
    { url: "http://localhost:3000", description: "Local development" },
  ],
});

// Write to file
const outputPath = path.join(__dirname, "../../openapi.json");
fs.writeFileSync(outputPath, JSON.stringify(doc, null, 2));
console.log(`OpenAPI spec written to ${outputPath}`);

export { doc as openapiDocument };
