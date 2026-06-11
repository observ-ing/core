import { Box, Typography, Chip, Stack } from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import type { TaxonDetail } from "../../services/types";
import { ConservationStatus } from "../common/ConservationStatus";
import { shouldItalicizeTaxonName } from "../common/TaxonLink";

export interface TaxonHeroCardProps {
  taxon: TaxonDetail;
  /** Large hero image URL; the image card is omitted when absent. */
  heroUrl?: string | undefined;
}

/**
 * The taxon hero block: an optional 240×240 image card alongside the scientific
 * name, common name, conservation/extinct chips, observation count, and
 * GBIF/Wikidata links. Shared by the full-page `TaxonDetail` and the
 * `TaxonDetailPanel` side panel.
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
            width: 240,
            height: 240,
            maxWidth: "100%",
            flexShrink: 0,
            borderRadius: 1,
            overflow: "hidden",
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
              mt: 0.5,
            }}
          >
            {taxon.commonName}
          </Typography>
        )}

        {/* Stats + External Links */}
        <Stack
          direction="row"
          spacing={1}
          sx={{
            alignItems: "center",
            mt: 2,
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
          {(gbifUrl || wikidataUrl) && (
            <>
              {gbifUrl && (
                <Chip
                  component="a"
                  href={gbifUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  label="GBIF"
                  size="small"
                  variant="outlined"
                  clickable
                  icon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                />
              )}
              {wikidataUrl && (
                <Chip
                  component="a"
                  href={wikidataUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  label="Wikidata"
                  size="small"
                  variant="outlined"
                  clickable
                  icon={<OpenInNewIcon sx={{ fontSize: 14 }} />}
                />
              )}
            </>
          )}
        </Stack>
      </Box>
    </Stack>
  );
}
