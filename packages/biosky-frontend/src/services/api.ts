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
} from "./types";

const API_BASE = import.meta.env.VITE_API_URL || "";

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

export function getLoginUrl(handle: string): string {
  return `${API_BASE}/oauth/login?handle=${encodeURIComponent(handle)}`;
}

export async function fetchFeed(cursor?: string): Promise<FeedResponse> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) {
    params.set("cursor", cursor);
  }

  const response = await fetch(`${API_BASE}/api/occurrences/feed?${params}`);
  if (!response.ok) {
    throw new Error("Failed to load feed");
  }

  return response.json();
}

export async function fetchExploreFeed(
  cursor?: string,
  filters?: FeedFilters
): Promise<ExploreFeedResponse> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  if (filters?.taxon) params.set("taxon", filters.taxon);
  if (filters?.lat !== undefined) params.set("lat", filters.lat.toString());
  if (filters?.lng !== undefined) params.set("lng", filters.lng.toString());
  if (filters?.radius) params.set("radius", filters.radius.toString());

  const response = await fetch(`${API_BASE}/api/feeds/explore?${params}`);
  if (!response.ok) {
    throw new Error("Failed to load explore feed");
  }

  return response.json();
}

export async function fetchHomeFeed(
  cursor?: string,
  location?: { lat: number; lng: number; nearbyRadius?: number }
): Promise<HomeFeedResponse> {
  const params = new URLSearchParams({ limit: "20" });
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
    throw new Error("Failed to load home feed");
  }

  return response.json();
}

export async function fetchProfileFeed(
  did: string,
  cursor?: string,
  type?: "observations" | "identifications" | "all"
): Promise<ProfileFeedResponse> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);
  if (type) params.set("type", type);

  const response = await fetch(
    `${API_BASE}/api/profiles/${encodeURIComponent(did)}/feed?${params}`
  );
  if (!response.ok) {
    throw new Error("Failed to load profile feed");
  }

  return response.json();
}

export async function fetchObservation(
  uri: string
): Promise<{ occurrence: Occurrence } | null> {
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

  const response = await fetch(`${API_BASE}/api/occurrences/geojson?${params}`);
  if (!response.ok) {
    throw new Error("Failed to load observations");
  }

  return response.json();
}

export async function searchTaxa(query: string): Promise<TaxaResult[]> {
  if (query.length < 2) return [];

  const response = await fetch(
    `${API_BASE}/api/taxa/search?q=${encodeURIComponent(query)}`
  );
  if (!response.ok) return [];

  const data = await response.json();
  return data.results || [];
}

export async function submitObservation(data: {
  scientificName: string;
  latitude: number;
  longitude: number;
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
  const response = await fetch(`${API_BASE}/api/occurrences`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to submit");
  }

  return response.json();
}

export async function updateObservation(data: {
  uri: string;
  scientificName: string;
  latitude: number;
  longitude: number;
  notes?: string;
  license?: string;
  eventDate: string;
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
  const response = await fetch(`${API_BASE}/api/occurrences`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to update");
  }

  return response.json();
}

export async function deleteObservation(uri: string): Promise<{ success: boolean }> {
  const response = await fetch(
    `${API_BASE}/api/occurrences/${encodeURIComponent(uri)}`,
    {
      method: "DELETE",
      credentials: "include",
    }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to delete observation");
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
  taxonName: string;
  taxonRank?: string;
  comment?: string;
  isAgreement?: boolean;
  confidence?: "low" | "medium" | "high";
}): Promise<{ uri: string; cid: string }> {
  const response = await fetch(`${API_BASE}/api/identifications`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to submit identification");
  }

  return response.json();
}

export async function submitComment(data: {
  occurrenceUri: string;
  occurrenceCid: string;
  body: string;
  replyToUri?: string;
  replyToCid?: string;
}): Promise<{ uri: string; cid: string }> {
  const response = await fetch(`${API_BASE}/api/comments`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || "Failed to submit comment");
  }

  return response.json();
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
  cursor?: string
): Promise<{ occurrences: Occurrence[]; cursor?: string }> {
  const params = new URLSearchParams({ limit: "20" });
  if (cursor) params.set("cursor", cursor);

  let url: string;
  if (name) {
    url = `${API_BASE}/api/taxa/${encodeURIComponent(kingdomOrId)}/${encodeURIComponent(name)}/occurrences?${params}`;
  } else {
    url = `${API_BASE}/api/taxa/${encodeURIComponent(kingdomOrId)}/occurrences?${params}`;
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error("Failed to fetch taxon observations");
  }

  return response.json();
}
