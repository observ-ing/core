import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Avatar,
  Button,
  CircularProgress,
  Stack,
  Paper,
  IconButton,
  Tabs,
  Tab,
  Chip,
  Menu,
  MenuItem,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import { fetchOccurrence, getImageUrl } from "../../services/api";
import { useAppSelector } from "../../store";
import type { Occurrence, Identification, Comment } from "../../services/types";
import { IdentificationPanel } from "../identification/IdentificationPanel";
import { IdentificationHistory } from "../identification/IdentificationHistory";
import { CommentSection } from "../comment/CommentSection";

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function getPdslsUrl(atUri: string): string {
  return `https://pdsls.dev/${atUri}`;
}

export function OccurrenceDetail() {
  const { uri } = useParams<{ uri: string }>();
  const navigate = useNavigate();
  const user = useAppSelector((state) => state.auth.user);

  const [occurrence, setOccurrence] = useState<Occurrence | null>(null);
  const [identifications, setIdentifications] = useState<Identification[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [selectedSubject, setSelectedSubject] = useState(0);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);

  useEffect(() => {
    if (!uri) {
      setError("No occurrence URI provided");
      setLoading(false);
      return;
    }

    const decodedUri = decodeURIComponent(uri);

    async function loadOccurrence() {
      setLoading(true);
      setError(null);

      const result = await fetchOccurrence(decodedUri);
      if (result?.occurrence) {
        setOccurrence(result.occurrence);
        setIdentifications((result as { identifications?: Identification[] }).identifications || []);
        setComments((result as { comments?: Comment[] }).comments || []);
      } else {
        setError("Occurrence not found");
      }
      setLoading(false);
    }

    loadOccurrence();
  }, [uri]);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  };

  const handleIdentificationSuccess = async () => {
    if (uri) {
      const result = await fetchOccurrence(decodeURIComponent(uri));
      if (result?.occurrence) {
        setOccurrence(result.occurrence);
        setIdentifications((result as { identifications?: Identification[] }).identifications || []);
        setComments((result as { comments?: Comment[] }).comments || []);
      }
    }
  };

  const handleCommentAdded = async () => {
    if (uri) {
      const result = await fetchOccurrence(decodeURIComponent(uri));
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

  if (loading) {
    return (
      <Container maxWidth="sm" sx={{ p: 4, textAlign: "center" }}>
        <CircularProgress color="primary" />
        <Typography color="text.secondary" sx={{ mt: 2 }}>
          Loading occurrence...
        </Typography>
      </Container>
    );
  }

  if (error || !occurrence) {
    return (
      <Container maxWidth="sm" sx={{ p: 4, textAlign: "center" }}>
        <Typography color="error" sx={{ mb: 2 }}>
          {error || "Occurrence not found"}
        </Typography>
        <Button variant="outlined" onClick={handleBack}>
          Go Back
        </Button>
      </Container>
    );
  }

  const displayName =
    occurrence.observer.displayName ||
    occurrence.observer.handle ||
    occurrence.observer.did.slice(0, 20);
  const handle = occurrence.observer.handle
    ? `@${occurrence.observer.handle}`
    : "";

  // Find the current subject's data
  const currentSubject = occurrence.subjects?.find((s) => s.index === selectedSubject);
  const species =
    currentSubject?.communityId ||
    occurrence.communityId ||
    occurrence.scientificName ||
    "Unknown species";

  // Check if there are multiple subjects
  const hasMultipleSubjects = occurrence.subjects && occurrence.subjects.length > 1;

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
            <MenuItem
              component="a"
              href={getPdslsUrl(occurrence.uri)}
              target="_blank"
              rel="noopener noreferrer"
            >
              View on AT Protocol
            </MenuItem>
          </Menu>
        </Box>
      </Box>

      {/* Images */}
      {occurrence.images.length > 0 && (
        <Box sx={{ bgcolor: "background.default" }}>
          <Box
            component="img"
            src={getImageUrl(occurrence.images[activeImageIndex])}
            alt={species}
            sx={{
              width: "100%",
              maxHeight: 400,
              objectFit: "contain",
              display: "block",
            }}
          />
          {occurrence.images.length > 1 && (
            <Stack direction="row" spacing={1} sx={{ p: 1, justifyContent: "center" }}>
              {occurrence.images.map((img, idx) => (
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
        {/* Subject Tabs - only show if multiple subjects */}
        {hasMultipleSubjects && (
          <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
            <Tabs
              value={selectedSubject}
              onChange={(_, newValue) => setSelectedSubject(newValue)}
              variant="scrollable"
              scrollButtons="auto"
            >
              {occurrence.subjects.map((subject) => (
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

        <Typography
          variant="h5"
          sx={{ fontStyle: "italic", color: "primary.main", fontWeight: 600 }}
        >
          {species}
        </Typography>

        {occurrence.scientificName &&
          occurrence.communityId &&
          occurrence.scientificName !== occurrence.communityId && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              Originally identified as: {occurrence.scientificName}
            </Typography>
          )}

        {/* Observer */}
        <Stack
          direction="row"
          spacing={1.5}
          alignItems="center"
          component={Link}
          to={`/profile/${encodeURIComponent(occurrence.observer.did)}`}
          sx={{
            mt: 2,
            textDecoration: "none",
            color: "inherit",
            "&:hover": { bgcolor: "rgba(255, 255, 255, 0.03)" },
            p: 1,
            mx: -1,
            borderRadius: 1,
          }}
        >
          <Avatar src={occurrence.observer.avatar} alt={displayName} />
          <Box>
            <Typography fontWeight={600}>{displayName}</Typography>
            {handle && (
              <Typography variant="body2" color="text.disabled">
                {handle}
              </Typography>
            )}
          </Box>
        </Stack>

        {/* Details */}
        <Box sx={{ mt: 3 }}>
          <Stack spacing={2}>
            <Box>
              <Typography variant="caption" color="text.secondary">
                Observed
              </Typography>
              <Typography>{formatDate(occurrence.eventDate)}</Typography>
            </Box>

            {occurrence.verbatimLocality && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Location
                </Typography>
                <Typography>{occurrence.verbatimLocality}</Typography>
              </Box>
            )}

            <Box>
              <Typography variant="caption" color="text.secondary">
                Coordinates
              </Typography>
              <Typography>
                {occurrence.location.latitude.toFixed(5)},{" "}
                {occurrence.location.longitude.toFixed(5)}
                {occurrence.location.uncertaintyMeters && (
                  <Typography
                    component="span"
                    variant="body2"
                    color="text.disabled"
                  >
                    {" "}
                    (±{occurrence.location.uncertaintyMeters}m)
                  </Typography>
                )}
              </Typography>
            </Box>

            {occurrence.occurrenceRemarks && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Notes
                </Typography>
                <Typography>{occurrence.occurrenceRemarks}</Typography>
              </Box>
            )}

            {/* Taxonomy Information */}
            {(occurrence.vernacularName || occurrence.kingdom || occurrence.family) && (
              <Box>
                <Typography variant="caption" color="text.secondary">
                  Taxonomy
                </Typography>
                {occurrence.vernacularName && (
                  <Typography>{occurrence.vernacularName}</Typography>
                )}
                <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                  {occurrence.kingdom && (
                    <Chip label={occurrence.kingdom} size="small" variant="outlined" />
                  )}
                  {occurrence.phylum && (
                    <Chip label={occurrence.phylum} size="small" variant="outlined" />
                  )}
                  {occurrence.class && (
                    <Chip label={occurrence.class} size="small" variant="outlined" />
                  )}
                  {occurrence.order && (
                    <Chip label={occurrence.order} size="small" variant="outlined" />
                  )}
                  {occurrence.family && (
                    <Chip label={occurrence.family} size="small" variant="outlined" />
                  )}
                  {occurrence.genus && (
                    <Chip label={occurrence.genus} size="small" variant="outlined" sx={{ fontStyle: "italic" }} />
                  )}
                </Stack>
              </Box>
            )}
          </Stack>
        </Box>

        {/* Identification History */}
        {identifications.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <IdentificationHistory
              identifications={identifications}
              subjectIndex={selectedSubject}
            />
          </Box>
        )}

        {/* Identification Panel */}
        {user ? (
          <IdentificationPanel
            occurrence={{
              uri: occurrence.uri,
              cid: occurrence.cid,
              scientificName: occurrence.scientificName,
              communityId: currentSubject?.communityId || occurrence.communityId,
            }}
            subjectIndex={selectedSubject}
            existingSubjectCount={occurrence.subjects?.length ?? 1}
            onSuccess={handleIdentificationSuccess}
          />
        ) : (
          <Paper sx={{ mt: 3, p: 2, textAlign: "center", bgcolor: "background.paper" }}>
            <Typography color="text.secondary">
              Log in to add an identification
            </Typography>
          </Paper>
        )}

        {/* Discussion / Comments */}
        <Box sx={{ mt: 3 }}>
          <CommentSection
            occurrenceUri={occurrence.uri}
            occurrenceCid={occurrence.cid}
            comments={comments}
            onCommentAdded={handleCommentAdded}
          />
        </Box>
      </Box>
    </Container>
  );
}
