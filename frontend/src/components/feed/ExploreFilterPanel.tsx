import { useState, useCallback, useRef } from "react";
import {
  Box,
  Paper,
  Collapse,
  IconButton,
  Typography,
  TextField,
  Autocomplete,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Button,
  Stack,
  Chip,
  Divider,
} from "@mui/material";
import FilterListIcon from "@mui/icons-material/FilterList";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import ClearIcon from "@mui/icons-material/Clear";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { useAppDispatch, useAppSelector } from "../../store";
import { setFilters, loadInitialFeed } from "../../store/feedSlice";
import { searchTaxa } from "../../services/api";
import type { TaxaResult, FeedFilters } from "../../services/types";
import { LocationPicker } from "../map/LocationPicker";

const KINGDOMS = [
  { value: "", label: "All Kingdoms" },
  { value: "Animalia", label: "Animals" },
  { value: "Plantae", label: "Plants" },
  { value: "Fungi", label: "Fungi" },
  { value: "Bacteria", label: "Bacteria" },
  { value: "Archaea", label: "Archaea" },
  { value: "Protozoa", label: "Protozoa" },
  { value: "Chromista", label: "Chromista" },
];

const DEFAULT_RADIUS = 10000; // 10km

export function ExploreFilterPanel() {
  const dispatch = useAppDispatch();
  const filters = useAppSelector((state) => state.feed.filters);

  const [isExpanded, setIsExpanded] = useState(false);

  // Local state for form fields
  const [taxonQuery, setTaxonQuery] = useState(filters.taxon || "");
  const [taxonSuggestions, setTaxonSuggestions] = useState<TaxaResult[]>([]);
  const [selectedTaxon, setSelectedTaxon] = useState<string | null>(
    filters.taxon || null
  );

  const [useLocation, setUseLocation] = useState(filters.lat !== undefined);
  const [lat, setLat] = useState(filters.lat ?? 37.7749);
  const [lng, setLng] = useState(filters.lng ?? -122.4194);
  const [radius, setRadius] = useState(filters.radius ?? DEFAULT_RADIUS);

  const [kingdom, setKingdom] = useState(filters.kingdom || "");

  const [startDate, setStartDate] = useState<Date | null>(
    filters.startDate ? new Date(filters.startDate) : null
  );
  const [endDate, setEndDate] = useState<Date | null>(
    filters.endDate ? new Date(filters.endDate) : null
  );

  // Count active filters for badge
  const activeFilterCount = [
    selectedTaxon,
    useLocation,
    kingdom,
    startDate,
    endDate,
  ].filter(Boolean).length;

  // Taxon search handler
  const latestTaxonQuery = useRef("");

  const handleTaxonSearch = useCallback(async (query: string) => {
    latestTaxonQuery.current = query;
    if (query.length >= 2) {
      const results = await searchTaxa(query);
      if (latestTaxonQuery.current === query) {
        setTaxonSuggestions(results.slice(0, 5));
      }
    } else {
      setTaxonSuggestions([]);
    }
  }, []);

  // Apply filters
  const handleApplyFilters = () => {
    const newFilters: FeedFilters = {};

    if (selectedTaxon) newFilters.taxon = selectedTaxon;
    if (useLocation) {
      newFilters.lat = lat;
      newFilters.lng = lng;
      newFilters.radius = radius;
    }
    if (kingdom) newFilters.kingdom = kingdom;
    if (startDate) newFilters.startDate = startDate.toISOString().split("T")[0] ?? "";
    if (endDate) newFilters.endDate = endDate.toISOString().split("T")[0] ?? "";

    dispatch(setFilters(newFilters));
    dispatch(loadInitialFeed());
  };

  // Clear all filters
  const handleClearFilters = () => {
    setSelectedTaxon(null);
    setTaxonQuery("");
    setUseLocation(false);
    setKingdom("");
    setStartDate(null);
    setEndDate(null);

    dispatch(setFilters({}));
    dispatch(loadInitialFeed());
  };

  // Location change handler
  const handleLocationChange = (newLat: number, newLng: number) => {
    setLat(newLat);
    setLng(newLng);
    setUseLocation(true);
  };

  return (
    <Paper sx={{ mb: 2, overflow: "hidden" }}>
      {/* Header - always visible */}
      <Box
        onClick={() => setIsExpanded(!isExpanded)}
        sx={{
          p: 1.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          "&:hover": { bgcolor: "action.hover" },
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <FilterListIcon color="action" />
          <Typography variant="subtitle2">Filters</Typography>
          {activeFilterCount > 0 && (
            <Chip
              size="small"
              label={activeFilterCount}
              color="primary"
              sx={{ height: 20, fontSize: "0.75rem" }}
            />
          )}
        </Stack>
        <IconButton size="small">
          {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
        </IconButton>
      </Box>

      {/* Collapsible filter content */}
      <Collapse in={isExpanded}>
        <Divider />
        <Box sx={{ p: 2 }}>
          {/* Taxon Autocomplete */}
          <Autocomplete
            freeSolo
            options={taxonSuggestions}
            getOptionLabel={(option) =>
              typeof option === "string" ? option : option.scientificName
            }
            inputValue={taxonQuery}
            onInputChange={(_, value) => {
              setTaxonQuery(value);
              handleTaxonSearch(value);
            }}
            onChange={(_, value) => {
              if (value) {
                const name =
                  typeof value === "string" ? value : value.scientificName;
                setSelectedTaxon(name);
                setTaxonQuery(name);
              } else {
                setSelectedTaxon(null);
              }
            }}
            filterOptions={(x) => x}
            renderInput={(params) => {
              // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
              const p = params as object;
              return (
                <TextField
                  {...p}
                  size="small"
                  label="Taxon"
                  placeholder="Search species..."
                />
              );
            }}
            renderOption={(props, option) => {
              const { key, ...otherProps } = props;
              return (
                <Box
                  component="li"
                  key={key}
                  {...otherProps}
                  sx={{ display: "flex", alignItems: "center", gap: 1 }}
                >
                  {option.photoUrl && (
                    <Box
                      component="img"
                      src={option.photoUrl}
                      alt=""
                      sx={{
                        width: 32,
                        height: 32,
                        borderRadius: 1,
                        objectFit: "cover",
                      }}
                    />
                  )}
                  <Box>
                    <Typography variant="body2" fontWeight={500}>
                      {option.scientificName}
                    </Typography>
                    {option.commonName && (
                      <Typography variant="caption" color="text.secondary">
                        {option.commonName}
                      </Typography>
                    )}
                  </Box>
                </Box>
              );
            }}
            sx={{ mb: 2 }}
          />

          {/* Kingdom Dropdown */}
          <FormControl fullWidth size="small" sx={{ mb: 2 }}>
            <InputLabel>Kingdom</InputLabel>
            <Select
              value={kingdom}
              label="Kingdom"
              onChange={(e) => setKingdom(e.target.value)}
            >
              {KINGDOMS.map((k) => (
                <MenuItem key={k.value} value={k.value}>
                  {k.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Date Range */}
          <LocalizationProvider dateAdapter={AdapterDateFns}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={1}
              sx={{ mb: 2 }}
            >
              <DatePicker
                label="Start Date"
                value={startDate}
                onChange={setStartDate}
                slotProps={{ textField: { size: "small", fullWidth: true } }}
              />
              <DatePicker
                label="End Date"
                value={endDate}
                onChange={setEndDate}
                slotProps={{ textField: { size: "small", fullWidth: true } }}
              />
            </Stack>
          </LocalizationProvider>

          {/* Location Filter */}
          <Box sx={{ mb: 2 }}>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ mb: 1 }}
            >
              <Typography variant="body2" color="text.secondary">
                Location
              </Typography>
              {useLocation && (
                <Chip
                  size="small"
                  label="Active"
                  color="primary"
                  onDelete={() => setUseLocation(false)}
                  sx={{ height: 20 }}
                />
              )}
            </Stack>

            {useLocation ? (
              <LocationPicker
                latitude={lat}
                longitude={lng}
                onChange={handleLocationChange}
                uncertaintyMeters={radius}
                onUncertaintyChange={setRadius}
              />
            ) : (
              <Button
                variant="outlined"
                size="small"
                onClick={() => {
                  // Try to get current location
                  navigator.geolocation?.getCurrentPosition(
                    (pos) => {
                      setLat(pos.coords.latitude);
                      setLng(pos.coords.longitude);
                      setUseLocation(true);
                    },
                    () => {
                      // Default to San Francisco on error
                      setUseLocation(true);
                    }
                  );
                }}
              >
                Add Location Filter
              </Button>
            )}
          </Box>

          {/* Action Buttons */}
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            <Button
              variant="text"
              color="inherit"
              startIcon={<ClearIcon />}
              onClick={handleClearFilters}
              disabled={activeFilterCount === 0}
            >
              Clear
            </Button>
            <Button variant="contained" onClick={handleApplyFilters}>
              Apply Filters
            </Button>
          </Stack>
        </Box>
      </Collapse>
    </Paper>
  );
}
