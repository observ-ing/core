import { useState } from "react";
import DOMPurify from "dompurify";
import {
  Box,
  Typography,
  Button,
  Stack,
  IconButton,
  LinearProgress,
  Link as MuiLink,
  Accordion,
  AccordionSummary,
  AccordionDetails,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import type { TaxonDetail as TaxonDetailType, Occurrence } from "../../services/types";
import { Link as RouterLink } from "react-router-dom";
import { LoadMoreButton } from "../common/LoadMoreButton";
import { WikiCommonsGallery } from "../common/WikiCommonsGallery";
import { shouldItalicizeTaxonName } from "../common/TaxonLink";
import { nameToSlug } from "../../lib/taxonSlug";
import { FeedItem } from "../feed/FeedItem";
import { TaxonHeroCard } from "./TaxonHeroCard";

// Accordion restyle: drop MUI's default elevation + divider rules and present
// each section as a bordered, rounded "card" matching the design mockup.
const accordionCardSx = {
  borderRadius: "14px",
  border: 1,
  borderColor: "divider",
  backgroundColor: "background.paper",
  boxShadow: "0 1px 2px rgba(60,50,30,0.04)",
  "&:before": { display: "none" },
  "&.Mui-expanded": { margin: 0 },
} as const;

interface TaxonDetailPanelProps {
  taxon: TaxonDetailType;
  heroUrl?: string | undefined;
  observations: Occurrence[];
  hasMore: boolean;
  loadingMore: boolean;
  /** A newly-selected taxon is loading; the still-visible content is stale. */
  loading?: boolean;
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
  loading = false,
  onLoadMore,
  onBack,
  onToggleTree,
}: TaxonDetailPanelProps) {
  const [descExpanded, setDescExpanded] = useState(false);
  const [galleryMounted, setGalleryMounted] = useState(false);

  return (
    <Box sx={{ flex: 1, overflow: "auto", minHeight: 0 }}>
      {/* Header */}
      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 3,
          px: { xs: 2, sm: 4 },
          py: 1.25,
          borderBottom: 1,
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          backgroundColor: (theme) =>
            theme.palette.mode === "dark" ? "rgba(26,26,26,0.86)" : "rgba(250,246,236,0.86)",
          backdropFilter: "blur(8px)",
        }}
      >
        <IconButton onClick={onBack} sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography
          variant="h6"
          component="h2"
          sx={{
            fontWeight: 600,
            fontSize: "1.1875rem",
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
      {/* While a newly-selected taxon loads we keep the previous one visible
          (no empty flash) but signal the swap: a progress bar pinned below the
          header, plus a dimmed, inert content area — mirroring how the
          classification tree is disabled during the same load. */}
      {loading && <LinearProgress sx={{ position: "sticky", top: 0, zIndex: 2 }} />}
      <Box
        sx={{
          opacity: loading ? 0.5 : 1,
          pointerEvents: loading ? "none" : "auto",
          transition: "opacity 0.2s",
        }}
      >
        {/* Main Content — constrained + centered to match the design's reading width */}
        <Box sx={{ maxWidth: 960, mx: "auto", px: { xs: 2, sm: 4 }, pt: 3.5, pb: 7.5 }}>
          {/* Breadcrumb: the ancestor path up to (but excluding) this taxon. */}
          {taxon.ancestors.length > 0 && (
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
              {taxon.ancestors.map((a, idx) => {
                const url =
                  a.rank === "kingdom"
                    ? `/taxon/${nameToSlug(a.name)}`
                    : taxon.kingdom
                      ? `/taxon/${nameToSlug(taxon.kingdom)}/${nameToSlug(a.name)}`
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
                    {idx < taxon.ancestors.length - 1 && (
                      <Box component="span" sx={{ color: "divider" }}>
                        /
                      </Box>
                    )}
                  </Box>
                );
              })}
            </Box>
          )}

          <TaxonHeroCard taxon={taxon} heroUrl={heroUrl} />

          {/* Media Gallery — lazy-loaded */}
          <Accordion
            disableGutters
            elevation={0}
            sx={{ ...accordionCardSx, mt: 3.25 }}
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
            <Accordion
              defaultExpanded
              disableGutters
              elevation={0}
              sx={{ ...accordionCardSx, mt: 2 }}
            >
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
            <Accordion disableGutters elevation={0} sx={{ ...accordionCardSx, mt: 2 }}>
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

          {/* Observations Section */}
          <Box sx={{ mt: 4.25, pt: 3, borderTop: 1, borderColor: "divider" }}>
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
            <Box sx={{ py: 5, textAlign: "center" }}>
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

              {hasMore && <LoadMoreButton loading={loadingMore} onClick={onLoadMore} />}
            </Box>
          )}
        </Box>
      </Box>
    </Box>
  );
}
