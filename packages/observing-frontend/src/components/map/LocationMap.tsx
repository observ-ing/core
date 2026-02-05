import { useEffect, useRef } from "react";
import { Box, useTheme } from "@mui/material";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface LocationMapProps {
  latitude: number;
  longitude: number;
  uncertaintyMeters?: number;
}

export function LocationMap({
  latitude,
  longitude,
  uncertaintyMeters,
}: LocationMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const theme = useTheme();

  useEffect(() => {
    if (!mapContainer.current) return;

    // Clean up any existing map (handles theme changes)
    if (map.current) {
      map.current.remove();
      map.current = null;
    }

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
      center: [longitude, latitude],
      zoom: 14,
      interactive: true,
      scrollZoom: false,
    });

    mapInstance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right"
    );

    mapInstance.on("load", () => {
      // Add marker
      new maplibregl.Marker({ color: "#22c55e" })
        .setLngLat([longitude, latitude])
        .addTo(mapInstance);

      // Add uncertainty circle if provided
      if (uncertaintyMeters && uncertaintyMeters > 0) {
        mapInstance.addSource("uncertainty", {
          type: "geojson",
          data: createCircleGeoJSON(longitude, latitude, uncertaintyMeters),
        });

        mapInstance.addLayer({
          id: "uncertainty-fill",
          type: "fill",
          source: "uncertainty",
          paint: {
            "fill-color": "#22c55e",
            "fill-opacity": 0.15,
          },
        });

        mapInstance.addLayer({
          id: "uncertainty-outline",
          type: "line",
          source: "uncertainty",
          paint: {
            "line-color": "#22c55e",
            "line-width": 2,
            "line-opacity": 0.5,
          },
        });

        // Fit map to uncertainty circle bounds
        const latOffset = uncertaintyMeters / 111320;
        const lngOffset = uncertaintyMeters / (111320 * Math.cos((latitude * Math.PI) / 180));
        mapInstance.fitBounds(
          [
            [longitude - lngOffset, latitude - latOffset],
            [longitude + lngOffset, latitude + latOffset],
          ],
          { padding: 40, maxZoom: 18 }
        );
      }
    });

    map.current = mapInstance;

    return () => {
      mapInstance.remove();
      map.current = null;
    };
    // Include theme.palette.mode to recreate map on theme change
  }, [latitude, longitude, uncertaintyMeters, theme.palette.mode]);

  return (
    <Box
      ref={mapContainer}
      sx={{
        position: "relative",
        width: "100%",
        height: 200,
        borderRadius: 1,
        overflow: "hidden",
        border: 1,
        borderColor: "divider",
      }}
    />
  );
}

// Create a GeoJSON circle polygon from center point and radius in meters
function createCircleGeoJSON(
  lng: number,
  lat: number,
  radiusMeters: number
): GeoJSON.FeatureCollection {
  const points = 64;
  const coords: [number, number][] = [];

  for (let i = 0; i < points; i++) {
    const angle = (i / points) * 2 * Math.PI;
    const dx = radiusMeters * Math.cos(angle);
    const dy = radiusMeters * Math.sin(angle);

    // Convert meters to degrees (approximate)
    const latOffset = dy / 111320;
    const lngOffset = dx / (111320 * Math.cos((lat * Math.PI) / 180));

    coords.push([lng + lngOffset, lat + latOffset]);
  }
  coords.push(coords[0]); // Close the polygon

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
