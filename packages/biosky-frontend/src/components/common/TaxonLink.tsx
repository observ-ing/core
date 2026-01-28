import { Link } from "react-router-dom";
import { Chip, Typography } from "@mui/material";
import { nameToSlug } from "../../lib/taxonSlug";

interface TaxonLinkProps {
  /** The taxon name to display */
  name: string;
  /** @deprecated Use kingdom prop instead. GBIF taxon ID (e.g., "gbif:3084746") for direct linking */
  taxonId?: string;
  /** Kingdom for building the taxon URL (e.g., "Plantae", "Animalia") */
  kingdom?: string;
  /** Taxonomic rank (e.g., "species", "genus", "family") */
  rank?: string;
  /** Display variant: text (default) or chip */
  variant?: "text" | "chip";
  /** Whether to italicize the name (default: true for species/genus, false otherwise) */
  italic?: boolean;
  /** Click handler - useful for stopping propagation in list items */
  onClick?: (e: React.MouseEvent) => void;
}

/**
 * A clickable taxon name that links to the taxon detail page.
 * Use this component to make taxon names/chips navigable throughout the app.
 */
export function TaxonLink({
  name,
  taxonId,
  kingdom,
  rank,
  variant = "text",
  italic,
  onClick,
}: TaxonLinkProps) {
  // Default italic behavior: italicize species and genus ranks
  const shouldItalicize =
    italic !== undefined
      ? italic
      : rank === "species" ||
        rank === "genus" ||
        rank === "subspecies" ||
        rank === "variety";

  // Build the URL using kingdom/name pattern with hyphenated slugs
  let taxonUrl: string;
  if (rank === "kingdom") {
    taxonUrl = `/taxon/${nameToSlug(name)}`;
  } else if (kingdom) {
    taxonUrl = `/taxon/${nameToSlug(kingdom)}/${nameToSlug(name)}`;
  } else if (taxonId) {
    taxonUrl = `/taxon/${encodeURIComponent(taxonId)}`;
  } else {
    taxonUrl = `/taxon/${nameToSlug(name)}`;
  }

  const handleClick = (e: React.MouseEvent) => {
    // Stop propagation if handler provided (e.g., to prevent parent link activation)
    if (onClick) {
      onClick(e);
    }
  };

  if (variant === "chip") {
    return (
      <Chip
        component={Link}
        to={taxonUrl}
        label={name}
        size="small"
        variant="outlined"
        onClick={handleClick}
        sx={{
          fontStyle: shouldItalicize ? "italic" : "normal",
          cursor: "pointer",
          "&:hover": {
            bgcolor: "rgba(255, 255, 255, 0.08)",
          },
        }}
      />
    );
  }

  return (
    <Typography
      component={Link}
      to={taxonUrl}
      onClick={handleClick}
      sx={{
        fontStyle: shouldItalicize ? "italic" : "normal",
        color: "primary.main",
        textDecoration: "none",
        "&:hover": {
          textDecoration: "underline",
        },
      }}
    >
      {name}
    </Typography>
  );
}
