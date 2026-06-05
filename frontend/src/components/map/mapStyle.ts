import type { Theme } from "@mui/material";
import type { SystemStyleObject } from "@mui/system";

export type BasemapMode = "light" | "dark";
export type BasemapId = "outdoor" | "streets" | "satellite";

/** Basemaps offered in the selector, in display order. */
export const BASEMAPS: ReadonlyArray<{ id: BasemapId; label: string }> = [
  { id: "outdoor", label: "Outdoor" },
  { id: "streets", label: "Streets" },
  { id: "satellite", label: "Satellite" },
];

export const DEFAULT_BASEMAP: BasemapId = "outdoor";

// MapTiler style slug per basemap + theme. "satellite" uses the Hybrid style so
// place/road labels stay on top of the imagery, and imagery is identical in
// light and dark (no separate dark slug).
const MAPTILER_SLUGS: Record<BasemapId, { light: string; dark: string }> = {
  outdoor: { light: "outdoor-v2", dark: "outdoor-v2-dark" },
  streets: { light: "streets-v2", dark: "streets-v2-dark" },
  satellite: { light: "hybrid", dark: "hybrid" },
};

// Publishable MapTiler key, baked into the client bundle at build time. Safe to
// expose (restrict it by domain in the MapTiler dashboard). See .env.example.
const MAPTILER_KEY = import.meta.env["VITE_MAPTILER_KEY"] || "";

/** Whether MapTiler basemaps are available (i.e. a key is configured). */
export const MAPTILER_ENABLED = Boolean(MAPTILER_KEY);

let warnedNoKey = false;

/**
 * Basemap style URL for the given basemap + theme mode.
 *
 * MapTiler styles are label-dense and have real light/dark variants, which
 * matters when orienting where to ID an observation. When no key is configured
 * (local dev / CI) it falls back to keyless CARTO vector tiles so the map still
 * renders — the selector is hidden in that case (see MAPTILER_ENABLED).
 */
export function basemapStyleUrl(basemap: BasemapId, mode: BasemapMode): string {
  if (MAPTILER_KEY) {
    const slug = MAPTILER_SLUGS[basemap][mode];
    return `https://api.maptiler.com/maps/${slug}/style.json?key=${MAPTILER_KEY}`;
  }
  if (!warnedNoKey) {
    warnedNoKey = true;
    console.warn(
      "[map] VITE_MAPTILER_KEY is not set — falling back to keyless CARTO basemap. " +
        "Set it (see .env.example) to use the MapTiler basemaps.",
    );
  }
  return mode === "dark"
    ? "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
    : "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json";
}

/** Shared styles for the map container element. */
export const mapContainerSx: SystemStyleObject<Theme> = {
  width: "100%",
  height: 200,
  borderRadius: 1,
  overflow: "hidden",
  border: 1,
  borderColor: "divider",
};
