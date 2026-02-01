import { useEffect, useState } from "react";
import { useParams, useNavigate, Link as RouterLink } from "react-router-dom";
import DOMPurify from "dompurify";
import {
  Box,
  Container,
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
  Breadcrumbs,
  ImageList,
  ImageListItem,
  ImageListItemBar,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { fetchTaxon, fetchTaxonObservations } from "../../services/api";
import type { TaxonDetail as TaxonDetailType, Occurrence } from "../../services/types";
import { slugToName } from "../../lib/taxonSlug";
import { ConservationStatus } from "../common/ConservationStatus";
import { TaxonLink } from "../common/TaxonLink";
import { FeedItem } from "../feed/FeedItem";
import { TaxonDetailSkeleton } from "../common/Skeletons";

export function TaxonDetail() {
  // Support both /taxon/:kingdom/:name and /taxon/:id
  const { kingdom, name, id } = useParams<{ kingdom?: string; name?: string; id?: string }>();
  const navigate = useNavigate();

  const [taxon, setTaxon] = useState<TaxonDetailType | null>(null);
  const [observations, setObservations] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);

  // Determine the lookup parameters — convert URL slugs (hyphens) back to names (spaces)
  const lookupKingdom = kingdom ? slugToName(decodeURIComponent(kingdom)) : undefined;
  const lookupName = name ? slugToName(decodeURIComponent(name)) : undefined;
  const lookupId = id ? decodeURIComponent(id) : undefined;

  useEffect(() => {
    if (!lookupKingdom && !lookupId) {
      setError("No taxon specified");
      setLoading(false);
      return;
    }

    async function loadTaxon() {
      setLoading(true);
      setError(null);

      let result: TaxonDetailType | null;
      if (lookupKingdom && lookupName) {
        result = await fetchTaxon(lookupKingdom, lookupName);
      } else {
        // Single param: either a kingdom name or a legacy ID
        result = await fetchTaxon(lookupId || lookupKingdom!);
      }

      if (result) {
        setTaxon(result);
        // Load initial observations
        try {
          let obsResult;
          if (lookupKingdom && lookupName) {
            obsResult = await fetchTaxonObservations(lookupKingdom, lookupName);
          } else {
            obsResult = await fetchTaxonObservations(lookupId || lookupKingdom!);
          }
          setObservations(obsResult.occurrences);
          setCursor(obsResult.cursor);
          setHasMore(!!obsResult.cursor);
        } catch {
          setObservations([]);
          setHasMore(false);
        }
      } else {
        setError("Taxon not found");
      }
      setLoading(false);
    }

    loadTaxon();
  }, [lookupKingdom, lookupName, lookupId]);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  const loadMoreObservations = async () => {
    if (!cursor || loadingMore) return;

    setLoadingMore(true);
    try {
      let result;
      if (lookupKingdom && lookupName) {
        result = await fetchTaxonObservations(lookupKingdom, lookupName, cursor);
      } else {
        result = await fetchTaxonObservations(lookupId || lookupKingdom!, undefined, cursor);
      }
      setObservations((prev) => [...prev, ...result.occurrences]);
      setCursor(result.cursor);
      setHasMore(!!result.cursor);
    } catch {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  if (loading) {
    return (
      <Container
        maxWidth="md"
        disableGutters
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflow: "auto",
        }}
      >
        <TaxonDetailSkeleton />
      </Container>
    );
  }

  if (error || !taxon) {
    return (
      <Container maxWidth="md" sx={{ p: 4, textAlign: "center" }}>
        <Typography color="error" sx={{ mb: 2 }}>
          {error || "Taxon not found"}
        </Typography>
        <Button variant="outlined" onClick={handleBack}>
          Go Back
        </Button>
      </Container>
    );
  }

  // Use gbifUrl from the API response
  const gbifUrl = taxon.gbifUrl;

  return (
    <Container
      maxWidth="md"
      disableGutters
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
      }}
    >
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
        <IconButton onClick={handleBack} sx={{ mr: 1 }}>
          <ArrowBackIcon />
        </IconButton>
        <Typography variant="subtitle1" fontWeight={500}>
          Taxon
        </Typography>
      </Box>

      {/* Main Content */}
      <Box sx={{ p: 3 }}>
        {/* Scientific Name */}
        <Typography
          variant="h5"
          sx={{
            fontStyle: taxon.rank === "species" || taxon.rank === "genus" ? "italic" : "normal",
            color: "primary.main",
            fontWeight: 600,
          }}
        >
          {taxon.scientificName}
        </Typography>

        {/* Common Name */}
        {taxon.commonName && (
          <Typography variant="h6" color="text.secondary" sx={{ mt: 0.5 }}>
            {taxon.commonName}
          </Typography>
        )}

        {/* Rank and Conservation Status */}
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2 }}>
          <Chip label={taxon.rank} size="small" color="default" />
          {taxon.conservationStatus && (
            <ConservationStatus status={taxon.conservationStatus} showLabel />
          )}
          {taxon.extinct && (
            <Chip label="Extinct" size="small" color="error" />
          )}
        </Stack>

        {/* Stats */}
        <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
          {taxon.observationCount} observation{taxon.observationCount !== 1 ? "s" : ""} on Observ.ing
          {taxon.numDescendants !== undefined && taxon.numDescendants > 0 && (
            <> &middot; {taxon.numDescendants.toLocaleString()} descendant taxa</>
          )}
        </Typography>

        {/* Taxonomy Hierarchy (Ancestors) - using Breadcrumbs */}
        {taxon.ancestors.length > 0 && (
          <Accordion defaultExpanded sx={{ mt: 3 }}>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle2" color="text.secondary">
                Classification
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Breadcrumbs
                separator={<ChevronRightIcon sx={{ fontSize: 16, color: "text.disabled" }} />}
                aria-label="taxonomy breadcrumb"
                sx={{ "& .MuiBreadcrumbs-ol": { flexWrap: "wrap", gap: 0.5 } }}
              >
                {taxon.ancestors.map((ancestor) => (
                  <TaxonLink
                    key={ancestor.id}
                    name={ancestor.name}
                    kingdom={taxon.kingdom}
                    rank={ancestor.rank}
                    variant="chip"
                    italic={ancestor.rank === "genus"}
                  />
                ))}
              </Breadcrumbs>
            </AccordionDetails>
          </Accordion>
        )}

        {/* Children Taxa */}
        {taxon.children.length > 0 && (
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle2" color="text.secondary">
                {taxon.rank === "genus" ? "Species" : "Child Taxa"} ({taxon.children.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ gap: 0.5 }}>
                {taxon.children.map((child) => (
                  <TaxonLink
                    key={child.id}
                    name={child.scientificName}
                    kingdom={taxon.kingdom}
                    rank={child.rank}
                    variant="chip"
                  />
                ))}
              </Stack>
            </AccordionDetails>
          </Accordion>
        )}

        {/* Media Gallery - using ImageList */}
        {taxon.media && taxon.media.length > 0 && (
          <Accordion defaultExpanded>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle2" color="text.secondary">
                Media ({taxon.media.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <ImageList
                variant="masonry"
                cols={3}
                gap={8}
                sx={{
                  m: 0,
                  "@media (max-width: 600px)": { "& > li": { width: "calc(50% - 4px) !important" } },
                }}
              >
                {taxon.media.map((m, idx) => (
                  <ImageListItem key={idx}>
                    <img
                      src={m.url}
                      alt={m.title || `Media ${idx + 1}`}
                      loading="lazy"
                      style={{ borderRadius: 4 }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    {(m.title || m.creator) && (
                      <ImageListItemBar
                        title={m.title}
                        subtitle={m.creator}
                        sx={{
                          borderRadius: "0 0 4px 4px",
                          "& .MuiImageListItemBar-title": { fontSize: "0.75rem" },
                          "& .MuiImageListItemBar-subtitle": { fontSize: "0.65rem" },
                        }}
                      />
                    )}
                  </ImageListItem>
                ))}
              </ImageList>
            </AccordionDetails>
          </Accordion>
        )}

        {/* Descriptions */}
        {taxon.descriptions && taxon.descriptions.length > 0 && (
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle2" color="text.secondary">
                Description
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              {taxon.descriptions.slice(0, 2).map((d, idx) => (
                <Box key={idx} sx={{ mb: idx < taxon.descriptions!.length - 1 ? 2 : 0 }}>
                  <Typography
                    variant="body2"
                    component="div"
                    sx={{
                      display: "-webkit-box",
                      WebkitLineClamp: 6,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                      "& p": { m: 0 },
                      "& em, & i": { fontStyle: "italic" },
                    }}
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(d.description, {
                        ALLOWED_TAGS: ["p", "br", "em", "i", "strong", "b", "a"],
                        ALLOWED_ATTR: ["href", "target", "rel"],
                      }),
                    }}
                  />
                  {d.source && (
                    <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                      Source: {d.source}
                    </Typography>
                  )}
                </Box>
              ))}
            </AccordionDetails>
          </Accordion>
        )}

        {/* References */}
        {taxon.references && taxon.references.length > 0 && (
          <Accordion>
            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
              <Typography variant="subtitle2" color="text.secondary">
                References ({taxon.references.length})
              </Typography>
            </AccordionSummary>
            <AccordionDetails>
              <Stack spacing={0.5}>
                {taxon.references.slice(0, 5).map((r, idx) => (
                  <Typography key={idx} variant="caption" color="text.secondary">
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

        {/* External Link */}
        {gbifUrl && (
          <Button
            component="a"
            href={gbifUrl}
            target="_blank"
            rel="noopener noreferrer"
            variant="outlined"
            size="small"
            endIcon={<OpenInNewIcon fontSize="small" />}
            sx={{ mt: 3 }}
          >
            View on GBIF
          </Button>
        )}
      </Box>

      {/* Observations Section */}
      <Divider />
      <Box sx={{ px: 3, py: 2 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Recent Observations
        </Typography>
      </Box>

      {observations.length === 0 ? (
        <Box sx={{ p: 3, textAlign: "center" }}>
          <Typography color="text.secondary">
            No observations yet
          </Typography>
        </Box>
      ) : (
        <Box>
          {observations.map((obs) => (
            <FeedItem key={obs.uri} observation={obs} />
          ))}

          {hasMore && (
            <Box sx={{ p: 2, textAlign: "center" }}>
              <Button
                variant="text"
                onClick={loadMoreObservations}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <CircularProgress size={20} sx={{ mr: 1 }} />
                ) : null}
                Load more
              </Button>
            </Box>
          )}
        </Box>
      )}
    </Container>
  );
}
