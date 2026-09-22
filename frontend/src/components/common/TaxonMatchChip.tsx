import { Avatar, Chip } from "@mui/material";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import AddCircleOutlinedIcon from "@mui/icons-material/AddCircleOutlined";
import type { TaxaResult } from "../../services/types";

export interface TaxonMatchChipProps {
  /** The matched taxon, or `null` if the typed name has no match yet. */
  matchedTaxon: TaxaResult | null;
}

/**
 * Shows whether a typed taxon name resolved to an existing taxon or would
 * create a new one. Used as `bottomContent` under a `TaxaAutocomplete`.
 */
export function TaxonMatchChip({ matchedTaxon }: TaxonMatchChipProps) {
  if (!matchedTaxon) {
    return (
      <Chip
        icon={<AddCircleOutlinedIcon />}
        label="New taxon"
        color="info"
        size="small"
        variant="outlined"
        sx={{ mt: 0.5 }}
      />
    );
  }

  return (
    <Chip
      {...(matchedTaxon.photoUrl
        ? { avatar: <Avatar src={matchedTaxon.photoUrl} alt="" /> }
        : { icon: <CheckCircleOutlinedIcon /> })}
      label={["Existing taxon", matchedTaxon.commonName, matchedTaxon.rank]
        .filter((p): p is string => Boolean(p))
        .join(" · ")}
      color="success"
      size="small"
      variant="outlined"
      sx={{ mt: 0.5 }}
    />
  );
}
