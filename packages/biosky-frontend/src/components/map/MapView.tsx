import { useEffect, useRef } from "react";
import { Box } from "@mui/material";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  fetchObservationsGeoJSON,
  fetchObservation,
  getImageUrl,
} from "../../services/api";
import type { Occurrence } from "../../services/types";

export function MapView() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);

  useEffect(() => {
    if (!mapContainer.current || map.current) return;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: [
              "https://a.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://b.tile.openstreetmap.org/{z}/{x}/{y}.png",
              "https://c.tile.openstreetmap.org/{z}/{x}/{y}.png",
            ],
            tileSize: 256,
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: [-122.4194, 37.7749],
      zoom: 10,
    });

    mapInstance.addControl(new maplibregl.NavigationControl(), "bottom-right");

    mapInstance.on("load", () => {
      mapInstance.addSource("observations", {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      mapInstance.addLayer({
        id: "clusters",
        type: "circle",
        source: "observations",
        filter: ["has", "point_count"],
        paint: {
          "circle-color": "#22c55e",
          "circle-radius": [
            "step",
            ["get", "point_count"],
            20,
            10,
            25,
            50,
            30,
            100,
            35,
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0a0a0a",
        },
      });

      mapInstance.addLayer({
        id: "observation-points",
        type: "circle",
        source: "observations",
        filter: ["!", ["has", "point_count"]],
        paint: {
          "circle-color": "#22c55e",
          "circle-radius": 8,
          "circle-stroke-width": 2,
          "circle-stroke-color": "#0a0a0a",
        },
      });

      mapInstance.on("moveend", () => {
        loadObservations(mapInstance);
      });

      loadObservations(mapInstance);
    });

    mapInstance.on("click", "clusters", async (e) => {
      const features = mapInstance.queryRenderedFeatures(e.point, {
        layers: ["clusters"],
      });
      const clusterId = features[0].properties?.cluster_id;
      const source = mapInstance.getSource(
        "observations"
      ) as maplibregl.GeoJSONSource;
      try {
        const zoom = await source.getClusterExpansionZoom(clusterId);
        const geometry = features[0].geometry;
        if (geometry.type === "Point") {
          mapInstance.easeTo({
            center: geometry.coordinates as [number, number],
            zoom,
          });
        }
      } catch {
        // Ignore cluster expansion errors
      }
    });

    mapInstance.on("click", "observation-points", async (e) => {
      const feature = e.features?.[0];
      if (!feature) return;

      const props = feature.properties;
      const geometry = feature.geometry;
      if (geometry.type !== "Point") return;

      const result = await fetchObservation(props?.uri);
      if (!result) return;

      showPopup(
        mapInstance,
        result.occurrence,
        geometry.coordinates as [number, number]
      );
    });

    mapInstance.on("mouseenter", "clusters", () => {
      mapInstance.getCanvas().style.cursor = "pointer";
    });
    mapInstance.on("mouseleave", "clusters", () => {
      mapInstance.getCanvas().style.cursor = "";
    });
    mapInstance.on("mouseenter", "observation-points", () => {
      mapInstance.getCanvas().style.cursor = "pointer";
    });
    mapInstance.on("mouseleave", "observation-points", () => {
      mapInstance.getCanvas().style.cursor = "";
    });

    map.current = mapInstance;

    return () => {
      mapInstance.remove();
      map.current = null;
    };
  }, []);

  return (
    <Box sx={{ flex: 1, position: "relative" }}>
      <Box ref={mapContainer} sx={{ width: "100%", height: "100%" }} />
    </Box>
  );
}

async function loadObservations(map: maplibregl.Map) {
  const bounds = map.getBounds();
  try {
    const geojson = await fetchObservationsGeoJSON({
      minLat: bounds.getSouth(),
      minLng: bounds.getWest(),
      maxLat: bounds.getNorth(),
      maxLng: bounds.getEast(),
    });
    // Check if source still exists (map may have been removed)
    const source = map.getSource("observations") as
      | maplibregl.GeoJSONSource
      | undefined;
    if (source) {
      source.setData(geojson);
    }
  } catch {
    // Silently ignore errors (map may have been removed)
  }
}

function showPopup(
  map: maplibregl.Map,
  observation: Occurrence,
  coords: [number, number]
) {
  const imageHtml = observation.images[0]
    ? `<img src="${getImageUrl(observation.images[0])}" alt="${observation.scientificName}" style="width: 100%; border-radius: 0.5rem; margin-bottom: 0.5rem;" />`
    : "";

  const detailUrl = `/observation/${encodeURIComponent(observation.uri)}`;

  new maplibregl.Popup({ maxWidth: "300px" })
    .setLngLat(coords)
    .setHTML(
      `
      <div class="observation-popup" style="padding: 1rem;">
        ${imageHtml}
        <h3 style="font-size: 1rem; font-style: italic; color: #22c55e; margin-bottom: 0.25rem;">
          ${observation.scientificName || "Unknown species"}
        </h3>
        <div style="font-size: 0.875rem; color: #999; margin-bottom: 0.5rem;">
          by @${observation.observer.handle || observation.observer.did.slice(0, 20)}
        </div>
        <div style="font-size: 0.75rem; color: #666; margin-bottom: 0.75rem;">
          ${new Date(observation.eventDate).toLocaleDateString()}
          ${observation.verbatimLocality ? ` &bull; ${observation.verbatimLocality}` : ""}
        </div>
        <a href="${detailUrl}" style="display: block; text-align: center; padding: 0.5rem; background: #22c55e; color: #0a0a0a; border-radius: 0.375rem; text-decoration: none; font-size: 0.875rem; font-weight: 500;">
          View Details
        </a>
      </div>
    `
    )
    .addTo(map);
}
