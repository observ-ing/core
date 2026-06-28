import { Box, Link as MuiLink } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";

export interface BreadcrumbItem {
  /** Visible crumb text. */
  label: string;
  /** Destination route; when omitted the crumb renders as plain text. */
  href?: string | undefined;
  /** Render the label in italics (e.g. genus/species names). */
  italic?: boolean | undefined;
}

export interface BreadcrumbsProps {
  /** Ordered crumbs, root-first. Renders nothing when empty. */
  items: BreadcrumbItem[];
  /** Extra `sx` merged onto the container (e.g. bottom spacing). */
  sx?: SxProps<Theme> | undefined;
}

/**
 * A muted, single-line trail of links separated by `/`, with a hover accent on
 * linked crumbs. Presentational only — callers map their own data onto
 * {@link BreadcrumbItem}s (see `TaxonBreadcrumb`).
 */
export function Breadcrumbs({ items, sx }: BreadcrumbsProps) {
  if (items.length === 0) return null;

  return (
    <Box
      sx={[
        {
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 0.75,
          fontSize: "0.78rem",
          color: "text.disabled",
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {items.map((item, idx) => (
        <Box
          key={`${idx}-${item.label}`}
          component="span"
          sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}
        >
          {item.href ? (
            <MuiLink
              component={RouterLink}
              to={item.href}
              sx={{
                color: "inherit",
                fontStyle: item.italic ? "italic" : "normal",
                textDecoration: "none",
                "&:hover": { color: "primary.main", textDecoration: "underline" },
              }}
            >
              {item.label}
            </MuiLink>
          ) : (
            <Box component="span" sx={{ fontStyle: item.italic ? "italic" : "normal" }}>
              {item.label}
            </Box>
          )}
          {idx < items.length - 1 && (
            <Box component="span" sx={{ color: "divider" }}>
              /
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
}
