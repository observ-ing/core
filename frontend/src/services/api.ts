import type {
  User,
  FeedResponse,
  Occurrence,
  TaxaResult,
  TaxonDetail,
  GeoJSONFeatureCollection,
  FeedFilters,
  ExploreFeedResponse,
  HomeFeedResponse,
  ProfileFeedResponse,
  NotificationsResponse,
  OccurrenceDetailResponse,
} from "./types";

const API_BASE = import.meta.env["VITE_API_URL"] || "";
const DEFAULT_PAGE_SIZE = "20";

/**
 * Extract an error message from a failed fetch response.
 * Tries to parse the response body as JSON and extract `.error`,
 * falling back to the provided default message if parsing fails.
 */
async function extractErrorMessage(response: Response, defaultMessage: string): Promise<string> {
  try {
    const body = await response.json();
    if (body.error && typeof body.error === "string") {
      return body.error;
    }
  } catch {
    // JSON parsing failed, fall through to default
  }
  return defaultMessage;
}

async function fetchApi<T>(url: string, errorMessage: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, errorMessage));
  }
  return response.json() as Promise<T>;
}

export async function checkAuth(): Promise<User | null> {
  try {
    const response = await fetch(`${API_BASE}/oauth/me`, {
      credentials: "include",
    });
    if (response.ok) {
      const data = await response.json();
      return data.user ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export async function logout(): Promise<void> {
  await fetch(`${API_BASE}/oauth/logout`, {
    method: "POST",
    credentials: "include",
  });
}

export async function initiateLogin(handle: string): Promise<{ url: string }> {
  return fetchApi(
    `${API_BASE}/oauth/login?handle=${encodeURIComponent(handle)}`,
    "Failed to initiate login",
  );
}

export async function fetchFeed(cursor?: string): Promise<FeedResponse> {
  const params = new URLSearchParams({ limit: DEFAULT_PAGE_SIZE });
  if (cursor) {
    params.set("cursor", cursor);
  }

  return fetchApi(`${API_BASE}/api/occurrences/feed?${params}`, "Failed to load feed");
}

export async function fetchExploreFeed(
  cursor?: string,
  filters?: FeedFilters,
): Promise<ExploreFeedResponse> {
  const params = new URLSearchParams({ limit: DEFAULT_PAGE_SIZE });
  if (cursor) params.set("cursor", cursor);
  if (filters?.taxon) params.set("taxon", filters.taxon);
  if (filters?.lat !== undefined) params.set("lat", filters.lat.toString());
  if (filters?.lng !== undefined) params.set("lng", filters.lng.toString());
  if (filters?.radius) params.set("radius", filters.radius.toString());
  if (filters?.kingdom) params.set("kingdom", filters.kingdom);
  if (filters?.startDate) params.set("startDate", filters.startDate);
  if (filters?.endDate) params.set("endDate", filters.endDate);

  return fetchApi(`${API_BASE}/api/feeds/explore?${params}`, "Failed to load explore feed");
}

export async function fetchHomeFeed(
  cursor?: string,
  location?: { lat: number; lng: number; nearbyRadius?: number },
): Promise<HomeFeedResponse> {
  const params = new URLSearchParams({ limit: DEFAULT_PAGE_SIZE });
  if (cursor) params.set("cursor", cursor);
  if (location) {
    params.set("lat", location.lat.toString());
    params.set("lng", location.lng.toString());
    if (location.nearbyRadius) {
      params.set("nearbyRadius", location.nearbyRadius.toString());
    }
  }

  const response = await fetch(`${API_BASE}/api/feeds/home?${params}`, {
    credentials: "include",
  });
  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Authentication required");
    }
    throw new Error(await extractErrorMessage(response, "Failed to load home feed"));
  }

  return response.json();
}

export async function fetchProfileFeed(
  did: string,
  cursor?: string,
  type?: "observations" | "identifications",
): Promise<ProfileFeedResponse> {
  const params = new URLSearchParams({ limit: DEFAULT_PAGE_SIZE });
  if (cursor) params.set("cursor", cursor);
  if (type) params.set("type", type);

  return fetchApi(
    `${API_BASE}/api/profiles/${encodeURIComponent(did)}/feed?${params}`,
    "Failed to load profile feed",
  );
}

export async function fetchObservation(uri: string): Promise<OccurrenceDetailResponse | null> {
  try {
    const url = `${API_BASE}/api/occurrences/${encodeURIComponent(uri)}`;
    const response = await fetch(url);
    if (!response.ok) return null;
    return response.json();
  } catch (e) {
    console.error("fetchObservation error:", e);
    return null;
  }
}

export async function fetchObservationsGeoJSON(bounds: {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}): Promise<GeoJSONFeatureCollection> {
  const params = new URLSearchParams({
    minLat: bounds.minLat.toString(),
    minLng: bounds.minLng.toString(),
    maxLat: bounds.maxLat.toString(),
    maxLng: bounds.maxLng.toString(),
  });

  return fetchApi(`${API_BASE}/api/occurrences/geojson?${params}`, "Failed to load observations");
}

// ============================================================================
// Actor Search
// ============================================================================

export interface ActorSearchResult {
  did: string;
  handle: string;
  displayName?: string;
  avatar?: string;
}

export async function searchActors(query: string): Promise<ActorSearchResult[]> {
  if (query.length < 2) return [];

  const response = await fetch(`${API_BASE}/api/actors/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) return [];

  const data = await response.json();
  return data.actors || [];
}

export async function searchTaxa(query: string): Promise<TaxaResult[]> {
  if (query.length < 2) return [];

  const response = await fetch(`${API_BASE}/api/taxa/search?q=${encodeURIComponent(query)}`);
  if (!response.ok) return [];

  const data = await response.json();
  return data.results || [];
}

export async function submitObservation(data: {
  scientificName?: string;
  latitude: number;
  longitude: number;
  coordinateUncertaintyInMeters?: number;
  notes?: string;
  license?: string;
  eventDate: string;
  images?: Array<{ data: string; mimeType: string }>;
  // Taxonomy fields
  taxonId?: string;
  taxonRank?: string;
  vernacularName?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  // Co-observers
  recordedBy?: string[];
}): Promise<{ uri: string; cid: string }> {
  return fetchApi(`${API_BASE}/api/occurrences`, "Failed to submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
}

export async function updateObservation(data: {
  uri: string;
  scientificName?: string;
  latitude: number;
  longitude: number;
  coordinateUncertaintyInMeters?: number;
  notes?: string;
  license?: string;
  eventDate: string;
  images?: Array<{ data: string; mimeType: string }>;
  retainedBlobCids?: string[];
  // Taxonomy fields
  taxonId?: string;
  taxonRank?: string;
  vernacularName?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  // Co-observers
  recordedBy?: string[];
}): Promise<{ uri: string; cid: string }> {
  return fetchApi(`${API_BASE}/api/occurrences`, "Failed to update", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
}

export async function deleteObservation(uri: string): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/api/occurrences/${encodeURIComponent(uri)}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Session expired, please log in again");
    }
    throw new Error(await extractErrorMessage(response, "Failed to delete observation"));
  }

  return response.json();
}

export async function deleteIdentification(uri: string): Promise<{ success: boolean }> {
  const response = await fetch(`${API_BASE}/api/identifications/${encodeURIComponent(uri)}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error("Session expired, please log in again");
    }
    throw new Error(await extractErrorMessage(response, "Failed to delete identification"));
  }

  return response.json();
}

export function getImageUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export async function submitIdentification(data: {
  occurrenceUri: string;
  occurrenceCid: string;
  subjectIndex?: number;
  scientificName: string;
  taxonRank?: string;
  comment?: string;
  isAgreement?: boolean;
}): Promise<{ uri: string; cid: string }> {
  return fetchApi(`${API_BASE}/api/identifications`, "Failed to submit identification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
}

export async function submitComment(data: {
  occurrenceUri: string;
  occurrenceCid: string;
  body: string;
  replyToUri?: string;
  replyToCid?: string;
}): Promise<{ uri: string; cid: string }> {
  return fetchApi(`${API_BASE}/api/comments`, "Failed to submit comment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
}

/**
 * Fetch taxon details. Supports:
 * - kingdom + name: fetchTaxon("Plantae", "Quercus alba")
 * - kingdom only: fetchTaxon("Plantae")
 * - legacy ID: fetchTaxon("gbif:12345")
 */
export async function fetchTaxon(kingdomOrId: string, name?: string): Promise<TaxonDetail | null> {
  try {
    let url: string;
    if (name) {
      url = `${API_BASE}/api/taxa/${encodeURIComponent(kingdomOrId)}/${encodeURIComponent(name)}`;
    } else {
      url = `${API_BASE}/api/taxa/${encodeURIComponent(kingdomOrId)}`;
    }
    const response = await fetch(url);
    if (!response.ok) return null;
    return response.json();
  } catch (e) {
    console.error("fetchTaxon error:", e);
    return null;
  }
}

/**
 * Fetch observations for a taxon. Supports:
 * - kingdom + name: fetchTaxonObservations("Plantae", "Quercus alba", cursor?)
 * - kingdom only: fetchTaxonObservations("Plantae", undefined, cursor?)
 * - legacy ID: fetchTaxonObservations("gbif:12345", undefined, cursor?)
 */
export async function fetchTaxonObservations(
  kingdomOrId: string,
  name?: string,
  cursor?: string,
): Promise<{ occurrences: Occurrence[]; cursor?: string }> {
  const params = new URLSearchParams({ limit: DEFAULT_PAGE_SIZE });
  if (cursor) params.set("cursor", cursor);

  let url: string;
  if (name) {
    url = `${API_BASE}/api/taxa/${encodeURIComponent(kingdomOrId)}/${encodeURIComponent(name)}/occurrences?${params}`;
  } else {
    url = `${API_BASE}/api/taxa/${encodeURIComponent(kingdomOrId)}/occurrences?${params}`;
  }

  return fetchApi(url, "Failed to fetch taxon observations");
}

// ============================================================================
// Interaction API Functions
// ============================================================================

export interface InteractionResponse {
  uri: string;
  cid: string;
  did: string;
  subject_a_occurrence_uri: string | null;
  subject_a_occurrence_cid: string | null;
  subject_a_subject_index: number;
  subject_a_taxon_name: string | null;
  subject_a_kingdom: string | null;
  subject_b_occurrence_uri: string | null;
  subject_b_occurrence_cid: string | null;
  subject_b_subject_index: number;
  subject_b_taxon_name: string | null;
  subject_b_kingdom: string | null;
  interaction_type: string;
  direction: string;
  comment: string | null;
  created_at: string;
  creator?: {
    did: string;
    handle?: string;
    displayName?: string;
    avatar?: string;
  };
}

export async function submitInteraction(data: {
  subjectA: {
    occurrenceUri?: string;
    occurrenceCid?: string;
    subjectIndex?: number;
    scientificName?: string;
    kingdom?: string;
  };
  subjectB: {
    occurrenceUri?: string;
    occurrenceCid?: string;
    subjectIndex?: number;
    scientificName?: string;
    kingdom?: string;
  };
  interactionType: string;
  direction: "AtoB" | "BtoA" | "bidirectional";
  comment?: string;
}): Promise<{ uri: string; cid: string }> {
  return fetchApi(`${API_BASE}/api/interactions`, "Failed to submit interaction", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(data),
  });
}

export async function fetchInteractionsForOccurrence(
  occurrenceUri: string,
): Promise<{ interactions: InteractionResponse[] }> {
  const response = await fetch(
    `${API_BASE}/api/interactions/occurrence/${encodeURIComponent(occurrenceUri)}`,
  );
  if (!response.ok) {
    throw new Error(await extractErrorMessage(response, "Failed to fetch interactions"));
  }

  return response.json();
}

export async function likeObservation(
  occurrenceUri: string,
  occurrenceCid: string,
): Promise<{ uri: string; cid: string }> {
  return fetchApi(`${API_BASE}/api/likes`, "Failed to like observation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ occurrenceUri, occurrenceCid }),
  });
}

// ============================================================================
// Notification API Functions
// ============================================================================

export async function fetchNotifications(cursor?: string): Promise<NotificationsResponse> {
  const params = new URLSearchParams({ limit: DEFAULT_PAGE_SIZE });
  if (cursor) params.set("cursor", cursor);

  return fetchApi(`${API_BASE}/api/notifications?${params}`, "Failed to load notifications", {
    credentials: "include",
  });
}

export async function fetchUnreadCount(): Promise<{ count: number }> {
  return fetchApi(`${API_BASE}/api/notifications/unread-count`, "Failed to fetch unread count", {
    credentials: "include",
  });
}

export async function markNotificationRead(id?: number): Promise<{ success: boolean }> {
  return fetchApi(`${API_BASE}/api/notifications/read`, "Failed to mark notification read", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(id !== undefined ? { id } : {}),
  });
}

export async function unlikeObservation(occurrenceUri: string): Promise<{ success: boolean }> {
  return fetchApi(`${API_BASE}/api/likes`, "Failed to unlike observation", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ occurrenceUri }),
  });
}
