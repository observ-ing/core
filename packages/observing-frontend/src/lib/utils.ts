/**
 * Shared utility functions for the Observ.ing frontend
 */

/**
 * Format a Date as a compact relative time string (e.g., "now", "5m", "2h", "3d")
 * For dates older than a week, returns a formatted date string.
 */
export function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Format a date string as a relative time with "ago" suffix (e.g., "5m ago", "2h ago")
 * For dates older than a week, returns a formatted date string without "ago".
 */
export function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

/**
 * Format a date string as a long-form date (e.g., "January 15, 2024")
 */
export function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Generate a PDSLS URL for viewing an AT Protocol record
 */
export function getPdslsUrl(atUri: string): string {
  return `https://pdsls.dev/${atUri}`;
}

/**
 * Parse an AT URI into its components
 * Format: at://did:plc:xxx/collection/rkey
 */
export function parseAtUri(atUri: string): { did: string; collection: string; rkey: string } | null {
  const match = atUri.match(/^at:\/\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  return { did: match[1], collection: match[2], rkey: match[3] };
}

/**
 * Build an observation URL from an AT URI
 * Converts: at://did:plc:xxx/org.rwell.test.occurrence/rkey
 * To: /observation/did:plc:xxx/rkey
 */
export function getObservationUrl(atUri: string): string {
  const parsed = parseAtUri(atUri);
  if (!parsed) return `/observation/${encodeURIComponent(atUri)}`;
  return `/observation/${parsed.did}/${parsed.rkey}`;
}

/**
 * Reconstruct an AT URI from did and rkey (for occurrences)
 */
export function buildOccurrenceAtUri(did: string, rkey: string): string {
  return `at://${did}/org.rwell.test.occurrence/${rkey}`;
}
