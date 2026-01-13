/**
 * BioSky - Decentralized Biodiversity Platform on AT Protocol
 *
 * Main entry point that exports all modules.
 */

// Types
export * from "./generated/types.js";

// Ingester
export { FirehoseSubscription, createFirehoseSubscription } from "./ingester/firehose.js";
export { Database } from "./ingester/database.js";
export { Ingester } from "./ingester/index.js";
export { MediaProxy } from "./ingester/media-proxy.js";

// Auth
export { OAuthService } from "./auth/oauth.js";
export { IdentityResolver, getIdentityResolver } from "./auth/identity.js";

// AppView
export { AppViewServer } from "./appview/api.js";
export { TaxonomyResolver } from "./appview/taxonomy.js";
export { CommunityIdCalculator, TaxonomicHierarchy } from "./appview/community-id.js";
