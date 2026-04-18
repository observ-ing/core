import { memo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Box,
  Avatar,
  AvatarGroup,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  Card,
  CardHeader,
  CardContent,
  CardActions,
  CardActionArea,
  Stack,
  Tooltip,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import FavoriteIcon from "@mui/icons-material/Favorite";
import type { Occurrence } from "../../services/types";
import { useAppSelector } from "../../store";
import { getImageUrl } from "../../services/api";
import { useLikeToggle } from "../../hooks/useLikeToggle";
import { TaxonLink } from "../common/TaxonLink";
import { getDisplayName, getPdslsUrl, getObservationUrl } from "../../lib/utils";
import { RelativeTime } from "../common/RelativeTime";
import { ImageWithSkeleton } from "../common/ImageWithSkeleton";
import { FEED_CARD_SX, FEED_IMAGE_MAX_HEIGHT } from "./feedLayout";

interface FeedItemProps {
  observation: Occurrence;
  onEdit?: (observation: Occurrence) => void;
  onDelete?: (observation: Occurrence) => void;
}

export const FeedItem = memo(function FeedItem({ observation, onEdit, onDelete }: FeedItemProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const { liked, likeCount, handleLikeToggle } = useLikeToggle(
    observation.viewerHasLiked ?? false,
    observation.likeCount ?? 0,
  );
  const menuOpen = Boolean(anchorEl);
  const navigate = useNavigate();
  const currentUser = useAppSelector((state) => state.auth.user);
  const isOwnPost = currentUser?.did === observation.observer.did;

  // Get owner and co-observers
  const observers = observation.observers || [];
  const owner = observers.find((o) => o.role === "owner") || observation.observer;
  const coObservers = observers.filter((o) => o.role === "co-observer");
  const hasCoObservers = coObservers.length > 0;

  const displayName = getDisplayName(owner);
  const handle = owner.handle ? `@${owner.handle}` : "";
  const timeAgo = <RelativeTime date={new Date(observation.createdAt)} />;

  const taxonomy = observation.effectiveTaxonomy;
  const species = observation.communityId || taxonomy?.scientificName || undefined;

  const imageUrl = observation.images[0] ? getImageUrl(observation.images[0]) : "";

  const observationUrl = getObservationUrl(observation.uri);
  const pdslsUrl = getPdslsUrl(observation.uri);

  // Build tooltip for co-observers
  const coObserverNames = coObservers.map((o) => getDisplayName(o)).join(", ");

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setAnchorEl(null);
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleMenuClose();
    onEdit?.(observation);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleMenuClose();
    onDelete?.(observation);
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking on interactive elements (links, buttons)
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("a, button")) {
      return;
    }
    navigate(observationUrl);
  };

  const avatarEl = hasCoObservers ? (
    <Tooltip title={`With ${coObserverNames}`} placement="top">
      <AvatarGroup
        max={3}
        sx={{
          "& .MuiAvatar-root": {
            width: 36,
            height: 36,
            border: "2px solid",
            borderColor: "background.paper",
          },
        }}
      >
        <Avatar {...(owner.avatar ? { src: owner.avatar } : {})} alt={displayName} />
        {coObservers.slice(0, 2).map((co) => (
          <Avatar
            key={co.did}
            {...(co.avatar ? { src: co.avatar } : {})}
            alt={co.displayName || co.handle || co.did}
          />
        ))}
      </AvatarGroup>
    </Tooltip>
  ) : (
    <Avatar
      component={Link}
      to={`/profile/${encodeURIComponent(owner.did)}`}
      {...(owner.avatar ? { src: owner.avatar } : {})}
      alt={displayName}
      onClick={(e) => e.stopPropagation()}
      sx={{ width: 40, height: 40, cursor: "pointer" }}
    />
  );

  const titleEl = (
    <Typography
      component={Link}
      to={`/profile/${encodeURIComponent(owner.did)}`}
      onClick={(e) => e.stopPropagation()}
      sx={{
        fontWeight: 600,
        fontSize: "14px",
        color: "text.primary",
        textDecoration: "none",
        "&:hover": { textDecoration: "underline" },
      }}
    >
      {displayName}
    </Typography>
  );

  const subheaderEl = (
    <Stack
      direction="row"
      spacing={1}
      sx={{
        alignItems: "center",
        mt: 0.25,
        fontFamily: "var(--ov-mono)",
        fontSize: "12px",
        color: "text.disabled",
      }}
    >
      {handle && <Box component="span">{handle}</Box>}
      {handle && (
        <Box component="span" sx={{ opacity: 0.5 }}>
          ·
        </Box>
      )}
      <Box component="span">{timeAgo}</Box>
      {hasCoObservers && (
        <>
          <Box component="span" sx={{ opacity: 0.5 }}>
            ·
          </Box>
          <Tooltip title={`With ${coObserverNames}`}>
            <Box
              component="span"
              sx={{ color: "primary.main", cursor: "pointer" }}
              onClick={(e) => e.stopPropagation()}
            >
              +{coObservers.length}
            </Box>
          </Tooltip>
        </>
      )}
    </Stack>
  );

  const taxoStrip = taxonomy
    ? [taxonomy.kingdom, taxonomy.phylum, taxonomy.class, taxonomy.order, taxonomy.family].filter(
        Boolean,
      )
    : [];

  const eventDate = observation.eventDate ? new Date(observation.eventDate) : null;
  const dateStr = eventDate
    ? eventDate.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" })
    : "—";
  const coordStr = observation.location
    ? `${observation.location.latitude.toFixed(3)}°, ${observation.location.longitude.toFixed(3)}°`
    : "—";
  const idCount = observation.identificationCount ?? 0;

  return (
    <Card sx={FEED_CARD_SX}>
      <CardActionArea onClick={handleCardClick} component="div">
        <CardHeader
          avatar={avatarEl}
          title={titleEl}
          subheader={subheaderEl}
          disableTypography
          action={
            <>
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
                onClick={(e) => e.stopPropagation()}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
              >
                {isOwnPost && onEdit && <MenuItem onClick={handleEditClick}>Edit</MenuItem>}
                {isOwnPost && onDelete && (
                  <MenuItem onClick={handleDeleteClick} sx={{ color: "error.main" }}>
                    Delete
                  </MenuItem>
                )}
                <MenuItem
                  component="a"
                  href={pdslsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                >
                  View on AT Protocol
                </MenuItem>
              </Menu>
            </>
          }
        />

        {imageUrl && (
          <Box sx={{ position: "relative" }}>
            <ImageWithSkeleton
              src={imageUrl}
              alt={species || "Observation photo"}
              sx={{ height: FEED_IMAGE_MAX_HEIGHT }}
            />
            {observation.images.length > 1 && (
              <Box
                sx={{
                  position: "absolute",
                  right: 10,
                  bottom: 10,
                  px: 1,
                  py: 0.5,
                  borderRadius: 0.5,
                  bgcolor: "rgba(0,0,0,0.55)",
                  color: "#fff",
                  fontFamily: "var(--ov-mono)",
                  fontSize: "10.5px",
                  backdropFilter: "blur(4px)",
                }}
              >
                1 / {observation.images.length}
              </Box>
            )}
          </Box>
        )}

        <CardContent sx={{ py: 2 }}>
          <Box
            sx={{
              fontFamily: "var(--ov-serif)",
              fontStyle: "italic",
              fontWeight: 500,
              fontSize: "21px",
              color: "primary.main",
              letterSpacing: "-0.01em",
              lineHeight: 1.2,
            }}
          >
            {species ? (
              <TaxonLink
                name={species}
                kingdom={taxonomy?.kingdom}
                rank={undefined}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <Box component="span" sx={{ color: "text.secondary" }}>
                Unidentified
              </Box>
            )}
          </Box>
          {taxonomy?.vernacularName && (
            <Typography sx={{ color: "text.secondary", fontSize: "14px", mt: 0.4 }}>
              {taxonomy.vernacularName}
            </Typography>
          )}
          {taxoStrip.length > 0 && (
            <Box
              sx={{
                display: "flex",
                flexWrap: "wrap",
                mt: 1.25,
                fontFamily: "var(--ov-mono)",
                fontSize: "10px",
                color: "text.disabled",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
              }}
            >
              {taxoStrip.map((t, i) => (
                <Box component="span" key={i} sx={{ display: "inline-flex" }}>
                  {i > 0 && (
                    <Box component="span" sx={{ opacity: 0.4, px: 0.75 }}>
                      ·
                    </Box>
                  )}
                  <Box component="span" sx={{ color: "text.secondary" }}>
                    {t}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              borderTop: 1,
              borderColor: "divider",
              mt: 1.75,
              fontFamily: "var(--ov-mono)",
              fontSize: "11px",
              color: "text.disabled",
              "& > div": { py: 1.25 },
              "& > div + div": { borderLeft: 1, borderColor: "divider", pl: 1.75 },
              "& .k": {
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontSize: "9.5px",
                display: "block",
                mb: 0.4,
              },
              "& .v": {
                color: "text.primary",
                fontSize: "12px",
                fontWeight: 500,
                fontVariantNumeric: "tabular-nums",
              },
            }}
          >
            <Box>
              <Box component="span" className="k">
                Observed
              </Box>
              <Box component="span" className="v">
                {dateStr}
              </Box>
            </Box>
            <Box>
              <Box component="span" className="k">
                Location
              </Box>
              <Box component="span" className="v">
                {coordStr}
              </Box>
            </Box>
            <Box>
              <Box component="span" className="k">
                IDs
              </Box>
              <Box component="span" className="v">
                {idCount}
              </Box>
            </Box>
          </Box>
        </CardContent>
      </CardActionArea>
      <CardActions
        disableSpacing
        sx={{
          pt: 1,
          pb: 1,
          px: 1.5,
          borderTop: 1,
          borderColor: "divider",
          gap: 0.5,
        }}
      >
        <Tooltip title={!currentUser ? "Log in to like" : ""}>
          <span>
            <IconButton
              size="small"
              onClick={() => handleLikeToggle(observation.uri, observation.cid)}
              disabled={!currentUser}
              aria-label={liked ? "Unlike" : "Like"}
              sx={{
                color: liked ? "var(--ov-heart)" : "text.disabled",
                gap: 0.75,
                fontSize: "12px",
                borderRadius: 1,
              }}
            >
              {liked ? <FavoriteIcon fontSize="small" /> : <FavoriteBorderIcon fontSize="small" />}
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
      </CardActions>
    </Card>
  );
});
