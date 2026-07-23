import { Link } from "react-router-dom";
import { Chip, Typography } from "@mui/material";
import { buildTaxonUrl } from "../../lib/taxonSlug";

const ITALICIZED_RANKS = new Set(["species", "genus", "subspecies", "variety"]);

/**
 * Determine whether a taxon name should be italicized.
 * When rank is known, italicize species/genus/subspecies/variety.
 * When rank is unknown, use word count as a heuristic:
 * multi-word names are typically species (binomial) or below → italic.
 */
export function shouldItalicizeTaxonName(name: string, rank?: string): boolean {
  if (rank) return ITALICIZED_RANKS.has(rank);
  // Heuristic: binomial/trinomial names (2+ words) are species-level
  return name.trim().includes(" ");
}

export interface TaxonLinkProps {
  /** The taxon name to display */
  name: string;
  /** Kingdom for building the taxon URL (e.g., "Plantae", "Animalia") */
  kingdom?: string | undefined;
  /** Taxonomic rank (e.g., "species", "genus", "family") */
  rank?: string | undefined;
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
  kingdom,
  rank,
  variant = "text",
  italic,
  onClick,
}: TaxonLinkProps) {
  // Default italic behavior: italicize species/genus/subspecies/variety ranks
  const shouldItalicize = italic !== undefined ? italic : shouldItalicizeTaxonName(name, rank);

  const taxonUrl = buildTaxonUrl(name, kingdom, rank);

  const handleClick = (e: React.MouseEvent) => {
    // Stop propagation if handler provided (e.g., to prevent parent link activation)
    if (onClick) {
      onClick(e);
    }
  };

  // If no valid URL, render as plain text
  if (!taxonUrl) {
    if (variant === "chip") {
      return (
        <Chip
          label={name}
          size="small"
          variant="outlined"
          sx={{ fontStyle: shouldItalicize ? "italic" : "normal" }}
        />
      );
    }
    return (
      <Typography sx={{ fontStyle: shouldItalicize ? "italic" : "normal" }}>{name}</Typography>
    );
  }

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
            // Theme token (mode-aware): a hardcoded white rgba was invisible /
            // wrong in light mode.
            bgcolor: "action.hover",
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
