import { useState } from "react";
import { Box, Typography, TextField, Autocomplete, Button, Stack, Chip } from "@mui/material";
import FilterListIcon from "@mui/icons-material/FilterList";
import ClearIcon from "@mui/icons-material/Clear";
import VerifiedOutlinedIcon from "@mui/icons-material/VerifiedOutlined";
import { DatePicker } from "@mui/x-date-pickers/DatePicker";
import { countChipSx } from "../common/chipSx";
import { CollapsibleSection } from "../common/CollapsibleSection";
import { KingdomSelect } from "../common/KingdomSelect";
import { TaxonThumbnail } from "../common/TaxonThumbnail";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFns";
import { useAppDispatch, useAppSelector } from "../../store";
import { setFilters } from "../../store/feedSlice";
import type { FeedFilters } from "../../services/types";
import { useDebouncedTaxaSearch } from "../../hooks/useDebouncedTaxaSearch";
import { QUALITY_CRITERIA, type QualityCriterion } from "../../lib/qualityCriteria";

export function ExploreFilterPanel() {
  const dispatch = useAppDispatch();
  const filters = useAppSelector((state) => state.feed.filters);

  // Local state for form fields
  const [taxonQuery, setTaxonQuery] = useState(filters.taxon || "");
  const { suggestions: taxonSuggestions, search: searchTaxon } = useDebouncedTaxaSearch();
  const [selectedTaxon, setSelectedTaxon] = useState<string | null>(filters.taxon || null);

  const [kingdom, setKingdom] = useState(filters.kingdom || "");

  const [startDate, setStartDate] = useState<Date | null>(
    filters.startDate ? new Date(filters.startDate) : null,
  );
  const [endDate, setEndDate] = useState<Date | null>(
    filters.endDate ? new Date(filters.endDate) : null,
  );

  // Required data-quality criteria. Each selected criterion narrows the feed to
  // rows that meet it; selecting all five is equivalent to "fully complete".
  const [quality, setQuality] = useState<QualityCriterion[]>(filters.quality ?? []);

  // Count active filters for the chevron badge. Each required quality criterion
  // counts on its own, since users treat them as individual filters.
  const activeFilterCount =
    [selectedTaxon, kingdom, startDate, endDate].filter(Boolean).length + quality.length;

  const handleApplyFilters = () => {
    const newFilters: FeedFilters = {};

    if (selectedTaxon) newFilters.taxon = selectedTaxon;
    if (kingdom) newFilters.kingdom = kingdom;
    if (startDate) newFilters.startDate = startDate.toISOString().split("T")[0] ?? "";
    if (endDate) newFilters.endDate = endDate.toISOString().split("T")[0] ?? "";
    if (quality.length) newFilters.quality = quality;

    // Updating filters changes useFeed's query key, which refetches the feed.
    dispatch(setFilters(newFilters));
  };

  // Clear all filters (including the quality criteria)
  const handleClearFilters = () => {
    setSelectedTaxon(null);
    setTaxonQuery("");
    setKingdom("");
    setStartDate(null);
    setEndDate(null);
    setQuality([]);

    dispatch(setFilters({}));
  };

  // Toggle a single quality criterion in the pending selection. Applied with
  // the rest of the filters via the Apply button.
  const toggleQuality = (id: QualityCriterion) => {
    setQuality((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));
  };

  return (
    <CollapsibleSection
      icon={<FilterListIcon fontSize="small" sx={{ color: "primary.main" }} />}
      title="Filters"
      sx={{ mb: 2 }}
      trailing={
        activeFilterCount > 0 ? (
          <Chip size="small" label={activeFilterCount} color="primary" sx={countChipSx} />
        ) : undefined
      }
    >
      {/* Taxon Autocomplete */}
      <Autocomplete
        freeSolo
        options={taxonSuggestions}
        getOptionLabel={(option) => (typeof option === "string" ? option : option.scientificName)}
        inputValue={taxonQuery}
        onInputChange={(_, value) => {
          setTaxonQuery(value);
          searchTaxon(value);
        }}
        onChange={(_, value) => {
          if (value) {
            const name = typeof value === "string" ? value : value.scientificName;
            setSelectedTaxon(name);
            setTaxonQuery(name);
          } else {
            setSelectedTaxon(null);
          }
        }}
        filterOptions={(x) => x}
        renderInput={(params) => (
          <TextField {...params} size="small" label="Taxon" placeholder="Search species..." />
        )}
        renderOption={(props, option) => {
          const { key, ...otherProps } = props;
          return (
            <Box
              component="li"
              key={key}
              {...otherProps}
              sx={{ display: "flex", alignItems: "center", gap: 1 }}
            >
              <TaxonThumbnail src={option.photoUrl} size={32} />
              <Box>
                <Typography
                  variant="body2"
                  sx={{
                    fontWeight: 500,
                  }}
                >
                  {option.scientificName}
                </Typography>
                {option.commonName && (
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                    }}
                  >
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
      <Box sx={{ mb: 2 }}>
        <KingdomSelect
          idPrefix="explore-kingdom"
          value={kingdom}
          onChange={setKingdom}
          size="small"
          margin="none"
          required={false}
          emptyOption={{ value: "", label: "All Kingdoms" }}
          emptyOptionItalic={false}
        />
      </Box>

      {/* Date Range */}
      <LocalizationProvider dateAdapter={AdapterDateFns}>
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 2 }}>
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

      {/* Data quality — require one or more criteria (matches the
          checklist shown on each observation) */}
      <Box sx={{ mb: 2 }}>
        <Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mb: 1 }}>
          <VerifiedOutlinedIcon fontSize="small" color="action" />
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            Data quality
          </Typography>
        </Stack>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
          {QUALITY_CRITERIA.map((criterion) => {
            const selected = quality.includes(criterion.id);
            return (
              <Chip
                key={criterion.id}
                size="small"
                label={criterion.label}
                color={selected ? "primary" : "default"}
                variant={selected ? "filled" : "outlined"}
                onClick={() => toggleQuality(criterion.id)}
                aria-pressed={selected}
              />
            );
          })}
        </Box>
      </Box>

      {/* Action Buttons */}
      <Stack
        direction="row"
        spacing={1}
        sx={{
          justifyContent: "flex-end",
        }}
      >
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
    </CollapsibleSection>
  );
}
