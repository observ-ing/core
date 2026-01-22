import type {
  User,
  FeedResponse,
  Occurrence,
  TaxaResult,
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

export async function fetchOccurrence(
  uri: string
): Promise<{ occurrence: Occurrence } | null> {
  try {
    const url = `${API_BASE}/api/occurrences/${encodeURIComponent(uri)}`;
    console.log("fetchOccurrence - uri:", uri);
    console.log("fetchOccurrence - url:", url);
    const response = await fetch(url);
    console.log("fetchOccurrence - response status:", response.status);
    if (!response.ok) return null;
    return response.json();
  } catch (e) {
    console.error("fetchOccurrence error:", e);
    return null;
  }
}

export async function fetchOccurrencesGeoJSON(bounds: {
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
    throw new Error("Failed to load occurrences");
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

export async function submitOccurrence(data: {
  scientificName: string;
  latitude: number;
  longitude: number;
  notes?: string;
  eventDate: string;
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

export function getImageUrl(path: string): string {
  return `${API_BASE}${path}`;
}
