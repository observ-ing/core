import { memo } from "react";
import { Link } from "react-router-dom";
import { Typography, Card, CardActionArea, CardContent } from "@mui/material";
import type { Occurrence } from "../../services/types";
import { useIsPending } from "../../store/pendingSlice";
import { getImageUrl } from "../../services/api";
import { getObservationUrl } from "../../lib/utils";
import { RelativeTime } from "../common/RelativeTime";
import { shouldItalicizeTaxonName } from "../common/TaxonLink";
import { ImageWithSkeleton } from "../common/ImageWithSkeleton";
import { PendingBadge } from "./PendingBadge";

interface ExploreGridCardProps {
  observation: Occurrence;
}

export const ExploreGridCard = memo(function ExploreGridCard({
  observation,
}: ExploreGridCardProps) {
  const species = observation.communityId || observation.effectiveTaxonomy?.scientificName;
  // Optimistic tombstone awaiting ingestion: dim it and block navigation to a
  // detail page that would 404 until the record lands.
  const isPending = useIsPending(observation.uri);

  return (
    <Card sx={{ display: "flex", flexDirection: "column", position: "relative" }}>
      {isPending && <PendingBadge />}
      <CardActionArea
        component={Link}
        to={getObservationUrl(observation.uri)}
        onClick={isPending ? (e) => e.preventDefault() : undefined}
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
          ...(isPending && { opacity: 0.7, pointerEvents: "none" }),
        }}
      >
        <ImageWithSkeleton
          src={observation.images[0] ? getImageUrl(observation.images[0].url) : undefined}
          alt={species || "Observation"}
          sx={{ aspectRatio: "1" }}
        />
        <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 }, flex: 1 }}>
          <Typography
            variant="body2"
            sx={{
              fontStyle:
                species && shouldItalicizeTaxonName(species, observation.effectiveTaxonomy?.rank)
                  ? "italic"
                  : "normal",
              color: "primary.main",
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {species || "Unknown species"}
          </Typography>
          <Typography
            variant="caption"
            noWrap
            sx={{
              color: "text.disabled",
            }}
          >
            <RelativeTime date={new Date(observation.createdAt)} />
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
});
