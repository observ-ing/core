import { Box, Typography } from "@mui/material";
import type { Occurrence } from "../../services/types";
import { EmptyState } from "../common/EmptyState";
import { LoadMoreButton } from "../common/LoadMoreButton";
import { FeedItem } from "../feed/FeedItem";
import { TAXON_OBSERVATIONS_HEADER_SX } from "./taxonLayout";

interface TaxonObservationsProps {
  observations: Occurrence[];
  hasMore: boolean;
  loadingMore: boolean;
  /** Display name (common or scientific) used in the empty-state prompt. */
  emptyName: string;
  onLoadMore: () => void;
}

/**
 * The "Recent Observations" section of the taxon detail panel: a feed of
 * observations for this taxon, or an empty-state prompt when there are none.
 */
export function TaxonObservations({
  observations,
  hasMore,
  loadingMore,
  emptyName,
  onLoadMore,
}: TaxonObservationsProps) {
  return (
    <>
      <Box sx={TAXON_OBSERVATIONS_HEADER_SX}>
        <Typography
          variant="subtitle2"
          sx={{
            color: "text.secondary",
          }}
        >
          Recent Observations
        </Typography>
      </Box>
      {observations.length === 0 ? (
        <EmptyState
          p={5}
          message="No observations yet"
          secondary={
            <>
              Be the first to observe <em>{emptyName}</em> on Observ.ing!
            </>
          }
        />
      ) : (
        <Box>
          {observations.map((obs) => (
            <FeedItem key={obs.uri} observation={obs} />
          ))}

          {hasMore && <LoadMoreButton loading={loadingMore} onClick={onLoadMore} />}
        </Box>
      )}
    </>
  );
}
