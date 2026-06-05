import { useCallback, useEffect, useState } from "react";
import { DEFAULT_BASEMAP, isBasemapId, type BasemapId } from "./mapStyle";
import { useAppSelector } from "../../store";
import { useUserPreferences } from "../../lib/query/hooks";
import { useUpdatePreferences } from "../../lib/query/mutations";

const STORAGE_KEY = "observing-basemap";
const CHANGE_EVENT = "observing-basemap-change";

function getStoredBasemap(): BasemapId {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return isBasemapId(value) ? value : DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP;
  }
}

function setStoredBasemap(id: BasemapId): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // Storage disabled (private mode) — the change event still syncs this tab.
  }
  // The native `storage` event only fires in *other* tabs, so dispatch our own
  // so every map in this document updates immediately.
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT));
}

/**
 * Effective basemap + setter. The choice is persisted in localStorage (so it
 * works logged-out and across reloads, and stays in sync across every map and
 * tab) AND, when signed in, synced to the user's server preferences so it
 * follows them across devices.
 */
export function useBasemap(): [BasemapId, (id: BasemapId) => void] {
  const isAuthenticated = useAppSelector((s) => s.auth.user !== null);
  const { data: prefs } = useUserPreferences();
  const updatePrefs = useUpdatePreferences();

  // Local copy drives the logged-out case + instant updates; synced across maps
  // and tabs via the custom + storage events.
  const [local, setLocal] = useState<BasemapId>(getStoredBasemap);
  useEffect(() => {
    const sync = () => setLocal(getStoredBasemap());
    window.addEventListener(CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // When signed in, the saved server value is authoritative. Mirror it into
  // localStorage so it persists and every map picks it up.
  const serverBasemap = prefs && isBasemapId(prefs.basemap) ? prefs.basemap : undefined;
  useEffect(() => {
    if (serverBasemap && serverBasemap !== getStoredBasemap()) setStoredBasemap(serverBasemap);
  }, [serverBasemap]);

  const basemap = serverBasemap ?? local;

  const setBasemap = useCallback(
    (id: BasemapId) => {
      setStoredBasemap(id); // instant local update for every map (+ logged-out persistence)
      if (isAuthenticated) updatePrefs.mutate({ basemap: id });
    },
    [isAuthenticated, updatePrefs],
  );

  return [basemap, setBasemap];
}
