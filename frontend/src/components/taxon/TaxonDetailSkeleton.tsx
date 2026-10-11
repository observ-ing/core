import { Box, Skeleton, Stack, Typography } from "@mui/material";
import { FeedItemSkeleton } from "../feed/FeedItemSkeleton";
import { DetailHeaderSkeleton } from "../common/DetailHeaderSkeleton";
import {
  TAXON_DETAIL_COLUMN_SX,
  TAXON_HERO_IMAGE_SIZE,
  TAXON_OBSERVATIONS_HEADER_SX,
} from "./taxonLayout";

// Pill-shaped placeholders for the small GBIF / Wikidata link chips.
const LINK_CHIP_WIDTHS = [61, 85];

/**
 * Skeleton loader matching taxon detail page layout
 */
export function TaxonDetailSkeleton() {
  return (
    <Box>
      <DetailHeaderSkeleton
        titleWidth={60}
        sticky
        trailing={
          // Classification-tree toggle, shown on mobile only
          <Skeleton
            variant="circular"
            width={40}
            height={40}
            sx={{ ml: "auto", display: { xs: "block", md: "none" } }}
          />
        }
      />

      <Box sx={TAXON_DETAIL_COLUMN_SX}>
        {/* Breadcrumb */}
        <Skeleton variant="text" width="50%" height={19} sx={{ mb: 2.25 }} />

        {/* Hero: image card beside the names, chips, and links */}
        <Stack
          direction={{ xs: "column", sm: "row" }}
          spacing={2}
          sx={{ alignItems: { xs: "stretch", sm: "flex-start" } }}
        >
          <Skeleton
            variant="rectangular"
            width={TAXON_HERO_IMAGE_SIZE}
            height={TAXON_HERO_IMAGE_SIZE}
            sx={{ maxWidth: "100%", flexShrink: 0, borderRadius: 1.75, mx: { xs: "auto", sm: 0 } }}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {/* Scientific name */}
            <Skeleton variant="text" width="60%" height={33} />
            {/* Common name */}
            <Skeleton variant="text" width="40%" height={31} sx={{ mt: 0.75 }} />
            {/* Conservation status + observation count */}
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", mt: 2.5 }}>
              <Skeleton variant="rectangular" width={130} height={32} sx={{ borderRadius: 4 }} />
              <Skeleton variant="text" width={200} height={20} />
            </Stack>
            {/* External links */}
            <Stack direction="row" spacing={1.25} sx={{ mt: 2 }}>
              {LINK_CHIP_WIDTHS.map((width) => (
                <Skeleton
                  key={width}
                  variant="rectangular"
                  width={width}
                  height={24}
                  sx={{ borderRadius: 4 }}
                />
              ))}
            </Stack>
          </Box>
        </Stack>

        {/* Media section (collapsed) */}
        <Skeleton variant="rectangular" height={66} sx={{ mt: 3.25, borderRadius: 2 }} />

        {/* Recent observations */}
        <Box sx={TAXON_OBSERVATIONS_HEADER_SX}>
          <Typography variant="subtitle2">
            <Skeleton width={140} />
          </Typography>
        </Box>
        <FeedItemSkeleton />
        <FeedItemSkeleton />
      </Box>
    </Box>
  );
}
