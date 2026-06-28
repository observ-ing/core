import type { ReactElement } from "react";
import { Chip } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";

export interface ExternalLinkChipProps {
  /** Visible chip text (e.g. "GBIF", "Wikidata"). */
  label: string;
  /** Destination URL; opens in a new tab. */
  href: string;
  /** Leading icon. Defaults to an "open in new" glyph. */
  icon?: ReactElement | undefined;
}

/**
 * An outlined, clickable chip that links out to an external resource in a new
 * tab (with `rel="noopener noreferrer"`). Used for the GBIF/Wikidata links on
 * the taxon hero and anywhere else a compact external link is needed.
 */
export function ExternalLinkChip({ label, href, icon }: ExternalLinkChipProps) {
  return (
    <Chip
      component="a"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      label={label}
      size="small"
      variant="outlined"
      clickable
      icon={icon ?? <OpenInNewIcon sx={{ fontSize: 14 }} />}
    />
  );
}
