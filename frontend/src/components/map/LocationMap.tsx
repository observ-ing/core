import { useEffect, useRef } from "react";
import { Box, Typography, useTheme } from "@mui/material";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapContainerSx, MAPTILER_ENABLED } from "./mapStyle";
import {
  createCircleGeoJSON,
  createMap,
  getRadiusBounds,
  addUncertaintyLayers,
  setBasemapStyle,
} from "./mapUtils";
import { useBasemap } from "./useBasemap";
import { BasemapSelector } from "./BasemapSelector";
import maplibregl from "maplibre-gl";

export interface LocationMapProps {
  latitude: number;
  longitude: number;
  uncertaintyMeters?: number | undefined;
}

export function LocationMap({ latitude, longitude, uncertaintyMeters }: LocationMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const theme = useTheme();
  const mode = theme.palette.mode;
  const markerColor = theme.palette.mapMarker;
  const [basemap] = useBasemap();
  // Read the latest mode/basemap inside the create effect without making them
  // dependencies (theme/basemap changes swap the style in a separate effect
  // rather than rebuilding the map).
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;

  const validCoords = Number.isFinite(latitude) && Number.isFinite(longitude);

  useEffect(() => {
    if (!mapContainer.current || !validCoords) return;

    // Clean up any existing map (handles theme changes)
    if (map.current) {
      map.current.remove();
      map.current = null;
    }

    const { map: mapInstance } = createMap(
      mapContainer.current,
      {
        center: [longitude, latitude],
        zoom: 14,
        interactive: true,
        scrollZoom: false,
      },
      { geolocate: false, mode: modeRef.current, basemap: basemapRef.current },
    );

    mapInstance.on("load", () => {
      // Add marker
      new maplibregl.Marker({ color: markerColor })
        .setLngLat([longitude, latitude])
        .addTo(mapInstance);

      // Add uncertainty circle if provided
      if (uncertaintyMeters && uncertaintyMeters > 0) {
        mapInstance.addSource("uncertainty", {
          type: "geojson",
          data: createCircleGeoJSON(longitude, latitude, uncertaintyMeters),
        });

        addUncertaintyLayers(mapInstance, markerColor);

        // Fit map to uncertainty circle bounds
        mapInstance.fitBounds(getRadiusBounds(latitude, longitude, uncertaintyMeters), {
          padding: 40,
          maxZoom: 18,
        });
      }
    });

    map.current = mapInstance;

    return () => {
      mapInstance.remove();
      map.current = null;
    };
  }, [latitude, longitude, uncertaintyMeters, validCoords]);

  // Swap the style when the theme or basemap changes, without rebuilding the
  // map (skips the initial render — the map starts in the right style).
  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    if (map.current) setBasemapStyle(map.current, basemap, mode);
  }, [mode, basemap]);

  if (!validCoords) {
    return (
      <Box
        sx={[
          mapContainerSx,
          {
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "action.hover",
          },
        ]}
      >
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
          }}
        >
          Location unavailable
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={[{ position: "relative" }, mapContainerSx]}>
      {/* Fill the parent via width/height, NOT position:absolute+inset — maplibre
          adds `.maplibregl-map { position: relative }`, which ties on specificity
          with emotion's `position:absolute` and wins by load order in the prod CSS
          bundle, collapsing the container to height 0 (a blank map). */}
      <Box ref={mapContainer} sx={{ width: "100%", height: "100%" }} />
      {MAPTILER_ENABLED && <BasemapSelector />}
    </Box>
  );
}
