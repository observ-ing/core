import { Link } from "react-router-dom";
import { Chip, Typography } from "@mui/material";
import { nameToSlug } from "../../lib/taxonSlug";

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
  /** @deprecated Use kingdom prop instead. GBIF taxon ID (e.g., "gbif:3084746") for direct linking */
  taxonId?: string | undefined;
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
  taxonId,
  kingdom,
  rank,
  variant = "text",
  italic,
  onClick,
}: TaxonLinkProps) {
  // Default italic behavior: italicize species/genus/subspecies/variety ranks
  const shouldItalicize = italic !== undefined ? italic : shouldItalicizeTaxonName(name, rank);

  // Build the URL using kingdom/name pattern with hyphenated slugs
  // All non-kingdom taxa require a kingdom prefix
  let taxonUrl: string | null;
  if (rank === "kingdom") {
    taxonUrl = `/taxon/${nameToSlug(name)}`;
  } else if (kingdom) {
    taxonUrl = `/taxon/${nameToSlug(kingdom)}/${nameToSlug(name)}`;
  } else {
    // No valid URL without kingdom - render as plain text
    taxonUrl = null;
  }

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
          sx={{
            fontStyle: shouldItalicize ? "italic" : "normal",
            fontFamily: shouldItalicize ? "var(--ov-serif)" : undefined,
          }}
        />
      );
    }
    return (
      <Typography
        component="span"
        sx={{
          fontStyle: shouldItalicize ? "italic" : "normal",
          fontFamily: shouldItalicize ? "var(--ov-serif)" : undefined,
          fontWeight: shouldItalicize ? 500 : undefined,
        }}
      >
        {name}
      </Typography>
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
          fontFamily: shouldItalicize ? "var(--ov-serif)" : undefined,
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
        fontFamily: shouldItalicize ? "var(--ov-serif)" : undefined,
        fontWeight: shouldItalicize ? 500 : undefined,
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
