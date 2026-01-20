import type {
  User,
  FeedResponse,
  Observation,
  TaxaResult,
  GeoJSONFeatureCollection,
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

export async function fetchObservation(
  uri: string
): Promise<{ observation: Observation } | null> {
  try {
    const url = `${API_BASE}/api/occurrences/${encodeURIComponent(uri)}`;
    console.log("fetchObservation - uri:", uri);
    console.log("fetchObservation - url:", url);
    const response = await fetch(url);
    console.log("fetchObservation - response status:", response.status);
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
