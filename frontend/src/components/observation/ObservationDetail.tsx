import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Avatar,
  Button,
  Stack,
  IconButton,
  ButtonBase,
  Menu,
  MenuItem,
  List,
  ListItem,
  ListItemIcon,
  ListItemAvatar,
  ListItemText,
  Tooltip,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import FavoriteIcon from "@mui/icons-material/Favorite";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import {
  fetchObservation,
  getImageUrl,
  deleteIdentification,
  pollObservation,
} from "../../services/api";
import { useAppSelector, useAppDispatch } from "../../store";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useLikeToggle } from "../../hooks/useLikeToggle";
import { openDeleteConfirm, openEditModal, addToast } from "../../store/uiSlice";
import { checkAuth } from "../../store/authSlice";
import type { Occurrence, Identification, Comment } from "../../services/types";
import { IdentificationPanel } from "../identification/IdentificationPanel";
import { IdentificationHistory } from "../identification/IdentificationHistory";
import { CommentSection } from "../comment/CommentSection";
import { InteractionPanel } from "../interaction/InteractionPanel";
import { LocationMap } from "../map/LocationMap";
import { TaxonLink } from "../common/TaxonLink";
import { ObservationDetailSkeleton } from "./ObservationDetailSkeleton";
import { PhotoLightbox } from "./PhotoLightbox";
import {
  formatDate,
  getDisplayName,
  getPdslsUrl,
  buildOccurrenceAtUri,
  getErrorMessage,
} from "../../lib/utils";

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
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const { liked, setLiked, likeCount, setLikeCount, handleLikeToggle } = useLikeToggle();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);

  usePageTitle(
    observation?.communityId || observation?.effectiveTaxonomy?.scientificName || "Observation",
  );

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

      if (!atUri) return;
      const result = await fetchObservation(atUri);
      if (result?.occurrence) {
        setObservation(result.occurrence);
        setLiked(result.occurrence.viewerHasLiked ?? false);
        setLikeCount(result.occurrence.likeCount ?? 0);
        setIdentifications(result.identifications || []);
        setComments(result.comments || []);
      } else {
        setError("Observation not found");
      }
      setLoading(false);
    }

    loadObservation();
  }, [atUri, setLiked, setLikeCount]);

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
        setIdentifications(result.identifications || []);
        setComments(result.comments || []);
      }
    }
  };

  const handleCommentAdded = async () => {
    if (atUri) {
      const result = await fetchObservation(atUri);
      if (result) {
        setComments(result.comments || []);
      }
    }
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleEditClick = () => {
    handleMenuClose();
    if (observation) {
      dispatch(openEditModal(observation));
    }
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

  const displayName = getDisplayName(observation.observer);
  const handle = observation.observer.handle ? `@${observation.observer.handle}` : "";

  const taxonomy = observation.effectiveTaxonomy;

  const species = observation.communityId || taxonomy?.scientificName || undefined;

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
          <Typography
            variant="subtitle1"
            sx={{
              fontWeight: 500,
            }}
          >
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
              {isOwner && <MenuItem onClick={handleEditClick}>Edit</MenuItem>}
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
            <TaxonLink name={species} kingdom={taxonomy?.kingdom} />
          ) : (
            <Typography
              variant="h5"
              sx={{ fontWeight: 600, fontStyle: "italic", color: "text.secondary" }}
            >
              Unidentified
            </Typography>
          )}
          {taxonomy?.vernacularName && (
            <Typography
              variant="body1"
              sx={{
                color: "text.secondary",
              }}
            >
              {taxonomy.vernacularName}
            </Typography>
          )}
        </Box>

        {/* Like button */}
        <Stack
          direction="row"
          sx={{
            alignItems: "center",
            px: 3,
            pb: 1,
          }}
        >
          <Tooltip title={!user ? "Log in to like" : ""}>
            <span>
              <IconButton
                size="small"
                onClick={() => observation && handleLikeToggle(observation.uri, observation.cid)}
                disabled={!user}
                aria-label={liked ? "Unlike" : "Like"}
                sx={{
                  color: liked ? "error.main" : "text.disabled",
                  ml: -0.5,
                }}
              >
                {liked ? (
                  <FavoriteIcon fontSize="small" />
                ) : (
                  <FavoriteBorderIcon fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>
          {likeCount > 0 && (
            <Typography
              variant="body2"
              sx={{
                color: "text.secondary",
                ml: -0.25,
              }}
            >
              {likeCount}
            </Typography>
          )}
        </Stack>

        {/* Images */}
        {observation.images.length > 0 && (
          <Box sx={{ bgcolor: "grey.900", p: { xs: 0, sm: 2 } }}>
            <ButtonBase
              onClick={() => setLightboxOpen(true)}
              aria-label="Enlarge photo"
              sx={{
                display: "block",
                width: "100%",
                borderRadius: { xs: 0, sm: 2 },
                overflow: "hidden",
                cursor: "zoom-in",
              }}
            >
              <Box
                component="img"
                src={getImageUrl(observation.images[activeImageIndex] ?? "")}
                alt={species}
                sx={{
                  width: "100%",
                  maxHeight: 400,
                  objectFit: "contain",
                  display: "block",
                  boxShadow: { xs: "none", sm: "0 4px 12px rgba(0, 0, 0, 0.15)" },
                }}
              />
            </ButtonBase>
            {observation.images.length > 1 && (
              <Stack direction="row" spacing={1} sx={{ p: 1, justifyContent: "center" }}>
                {observation.images.map((img, idx) => (
                  <ButtonBase
                    key={img}
                    onClick={() => setActiveImageIndex(idx)}
                    sx={{
                      width: 60,
                      height: 60,
                      border: 2,
                      borderColor: idx === activeImageIndex ? "primary.main" : "divider",
                      borderRadius: 1,
                      overflow: "hidden",
                    }}
                  >
                    <Box
                      component="img"
                      src={getImageUrl(img)}
                      alt={`Photo ${idx + 1}`}
                      sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </ButtonBase>
                ))}
              </Stack>
            )}
          </Box>
        )}

        {/* Content */}
        <Box sx={{ p: 3 }}>
          {/* Observer */}
          <ListItem
            component={Link}
            to={`/profile/${encodeURIComponent(observation.observer.did)}`}
            sx={{
              textDecoration: "none",
              color: "inherit",
              "&:hover": { bgcolor: "action.hover" },
              mx: -2,
              borderRadius: 1,
            }}
          >
            <ListItemAvatar>
              <Avatar
                {...(observation.observer.avatar ? { src: observation.observer.avatar } : {})}
                alt={displayName}
              />
            </ListItemAvatar>
            <ListItemText
              primary={displayName}
              secondary={handle || undefined}
              slotProps={{
                primary: { sx: { fontWeight: 600 } },
                secondary: { sx: { color: "text.disabled" } },
              }}
            />
          </ListItem>

          {/* Observation Details */}
          <List disablePadding sx={{ mt: 1 }}>
            <ListItem disableGutters alignItems="flex-start">
              <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>
                <CalendarTodayIcon sx={{ fontSize: 18, color: "text.secondary" }} />
              </ListItemIcon>
              <ListItemText
                primary="Observed"
                secondary={formatDate(observation.eventDate)}
                slotProps={{
                  primary: { variant: "caption", color: "text.secondary" },
                  secondary: { variant: "body1", color: "text.primary" },
                }}
              />
            </ListItem>

            <ListItem disableGutters alignItems="flex-start">
              <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>
                <MyLocationIcon sx={{ fontSize: 18, color: "text.secondary" }} />
              </ListItemIcon>
              <ListItemText
                primary="Coordinates"
                secondary={
                  <>
                    {observation.location.latitude.toFixed(5)},{" "}
                    {observation.location.longitude.toFixed(5)}
                    {observation.location.uncertaintyMeters && (
                      <Typography
                        component="span"
                        variant="body2"
                        sx={{
                          color: "text.disabled",
                        }}
                      >
                        {" "}
                        (±{observation.location.uncertaintyMeters}m)
                      </Typography>
                    )}
                  </>
                }
                slotProps={{
                  primary: { variant: "caption", color: "text.secondary" },
                  secondary: {
                    variant: "body1",
                    color: "text.primary",
                    component: "div",
                  },
                }}
              />
            </ListItem>
            <Box sx={{ ml: 4.5, mb: 1 }}>
              <LocationMap
                latitude={observation.location.latitude}
                longitude={observation.location.longitude}
                uncertaintyMeters={observation.location.uncertaintyMeters}
              />
            </Box>
          </List>

          <Box sx={{ mt: 3 }}>
            {/* Identification History */}
            <Box sx={{ mt: 2 }}>
              <IdentificationHistory
                identifications={identifications}
                kingdom={taxonomy?.kingdom}
                currentUserDid={user?.did}
                onDeleteIdentification={async (uri) => {
                  try {
                    await deleteIdentification(uri);
                    // Wait for the ingester to remove the identification;
                    // refetching immediately would show the stale row and
                    // make the delete look like it failed.
                    if (atUri) {
                      await pollObservation(
                        atUri,
                        (r) => !r?.identifications?.some((id) => id.uri === uri),
                      );
                    }
                    dispatch(addToast({ message: "Identification deleted", type: "success" }));
                    await handleIdentificationSuccess();
                  } catch (error) {
                    const message = getErrorMessage(error, "Failed to delete identification");
                    dispatch(addToast({ message, type: "error" }));
                    if (message.includes("Session expired")) {
                      dispatch(checkAuth());
                    }
                    throw error;
                  }
                }}
                observerDid={observation.observer.did}
                footer={
                  user ? (
                    <IdentificationPanel
                      observation={{
                        uri: observation.uri,
                        cid: observation.cid,
                        scientificName: taxonomy?.scientificName,
                        communityId: observation.communityId,
                      }}
                      imageUrl={
                        observation.images[0] != null
                          ? getImageUrl(observation.images[0])
                          : undefined
                      }
                      latitude={observation.location?.latitude}
                      longitude={observation.location?.longitude}
                      onSuccess={handleIdentificationSuccess}
                    />
                  ) : (
                    <Typography
                      variant="body2"
                      sx={{
                        color: "text.secondary",
                        mt: 2,
                        textAlign: "center",
                      }}
                    >
                      Log in to add an identification
                    </Typography>
                  )
                }
              />
            </Box>

            {/* Interactions Panel */}
            <InteractionPanel
              observation={{
                uri: observation.uri,
                cid: observation.cid,
                scientificName: taxonomy?.scientificName,
                communityId: observation.communityId,
              }}
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

      {observation.images.length > 0 && (
        <PhotoLightbox
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          src={getImageUrl(observation.images[activeImageIndex] ?? "")}
          alt={species}
        />
      )}
    </Box>
  );
}
