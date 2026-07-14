import { memo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Box,
  Typography,
  IconButton,
  Card,
  CardContent,
  CardActionArea,
  Tooltip,
} from "@mui/material";
import FavoriteBorderIcon from "@mui/icons-material/FavoriteBorder";
import FavoriteIcon from "@mui/icons-material/Favorite";
import type { Occurrence } from "../../services/types";
import { useAppSelector } from "../../store";
import { useIsPending } from "../../store/pendingSlice";
import { getImageUrl } from "../../services/api";
import { useLike } from "../../lib/query/mutations";
import { TaxonLink } from "../common/TaxonLink";
import { UserCard } from "../common/UserCard";
import { RecordOverflowMenu } from "../common/RecordOverflowMenu";
import { getObservationUrl } from "../../lib/utils";
import { RelativeTime } from "../common/RelativeTime";
import { ImageWithSkeleton } from "../common/ImageWithSkeleton";
import { PendingBadge } from "./PendingBadge";
import { FEED_CARD_SX, FEED_IMAGE_MAX_HEIGHT } from "./feedLayout";

interface FeedItemProps {
  observation: Occurrence;
  onEdit?: (observation: Occurrence) => void;
  onDelete?: (observation: Occurrence) => void;
}

export const FeedItem = memo(function FeedItem({ observation, onEdit, onDelete }: FeedItemProps) {
  // Like state lives in the query cache: the optimistic mutation patches the
  // occurrence in every cache that holds it, so reading the prop is reactive.
  const liked = observation.viewerHasLiked ?? false;
  const likeCount = observation.likeCount ?? 0;
  const like = useLike();
  const navigate = useNavigate();
  const currentUser = useAppSelector((state) => state.auth.user);
  const isOwnPost = currentUser?.did === observation.observer.did;
  // True while this is an optimistic tombstone the ingester hasn't confirmed yet.
  const isPending = useIsPending(observation.uri);

  const owner = observation.observer;
  const handle = owner.handle ? `@${owner.handle}` : "";
  const timeAgo = <RelativeTime date={new Date(observation.createdAt)} />;

  const taxonomy = observation.effectiveTaxonomy;
  const species = observation.communityId || taxonomy?.scientificName || undefined;

  const imageUrl = observation.images[0] ? getImageUrl(observation.images[0].url) : "";

  const observationUrl = getObservationUrl(observation.uri);

  const handleCardClick = (e: React.MouseEvent) => {
    // Don't navigate if clicking on interactive elements (links, buttons)
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest("a, button")) {
      return;
    }
    navigate(observationUrl);
  };

  return (
    <Card sx={{ ...FEED_CARD_SX, position: "relative", ...(isPending && { opacity: 0.7 }) }}>
      {isPending && <PendingBadge />}
      {/* While pending the row isn't ingested: navigation 404s and the menu's
          edit/delete act on a record that doesn't exist yet, so we freeze all
          interaction inside the action area until reconciliation. */}
      <CardActionArea
        onClick={isPending ? undefined : handleCardClick}
        component="div"
        sx={isPending ? { pointerEvents: "none" } : undefined}
      >
        <Box sx={{ display: "flex", gap: 1, p: 2, alignItems: "flex-start" }}>
          <UserCard
            actor={owner}
            avatarSize={40}
            spacing={1}
            link
            stopPropagation
            nameSx={{ "&:hover": { textDecoration: "underline" } }}
            trailing={
              handle ? (
                <Typography variant="body2" sx={{ color: "text.disabled" }}>
                  {handle}
                </Typography>
              ) : undefined
            }
            belowName={
              <Typography variant="body2" sx={{ color: "text.disabled" }}>
                {timeAgo}
              </Typography>
            }
          />
          <Box sx={{ ml: "auto" }}>
            <RecordOverflowMenu
              atUri={observation.uri}
              stopPropagation
              {...(isOwnPost && onEdit ? { onEdit: () => onEdit(observation) } : {})}
              {...(isOwnPost && onDelete ? { onDelete: () => onDelete(observation) } : {})}
            />
          </Box>
        </Box>

        {imageUrl && (
          <ImageWithSkeleton
            src={imageUrl}
            alt={species || "Observation photo"}
            sx={{ height: FEED_IMAGE_MAX_HEIGHT }}
          />
        )}
      </CardActionArea>

      {/* Species name and like button share a row. Kept outside CardActionArea
          so the like button stays a standalone control and doesn't fold into
          the card's accessible name or trigger card navigation. */}
      <CardContent>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 1,
          }}
        >
          <Box sx={{ fontSize: "1.1rem", minWidth: 0 }}>
            {species ? (
              <TaxonLink name={species} kingdom={taxonomy?.kingdom} rank={taxonomy?.rank} />
            ) : (
              <Typography sx={{ fontStyle: "italic", color: "text.secondary" }}>
                Unidentified
              </Typography>
            )}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
            <Tooltip title={!currentUser ? "Log in to like" : ""}>
              <span>
                <IconButton
                  size="small"
                  onClick={() =>
                    like.mutate({ uri: observation.uri, cid: observation.cid, liked: !liked })
                  }
                  disabled={!currentUser || isPending}
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
              </span>
            </Tooltip>
            {likeCount > 0 && (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                {likeCount}
              </Typography>
            )}
          </Box>
        </Box>
      </CardContent>
    </Card>
  );
});
