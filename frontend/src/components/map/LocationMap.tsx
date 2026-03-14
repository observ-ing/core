import { useEffect, useRef } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapStyle, darkMapFilter } from "./mapStyle";
import { createCircleGeoJSON, METERS_PER_DEGREE } from "./mapUtils";

export interface LocationMapProps {
  latitude: number;
  longitude: number;
  uncertaintyMeters?: number | undefined;
}

export function LocationMap({ latitude, longitude, uncertaintyMeters }: LocationMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const theme = useTheme();

  const validCoords = Number.isFinite(latitude) && Number.isFinite(longitude);

  useEffect(() => {
    if (!mapContainer.current || !validCoords) return;

    // Clean up any existing map (handles theme changes)
    if (map.current) {
      map.current.remove();
      map.current = null;
    }

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: mapStyle,
      center: [longitude, latitude],
      zoom: 14,
      interactive: true,
      scrollZoom: false,
    });

    mapInstance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right",
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
        const latOffset = uncertaintyMeters / METERS_PER_DEGREE;
        const lngOffset =
          uncertaintyMeters / (METERS_PER_DEGREE * Math.cos((latitude * Math.PI) / 180));
        mapInstance.fitBounds(
          [
            [longitude - lngOffset, latitude - latOffset],
            [longitude + lngOffset, latitude + latOffset],
          ],
          { padding: 40, maxZoom: 18 },
        );
      }
    });

    map.current = mapInstance;

    return () => {
      mapInstance.remove();
      map.current = null;
    };
  }, [latitude, longitude, uncertaintyMeters, validCoords]);

  if (!validCoords) {
    return (
      <Box
        sx={{
          width: "100%",
          height: 200,
          borderRadius: 1,
          overflow: "hidden",
          border: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          bgcolor: "action.hover",
        }}
      >
        <Typography variant="body2" color="text.secondary">
          Location unavailable
        </Typography>
      </Box>
    );
  }

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
        ...(theme.palette.mode === "dark" && darkMapFilter),
      }}
    />
  );
}
