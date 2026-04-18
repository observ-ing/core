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
  ListItem,
  ListItemAvatar,
  ListItemText,
  Tooltip,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import FavoriteIcon from "@mui/icons-material/Favorite";
import { fetchObservation, getImageUrl, deleteIdentification } from "../../services/api";
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
            px: 2,
            py: 1.25,
            borderBottom: 1,
            borderColor: "divider",
            display: "flex",
            alignItems: "center",
            gap: 1,
          }}
        >
          <IconButton onClick={handleBack} size="small">
            <ArrowBackIcon fontSize="small" />
          </IconButton>
          <Box
            sx={{
              fontFamily: "var(--ov-mono)",
              fontSize: "11.5px",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              color: "text.disabled",
              display: "flex",
              alignItems: "center",
              gap: 0.75,
            }}
          >
            <Box component="span">Observation</Box>
            <Box component="span" sx={{ opacity: 0.45 }}>
              /
            </Box>
            <Box component="span" sx={{ color: "text.secondary" }}>
              {rkey}
            </Box>
          </Box>
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

        {/* Specimen Header */}
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: { xs: "1fr", md: "1fr 300px" },
            gap: { xs: 3, md: 6 },
            px: 3.5,
            pt: 4.5,
            pb: 3.5,
            borderBottom: 1,
            borderColor: "divider",
          }}
        >
          <Box>
            <Box
              sx={{
                fontFamily: "var(--ov-mono)",
                fontSize: "10.5px",
                letterSpacing: "0.12em",
                textTransform: "uppercase",
                color: "text.disabled",
                mb: 1.5,
                display: "flex",
                gap: 1,
                alignItems: "center",
              }}
            >
              <Box component="span">Taxon</Box>
              {taxonomy?.kingdom && (
                <Box
                  component="span"
                  sx={{
                    px: 0.75,
                    py: 0.25,
                    bgcolor: "primary.light",
                    color: "primary.dark",
                    borderRadius: 0.5,
                    fontSize: "9.5px",
                  }}
                >
                  {taxonomy.kingdom}
                </Box>
              )}
            </Box>
            <Box
              sx={{
                fontFamily: "var(--ov-serif)",
                fontStyle: "italic",
                fontWeight: 500,
                fontSize: { xs: "40px", sm: "56px" },
                lineHeight: 0.98,
                color: "primary.main",
                letterSpacing: "-0.02em",
              }}
            >
              {species ? (
                <TaxonLink name={species} kingdom={taxonomy?.kingdom} />
              ) : (
                <Box component="span" sx={{ color: "text.secondary" }}>
                  Unidentified
                </Box>
              )}
            </Box>
            {taxonomy?.vernacularName && (
              <Typography sx={{ fontSize: "17px", color: "text.secondary", mt: 1 }}>
                {taxonomy.vernacularName}
              </Typography>
            )}
            {/* Taxonomic ladder */}
            {taxonomy && (
              <Box sx={{ mt: 2.75, borderTop: 1, borderColor: "divider" }}>
                {(
                  [
                    ["Kingdom", taxonomy.kingdom],
                    ["Phylum", taxonomy.phylum],
                    ["Class", taxonomy.class],
                    ["Order", taxonomy.order],
                    ["Family", taxonomy.family],
                    ["Genus", taxonomy.genus],
                  ] satisfies [string, string | undefined][]
                )
                  .filter(([, v]) => !!v)
                  .map(([k, v], i, arr) => (
                    <Box
                      key={k}
                      sx={{
                        display: "grid",
                        gridTemplateColumns: "90px 1fr",
                        gap: 2,
                        alignItems: "baseline",
                        py: 1,
                        borderBottom: i === arr.length - 1 ? 1 : 0,
                        borderBottomStyle: "solid",
                        borderColor: "divider",
                        fontFamily: "var(--ov-mono)",
                        fontSize: "12px",
                        position: "relative",
                        "&::after":
                          i !== arr.length - 1
                            ? {
                                content: '""',
                                position: "absolute",
                                left: 0,
                                right: 0,
                                bottom: 0,
                                borderBottom: "1px dashed",
                                borderColor: "divider",
                              }
                            : {},
                      }}
                    >
                      <Box
                        sx={{
                          color: "text.disabled",
                          textTransform: "uppercase",
                          fontSize: "10px",
                          letterSpacing: "0.08em",
                        }}
                      >
                        {k}
                      </Box>
                      <Box
                        sx={{
                          color: "text.primary",
                          fontFamily: k === "Kingdom" ? "var(--ov-mono)" : "var(--ov-serif)",
                          fontStyle: k === "Kingdom" ? "normal" : "italic",
                          fontSize: "14px",
                        }}
                      >
                        {v}
                      </Box>
                    </Box>
                  ))}
              </Box>
            )}
            <Box sx={{ mt: 2.5, display: "flex", alignItems: "center", gap: 1 }}>
              <Tooltip title={!user ? "Log in to like" : ""}>
                <span>
                  <IconButton
                    size="small"
                    onClick={() =>
                      observation && handleLikeToggle(observation.uri, observation.cid)
                    }
                    disabled={!user}
                    aria-label={liked ? "Unlike" : "Like"}
                    sx={{
                      color: liked ? "var(--ov-heart)" : "text.disabled",
                      gap: 0.75,
                      fontSize: "12px",
                      borderRadius: 1,
                    }}
                  >
                    {liked ? (
                      <FavoriteIcon fontSize="small" />
                    ) : (
                      <FavoriteBorderIcon fontSize="small" />
                    )}
                    {likeCount > 0 && (
                      <Box
                        component="span"
                        sx={{
                          fontFamily: "var(--ov-mono)",
                          fontVariantNumeric: "tabular-nums",
                          fontSize: "12px",
                          ml: 0.5,
                        }}
                      >
                        {likeCount}
                      </Box>
                    )}
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Box>
          {/* Record card */}
          <Box
            sx={{
              border: 1,
              borderColor: "divider",
              borderRadius: 0.5,
              fontFamily: "var(--ov-mono)",
              fontSize: "11px",
              bgcolor: "background.paper",
              alignSelf: "start",
              "& .rc-row": {
                display: "grid",
                gridTemplateColumns: "86px 1fr",
                px: 1.75,
                py: 1.1,
                borderBottom: 1,
                borderColor: "divider",
                alignItems: "baseline",
              },
              "& .rc-row:last-of-type": { borderBottom: 0 },
              "& .rc-k": {
                color: "text.disabled",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontSize: "10px",
              },
              "& .rc-v": {
                color: "text.primary",
                fontVariantNumeric: "tabular-nums",
                wordBreak: "break-all",
              },
            }}
          >
            <Box className="rc-row">
              <Box className="rc-k">Record</Box>
              <Box className="rc-v">{rkey}</Box>
            </Box>
            <Box className="rc-row">
              <Box className="rc-k">DID</Box>
              <Box className="rc-v" sx={{ fontSize: "10px" }}>
                {did}
              </Box>
            </Box>
            <Box className="rc-row">
              <Box className="rc-k">CID</Box>
              <Box className="rc-v" sx={{ fontSize: "10px" }}>
                {observation.cid}
              </Box>
            </Box>
            <Box className="rc-row">
              <Box className="rc-k">Created</Box>
              <Box className="rc-v">
                {new Date(observation.createdAt).toISOString().slice(0, 10)}
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Images */}
        {observation.images.length > 0 && (
          <Box sx={{ px: 3.5, pt: 3.5 }}>
            <Box
              sx={{
                border: 1,
                borderColor: "divider",
                borderRadius: 0.5,
                overflow: "hidden",
                bgcolor: "var(--ov-bg-sunken)",
              }}
            >
              <ButtonBase
                onClick={() => setLightboxOpen(true)}
                aria-label="Enlarge photo"
                sx={{
                  display: "block",
                  width: "100%",
                  cursor: "zoom-in",
                }}
              >
                <Box
                  component="img"
                  src={getImageUrl(observation.images[activeImageIndex] ?? "")}
                  alt={species}
                  sx={{
                    width: "100%",
                    maxHeight: 520,
                    objectFit: "contain",
                    display: "block",
                  }}
                />
              </ButtonBase>
              <Box
                sx={{
                  display: "flex",
                  justifyContent: "space-between",
                  px: 1.75,
                  py: 1.25,
                  borderTop: 1,
                  borderColor: "divider",
                  fontFamily: "var(--ov-mono)",
                  fontSize: "11px",
                  color: "text.disabled",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                <Box component="span">
                  Plate {activeImageIndex + 1} / {observation.images.length}
                </Box>
                <Box component="span">{formatDate(observation.eventDate)}</Box>
              </Box>
            </Box>
            {observation.images.length > 1 && (
              <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: "wrap" }}>
                {observation.images.map((img, idx) => (
                  <ButtonBase
                    key={img}
                    onClick={() => setActiveImageIndex(idx)}
                    sx={{
                      width: 62,
                      height: 62,
                      border: 1,
                      borderColor: idx === activeImageIndex ? "primary.main" : "divider",
                      boxShadow: idx === activeImageIndex ? "0 0 0 1px var(--ov-accent)" : "none",
                      borderRadius: 0.5,
                      overflow: "hidden",
                      position: "relative",
                    }}
                  >
                    <Box
                      component="img"
                      src={getImageUrl(img)}
                      alt={`Photo ${idx + 1}`}
                      sx={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                    <Box
                      sx={{
                        position: "absolute",
                        left: 3,
                        top: 2,
                        fontFamily: "var(--ov-mono)",
                        fontSize: "9px",
                        color: "#fff",
                        bgcolor: "rgba(0,0,0,0.6)",
                        px: 0.4,
                        borderRadius: 0.25,
                      }}
                    >
                      {String(idx + 1).padStart(2, "0")}
                    </Box>
                  </ButtonBase>
                ))}
              </Stack>
            )}
          </Box>
        )}

        {/* Content */}
        <Box sx={{ px: 3.5, py: 3.5 }}>
          {/* Observer */}
          <Box
            sx={{
              fontFamily: "var(--ov-mono)",
              fontSize: "10.5px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "text.disabled",
              mb: 1.25,
            }}
          >
            Observer
          </Box>
          <ListItem
            component={Link}
            to={`/profile/${encodeURIComponent(observation.observer.did)}`}
            sx={{
              textDecoration: "none",
              color: "inherit",
              "&:hover": { bgcolor: "action.hover" },
              mx: -1.5,
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
                secondary: {
                  sx: { color: "text.disabled", fontFamily: "var(--ov-mono)", fontSize: "12px" },
                },
              }}
            />
          </ListItem>

          {/* Observation metadata */}
          <Box
            component="table"
            sx={{
              width: "100%",
              borderCollapse: "collapse",
              mt: 2.5,
              "& td": {
                py: 1.4,
                borderBottom: "1px dashed",
                borderColor: "divider",
                verticalAlign: "top",
                fontSize: "13px",
              },
              "& td:first-of-type": {
                width: 130,
                color: "text.disabled",
                fontFamily: "var(--ov-mono)",
                textTransform: "uppercase",
                fontSize: "10.5px",
                letterSpacing: "0.08em",
                pr: 1.75,
                pt: 1.6,
              },
              "& td:last-of-type": {
                color: "text.primary",
                fontFamily: "var(--ov-mono)",
                fontVariantNumeric: "tabular-nums",
                fontSize: "12.5px",
              },
              "& tr:last-of-type td": { borderBottom: 0 },
            }}
          >
            <tbody>
              <tr>
                <td>Observed</td>
                <td>{formatDate(observation.eventDate)}</td>
              </tr>
              <tr>
                <td>Latitude</td>
                <td>{observation.location.latitude.toFixed(5)}°</td>
              </tr>
              <tr>
                <td>Longitude</td>
                <td>{observation.location.longitude.toFixed(5)}°</td>
              </tr>
              {observation.location.uncertaintyMeters !== undefined && (
                <tr>
                  <td>Uncertainty</td>
                  <td>±{observation.location.uncertaintyMeters} m</td>
                </tr>
              )}
              <tr>
                <td>Photos</td>
                <td>{observation.images.length}</td>
              </tr>
            </tbody>
          </Box>
          <Box sx={{ mt: 2 }}>
            <LocationMap
              latitude={observation.location.latitude}
              longitude={observation.location.longitude}
              uncertaintyMeters={observation.location.uncertaintyMeters}
            />
          </Box>

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
