import { Box, Button, CircularProgress, Typography } from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import type { SpeciesSuggestion } from "../../services/api";
import { useVisualId } from "../../hooks/useVisualId";
import { VisualIdCards, type AncestorSelection } from "./VisualIdCards";

interface VisualIdProps {
  imageUrl: string;
  latitude?: number | undefined;
  longitude?: number | undefined;
  onSelect: (suggestion: SpeciesSuggestion) => void;
  onSelectAncestor: (ancestor: AncestorSelection) => void;
  disabled?: boolean;
  /** Automatically fetch matches on mount */
  autoFetch?: boolean;
  /** Suppress error toasts (e.g. for best-effort background identification) */
  quiet?: boolean;
}

export function VisualId({
  imageUrl,
  latitude,
  longitude,
  onSelect,
  onSelectAncestor,
  disabled,
  autoFetch,
  quiet,
}: VisualIdProps) {
  const { suggestions, isLoading, hasLoaded, handleFetch } = useVisualId({
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
          Visual ID
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
      <VisualIdCards
        suggestions={suggestions}
        onSelectSpecies={onSelect}
        onSelectAncestor={onSelectAncestor}
      />
    </Box>
  );
}
