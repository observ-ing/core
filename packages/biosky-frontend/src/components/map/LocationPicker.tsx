import { useEffect, useRef, useCallback } from "react";
import { Box, Typography } from "@mui/material";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface LocationPickerProps {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number) => void;
}

export function LocationPicker({
  latitude,
  longitude,
  onChange,
}: LocationPickerProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);

  const updateMarker = useCallback(
    (lng: number, lat: number) => {
      if (!map.current) return;

      if (marker.current) {
        marker.current.setLngLat([lng, lat]);
      } else {
        marker.current = new maplibregl.Marker({ color: "#22c55e" })
          .setLngLat([lng, lat])
          .addTo(map.current);
      }
    },
    []
  );

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
      center: [longitude, latitude],
      zoom: 12,
    });

    mapInstance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right"
    );

    mapInstance.on("load", () => {
      updateMarker(longitude, latitude);
    });

    mapInstance.on("click", (e) => {
      const { lng, lat } = e.lngLat;
      updateMarker(lng, lat);
      onChange(lat, lng);
    });

    map.current = mapInstance;

    return () => {
      marker.current?.remove();
      mapInstance.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  // Update marker and center when props change externally
  useEffect(() => {
    if (map.current && marker.current) {
      const currentPos = marker.current.getLngLat();
      if (
        Math.abs(currentPos.lat - latitude) > 0.0001 ||
        Math.abs(currentPos.lng - longitude) > 0.0001
      ) {
        updateMarker(longitude, latitude);
        map.current.setCenter([longitude, latitude]);
      }
    }
  }, [latitude, longitude, updateMarker]);

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Location (click map to set)
      </Typography>
      <Box
        ref={mapContainer}
        sx={{
          width: "100%",
          height: 200,
          borderRadius: 1,
          overflow: "hidden",
          border: 1,
          borderColor: "divider",
        }}
      />
      <Typography
        variant="caption"
        color="text.disabled"
        sx={{ display: "block", mt: 0.5 }}
      >
        {latitude.toFixed(6)}, {longitude.toFixed(6)}
      </Typography>
    </Box>
  );
}
