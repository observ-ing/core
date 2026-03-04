import { useState, useCallback } from "react";
import {
  Autocomplete,
  Avatar,
  Box,
  CircularProgress,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { searchActors } from "../../services/api";
import type { ActorSearchResult } from "../../services/api";
import { useAutocomplete } from "../../hooks/useAutocomplete";

interface ActorAutocompleteProps {
  onSelect: (actor: ActorSearchResult) => void;
  excludeDids?: string[];
  label?: string;
  placeholder?: string;
}

export function ActorAutocomplete({
  onSelect,
  excludeDids = [],
  label = "Search by handle",
  placeholder = "Search for a user...",
}: ActorAutocompleteProps) {
  const [inputValue, setInputValue] = useState("");

  const searchFn = useCallback((query: string) => searchActors(query), []);
  const filterResults = useCallback(
    (results: ActorSearchResult[]) => results.filter((r) => !excludeDids.includes(r.did)),
    [excludeDids],
  );
  const { options, loading, handleSearch, clearOptions } = useAutocomplete<ActorSearchResult>({
    searchFn,
    filterResults,
  });

  return (
    <Autocomplete
      options={options}
      loading={loading}
      getOptionLabel={(option) => option.handle}
      inputValue={inputValue}
      onInputChange={(_, v) => {
        setInputValue(v);
        handleSearch(v);
      }}
      onChange={(_, v) => {
        if (v) {
          onSelect(v);
          setInputValue("");
          clearOptions();
        }
      }}
      filterOptions={(x) => x}
      size="small"
      renderInput={(params) => {
        // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        const p = params as object;
        return (
          <TextField
            {...p}
            fullWidth
            label={label}
            placeholder={placeholder}
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
          <Box component="li" key={key} {...otherProps}>
            <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 0.5 }}>
              <Avatar
                src={option.avatar ?? ""}
                alt={option.handle}
                sx={{ width: 32, height: 32 }}
              />
              <Box sx={{ minWidth: 0 }}>
                {option.displayName && (
                  <Typography variant="body2" fontWeight={600} noWrap>
                    {option.displayName}
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary" noWrap>
                  @{option.handle}
                </Typography>
              </Box>
            </Stack>
          </Box>
        );
      }}
    />
  );
}
