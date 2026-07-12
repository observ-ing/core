import { lazy, Suspense, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Divider,
  Typography,
  Button,
  Stack,
  IconButton,
  ButtonBase,
  Menu,
  MenuItem,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Tooltip,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import FavoriteIcon from "@mui/icons-material/Favorite";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import MyLocationIcon from "@mui/icons-material/MyLocation";
import NumbersIcon from "@mui/icons-material/Numbers";
import { getImageUrl } from "../../services/api";
import { useAppSelector, useAppDispatch } from "../../store";
import { usePageTitle } from "../../hooks/usePageTitle";
import { detailHeaderSx } from "../common/layoutSx";
import { useToast } from "../../hooks/useToast";
import { useObservation } from "../../lib/query/hooks";
import { useLike, useDeleteIdentification } from "../../lib/query/mutations";
import { openDeleteConfirm, openEditModal } from "../../store/uiSlice";
import { checkAuth } from "../../store/authSlice";
import { IdentificationPanel } from "../identification/IdentificationPanel";
import { IdentificationHistory } from "../identification/IdentificationHistory";
import { CommentSection } from "../comment/CommentSection";
import { TaxonLink } from "../common/TaxonLink";
import { ObservationDetailSkeleton } from "./ObservationDetailSkeleton";
import { PhotoLightbox } from "./PhotoLightbox";
import { DataQualitySection } from "./DataQualitySection";
import { UserCard } from "../common/UserCard";
import { Section, SectionHeader } from "../common/Section";
import {
  formatEventDate,
  getPdslsUrl,
  buildOccurrenceAtUri,
  getErrorMessage,
} from "../../lib/utils";
import { getLicenseLabel } from "../../lib/licenses";

// Lazy so maplibre-gl is split into its own chunk, loaded only when an
// observation actually has a location to map.
const LocationMap = lazy(() =>
  import("../map/LocationMap").then((m) => ({ default: m.LocationMap })),
);

export function ObservationDetail() {
  const { did, rkey } = useParams<{ did: string; rkey: string }>();
  const navigate = useNavigate();
  const dispatch = useAppDispatch();
  const toast = useToast();
  const user = useAppSelector((state) => state.auth.user);

  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);

  // Reconstruct AT URI from route params
  const atUri = did && rkey ? buildOccurrenceAtUri(did, rkey) : null;

  const obsQuery = useObservation(atUri ?? undefined);
  const observation = obsQuery.data?.occurrence ?? null;
  const identifications = obsQuery.data?.identifications ?? [];
  const comments = obsQuery.data?.comments ?? [];
  const loading = obsQuery.isLoading;

  // Like state is sourced from the cached occurrence; the optimistic mutation
  // patches it in place (and across every other cache that holds it).
  const liked = observation?.viewerHasLiked ?? false;
  const likeCount = observation?.likeCount ?? 0;
  const like = useLike();
  // Waits for the ingester to drop the identification, then refetches the
  // detail so the removed row disappears.
  const deleteId = useDeleteIdentification();

  usePageTitle(
    observation?.communityId || observation?.effectiveTaxonomy?.scientificName || "Observation",
  );

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
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

  if (!observation) {
    return (
      <Box sx={{ flex: 1, overflow: "auto" }}>
        <Container maxWidth="md" sx={{ p: 4, textAlign: "center" }}>
          <Typography color="error" sx={{ mb: 2 }}>
            {!atUri ? "No observation URI provided" : "Observation not found"}
          </Typography>
          <Button variant="outlined" onClick={handleBack}>
            Go Back
          </Button>
        </Container>
      </Box>
    );
  }

  const taxonomy = observation.effectiveTaxonomy;

  const species = observation.communityId || taxonomy?.scientificName || undefined;

  const activeImage = observation.images[activeImageIndex];

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
        <Box sx={detailHeaderSx}>
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

        {/* Identity header: species, then observer + date with the like
            control — so what / who / when read as a single block. A divider
            keeps the taxa title visually distinct from the attribution row. */}
        <Box sx={{ px: 3, pt: 2, pb: 1.5 }}>
          {species ? (
            <TaxonLink name={species} kingdom={taxonomy?.kingdom} rank={taxonomy?.rank} />
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

        <Divider sx={{ mx: 3 }} />

        <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 3, pt: 1.5, pb: 1.5 }}>
          <UserCard
            actor={observation.observer}
            avatarSize={44}
            spacing={1.5}
            link
            showHandle
            sx={{ flex: 1, minWidth: 0 }}
            belowName={
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {observation.eventDate
                  ? `Observed ${formatEventDate(observation.eventDate)}`
                  : "Date not recorded"}
              </Typography>
            }
          />
          <Tooltip title={!user ? "Log in to like" : ""}>
            <span>
              <Stack direction="row" sx={{ alignItems: "center" }}>
                <IconButton
                  size="small"
                  onClick={() =>
                    like.mutate({ uri: observation.uri, cid: observation.cid, liked: !liked })
                  }
                  disabled={!user}
                  aria-label={liked ? "Unlike" : "Like"}
                  sx={{
                    color: liked ? "error.main" : "text.disabled",
                  }}
                >
                  {liked ? (
                    <FavoriteIcon fontSize="small" />
                  ) : (
                    <FavoriteBorderIcon fontSize="small" />
                  )}
                </IconButton>
                {likeCount > 0 && (
                  <Typography variant="body2" sx={{ color: "text.secondary", ml: -0.25 }}>
                    {likeCount}
                  </Typography>
                )}
              </Stack>
            </span>
          </Tooltip>
        </Stack>

        {/* Images */}
        {activeImage && (
          <Box sx={{ bgcolor: (theme) => theme.palette.overlay["backdrop"], p: { xs: 0, sm: 2 } }}>
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
                src={getImageUrl(activeImage.url)}
                alt={species || "Observation photo"}
                sx={{
                  width: "100%",
                  maxHeight: 400,
                  objectFit: "contain",
                  display: "block",
                  boxShadow: (theme) => ({ xs: "none", sm: theme.palette.cardShadow["photo"] }),
                }}
              />
            </ButtonBase>
            {activeImage.license && (
              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  textAlign: "center",
                  color: (theme) => theme.palette.overlay["caption"],
                  px: 1,
                  pt: { xs: 1, sm: 0.5 },
                }}
              >
                License: {getLicenseLabel(activeImage.license)}
              </Typography>
            )}
            {observation.images.length > 1 && (
              <Stack direction="row" spacing={1} sx={{ p: 1, justifyContent: "center" }}>
                {observation.images.map((img, idx) => (
                  <ButtonBase
                    key={img.url}
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
                      src={getImageUrl(img.url)}
                      alt={`Photo ${idx + 1}`}
                      sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </ButtonBase>
                ))}
              </Stack>
            )}
          </Box>
        )}

        {/* Content: a uniform vertical stack of peer sections. */}
        <Box sx={{ p: { xs: 2, sm: 3 } }}>
          <Stack spacing={2.5}>
            {/* Details */}
            <Section>
              <SectionHeader
                icon={<InfoOutlinedIcon fontSize="small" sx={{ color: "primary.main" }} />}
                title="Details"
                sx={{ mb: 1.5 }}
              />
              <List disablePadding>
                {observation.organismQuantity && (
                  <ListItem disableGutters alignItems="flex-start">
                    <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>
                      <NumbersIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                    </ListItemIcon>
                    <ListItemText
                      primary="Quantity"
                      secondary={
                        <>
                          {observation.organismQuantity}
                          {observation.organismQuantityType && (
                            <Typography
                              component="span"
                              variant="body2"
                              sx={{ color: "text.disabled" }}
                            >
                              {" "}
                              ({observation.organismQuantityType.replace(/-/g, " ")})
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
                )}

                <ListItem disableGutters alignItems="flex-start">
                  <ListItemIcon sx={{ minWidth: 36, mt: 0.5 }}>
                    <MyLocationIcon sx={{ fontSize: 18, color: "text.secondary" }} />
                  </ListItemIcon>
                  <ListItemText
                    primary="Coordinates"
                    secondary={
                      observation.location ? (
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
                      ) : (
                        "—"
                      )
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
                {observation.location && (
                  <Box sx={{ mt: 1 }}>
                    <Suspense fallback={<Box sx={{ height: 180 }} />}>
                      <LocationMap
                        latitude={observation.location.latitude}
                        longitude={observation.location.longitude}
                        uncertaintyMeters={observation.location.uncertaintyMeters}
                      />
                    </Suspense>
                  </Box>
                )}
              </List>
            </Section>

            {/* Data Quality */}
            <DataQualitySection issues={observation.qualityIssues} />

            {/* Identification History */}
            <IdentificationHistory
              identifications={identifications}
              kingdom={taxonomy?.kingdom}
              currentUserDid={user?.did}
              onDeleteIdentification={async (uri) => {
                if (!atUri) return;
                try {
                  await deleteId.mutateAsync({ uri, occurrenceUri: atUri });
                  toast.success("Identification deleted");
                } catch (error) {
                  const message = getErrorMessage(error, "Failed to delete identification");
                  toast.error(message);
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
                      kingdom: taxonomy?.kingdom,
                      rank: taxonomy?.rank,
                    }}
                    imageUrl={
                      observation.images[0] != null
                        ? getImageUrl(observation.images[0].url)
                        : undefined
                    }
                    latitude={observation.location?.latitude}
                    longitude={observation.location?.longitude}
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

            {/* Discussion / Comments */}
            <CommentSection
              observationUri={observation.uri}
              observationCid={observation.cid}
              comments={comments}
            />
          </Stack>
        </Box>
      </Container>

      {activeImage && (
        <PhotoLightbox
          open={lightboxOpen}
          onClose={() => setLightboxOpen(false)}
          src={getImageUrl(activeImage.url)}
          alt={species || "Observation photo"}
          license={activeImage.license}
        />
      )}
    </Box>
  );
}
