import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Box,
  Avatar,
  AvatarGroup,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  CardMedia,
  Stack,
  Tooltip,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import type { Occurrence } from "../../services/types";
import type { RootState } from "../../store";
import { getImageUrl } from "../../services/api";
import { TaxonLink } from "../common/TaxonLink";
import { formatTimeAgo, getPdslsUrl } from "../../lib/utils";

interface FeedItemProps {
  occurrence: Occurrence;
  onEdit?: (occurrence: Occurrence) => void;
  onDelete?: (occurrence: Occurrence) => void;
}

export function FeedItem({ occurrence, onEdit, onDelete }: FeedItemProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);
  const navigate = useNavigate();
  const currentUser = useSelector((state: RootState) => state.auth.user);
  const isOwnPost = currentUser?.did === occurrence.observer.did;

  // Get owner and co-observers
  const observers = occurrence.observers || [];
  const owner = observers.find((o) => o.role === "owner") || occurrence.observer;
  const coObservers = observers.filter((o) => o.role === "co-observer");
  const hasCoObservers = coObservers.length > 0;

  const displayName =
    owner.displayName ||
    owner.handle ||
    owner.did.slice(0, 20);
  const handle = owner.handle
    ? `@${owner.handle}`
    : "";
  const timeAgo = formatTimeAgo(new Date(occurrence.createdAt));

  // Use effectiveTaxonomy (preferred) or fall back to legacy fields
  const taxonomy = occurrence.effectiveTaxonomy || {
    scientificName: occurrence.scientificName,
    taxonId: occurrence.taxonId,
    taxonRank: occurrence.taxonRank,
    kingdom: occurrence.kingdom,
  };
  const species =
    occurrence.communityId || taxonomy.scientificName || undefined;

  const imageUrl = occurrence.images[0]
    ? getImageUrl(occurrence.images[0])
    : "";

  const occurrenceUrl = `/occurrence/${encodeURIComponent(occurrence.uri)}`;
  const pdslsUrl = getPdslsUrl(occurrence.uri);

  // Build tooltip for co-observers
  const coObserverNames = coObservers
    .map((o) => o.displayName || o.handle || o.did.slice(0, 15))
    .join(", ");

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
    onEdit?.(occurrence);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    handleMenuClose();
    onDelete?.(occurrence);
  };

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking on interactive elements (links, buttons)
    const target = e.target as HTMLElement;
    if (target.closest('a, button')) {
      return;
    }
    navigate(occurrenceUrl);
  };

  return (
    <Box
      onClick={handleCardClick}
      sx={{
        display: "flex",
        gap: 1.5,
        p: 2,
        bgcolor: "background.paper",
        borderRadius: 2,
        mb: 2,
        mx: { xs: 1, sm: 2 },
        cursor: "pointer",
        color: "inherit",
        boxShadow: 1,
        transition: "all 0.2s ease",
        "&:hover": {
          transform: "translateY(-2px)",
          boxShadow: 4,
        },
        "&:first-of-type": {
          mt: 2,
        },
      }}
    >
      {hasCoObservers ? (
        <Tooltip title={`With ${coObserverNames}`} placement="top">
          <AvatarGroup
            max={3}
            sx={{
              "& .MuiAvatar-root": { width: 40, height: 40, border: "2px solid", borderColor: "background.paper" },
            }}
          >
            <Avatar src={owner.avatar} alt={displayName} />
            {coObservers.slice(0, 2).map((co) => (
              <Avatar
                key={co.did}
                src={co.avatar}
                alt={co.displayName || co.handle || co.did}
              />
            ))}
          </AvatarGroup>
        </Tooltip>
      ) : (
        <Avatar
          src={owner.avatar}
          alt={displayName}
          sx={{ width: 48, height: 48 }}
        />
      )}

      <Box sx={{ flex: 1, minWidth: 0 }}>
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
          <Typography variant="body2" color="text.disabled">
            {timeAgo}
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
              onClick={(e) => e.stopPropagation()}
              anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
              transformOrigin={{ vertical: "top", horizontal: "right" }}
            >
              {isOwnPost && onEdit && (
                <MenuItem onClick={handleEditClick}>Edit</MenuItem>
              )}
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
          </Box>
        </Stack>

        {/* Species display - show multiple if multi-subject */}
        {occurrence.subjects && occurrence.subjects.length > 1 ? (
          <Stack spacing={0.25} sx={{ my: 0.5 }}>
            {occurrence.subjects.slice(0, 3).map((subject, idx) => (
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
                    kingdom={taxonomy.kingdom}
                    rank="species"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <Typography sx={{ fontStyle: "italic", color: "primary.main" }}>
                    Unknown
                  </Typography>
                )}
              </Box>
            ))}
            {occurrence.subjects.length > 3 && (
              <Typography variant="caption" color="text.disabled">
                +{occurrence.subjects.length - 3} more
              </Typography>
            )}
          </Stack>
        ) : (
          <Box sx={{ my: 0.5, fontSize: "1.1rem" }}>
            {species ? (
              <TaxonLink
                name={species}
                kingdom={taxonomy.kingdom}
                rank={taxonomy.taxonRank || "species"}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <Typography sx={{ fontStyle: "italic", color: "text.secondary" }}>
                Unidentified
              </Typography>
            )}
          </Box>
        )}

        {occurrence.occurrenceRemarks && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ lineHeight: 1.4, my: 0.5 }}
          >
            {occurrence.occurrenceRemarks}
          </Typography>
        )}

        {occurrence.verbatimLocality && (
          <Typography variant="body2" color="text.disabled" sx={{ mt: 0.5 }}>
            {occurrence.verbatimLocality}
          </Typography>
        )}

        {imageUrl && (
          <CardMedia
            component="img"
            image={imageUrl}
            alt={species || "Observation photo"}
            loading="lazy"
            sx={{
              mt: 1.5,
              borderRadius: 2,
              maxHeight: 300,
              objectFit: "cover",
              boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
            }}
          />
        )}
      </Box>
    </Box>
  );
}
