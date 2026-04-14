import { useCallback, type ReactNode } from "react";
import { Autocomplete, Box, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { searchTaxa } from "../../services/api";
import type { TaxaResult } from "../../services/types";
import { ConservationStatus } from "./ConservationStatus";
import { useAutocomplete } from "../../hooks/useAutocomplete";
import { MAX_AUTOCOMPLETE_RESULTS } from "../../lib/utils";

interface TaxaAutocompleteProps {
  value: string;
  onChange: (name: string) => void;
  /**
   * Fires whenever the user picks a suggestion (with the full TaxaResult)
   * or types free text that no longer corresponds to a pick (with null).
   * Lets callers know whether they have authoritative taxonomy data.
   */
  onMatchChange?: (match: TaxaResult | null) => void;
  label?: string;
  placeholder?: string;
  size?: "small" | "medium";
  margin?: "normal" | "dense" | "none";
  /** Content rendered below the input field (e.g. AI suggestions) */
  bottomContent?: ReactNode;
}

export function TaxaAutocomplete({
  value,
  onChange,
  onMatchChange,
  label = "Species Name",
  placeholder = "Search by common or scientific name...",
  size,
  margin = "normal",
  bottomContent,
}: TaxaAutocompleteProps) {
  const searchFn = useCallback((query: string) => searchTaxa(query), []);
  const { options, loading, handleSearch, clearOptions } = useAutocomplete<TaxaResult>({
    searchFn,
    filterResults: (results) => results.slice(0, MAX_AUTOCOMPLETE_RESULTS),
  });

  return (
    <Box>
      <Autocomplete
        freeSolo
        autoHighlight
        options={options}
        loading={loading}
        getOptionLabel={(option) => (typeof option === "string" ? option : option.scientificName)}
        inputValue={value}
        onInputChange={(_, v, reason) => {
          onChange(v);
          if (reason === "input") onMatchChange?.(null);
          handleSearch(v);
        }}
        onChange={(_, v) => {
          if (v && typeof v !== "string") {
            onChange(v.scientificName);
            onMatchChange?.(v);
            clearOptions();
          } else if (typeof v === "string") {
            // freeSolo commits typed text as a string. If it matches a loaded
            // option (user typed the full name then blurred), surface that
            // option so the caller can pre-fill fields like kingdom.
            const match =
              options.find((o) => o.scientificName === v) ??
              options.find((o) => o.commonName === v) ??
              null;
            onChange(v);
            onMatchChange?.(match);
            if (match) clearOptions();
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
                  loading="lazy"
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
      {bottomContent}
    </Box>
  );
}
