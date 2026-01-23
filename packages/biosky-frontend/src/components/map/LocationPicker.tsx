import { useEffect, useRef, useCallback, useState } from "react";
import {
  Box,
  Typography,
  TextField,
  Autocomplete,
  Stack,
  InputAdornment,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

interface LocationPickerProps {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number) => void;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
}

export function LocationPicker({
  latitude,
  longitude,
  onChange,
}: LocationPickerProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [latInput, setLatInput] = useState(latitude.toFixed(6));
  const [lngInput, setLngInput] = useState(longitude.toFixed(6));

  const updateMarker = useCallback((lng: number, lat: number) => {
    if (!map.current) return;

    if (marker.current) {
      marker.current.setLngLat([lng, lat]);
    } else {
      marker.current = new maplibregl.Marker({ color: "#22c55e" })
        .setLngLat([lng, lat])
        .addTo(map.current);
    }
  }, []);

  const flyToLocation = useCallback(
    (lat: number, lng: number) => {
      if (map.current) {
        map.current.flyTo({ center: [lng, lat], zoom: 14 });
      }
      updateMarker(lng, lat);
      onChange(lat, lng);
      setLatInput(lat.toFixed(6));
      setLngInput(lng.toFixed(6));
    },
    [onChange, updateMarker]
  );

  // Search Nominatim
  useEffect(() => {
    if (searchQuery.length < 3) {
      setSearchResults([]);
      return;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=5`,
          {
            signal: controller.signal,
            headers: {
              "User-Agent": "BioSky/1.0",
            },
          }
        );
        if (response.ok) {
          const data: NominatimResult[] = await response.json();
          setSearchResults(data);
        }
      } catch (error) {
        if (!(error instanceof Error && error.name === "AbortError")) {
          console.error("Geocoding error:", error);
        }
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      clearTimeout(timeoutId);
      controller.abort();
    };
  }, [searchQuery]);

  // Initialize map
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
      setLatInput(lat.toFixed(6));
      setLngInput(lng.toFixed(6));
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
        setLatInput(latitude.toFixed(6));
        setLngInput(longitude.toFixed(6));
      }
    }
  }, [latitude, longitude, updateMarker]);

  const handleLatChange = (value: string) => {
    setLatInput(value);
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && parsed >= -90 && parsed <= 90) {
      const lng = parseFloat(lngInput);
      if (!isNaN(lng)) {
        updateMarker(lng, parsed);
        map.current?.setCenter([lng, parsed]);
        onChange(parsed, lng);
      }
    }
  };

  const handleLngChange = (value: string) => {
    setLngInput(value);
    const parsed = parseFloat(value);
    if (!isNaN(parsed) && parsed >= -180 && parsed <= 180) {
      const lat = parseFloat(latInput);
      if (!isNaN(lat)) {
        updateMarker(parsed, lat);
        map.current?.setCenter([parsed, lat]);
        onChange(lat, parsed);
      }
    }
  };

  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
        Location
      </Typography>

      <Autocomplete
        freeSolo
        options={searchResults}
        getOptionLabel={(option) =>
          typeof option === "string" ? option : option.display_name
        }
        inputValue={searchQuery}
        onInputChange={(_, value) => setSearchQuery(value)}
        onChange={(_, value) => {
          if (value && typeof value !== "string") {
            flyToLocation(parseFloat(value.lat), parseFloat(value.lon));
            setSearchQuery("");
          }
        }}
        loading={isSearching}
        filterOptions={(x) => x}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            placeholder="Search for a place..."
            InputProps={{
              ...params.InputProps,
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" sx={{ color: "text.disabled" }} />
                </InputAdornment>
              ),
            }}
            sx={{ mb: 1 }}
          />
        )}
        renderOption={(props, option) => {
          const { key, ...otherProps } = props;
          return (
            <Box
              component="li"
              key={key}
              {...otherProps}
              sx={{ fontSize: "0.875rem" }}
            >
              {option.display_name}
            </Box>
          );
        }}
      />

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

      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <TextField
          size="small"
          label="Latitude"
          value={latInput}
          onChange={(e) => handleLatChange(e.target.value)}
          inputProps={{ inputMode: "decimal" }}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          label="Longitude"
          value={lngInput}
          onChange={(e) => handleLngChange(e.target.value)}
          inputProps={{ inputMode: "decimal" }}
          sx={{ flex: 1 }}
        />
      </Stack>

      <Typography
        variant="caption"
        color="text.disabled"
        sx={{ display: "block", mt: 0.5 }}
      >
        Search, click map, or enter coordinates
      </Typography>
    </Box>
  );
}
