import { useState, useEffect, useRef } from "react";
import { Box, Button, Chip, CircularProgress, Stack, Typography } from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import { identifySpecies, type SpeciesSuggestion } from "../../services/api";
import { useAppDispatch } from "../../store";
import { addToast } from "../../store/uiSlice";

interface AiSuggestionsProps {
  imageUrl: string;
  latitude?: number | undefined;
  longitude?: number | undefined;
  onSelect: (suggestion: SpeciesSuggestion) => void;
  disabled?: boolean;
  /** Automatically fetch suggestions on mount */
  autoFetch?: boolean;
  /** Suppress error toasts (e.g. for best-effort background identification) */
  quiet?: boolean;
}

export function AiSuggestions({
  imageUrl,
  latitude,
  longitude,
  onSelect,
  disabled,
  autoFetch,
  quiet,
}: AiSuggestionsProps) {
  const dispatch = useAppDispatch();
  const [suggestions, setSuggestions] = useState<SpeciesSuggestion[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const fetchedRef = useRef(false);

  const handleFetch = async () => {
    setIsLoading(true);
    setSuggestions([]);
    try {
      const response = await fetch(imageUrl);
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result ?? "").split(",")[1] ?? "");
        reader.readAsDataURL(blob);
      });

      const params: Parameters<typeof identifySpecies>[0] = {
        image: base64,
        limit: 5,
      };
      if (latitude != null && Number.isFinite(latitude)) params.latitude = latitude;
      if (longitude != null && Number.isFinite(longitude)) params.longitude = longitude;

      const result = await identifySpecies(params);
      setSuggestions(result.suggestions);
      setHasLoaded(true);
      if (result.suggestions.length === 0 && !quiet) {
        dispatch(addToast({ message: "No species suggestions found", type: "success" }));
      }
    } catch {
      if (!quiet) {
        dispatch(addToast({ message: "Species identification unavailable", type: "error" }));
      }
      setHasLoaded(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (autoFetch && !fetchedRef.current) {
      fetchedRef.current = true;
      handleFetch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoFetch]);

  return (
    <Box>
      {!hasLoaded && !autoFetch && (
        <Button
          variant="outlined"
          color="secondary"
          size="small"
          startIcon={
            isLoading ? <CircularProgress size={16} color="inherit" /> : <AutoFixHighIcon />
          }
          onClick={handleFetch}
          disabled={disabled || isLoading}
          fullWidth
          sx={{ mb: 1 }}
        >
          AI Suggest
        </Button>
      )}

      {isLoading && autoFetch && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <CircularProgress size={16} />
          <Typography variant="caption" color="text.secondary">
            Identifying species...
          </Typography>
        </Box>
      )}

      {suggestions.length > 0 && (
        <Box sx={{ mb: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
            <AutoFixHighIcon sx={{ fontSize: 14, color: "text.secondary" }} />
            <Typography variant="caption" color="text.secondary">
              AI suggestions
            </Typography>
          </Box>
          <Stack direction="row" spacing={0.5} sx={{ flexWrap: "wrap", gap: 0.5 }}>
            {suggestions.map((s) => (
              <Chip
                key={s.scientificName}
                label={s.commonName ? `${s.scientificName} (${s.commonName})` : s.scientificName}
                size="small"
                onClick={() => onSelect(s)}
                variant="outlined"
                color="primary"
                sx={{ fontStyle: "italic", cursor: "pointer" }}
              />
            ))}
          </Stack>
        </Box>
      )}
    </Box>
  );
}
