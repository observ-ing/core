import { Box, Button } from "@mui/material";
import AutoFixHighIcon from "@mui/icons-material/AutoFixHigh";
import type { SpeciesSuggestion } from "../../services/api";
import { useVisualId } from "../../hooks/useVisualId";
import { VisualIdCards, type AncestorSelection } from "./VisualIdCards";
import { ButtonSpinner } from "../common/ButtonSpinner";
import { SpeciesIdProgress } from "./SpeciesIdProgress";

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
  const { suggestions, isLoading, hasLoaded, handleFetch, readyAt } = useVisualId({
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
          startIcon={isLoading ? <ButtonSpinner /> : <AutoFixHighIcon />}
          onClick={handleFetch}
          disabled={disabled || isLoading}
          fullWidth
          sx={{ mb: 1 }}
        >
          Visual ID
        </Button>
      )}
      {isLoading && (autoFetch || readyAt !== null) && <SpeciesIdProgress readyAt={readyAt} />}
      <VisualIdCards
        suggestions={suggestions}
        onSelectSpecies={onSelect}
        onSelectAncestor={onSelectAncestor}
      />
    </Box>
  );
}
