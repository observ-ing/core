import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Avatar,
  Button,
  Stack,
  Paper,
  IconButton,
  Tabs,
  Tab,
  Chip,
  Menu,
  MenuItem,
  Breadcrumbs,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import NotesIcon from "@mui/icons-material/Notes";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { fetchObservation, getImageUrl } from "../../services/api";
import { useAppSelector, useAppDispatch } from "../../store";
import { openDeleteConfirm } from "../../store/uiSlice";
import type { Occurrence, Identification, Comment } from "../../services/types";
import { IdentificationPanel } from "../identification/IdentificationPanel";
import { IdentificationHistory } from "../identification/IdentificationHistory";
import { CommentSection } from "../comment/CommentSection";
import { InteractionPanel } from "../interaction/InteractionPanel";
import { LocationMap } from "../map/LocationMap";
import { TaxonLink } from "../common/TaxonLink";
import { ObservationDetailSkeleton } from "../common/Skeletons";
import { formatDate, getPdslsUrl, buildOccurrenceAtUri } from "../../lib/utils";

export function ObservationDetail() {
  const { did, rkey } = useParams<{ did: string; rkey: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);

  const [observation, setObservation] = useState<Occurrence | null>(null);
  const [identifications, setIdentifications] = useState<Identification[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [selectedSubject, setSelectedSubject] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);

  // Reconstruct AT URI from route params
  const atUri = did && rkey ? buildOccurrenceAtUri(did, rkey) : null;

  useEffect(() => {
    if (!atUri) {
      setError("No observation URI provided");
      setLoading(false);
      return;
    }

    async function loadObservation() {
      setLoading(true);
      setError(null);

      const result = await fetchObservation(atUri!);
      if (result?.occurrence) {
        setObservation(result.occurrence);
        setIdentifications((result as { identifications?: Identification[] }).identifications || []);
        setComments((result as { comments?: Comment[] }).comments || []);
      } else {
        setError("Observation not found");
      }
      setLoading(false);
    }

    loadObservation();
  }, [atUri]);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  const handleIdentificationSuccess = async () => {
    if (atUri) {
      const result = await fetchObservation(atUri);
      if (result?.occurrence) {
        setObservation(result.occurrence);
        setIdentifications((result as { identifications?: Identification[] }).identifications || []);
        setComments((result as { comments?: Comment[] }).comments || []);
      }
    }
  };

  const handleCommentAdded = async () => {
    if (atUri) {
      const result = await fetchObservation(atUri);
      if (result) {
        setComments((result as { comments?: Comment[] }).comments || []);
      }
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleDeleteClick = () => {
    handleMenuClose();
    if (observation) {
      dispatch(openDeleteConfirm(observation));
    }
  };

  if (loading) {
    return (
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <Container
          maxWidth="md"
          disableGutters
          sx={{
            minHeight: "100%",
            display: "flex",
            flexDirection: "column",
            bgcolor: "background.paper",
          }}
        >
          <ObservationDetailSkeleton />
        </Container>
      </Box>
    );
  }

  if (error || !observation) {
    return (
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <Container maxWidth="md" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="error" sx={{ mb: 2 }}>
            {error || "Observation not found"}
          </Typography>
          <Button variant="outlined" onClick={handleBack}>
            Go Back
          </Button>
        </Container>
      </Box>
    );
  }

  const displayName =
    observation.observer.displayName ||
    observation.observer.handle ||
    observation.observer.did.slice(0, 20);
  const handle = observation.observer.handle
    ? `@${observation.observer.handle}`
    : "";

  // Find the current subject's data
  const currentSubject = observation.subjects?.find((s) => s.index === selectedSubject);

  // Get taxonomy from effectiveTaxonomy (preferred), falling back to legacy fields
  const taxonomy = observation.effectiveTaxonomy || {
    scientificName: observation.scientificName,
    vernacularName: observation.vernacularName,
    kingdom: observation.kingdom,
    phylum: observation.phylum,
    class: observation.class,
    order: observation.order,
    family: observation.family,
    genus: observation.genus,
    taxonId: observation.taxonId,
    taxonRank: observation.taxonRank,
  };

  const species =
    currentSubject?.communityId ||
    observation.communityId ||
    taxonomy.scientificName ||
    undefined;

  // Check if there are multiple subjects
  const hasMultipleSubjects = observation.subjects && observation.subjects.length > 1;

  // Check if current user owns this observation
  const isOwner = user?.did === observation.observer.did;

  return (
    <Box sx={{ flex: 1, overflow: "auto" }}>
    <Container
      maxWidth="md"
      disableGutters
      sx={{
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
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
          Observation
        </Typography>
        <Box sx={{ ml: "auto" }}>
          <IconButton
            size="small"
            onClick={handleMenuOpen}
            aria-label="More options"
            sx={{ color: "text.disabled" }}
          >
            <MoreVertIcon fontSize="small" />
          </IconButton>
          <Menu
            anchorEl={anchorEl}
            open={menuOpen}
            onClose={handleMenuClose}
            anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
            transformOrigin={{ vertical: "top", horizontal: "right" }}
          >
            {isOwner && (
              <MenuItem onClick={handleDeleteClick} sx={{ color: "error.main" }}>
                Delete
              </MenuItem>
            )}
            <MenuItem
              component="a"
              href={getPdslsUrl(observation.uri)}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on AT Protocol
            </MenuItem>
          </Menu>
        </Box>
      </Box>

      {/* Species Header */}
      <Box sx={{ px: 3, pt: 2, pb: 1 }}>
        {species ? (
          <TaxonLink
            name={species}
            kingdom={taxonomy.kingdom}
            rank={taxonomy.taxonRank || "species"}
          />
        ) : (
          <Typography variant="h5" sx={{ fontWeight: 600, fontStyle: "italic", color: "text.secondary" }}>
            Unidentified
          </Typography>
        )}
        {taxonomy.vernacularName && (
          <Typography variant="body1" color="text.secondary">
            {taxonomy.vernacularName}
          </Typography>
        )}
      </Box>

      {/* Images */}
      {observation.images.length > 0 && (
        <Box sx={{ bgcolor: "#1a1a1a", p: { xs: 0, sm: 2 } }}>
          <Box
            component="img"
            src={getImageUrl(observation.images[activeImageIndex])}
            alt={species}
            sx={{
              width: "100%",
              maxHeight: 400,
              objectFit: "contain",
              display: "block",
              borderRadius: { xs: 0, sm: 2 },
              boxShadow: { xs: "none", sm: "0 4px 12px rgba(0, 0, 0, 0.15)" },
            }}
          />
          {observation.images.length > 1 && (
            <Stack direction="row" spacing={1} sx={{ p: 1, justifyContent: "center" }}>
              {observation.images.map((img, idx) => (
                <Box
                  key={img}
                  component="button"
                  onClick={() => setActiveImageIndex(idx)}
                  sx={{
                    width: 60,
                    height: 60,
                    p: 0,
                    border: 2,
                    borderColor: idx === activeImageIndex ? "primary.main" : "divider",
                    borderRadius: 1,
                    overflow: "hidden",
                    cursor: "pointer",
                    bgcolor: "transparent",
                  }}
                >
                  <Box
                    component="img"
                    src={getImageUrl(img)}
                    alt={`Photo ${idx + 1}`}
                    sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                </Box>
              ))}
            </Stack>
          )}
        </Box>
      )}

      {/* Content */}
      <Box sx={{ p: 3 }}>
        {/* Observer */}
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          component={Link}
          to={`/profile/${encodeURIComponent(observation.observer.did)}`}
          sx={{
            textDecoration: "none",
            color: "inherit",
            "&:hover": { bgcolor: "rgba(255, 255, 255, 0.03)" },
            p: 1,
            mx: -1,
            borderRadius: 1,
          }}
        >
          <Avatar src={observation.observer.avatar} alt={displayName} />
          <Box>
            <Typography fontWeight={600}>{displayName}</Typography>
            {handle && (
              <Typography variant="body2" color="text.disabled">
                {handle}
              </Typography>
            )}
          </Box>
        </Stack>

        {/* Observation Details (shared across all subjects) */}
        <Box sx={{ mt: 2 }}>
          <Stack spacing={2}>
            <Box>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <CalendarTodayIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                <Typography variant="caption" color="text.secondary">
                  Observed
                </Typography>
              </Stack>
              <Typography>{formatDate(observation.eventDate)}</Typography>
            </Box>

            {observation.verbatimLocality && (
              <Box>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <LocationOnIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                  <Typography variant="caption" color="text.secondary">
                    Location
                  </Typography>
                </Stack>
                <Typography>{observation.verbatimLocality}</Typography>
              </Box>
            )}

            <Box>
              <Stack direction="row" alignItems="center" spacing={0.5}>
                <MyLocationIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                <Typography variant="caption" color="text.secondary">
                  Coordinates
                </Typography>
              </Stack>
              <Typography>
                {observation.location.latitude.toFixed(5)},{" "}
                {observation.location.longitude.toFixed(5)}
                {observation.location.uncertaintyMeters && (
                  <Typography
                    component="span"
                    variant="body2"
                    color="text.disabled"
                  >
                    {" "}
                    (±{observation.location.uncertaintyMeters}m)
                  </Typography>
                )}
              </Typography>
              <Box sx={{ mt: 1 }}>
                <LocationMap
                  latitude={observation.location.latitude}
                  longitude={observation.location.longitude}
                  uncertaintyMeters={observation.location.uncertaintyMeters}
                />
              </Box>
            </Box>

            {observation.occurrenceRemarks && (
              <Box>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <NotesIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                  <Typography variant="caption" color="text.secondary">
                    Notes
                  </Typography>
                </Stack>
                <Typography>{observation.occurrenceRemarks}</Typography>
              </Box>
            )}

            {/* Taxonomy Information */}
            {(taxonomy.vernacularName || taxonomy.kingdom || taxonomy.family) && (
              <Box>
                <Stack direction="row" alignItems="center" spacing={0.5}>
                  <AccountTreeIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                  <Typography variant="caption" color="text.secondary">
                    Taxonomy
                  </Typography>
                </Stack>
                <Breadcrumbs
                  separator={<ChevronRightIcon sx={{ fontSize: 16, color: "text.disabled" }} />}
                  aria-label="taxonomy breadcrumb"
                  sx={{ mt: 0.5, "& .MuiBreadcrumbs-ol": { flexWrap: "wrap", gap: 0.5 } }}
                >
                  {taxonomy.kingdom && (
                    <TaxonLink name={taxonomy.kingdom} rank="kingdom" variant="chip" italic={false} />
                  )}
                  {taxonomy.phylum && (
                    <TaxonLink name={taxonomy.phylum} kingdom={taxonomy.kingdom} rank="phylum" variant="chip" italic={false} />
                  )}
                  {taxonomy.class && (
                    <TaxonLink name={taxonomy.class} kingdom={taxonomy.kingdom} rank="class" variant="chip" italic={false} />
                  )}
                  {taxonomy.order && (
                    <TaxonLink name={taxonomy.order} kingdom={taxonomy.kingdom} rank="order" variant="chip" italic={false} />
                  )}
                  {taxonomy.family && (
                    <TaxonLink name={taxonomy.family} kingdom={taxonomy.kingdom} rank="family" variant="chip" italic={false} />
                  )}
                  {taxonomy.genus && (
                    <TaxonLink name={taxonomy.genus} kingdom={taxonomy.kingdom} rank="genus" variant="chip" />
                  )}
                </Breadcrumbs>
              </Box>
            )}
          </Stack>
        </Box>

        {/* Subject-specific content (identification) */}
        <Box sx={{ mt: 3 }}>
          {/* Subject Tabs - only show if multiple subjects */}
          {hasMultipleSubjects && (
            <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
              <Tabs
                value={selectedSubject}
                onChange={(_, newValue) => setSelectedSubject(newValue)}
                variant="scrollable"
                scrollButtons="auto"
              >
                {observation.subjects.map((subject) => (
                  <Tab
                    key={subject.index}
                    value={subject.index}
                    label={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2">
                          Subject {subject.index + 1}
                        </Typography>
                        {subject.communityId && (
                          <Chip
                            label={subject.communityId}
                            size="small"
                            sx={{ fontStyle: "italic", maxWidth: 120 }}
                          />
                        )}
                      </Stack>
                    }
                  />
                ))}
              </Tabs>
            </Box>
          )}

          {/* Identification History */}
          <Box sx={{ mt: 2 }}>
            <IdentificationHistory
              identifications={identifications}
              subjectIndex={selectedSubject}
              kingdom={taxonomy.kingdom}
              observerInitialId={observation.scientificName ? {
                scientificName: observation.scientificName,
                observer: observation.observer,
                date: observation.createdAt,
                kingdom: taxonomy.kingdom,
              } : undefined}
              footer={user ? (
                <IdentificationPanel
                  observation={{
                    uri: observation.uri,
                    cid: observation.cid,
                    scientificName: observation.scientificName,
                    communityId: currentSubject?.communityId || observation.communityId,
                  }}
                  subjectIndex={selectedSubject}
                  existingSubjectCount={observation.subjects?.length ?? 1}
                  onSuccess={handleIdentificationSuccess}
                />
              ) : (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 2, textAlign: "center" }}>
                  Log in to add an identification
                </Typography>
              )}
            />
          </Box>

          {/* Interactions Panel */}
          <InteractionPanel
            observation={{
              uri: observation.uri,
              cid: observation.cid,
              scientificName: observation.scientificName,
              communityId: currentSubject?.communityId || observation.communityId,
            }}
            subjects={observation.subjects || [{ index: 0, identificationCount: 0 }]}
            onSuccess={handleIdentificationSuccess}
          />
        </Box>

        {/* Discussion / Comments */}
        <Box sx={{ mt: 3 }}>
          <CommentSection
            observationUri={observation.uri}
            observationCid={observation.cid}
            comments={comments}
            onCommentAdded={handleCommentAdded}
          />
        </Box>
      </Box>
    </Container>
    </Box>
  );
}
