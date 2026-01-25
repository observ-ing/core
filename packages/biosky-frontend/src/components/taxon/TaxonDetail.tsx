import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
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
  Card,
  CardMedia,
  Link,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import { fetchTaxon, fetchTaxonOccurrences } from "../../services/api";
import type { TaxonDetail as TaxonDetailType, Occurrence } from "../../services/types";
import { ConservationStatus } from "../common/ConservationStatus";
import { TaxonLink } from "../common/TaxonLink";
import { FeedItem } from "../feed/FeedItem";

export function TaxonDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [taxon, setTaxon] = useState<TaxonDetailType | null>(null);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    if (!id) {
      setError("No taxon ID provided");
      setLoading(false);
      return;
    }

    const decodedId = decodeURIComponent(id);

    async function loadTaxon() {
      setLoading(true);
      setError(null);

      const result = await fetchTaxon(decodedId);
      if (result) {
        setTaxon(result);
        // Load initial occurrences
        try {
          const occResult = await fetchTaxonOccurrences(decodedId);
          setOccurrences(occResult.occurrences);
          setCursor(occResult.cursor);
          setHasMore(!!occResult.cursor);
        } catch {
          // Occurrences failed but taxon loaded - that's ok
          setOccurrences([]);
          setHasMore(false);
        }
      } else {
        setError("Taxon not found");
      }
      setLoading(false);
    }

    loadTaxon();
  }, [id]);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  const loadMoreOccurrences = async () => {
    if (!id || !cursor || loadingMore) return;

    setLoadingMore(true);
    try {
      const result = await fetchTaxonOccurrences(decodeURIComponent(id), cursor);
      setOccurrences((prev) => [...prev, ...result.occurrences]);
      setCursor(result.cursor);
      setHasMore(!!result.cursor);
    } catch {
      setHasMore(false);
    }
    setLoadingMore(false);
  };

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ p: 4, textAlign: "center" }}>
        <CircularProgress color="primary" />
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          Loading taxon...
        </Typography>
      </Container>
    );
  }

  if (error || !taxon) {
    return (
      <Container maxWidth="sm" sx={{ p: 4, textAlign: "center" }}>
        <Typography color="error" sx={{ mb: 2 }}>
          {error || "Taxon not found"}
        </Typography>
        <Button variant="outlined" onClick={handleBack}>
          Go Back
        </Button>
      </Container>
    );
  }

  // Extract numeric ID for GBIF link
  const gbifNumericId = taxon.id.startsWith("gbif:") ? taxon.id.slice(5) : taxon.id;
  const gbifUrl = `https://www.gbif.org/species/${gbifNumericId}`;

  return (
    <Container
      maxWidth="sm"
      disableGutters
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "auto",
        borderLeft: { sm: "1px solid #333" },
        borderRight: { sm: "1px solid #333" },
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
          {taxon.observationCount} observation{taxon.observationCount !== 1 ? "s" : ""} on BioSky
          {taxon.numDescendants !== undefined && taxon.numDescendants > 0 && (
            <> &middot; {taxon.numDescendants.toLocaleString()} descendant taxa</>
          )}
        </Typography>

        {/* Taxonomy Hierarchy (Ancestors) */}
        {taxon.ancestors.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="caption" color="text.secondary">
              Classification
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
              {taxon.ancestors.map((ancestor, idx) => (
                <Stack key={ancestor.id} direction="row" alignItems="center" spacing={0.5}>
                  {idx > 0 && (
                    <Typography color="text.disabled" sx={{ fontSize: "0.75rem" }}>
                      &gt;
                    </Typography>
                  )}
                  <TaxonLink
                    name={ancestor.name}
                    taxonId={ancestor.id}
                    rank={ancestor.rank}
                    variant="chip"
                    italic={ancestor.rank === "genus"}
                  />
                </Stack>
              ))}
            </Stack>
          </Box>
        )}

        {/* Children Taxa */}
        {taxon.children.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="caption" color="text.secondary">
              {taxon.rank === "genus" ? "Species" : "Child Taxa"} ({taxon.children.length})
            </Typography>
            <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5, gap: 0.5 }}>
              {taxon.children.map((child) => (
                <TaxonLink
                  key={child.id}
                  name={child.scientificName}
                  taxonId={child.id}
                  rank={child.rank}
                  variant="chip"
                />
              ))}
            </Stack>
          </Box>
        )}

        {/* Media Gallery */}
        {taxon.media && taxon.media.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="caption" color="text.secondary">
              Media
            </Typography>
            <Stack
              direction="row"
              spacing={1}
              sx={{
                mt: 1,
                overflowX: "auto",
                pb: 1,
                "&::-webkit-scrollbar": { height: 6 },
                "&::-webkit-scrollbar-thumb": { bgcolor: "grey.700", borderRadius: 3 },
              }}
            >
              {taxon.media.map((m, idx) => (
                <Card
                  key={idx}
                  sx={{
                    minWidth: 150,
                    maxWidth: 150,
                    bgcolor: "background.paper",
                    flexShrink: 0,
                  }}
                >
                  <CardMedia
                    component="img"
                    height="100"
                    image={m.url}
                    alt={m.title || `Media ${idx + 1}`}
                    sx={{ objectFit: "cover" }}
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                  {(m.title || m.creator) && (
                    <Box sx={{ p: 0.5 }}>
                      {m.title && (
                        <Typography variant="caption" noWrap display="block">
                          {m.title}
                        </Typography>
                      )}
                      {m.creator && (
                        <Typography variant="caption" color="text.secondary" noWrap display="block">
                          {m.creator}
                        </Typography>
                      )}
                    </Box>
                  )}
                </Card>
              ))}
            </Stack>
          </Box>
        )}

        {/* Descriptions */}
        {taxon.descriptions && taxon.descriptions.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="caption" color="text.secondary">
              Description
            </Typography>
            {taxon.descriptions.slice(0, 2).map((d, idx) => (
              <Box key={idx} sx={{ mt: 1 }}>
                <Typography
                  variant="body2"
                  sx={{
                    display: "-webkit-box",
                    WebkitLineClamp: 4,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden",
                  }}
                >
                  {d.description}
                </Typography>
                {d.source && (
                  <Typography variant="caption" color="text.secondary">
                    Source: {d.source}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        )}

        {/* References */}
        {taxon.references && taxon.references.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="caption" color="text.secondary">
              References
            </Typography>
            <Stack spacing={0.5} sx={{ mt: 1 }}>
              {taxon.references.slice(0, 5).map((r, idx) => (
                <Typography key={idx} variant="caption" color="text.secondary">
                  {r.link || r.doi ? (
                    <Link
                      href={r.link || `https://doi.org/${r.doi}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      color="primary"
                    >
                      {r.citation}
                    </Link>
                  ) : (
                    r.citation
                  )}
                </Typography>
              ))}
            </Stack>
          </Box>
        )}

        {/* External Link */}
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
      </Box>

      {/* Observations Section */}
      <Divider />
      <Box sx={{ px: 3, py: 2 }}>
        <Typography variant="subtitle2" color="text.secondary">
          Recent Observations
        </Typography>
      </Box>

      {occurrences.length === 0 ? (
        <Box sx={{ p: 3, textAlign: "center" }}>
          <Typography color="text.secondary">
            No observations yet
          </Typography>
        </Box>
      ) : (
        <Box>
          {occurrences.map((occ) => (
            <FeedItem key={occ.uri} occurrence={occ} />
          ))}

          {hasMore && (
            <Box sx={{ p: 2, textAlign: "center" }}>
              <Button
                variant="text"
                onClick={loadMoreOccurrences}
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
