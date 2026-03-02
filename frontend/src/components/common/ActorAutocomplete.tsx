import { useState, useCallback, useRef, useEffect } from "react";
import { Autocomplete, Avatar, Box, CircularProgress, Stack, TextField, Typography } from "@mui/material";
import { searchActors } from "../../services/api";
import type { ActorSearchResult } from "../../services/api";

const DEBOUNCE_MS = 300;

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
  const [options, setOptions] = useState<ActorSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const latestQuery = useRef("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    return () => clearTimeout(timerRef.current);
  }, []);

  const handleSearch = useCallback(
    (query: string) => {
      latestQuery.current = query;
      clearTimeout(timerRef.current);

      if (query.length < 2) {
        setOptions([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      timerRef.current = setTimeout(async () => {
        const results = await searchActors(query);
        if (latestQuery.current === query) {
          setOptions(results.filter((r) => !excludeDids.includes(r.did)));
          setLoading(false);
        }
      }, DEBOUNCE_MS);
    },
    [excludeDids],
  );

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
          setOptions([]);
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
