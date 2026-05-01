import { Box, Button, Chip, CircularProgress, IconButton, Stack, Typography } from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import PlaceIcon from "@mui/icons-material/Place";
import type { SpeciesSuggestion } from "../../services/api";
import { nameToSlug } from "../../lib/taxonSlug";
import { useAiSuggestions } from "../../hooks/useAiSuggestions";

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
  const { suggestions, isLoading, hasLoaded, handleFetch } = useAiSuggestions({
    imageUrl,
    latitude,
    longitude,
    autoFetch,
    quiet,
  });

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
          <Typography
            variant="caption"
            sx={{
              color: "text.secondary",
            }}
          >
            Identifying species...
          </Typography>
        </Box>
      )}
      <AiSuggestionChips suggestions={suggestions} onSelect={onSelect} />
    </Box>
  );
}

interface AiSuggestionChipsProps {
  suggestions: SpeciesSuggestion[];
  onSelect: (suggestion: SpeciesSuggestion) => void;
}

export function AiSuggestionChips({ suggestions, onSelect }: AiSuggestionChipsProps) {
  if (suggestions.length === 0) return null;

  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 0.5 }}>
        <AutoFixHighIcon sx={{ fontSize: 14, color: "text.secondary" }} />
        <Typography
          variant="caption"
          sx={{
            color: "text.secondary",
          }}
        >
          AI suggestions
        </Typography>
      </Box>
      <Stack spacing={0.5}>
        {suggestions.map((s) => (
          <Chip
            key={s.scientificName}
            label={
              <Box component="span" sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                {s.taxonMatch?.photoUrl && (
                  <Box
                    component="img"
                    src={s.taxonMatch.photoUrl}
                    alt=""
                    loading="lazy"
                    sx={{
                      width: 24,
                      height: 24,
                      borderRadius: 0.5,
                      objectFit: "cover",
                      flexShrink: 0,
                    }}
                  />
                )}
                <Box
                  component="span"
                  sx={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 0.5,
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <span style={{ fontStyle: "italic" }}>{s.scientificName}</span>
                  {s.commonName && (
                    <Typography
                      variant="caption"
                      component="span"
                      sx={{
                        color: "text.secondary",
                      }}
                    >
                      {s.commonName}
                    </Typography>
                  )}
                  {s.inRange === true && (
                    <Box
                      component="span"
                      sx={{
                        display: "inline-flex",
                        alignItems: "center",
                        color: "success.main",
                      }}
                      title="Found in your area"
                      aria-label="Found in your area"
                    >
                      <PlaceIcon sx={{ fontSize: 14 }} />
                    </Box>
                  )}
                  <Typography
                    variant="caption"
                    component="span"
                    sx={{
                      color: "text.secondary",
                      ml: "auto",
                    }}
                  >
                    {Math.round(s.confidence * 100)}%
                  </Typography>
                </Box>
                {s.kingdom && (
                  <IconButton
                    size="small"
                    component="a"
                    href={`/taxon/${s.kingdom}/${nameToSlug(s.scientificName)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e: React.MouseEvent) => e.stopPropagation()}
                    sx={{ p: 0, ml: 0.5 }}
                    title="Open taxon in new tab"
                  >
                    <OpenInNewIcon sx={{ fontSize: 14 }} />
                  </IconButton>
                )}
              </Box>
            }
            size="small"
            onClick={() => onSelect(s)}
            variant="outlined"
            color="primary"
            sx={{
              cursor: "pointer",
              maxWidth: "100%",
              height: "auto",
              "& .MuiChip-label": { width: "100%", px: 1.5, py: 0.5 },
            }}
          />
        ))}
      </Stack>
    </Box>
  );
}
