import { useEffect, useRef, useCallback, useState } from "react";
import {
  Box,
  Typography,
  TextField,
  Autocomplete,
  Stack,
  InputAdornment,
  Slider,
  useTheme,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapStyle, darkMapFilter } from "./mapStyle";

interface LocationPickerProps {
  latitude: number;
  longitude: number;
  onChange: (lat: number, lng: number) => void;
  uncertaintyMeters?: number;
  onUncertaintyChange?: (meters: number) => void;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
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
  coords.push(coords[0]!); // Close the polygon

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

// Logarithmic scale for slider (better UX for wide range)
function valueToSlider(value: number): number {
  return Math.log10(value);
}

function sliderToValue(slider: number): number {
  return Math.round(Math.pow(10, slider));
}

const SLIDER_MIN = valueToSlider(1);
const SLIDER_MAX = valueToSlider(500000);
const SLIDER_MARKS = [
  { value: valueToSlider(100), label: "100m" },
  { value: valueToSlider(1000), label: "1km" },
  { value: valueToSlider(10000), label: "10km" },
  { value: valueToSlider(100000), label: "100km" },
];

export function LocationPicker({
  latitude,
  longitude,
  onChange,
  uncertaintyMeters = 50,
  onUncertaintyChange,
}: LocationPickerProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const marker = useRef<maplibregl.Marker | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [latInput, setLatInput] = useState(latitude.toFixed(6));
  const [lngInput, setLngInput] = useState(longitude.toFixed(6));
  const theme = useTheme();

  const updateMarker = useCallback((lng: number, lat: number, radius?: number) => {
    if (!map.current) return;

    if (marker.current) {
      marker.current.setLngLat([lng, lat]);
    } else {
      marker.current = new maplibregl.Marker({ color: "#22c55e" })
        .setLngLat([lng, lat])
        .addTo(map.current);
    }

    // Update uncertainty circle
    const effectiveRadius = radius ?? uncertaintyMeters;
    const source = map.current.getSource("uncertainty") as maplibregl.GeoJSONSource | undefined;
    if (source) {
      source.setData(createCircleGeoJSON(lng, lat, effectiveRadius));
    }
  }, [uncertaintyMeters]);

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
              "User-Agent": "Observ.ing/1.0",
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

    const safeLat = Number.isFinite(latitude) ? latitude : 0;
    const safeLng = Number.isFinite(longitude) ? longitude : 0;

    const mapInstance = new maplibregl.Map({
      container: mapContainer.current,
      style: mapStyle,
      center: [safeLng, safeLat],
      zoom: 12,
    });

    mapInstance.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      "bottom-right"
    );

    mapInstance.on("load", () => {
      // Add uncertainty circle source and layers
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
            {...(params as object)}
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
          ...(theme.palette.mode === "dark" && darkMapFilter),
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

      {onUncertaintyChange && (
        <Box sx={{ mt: 2 }}>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
            Coordinate Uncertainty: {uncertaintyMeters >= 1000 ? `${(uncertaintyMeters / 1000).toFixed(uncertaintyMeters >= 10000 ? 0 : 1)}km` : `${uncertaintyMeters}m`}
          </Typography>
          <Slider
            value={valueToSlider(uncertaintyMeters)}
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step={0.01}
            marks={SLIDER_MARKS}
            onChange={(_, value) => {
              const meters = sliderToValue(value as number);
              onUncertaintyChange(meters);
              // Update circle immediately
              const source = map.current?.getSource("uncertainty") as maplibregl.GeoJSONSource | undefined;
              if (source) {
                source.setData(createCircleGeoJSON(parseFloat(lngInput), parseFloat(latInput), meters));
              }
            }}
            valueLabelDisplay="auto"
            valueLabelFormat={(value) => {
              const meters = sliderToValue(value);
              return meters >= 1000 ? `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)}km` : `${meters}m`;
            }}
            sx={{
              "& .MuiSlider-markLabel": {
                fontSize: "0.75rem",
              },
            }}
          />
          <Typography variant="caption" color="text.disabled">
            Adjust the circle to indicate location precision
          </Typography>
        </Box>
      )}
    </Box>
  );
}
