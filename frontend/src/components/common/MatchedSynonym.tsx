import { Box, Typography, type TypographyProps } from "@mui/material";
import type { TaxaResult } from "../../services/types";
import { shouldItalicizeTaxonName } from "./TaxonLink";

/**
 * "syn. Eriobotrya japonica": the synonym a search result matched, which
 * explains why a search for that name listed *Rhaphiolepis bibas*. Renders
 * nothing when the result matched by its own names.
 */
export function MatchedSynonym({
  taxon,
  ...typographyProps
}: { taxon: TaxaResult } & TypographyProps) {
  const synonym = taxon.matchedSynonym;
  if (!synonym) return null;
  // A synonym has the rank of the taxon it stands for.
  const italic = shouldItalicizeTaxonName(synonym, taxon.rank);
  return (
    <Typography {...typographyProps}>
      syn.{" "}
      <Box component="span" sx={{ fontStyle: italic ? "italic" : "normal" }}>
        {synonym}
      </Box>
    </Typography>
  );
}
