import { Box, Typography, Chip, Stack } from "@mui/material";
import type { TaxonDetail } from "../../services/types";
import { ConservationStatus } from "../common/ConservationStatus";
import { ExternalLinkChip } from "../common/ExternalLinkChip";
import { shouldItalicizeTaxonName } from "../common/TaxonLink";

export interface TaxonHeroCardProps {
  taxon: TaxonDetail;
  /** Large hero image URL; the image card is omitted when absent. */
  heroUrl?: string | undefined;
}

/**
 * The taxon hero block: an optional 240×240 image card alongside the scientific
 * name, common name, conservation/extinct chips, observation count, and
 * GBIF/Wikidata links. Rendered by the `TaxonDetailPanel` side panel.
 */
export function TaxonHeroCard({ taxon, heroUrl }: TaxonHeroCardProps) {
  const gbifUrl = taxon.gbifUrl;
  const wikidataUrl = taxon.wikidataUrl;

  return (
    <Stack
      direction={{ xs: "column", sm: "row" }}
      spacing={2}
      sx={{ alignItems: { xs: "stretch", sm: "flex-start" } }}
    >
      {heroUrl && (
        <Box
          sx={{
            width: 248,
            height: 248,
            maxWidth: "100%",
            flexShrink: 0,
            borderRadius: 1.75,
            overflow: "hidden",
            border: 1,
            borderColor: "divider",
            boxShadow: "0 2px 10px rgba(60,50,30,0.08)",
            backgroundColor: "action.hover",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            mx: { xs: "auto", sm: 0 },
          }}
        >
          <Box
            component="img"
            src={heroUrl}
            alt={taxon.scientificName}
            sx={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
            }}
          />
        </Box>
      )}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        {/* Scientific Name */}
        <Typography
          variant="h5"
          sx={{
            fontStyle: shouldItalicizeTaxonName(taxon.scientificName, taxon.rank)
              ? "italic"
              : "normal",
            color: "primary.main",
            fontWeight: 600,
            fontSize: "1.875rem",
            lineHeight: 1.1,
            letterSpacing: "-0.01em",
          }}
        >
          {taxon.scientificName}
        </Typography>

        {/* Common Name */}
        {taxon.commonName && (
          <Typography
            variant="h6"
            component="p"
            sx={{
              color: "text.secondary",
              mt: 0.75,
              fontSize: "1.2rem",
              fontWeight: 500,
            }}
          >
            {taxon.commonName}
          </Typography>
        )}

        {/* Conservation status + stats */}
        <Stack
          direction="row"
          spacing={1.5}
          sx={{
            alignItems: "center",
            mt: 2.5,
            flexWrap: "wrap",
          }}
        >
          {taxon.conservationStatus && (
            <ConservationStatus status={taxon.conservationStatus} showLabel />
          )}
          {taxon.extinct && <Chip label="Extinct" size="small" color="error" />}
          <Typography
            variant="body2"
            sx={{
              color: "text.secondary",
            }}
          >
            {taxon.observationCount} observation{taxon.observationCount !== 1 ? "s" : ""} on
            Observ.ing
            {taxon.numDescendants !== undefined && taxon.numDescendants > 0 && (
              <> &middot; {taxon.numDescendants.toLocaleString()} descendant taxa</>
            )}
          </Typography>
        </Stack>

        {/* External Links */}
        {(gbifUrl || wikidataUrl) && (
          <Stack direction="row" spacing={1.25} sx={{ mt: 2, flexWrap: "wrap" }}>
            {gbifUrl && <ExternalLinkChip label="GBIF" href={gbifUrl} />}
            {wikidataUrl && <ExternalLinkChip label="Wikidata" href={wikidataUrl} />}
          </Stack>
        )}
      </Box>
    </Stack>
  );
}
