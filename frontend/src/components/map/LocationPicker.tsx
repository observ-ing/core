import { useEffect, useRef, useCallback, useState } from "react";
import {
  Box,
  Typography,
  TextField,
  Autocomplete,
  Stack,
  InputAdornment,
  Slider,
  Button,
  Collapse,
  useTheme,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { mapContainerSx, MAPTILER_ENABLED } from "./mapStyle";
import {
  MAP_MARKER_COLOR,
  addUncertaintyLayers,
  createCircleGeoJSON,
  createMap,
  getRadiusBounds,
  setBasemapStyle,
} from "./mapUtils";
import { useBasemap } from "./useBasemap";
import { BasemapSelector } from "./BasemapSelector";

interface LocationPickerProps {
  latitude: number | null;
  longitude: number | null;
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
  const [latInput, setLatInput] = useState(latitude?.toFixed(6) ?? "");
  const [lngInput, setLngInput] = useState(longitude?.toFixed(6) ?? "");
  const [showCoordinates, setShowCoordinates] = useState(false);
  const theme = useTheme();
  const mode = theme.palette.mode;
  const [basemap] = useBasemap();
  // Latest mode/basemap for the init effect (which runs once); theme/basemap
  // changes are handled by swapping the style, not rebuilding the map.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const basemapRef = useRef(basemap);
  basemapRef.current = basemap;

  const updateMarker = useCallback(
    (lng: number, lat: number, radius?: number) => {
      if (!map.current) return;

      if (marker.current) {
        marker.current.setLngLat([lng, lat]);
      } else {
        marker.current = new maplibregl.Marker({ color: MAP_MARKER_COLOR })
          .setLngLat([lng, lat])
          .addTo(map.current);
      }

      // Update uncertainty circle
      const effectiveRadius = radius ?? uncertaintyMeters;
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- maplibre getSource has no generic overload
      const source = map.current.getSource("uncertainty") as maplibregl.GeoJSONSource | undefined;
      if (source) {
        source.setData(createCircleGeoJSON(lng, lat, effectiveRadius));
      }
    },
    [uncertaintyMeters],
  );

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
    [onChange, updateMarker],
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
          },
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

    const safeLat = latitude && Number.isFinite(latitude) ? latitude : 0;
    const safeLng = longitude && Number.isFinite(longitude) ? longitude : 0;

    const { map: mapInstance, geolocateControl } = createMap(
      mapContainer.current,
      {
        center: [safeLng, safeLat],
        zoom: latitude && longitude ? 12 : 1,
      },
      { mode: modeRef.current, basemap: basemapRef.current },
    );

    // Update marker and inputs when user geolocates via the built-in control
    geolocateControl?.on("geolocate", (e: GeolocationPosition) => {
      const { latitude: lat, longitude: lng } = e.coords;
      updateMarker(lng, lat);
      onChange(lat, lng);
      setLatInput(lat.toFixed(6));
      setLngInput(lng.toFixed(6));
    });

    mapInstance.on("load", () => {
      // Add uncertainty circle source and layers
      mapInstance.addSource("uncertainty", {
        type: "geojson",
        data:
          latitude && longitude
            ? createCircleGeoJSON(longitude, latitude, uncertaintyMeters)
            : { type: "FeatureCollection", features: [] },
      });

      addUncertaintyLayers(mapInstance);

      if (latitude && longitude) {
        updateMarker(longitude, latitude);
        if (uncertaintyMeters > 0) {
          mapInstance.fitBounds(getRadiusBounds(latitude, longitude, uncertaintyMeters), {
            padding: 40,
            maxZoom: 18,
            animate: false,
          });
        }
      }
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

  // Swap the style on theme/basemap change, preserving the current view,
  // marker, and uncertainty circle (skips the initial render — the map starts
  // in the right style).
  const firstStyle = useRef(true);
  useEffect(() => {
    if (firstStyle.current) {
      firstStyle.current = false;
      return;
    }
    if (map.current) setBasemapStyle(map.current, basemap, mode);
  }, [mode, basemap]);

  // Update marker and center when props change externally
  useEffect(() => {
    if (!map.current) return;
    if (!latitude || !longitude) return;

    const currentPos = marker.current?.getLngLat();
    if (
      !currentPos ||
      Math.abs(currentPos.lat - latitude) > 0.0001 ||
      Math.abs(currentPos.lng - longitude) > 0.0001
    ) {
      updateMarker(longitude, latitude);
      map.current.setCenter([longitude, latitude]);
      setLatInput(latitude.toFixed(6));
      setLngInput(longitude.toFixed(6));
    }
  }, [latitude, longitude, updateMarker]);

  const handleCoordinateChange = (value: string, axis: "lat" | "lng") => {
    if (axis === "lat") {
      setLatInput(value);
    } else {
      setLngInput(value);
    }
    const parsed = parseFloat(value);
    const [min, max] = axis === "lat" ? [-90, 90] : [-180, 180];
    if (isNaN(parsed) || parsed < min || parsed > max) return;

    // Use the fresh `value` for the current axis; the other axis comes from
    // state which is up-to-date from the previous render cycle.
    const otherInput = axis === "lat" ? lngInput : latInput;
    if (!otherInput) return;

    const otherValue = parseFloat(otherInput);
    if (isNaN(otherValue)) return;

    const lat = axis === "lat" ? parsed : otherValue;
    const lng = axis === "lat" ? otherValue : parsed;
    updateMarker(lng, lat);
    map.current?.setCenter([lng, lat]);
    onChange(lat, lng);
  };

  const handleLatChange = (value: string) => handleCoordinateChange(value, "lat");
  const handleLngChange = (value: string) => handleCoordinateChange(value, "lng");

  return (
    <Box sx={{ mt: 2 }}>
      <Typography
        variant="body2"
        sx={{
          color: "text.secondary",
          mb: 1,
        }}
      >
        Location
      </Typography>
      <Autocomplete
        freeSolo
        options={searchResults}
        getOptionLabel={(option) => (typeof option === "string" ? option : option.display_name)}
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
        renderInput={(params) => {
          // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- MUI Autocomplete params incompatible with exactOptionalPropertyTypes
          const spreadParams = params as object;
          return (
            <TextField
              {...spreadParams}
              size="small"
              placeholder="Search for a place..."
              slotProps={{
                ...params.slotProps,
                input: {
                  ...params.slotProps.input,
                  startAdornment: (
                    <InputAdornment position="start">
                      <SearchIcon fontSize="small" sx={{ color: "text.disabled" }} />
                    </InputAdornment>
                  ),
                },
              }}
              sx={{ mb: 1 }}
            />
          );
        }}
        renderOption={(props, option) => {
          const { key, ...otherProps } = props;
          return (
            <Box component="li" key={key} {...otherProps} sx={{ fontSize: "0.875rem" }}>
              {option.display_name}
            </Box>
          );
        }}
      />
      <Box sx={[{ position: "relative" }, mapContainerSx]}>
        <Box ref={mapContainer} sx={{ position: "absolute", inset: 0 }} />
        {MAPTILER_ENABLED && <BasemapSelector />}
      </Box>
      <Button
        size="small"
        onClick={() => setShowCoordinates((v) => !v)}
        endIcon={showCoordinates ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        sx={{ mt: 1, textTransform: "none", color: "text.secondary" }}
      >
        {showCoordinates ? "Hide coordinates" : "Enter coordinates manually"}
      </Button>
      <Collapse in={showCoordinates}>
        <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
          <TextField
            size="small"
            label="Latitude"
            value={latInput}
            onChange={(e) => handleLatChange(e.target.value)}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            sx={{ flex: 1 }}
          />
          <TextField
            size="small"
            label="Longitude"
            value={lngInput}
            onChange={(e) => handleLngChange(e.target.value)}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            sx={{ flex: 1 }}
          />
        </Stack>
      </Collapse>
      <Typography
        variant="caption"
        sx={{
          color: "text.disabled",
          display: "block",
          mt: 0.5,
        }}
      >
        Search or click the map to set a location
      </Typography>
      {onUncertaintyChange && (
        <Box sx={{ mt: 2 }}>
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
              mb: 1,
            }}
          >
            Coordinate Uncertainty:{" "}
            {uncertaintyMeters >= 1000
              ? `${(uncertaintyMeters / 1000).toFixed(uncertaintyMeters >= 10000 ? 0 : 1)}km`
              : `${uncertaintyMeters}m`}
          </Typography>
          <Slider
            value={valueToSlider(uncertaintyMeters)}
            min={SLIDER_MIN}
            max={SLIDER_MAX}
            step={0.01}
            marks={SLIDER_MARKS}
            onChange={(_, value) => {
              const meters = sliderToValue(typeof value === "number" ? value : (value[0] ?? 0));
              onUncertaintyChange(meters);
              // Update circle immediately
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- maplibre getSource has no generic overload
              const source = map.current?.getSource("uncertainty") as
                | maplibregl.GeoJSONSource
                | undefined;
              if (source && lngInput && latInput) {
                source.setData(
                  createCircleGeoJSON(parseFloat(lngInput), parseFloat(latInput), meters),
                );
              }
            }}
            valueLabelDisplay="auto"
            valueLabelFormat={(value) => {
              const meters = sliderToValue(value);
              return meters >= 1000
                ? `${(meters / 1000).toFixed(meters >= 10000 ? 0 : 1)}km`
                : `${meters}m`;
            }}
            sx={{
              "& .MuiSlider-markLabel": {
                fontSize: "0.75rem",
              },
            }}
          />
          <Typography
            variant="caption"
            sx={{
              color: "text.disabled",
            }}
          >
            Adjust the circle to indicate location precision
          </Typography>
        </Box>
      )}
    </Box>
  );
}
