import maplibregl from "maplibre-gl";
import { mapStyle } from "./mapStyle";

/** Approximate meters per degree of latitude at the equator */
export const METERS_PER_DEGREE = 111320;

/** Create a map instance with standard controls and collapsed attribution. */
export function createMap(
  container: HTMLElement,
  options: Omit<maplibregl.MapOptions, "container" | "style" | "attributionControl">,
): maplibregl.Map {
  const map = new maplibregl.Map({
    ...options,
    container,
    style: mapStyle,
    attributionControl: false,
  });

  map.addControl(new maplibregl.AttributionControl({ compact: true }));
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

  // Collapse attribution behind the (i) button once tiles load
  map.once("load", () => {
    container.querySelector(".maplibregl-ctrl-attrib")?.classList.remove("maplibregl-compact-show");
  });

  return map;
}

/** Color used for uncertainty circles and map markers */
export const MAP_MARKER_COLOR = "#22c55e";

/** Calculate lat/lng bounding box for a given radius in meters */
export function getRadiusBounds(
  lat: number,
  lng: number,
  radiusMeters: number,
): [[number, number], [number, number]] {
  const latOffset = radiusMeters / METERS_PER_DEGREE;
  const lngOffset = radiusMeters / (METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180));
  return [
    [lng - lngOffset, lat - latOffset],
    [lng + lngOffset, lat + latOffset],
  ];
}

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

/** Create a GeoJSON circle polygon from center point and radius in meters */
export function createCircleGeoJSON(
  lng: number,
  lat: number,
  radiusMeters: number,
): GeoJSON.FeatureCollection {
  const points = 64;
  const coords: [number, number][] = [];

  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);

    // Convert meters to degrees (approximate)
    const latOffset = dy / METERS_PER_DEGREE;
    const lngOffset = dx / (METERS_PER_DEGREE * Math.cos((lat * Math.PI) / 180));

    coords.push([lng + lngOffset, lat + latOffset]);
  }
  const first = coords[0];
  if (first) coords.push(first); // Close the polygon

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: {
          type: "Polygon",
          coordinates: [coords],
        },
      },
    ],
  };
}
