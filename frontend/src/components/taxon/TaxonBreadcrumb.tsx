import { Box, Link as MuiLink } from "@mui/material";
import { Link as RouterLink } from "react-router-dom";
import type { TaxonAncestor } from "../../bindings/TaxonAncestor";
import { nameToSlug } from "../../lib/taxonSlug";
import { shouldItalicizeTaxonName } from "../common/TaxonLink";

interface TaxonBreadcrumbProps {
  /** The ancestor path, root-first, up to (but excluding) the current taxon. */
  ancestors: TaxonAncestor[];
  /** Kingdom used to build links for non-kingdom ancestors. */
  kingdom?: string | undefined;
}

/**
 * The ancestor path shown above the taxon hero (e.g. Animalia / Arthropoda /
 * … / Vanessa). Each crumb links to its taxon page; genus/species names are
 * italicized. Renders nothing when there are no ancestors.
 */
export function TaxonBreadcrumb({ ancestors, kingdom }: TaxonBreadcrumbProps) {
  if (ancestors.length === 0) return null;

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 0.75,
        mb: 2.25,
        fontSize: "0.78rem",
        color: "text.disabled",
      }}
    >
      {ancestors.map((a, idx) => {
        const url =
          a.rank === "kingdom"
            ? `/taxon/${nameToSlug(a.name)}`
            : kingdom
              ? `/taxon/${nameToSlug(kingdom)}/${nameToSlug(a.name)}`
              : null;
        const italic = shouldItalicizeTaxonName(a.name, a.rank);
        return (
          <Box
            key={a.id}
            component="span"
            sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}
          >
            {url ? (
              <MuiLink
                component={RouterLink}
                to={url}
                sx={{
                  color: "inherit",
                  fontStyle: italic ? "italic" : "normal",
                  textDecoration: "none",
                  "&:hover": { color: "primary.main", textDecoration: "underline" },
                }}
              >
                {a.name}
              </MuiLink>
            ) : (
              <Box component="span" sx={{ fontStyle: italic ? "italic" : "normal" }}>
                {a.name}
              </Box>
            )}
            {idx < ancestors.length - 1 && (
              <Box component="span" sx={{ color: "divider" }}>
                /
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
