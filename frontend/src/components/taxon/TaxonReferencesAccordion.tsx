import { Stack, Typography, Link as MuiLink } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import type { TaxonReference } from "../../bindings/TaxonReference";
import { TaxonAccordion } from "./TaxonAccordion";

interface TaxonReferencesAccordionProps {
  references: TaxonReference[];
  sx?: SxProps<Theme>;
}

/**
 * Collapsible "References" section. Shows up to five citations, linking to the
 * reference's URL (or its DOI) when one is available.
 */
export function TaxonReferencesAccordion({ references, sx }: TaxonReferencesAccordionProps) {
  return (
    <TaxonAccordion title={`References (${references.length})`} sx={sx}>
      <Stack spacing={0.5}>
        {references.slice(0, 5).map((r, idx) => (
          <Typography
            key={idx}
            variant="caption"
            sx={{
              color: "text.secondary",
            }}
          >
            {r.link || r.doi ? (
              <MuiLink
                href={r.link || `https://doi.org/${r.doi}`}
                target="_blank"
                rel="noopener noreferrer"
                color="primary"
              >
                {r.citation}
              </MuiLink>
            ) : (
              r.citation
            )}
          </Typography>
        ))}
      </Stack>
    </TaxonAccordion>
  );
}
