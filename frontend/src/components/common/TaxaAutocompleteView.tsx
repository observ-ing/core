import type { ReactNode } from "react";
import { Autocomplete, Box, Stack, Typography } from "@mui/material";
import type { TaxaResult } from "../../services/types";
import { ConservationStatus } from "./ConservationStatus";
import { renderAutocompleteInput } from "./autocompleteInput";

interface TaxaAutocompleteViewProps {
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
  /** Content rendered below the input field (e.g. visual ID matches) */
  bottomContent?: ReactNode;
  options: TaxaResult[];
  loading: boolean;
  /** Called when the input text changes (reason === "input"); use to drive a search. */
  onSearch: (query: string) => void;
  /** Called when the user picks a suggestion; use to reset any in-flight search state. */
  onClear: () => void;
  /** Force the popup open state. Uncontrolled when omitted. */
  open?: boolean;
}

export function TaxaAutocompleteView({
  value,
  onChange,
  onMatchChange,
  label = "Species Name",
  placeholder = "Search by common or scientific name...",
  size,
  margin = "normal",
  bottomContent,
  options,
  loading,
  onSearch,
  onClear,
  open,
}: TaxaAutocompleteViewProps) {
  return (
    <Box>
      <Autocomplete
        freeSolo
        options={options}
        loading={loading}
        getOptionLabel={(option) => (typeof option === "string" ? option : option.scientificName)}
        inputValue={value}
        {...(open !== undefined ? { open } : {})}
        onInputChange={(_, v, reason) => {
          onChange(v);
          if (reason === "input") {
            onMatchChange?.(null);
            onSearch(v);
          }
        }}
        onChange={(_, v) => {
          if (v && typeof v !== "string") {
            onChange(v.scientificName);
            onMatchChange?.(v);
            onClear();
          } else if (typeof v === "string") {
            onChange(v);
            onMatchChange?.(null);
          }
        }}
        filterOptions={(x) => x}
        {...(size ? { size } : {})}
        renderInput={(params) =>
          renderAutocompleteInput({ params, loading, label, placeholder, margin })
        }
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
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{
                    alignItems: "center",
                    flexWrap: "wrap",
                  }}
                >
                  <Typography
                    sx={{
                      fontWeight: 600,
                    }}
                  >
                    {option.scientificName}
                  </Typography>
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
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.disabled",
                    }}
                  >
                    → {option.acceptedName}
                  </Typography>
                )}
                {option.commonName && !option.isSynonym && (
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.disabled",
                    }}
                  >
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
