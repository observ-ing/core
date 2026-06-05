import { useCallback, useEffect, useState } from "react";
import { BASEMAPS, DEFAULT_BASEMAP, type BasemapId } from "./mapStyle";

const STORAGE_KEY = "observing-basemap";
const CHANGE_EVENT = "observing-basemap-change";

const isBasemapId = (value: string | null): value is BasemapId =>
  BASEMAPS.some((b) => b.id === value);

export function getStoredBasemap(): BasemapId {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isBasemapId(value) ? value : DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP;
  }
}

export function setStoredBasemap(id: BasemapId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage disabled (private mode) — keep the in-memory choice via the event.
  }
  // The native `storage` event only fires in *other* tabs, so dispatch our own
  // so every map in this document updates immediately.
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/**
 * Persisted basemap preference, shared across every map in the app and synced
 * live between components (and across tabs).
 */
export function useBasemap(): [BasemapId, (id: BasemapId) => void] {
  const [basemap, setLocal] = useState<BasemapId>(getStoredBasemap);

  useEffect(() => {
    const sync = () => setLocal(getStoredBasemap());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const setBasemap = useCallback((id: BasemapId) => setStoredBasemap(id), []);
  return [basemap, setBasemap];
}
