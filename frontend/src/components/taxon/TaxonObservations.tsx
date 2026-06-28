import { Box, Typography } from "@mui/material";
import type { Occurrence } from "../../services/types";
import { LoadMoreButton } from "../common/LoadMoreButton";
import { FeedItem } from "../feed/FeedItem";

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
      <Box sx={{ mt: 4.25, pt: 3, borderTop: 1, borderColor: "divider" }}>
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
        <Box sx={{ py: 5, textAlign: "center" }}>
          <Typography
            sx={{
              color: "text.secondary",
              mb: 0.5,
            }}
          >
            No observations yet
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: "text.disabled",
            }}
          >
            Be the first to observe <em>{emptyName}</em> on Observ.ing!
          </Typography>
        </Box>
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
