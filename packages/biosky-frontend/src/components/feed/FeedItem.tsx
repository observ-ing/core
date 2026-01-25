import { useState, useRef, useEffect } from "react";
import { Link } from "react-router-dom";
import { useSelector } from "react-redux";
import {
  Box,
  Avatar,
  Typography,
  IconButton,
  Menu,
  MenuItem,
  CardMedia,
  Stack,
} from "@mui/material";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import type { Occurrence } from "../../services/types";
import type { RootState } from "../../store";
import { getImageUrl } from "../../services/api";
import { TaxonLink } from "../common/TaxonLink";

interface FeedItemProps {
  occurrence: Occurrence;
  onEdit?: (occurrence: Occurrence) => void;
}

function getPdslsUrl(atUri: string): string {
  return `https://pdsls.dev/${atUri}`;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);

  if (seconds < 60) return "now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d`;

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function FeedItem({ occurrence, onEdit }: FeedItemProps) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(anchorEl);
  const currentUser = useSelector((state: RootState) => state.auth.user);
  const isOwnPost = currentUser?.did === occurrence.observer.did;

  const displayName =
    occurrence.observer.displayName ||
    occurrence.observer.handle ||
    occurrence.observer.did.slice(0, 20);
  const handle = occurrence.observer.handle
    ? `@${occurrence.observer.handle}`
    : "";
  const timeAgo = formatTimeAgo(new Date(occurrence.createdAt));
  const species =
    occurrence.communityId || occurrence.scientificName || "Unknown species";
  const imageUrl = occurrence.images[0]
    ? getImageUrl(occurrence.images[0])
    : "";

  const occurrenceUrl = `/occurrence/${encodeURIComponent(occurrence.uri)}`;
  const pdslsUrl = getPdslsUrl(occurrence.uri);

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

  return (
    <Box
      component={Link}
      to={occurrenceUrl}
      sx={{
        display: "flex",
        gap: 1.5,
        p: 2,
        borderBottom: 1,
        borderColor: "divider",
        textDecoration: "none",
        color: "inherit",
        "&:hover": { bgcolor: "rgba(255, 255, 255, 0.03)" },
      }}
    >
      <Avatar
        src={occurrence.observer.avatar}
        alt={displayName}
        sx={{ width: 48, height: 48 }}
      />

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Stack direction="row" alignItems="baseline" spacing={1} flexWrap="wrap">
          <Typography
            component={Link}
            to={`/profile/${encodeURIComponent(occurrence.observer.did)}`}
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
                    taxonId={occurrence.taxonId}
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
            <TaxonLink
              name={species}
              taxonId={occurrence.taxonId}
              rank={occurrence.taxonRank || "species"}
              onClick={(e) => e.stopPropagation()}
            />
          </Box>
        )}

        {occurrence.occurrenceRemarks && (
          <Typography
            variant="body2"
            sx={{ color: "#ccc", lineHeight: 1.4, my: 0.5 }}
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
            alt={species}
            loading="lazy"
            sx={{
              mt: 1.5,
              borderRadius: 2,
              maxHeight: 300,
              objectFit: "cover",
            }}
          />
        )}
      </Box>
    </Box>
  );
}
