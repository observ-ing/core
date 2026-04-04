import { memo } from "react";
import { Link } from "react-router-dom";
import { Box, Typography, Card, CardActionArea, CardContent } from "@mui/material";
import type { Occurrence } from "../../services/types";
import { getImageUrl } from "../../services/api";
import { formatTimeAgo, getObservationUrl } from "../../lib/utils";
import { shouldItalicizeTaxonName } from "../common/TaxonLink";
import { ImageWithSkeleton } from "../common/ImageWithSkeleton";

interface ExploreGridCardProps {
  observation: Occurrence;
}

export const ExploreGridCard = memo(function ExploreGridCard({
  observation,
}: ExploreGridCardProps) {
  const species = observation.communityId || observation.effectiveTaxonomy?.scientificName;

  return (
    <Card sx={{ display: "flex", flexDirection: "column" }}>
      <CardActionArea
        component={Link}
        to={getObservationUrl(observation.uri)}
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "stretch",
        }}
      >
        {observation.images[0] ? (
          <ImageWithSkeleton
            src={getImageUrl(observation.images[0])}
            alt={species || "Observation"}
            sx={{ aspectRatio: "1" }}
          />
        ) : (
          <Box
            sx={{
              aspectRatio: "1",
              bgcolor: "action.hover",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Typography color="text.disabled" variant="body2">
              No image
            </Typography>
          </Box>
        )}
        <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 }, flex: 1 }}>
          <Typography
            variant="body2"
            sx={{
              fontStyle: species && shouldItalicizeTaxonName(species) ? "italic" : "normal",
              color: "primary.main",
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {species || "Unknown species"}
          </Typography>
          <Typography variant="caption" color="text.disabled" noWrap>
            {formatTimeAgo(new Date(observation.createdAt))}
            {observation.verbatimLocality && ` · ${observation.verbatimLocality}`}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
});
