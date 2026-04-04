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
import { formatTimeAgo, getDisplayName, getPdslsUrl, getObservationUrl } from "../../lib/utils";
import { ImageWithSkeleton } from "../common/ImageWithSkeleton";
import { FEED_CARD_SX, FEED_IMAGE_MAX_HEIGHT } from "./feedLayout";

interface FeedItemProps {
  observation: Occurrence;
  onEdit?: (observation: Occurrence) => void;
  onDelete?: (observation: Occurrence) => void;
}

const REMARKS_TRUNCATE_LENGTH = 200;

export const FeedItem = memo(function FeedItem({ observation, onEdit, onDelete }: FeedItemProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [remarksExpanded, setRemarksExpanded] = useState(false);
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
  const timeAgo = formatTimeAgo(new Date(observation.createdAt));

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
    <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap">
      <Typography
        component={Link}
        to={`/profile/${encodeURIComponent(owner.did)}`}
        onClick={(e) => e.stopPropagation()}
        sx={{
          fontWeight: 600,
          color: "text.primary",
          textDecoration: "none",
          "&:hover": { textDecoration: "underline" },
        }}
      >
        {displayName}
      </Typography>
      {hasCoObservers && (
        <Tooltip title={`With ${coObserverNames}`}>
          <Typography
            variant="body2"
            sx={{
              color: "primary.main",
              cursor: "pointer",
              "&:hover": { textDecoration: "underline" },
            }}
            onClick={(e) => e.stopPropagation()}
          >
            +{coObservers.length} other{coObservers.length > 1 ? "s" : ""}
          </Typography>
        </Tooltip>
      )}
      {handle && (
        <Typography variant="body2" color="text.disabled">
          {handle}
        </Typography>
      )}
    </Stack>
  );

  return (
    <Card sx={FEED_CARD_SX}>
      <CardActionArea onClick={handleCardClick} component="div">
        <CardHeader
          avatar={avatarEl}
          title={titleEl}
          subheader={timeAgo}
          subheaderTypographyProps={{ variant: "body2", color: "text.disabled" }}
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
          <ImageWithSkeleton
            src={imageUrl}
            alt={species || "Observation photo"}
            sx={{ maxHeight: FEED_IMAGE_MAX_HEIGHT }}
          />
        )}

        <CardContent>
          {/* Species display - show multiple if multi-subject */}
          {observation.subjects && observation.subjects.length > 1 ? (
            <Stack spacing={0.25}>
              {observation.subjects.slice(0, 3).map((subject, idx) => (
                <Box
                  key={subject.index}
                  sx={{
                    fontSize: idx === 0 ? "1.1rem" : "0.9rem",
                    opacity: idx === 0 ? 1 : 0.8,
                  }}
                >
                  {subject.communityId ? (
                    <TaxonLink
                      name={subject.communityId}
                      kingdom={taxonomy?.kingdom}
                      onClick={(e) => e.stopPropagation()}
                    />
                  ) : (
                    <Typography sx={{ fontStyle: "italic", color: "primary.main" }}>
                      Unknown
                    </Typography>
                  )}
                </Box>
              ))}
              {observation.subjects.length > 3 && (
                <Typography variant="caption" color="text.disabled">
                  +{observation.subjects.length - 3} more
                </Typography>
              )}
            </Stack>
          ) : (
            <Box sx={{ fontSize: "1.1rem" }}>
              {species ? (
                <TaxonLink
                  name={species}
                  kingdom={taxonomy?.kingdom}
                  rank={undefined}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <Typography sx={{ fontStyle: "italic", color: "text.secondary" }}>
                  Unidentified
                </Typography>
              )}
            </Box>
          )}

          {observation.occurrenceRemarks && (
            <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4, mt: 0.5 }}>
              {observation.occurrenceRemarks.length > REMARKS_TRUNCATE_LENGTH &&
              !remarksExpanded ? (
                <>
                  {observation.occurrenceRemarks.slice(0, REMARKS_TRUNCATE_LENGTH).trimEnd()}…{" "}
                  <Box
                    component="span"
                    onClick={(e) => {
                      e.stopPropagation();
                      setRemarksExpanded(true);
                    }}
                    sx={{
                      color: "primary.main",
                      cursor: "pointer",
                      "&:hover": { textDecoration: "underline" },
                    }}
                  >
                    Read more
                  </Box>
                </>
              ) : (
                observation.occurrenceRemarks
              )}
            </Typography>
          )}

          {observation.verbatimLocality && (
            <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>
              {observation.verbatimLocality}
            </Typography>
          )}
        </CardContent>
      </CardActionArea>
      <CardActions disableSpacing sx={{ pt: 0 }}>
        <Tooltip title={!currentUser ? "Log in to like" : ""}>
          <span>
            <IconButton
              size="small"
              onClick={() => handleLikeToggle(observation.uri, observation.cid)}
              disabled={!currentUser}
              aria-label={liked ? "Unlike" : "Like"}
              sx={{
                color: liked ? "error.main" : "text.disabled",
              }}
            >
              {liked ? <FavoriteIcon fontSize="small" /> : <FavoriteBorderIcon fontSize="small" />}
            </IconButton>
          </span>
        </Tooltip>
        {likeCount > 0 && (
          <Typography variant="body2" color="text.secondary">
            {likeCount}
          </Typography>
        )}
      </CardActions>
    </Card>
  );
});
