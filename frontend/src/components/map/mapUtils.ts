import type maplibregl from "maplibre-gl";

/** Color used for uncertainty circles and map markers */
export const MAP_MARKER_COLOR = "#22c55e";

/** Add uncertainty circle layers to a map instance */
export function addUncertaintyLayers(mapInstance: maplibregl.Map): void {
  mapInstance.addLayer({
    id: "uncertainty-fill",
    type: "fill",
    source: "uncertainty",
    paint: {
      "fill-color": MAP_MARKER_COLOR,
      "fill-opacity": 0.15,
    },
  });

  mapInstance.addLayer({
    id: "uncertainty-outline",
    type: "line",
    source: "uncertainty",
    paint: {
      "line-color": MAP_MARKER_COLOR,
      "line-width": 2,
      "line-opacity": 0.5,
    },
  });
}
