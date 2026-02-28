import { useState, useCallback, useRef, useEffect } from "react";
import { Autocomplete, Box, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { searchTaxa } from "../../services/api";
import type { TaxaResult } from "../../services/types";
import { ConservationStatus } from "./ConservationStatus";

const DEBOUNCE_MS = 300;

interface TaxaAutocompleteProps {
  value: string;
  onChange: (name: string) => void;
  label?: string;
  placeholder?: string;
  size?: "small" | "medium";
  margin?: "normal" | "dense" | "none";
}

export function TaxaAutocomplete({
  value,
  onChange,
  label = "Species Name",
  placeholder = "Search by common or scientific name...",
  size,
  margin = "normal",
}: TaxaAutocompleteProps) {
  const [suggestions, setSuggestions] = useState<TaxaResult[]>([]);
  const [loading, setLoading] = useState(false);
  const latestQuery = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleSearch = useCallback((query: string) => {
    latestQuery.current = query;
    clearTimeout(timerRef.current);

    if (query.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    timerRef.current = setTimeout(async () => {
      const results = await searchTaxa(query);
      if (latestQuery.current === query) {
        setSuggestions(results.slice(0, 5));
        setLoading(false);
      }
    }, DEBOUNCE_MS);
  }, []);

  return (
    <Autocomplete
      freeSolo
      options={suggestions}
      loading={loading}
      getOptionLabel={(option) => (typeof option === "string" ? option : option.scientificName)}
      inputValue={value}
      onInputChange={(_, v) => {
        onChange(v);
        handleSearch(v);
      }}
      onChange={(_, v) => {
        if (v) {
          const name = typeof v === "string" ? v : v.scientificName;
          onChange(name);
          setSuggestions([]);
        }
      }}
      filterOptions={(x) => x}
      {...(size ? { size } : {})}
      renderInput={(params) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const p = params as object;
        return (
          <TextField
            {...p}
            fullWidth
            label={label}
            placeholder={placeholder}
            margin={margin}
            slotProps={{
              input: {
                ...(params.InputProps || {}),
                endAdornment: (
                  <>
                    {loading && <CircularProgress color="inherit" size={20} />}
                    {params.InputProps?.endAdornment}
                  </>
                ),
              },
            }}
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
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1.5,
              p: 1.5,
            }}
          >
            {option.photoUrl && (
              <Box
                component="img"
                src={option.photoUrl}
                alt=""
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: 1,
                  objectFit: "cover",
                  flexShrink: 0,
                }}
              />
            )}
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <Typography fontWeight={600}>{option.scientificName}</Typography>
                {option.isSynonym && (
                  <Typography
                    variant="caption"
                    sx={{
                      bgcolor: "action.selected",
                      px: 0.75,
                      py: 0.25,
                      borderRadius: 0.5,
                      fontSize: "0.65rem",
                    }}
                  >
                    synonym
                  </Typography>
                )}
                {option.conservationStatus && (
                  <ConservationStatus status={option.conservationStatus} size="sm" />
                )}
              </Stack>
              {option.isSynonym && option.acceptedName && (
                <Typography variant="caption" color="text.disabled">
                  → {option.acceptedName}
                </Typography>
              )}
              {option.commonName && !option.isSynonym && (
                <Typography variant="caption" color="text.disabled">
                  {option.commonName}
                </Typography>
              )}
            </Box>
          </Box>
        );
      }}
    />
  );
}
