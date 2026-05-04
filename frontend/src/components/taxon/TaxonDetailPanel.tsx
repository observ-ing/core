import { useState } from "react";
import DOMPurify from "dompurify";
import {
  Box,
  Typography,
  Button,
  CircularProgress,
  Stack,
  IconButton,
  Chip,
  Divider,
  Link as MuiLink,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Tooltip,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { TaxonDetail as TaxonDetailType, Occurrence } from "../../services/types";
import { ConservationStatus } from "../common/ConservationStatus";
import { shouldItalicizeTaxonName } from "../common/TaxonLink";
import { WikiCommonsGallery } from "../common/WikiCommonsGallery";
import { FeedItem } from "../feed/FeedItem";

interface TaxonDetailPanelProps {
  taxon: TaxonDetailType;
  heroUrl?: string | undefined;
  observations: Occurrence[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onBack: () => void;
  onToggleTree?: () => void;
}

export function TaxonDetailPanel({
  taxon,
  heroUrl,
  observations,
  hasMore,
  loadingMore,
  onLoadMore,
  onBack,
  onToggleTree,
}: TaxonDetailPanelProps) {
  const [descExpanded, setDescExpanded] = useState(false);
  const [galleryMounted, setGalleryMounted] = useState(false);

  const gbifUrl = taxon.gbifUrl;
  const wikidataUrl = taxon.wikidataUrl;

  return (
    <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
      {/* Header */}
      <Box
        sx={{
          p: 1.5,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
        }}
      >
        <IconButton onClick={onBack} sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography
          variant="subtitle1"
          sx={{
            fontWeight: 500,
            flex: 1,
          }}
        >
          {taxon.rank.charAt(0).toUpperCase() + taxon.rank.slice(1)}
        </Typography>
        {onToggleTree && (
          <IconButton onClick={onToggleTree} sx={{ display: { xs: "inline-flex", md: "none" } }}>
            <AccountTreeIcon />
          </IconButton>
        )}
      </Box>
      {/* Main Content */}
      <Box sx={{ p: 3 }}>
        {/* Image card + title block */}
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
                <Tooltip title={`${taxon.conservationStatus.category} — IUCN Red List`} arrow>
                  <span>
                    <ConservationStatus status={taxon.conservationStatus} showLabel />
                  </span>
                </Tooltip>
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

        {/* Media Gallery — lazy-loaded */}
        <Accordion
          sx={{ mt: 3 }}
          onChange={(_e, expanded) => {
            if (expanded) setGalleryMounted(true);
          }}
        >
          <AccordionSummary expandIcon={<ExpandMoreIcon />}>
            <Typography
              variant="subtitle2"
              sx={{
                color: "text.secondary",
              }}
            >
              Media
            </Typography>
          </AccordionSummary>
          <AccordionDetails>
            {galleryMounted ? <WikiCommonsGallery taxonName={taxon.scientificName} /> : null}
          </AccordionDetails>
        </Accordion>

        {/* Descriptions */}
        {taxon.descriptions && taxon.descriptions.length > 0 && (
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography
                variant="subtitle2"
                sx={{
                  color: "text.secondary",
                }}
              >
                Description
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              {taxon.descriptions.slice(0, 2).map((d, idx) => (
                <Box key={idx} sx={{ mb: idx < (taxon.descriptions?.length ?? 0) - 1 ? 2 : 0 }}>
                  <Typography
                    variant="body2"
                    component="div"
                    sx={{
                      ...(!descExpanded && {
                        display: "-webkit-box",
                        WebkitLineClamp: 6,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }),
                      "& p": { m: 0 },
                      "& em, & i": { fontStyle: "italic" },
                    }}
                    // eslint-disable-next-line react/no-danger -- sanitized with DOMPurify
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(d.description, {
                        ALLOWED_TAGS: ["p", "br", "em", "i", "strong", "b", "a"],
                        ALLOWED_ATTR: ["href", "target", "rel"],
                      }),
                    }}
                  />
                  {d.source && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        mt: 0.5,
                        display: "block",
                      }}
                    >
                      Source: {d.source}
                    </Typography>
                  )}
                </Box>
              ))}
              <Button
                size="small"
                onClick={() => setDescExpanded((v) => !v)}
                sx={{ mt: 1, textTransform: "none" }}
              >
                {descExpanded ? "Show less" : "Read more"}
              </Button>
            </AccordionDetails>
          </Accordion>
        )}

        {/* References */}
        {taxon.references && taxon.references.length > 0 && (
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography
                variant="subtitle2"
                sx={{
                  color: "text.secondary",
                }}
              >
                References ({taxon.references.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={0.5}>
                {taxon.references.slice(0, 5).map((r, idx) => (
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
            </AccordionDetails>
          </Accordion>
        )}
      </Box>
      {/* Observations Section */}
      <Divider />
      <Box sx={{ px: 3, py: 2 }}>
        <Typography
          variant="subtitle2"
          sx={{
            color: "text.secondary",
          }}
        >
          Recent Observations
        </Typography>
      </Box>
      {observations.length === 0 ? (
        <Box sx={{ px: 3, py: 5, textAlign: "center" }}>
          <Typography
            sx={{
              color: "text.secondary",
              mb: 0.5,
            }}
          >
            No observations yet
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.disabled",
            }}
          >
            Be the first to observe <em>{taxon.commonName || taxon.scientificName}</em> on
            Observ.ing!
          </Typography>
        </Box>
      ) : (
        <Box>
          {observations.map((obs) => (
            <FeedItem key={obs.uri} observation={obs} />
          ))}

          {hasMore && (
            <Box sx={{ p: 2, textAlign: "center" }}>
              <Button variant="text" onClick={onLoadMore} disabled={loadingMore}>
                {loadingMore ? <CircularProgress size={20} sx={{ mr: 1 }} /> : null}
                Load more
              </Button>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
