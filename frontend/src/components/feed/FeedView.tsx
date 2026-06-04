import { useRef, useCallback } from "react";
import { Box, Container } from "@mui/material";
import { useAppDispatch } from "../../store";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useFeed } from "../../lib/query/hooks";
import { openEditModal, openDeleteConfirm } from "../../store/uiSlice";
import type { FeedTab, Occurrence } from "../../services/types";
import { FeedItem } from "./FeedItem";
import { FeedSkeletonList } from "./FeedItemSkeleton";
import { ProfileObservationCardSkeleton } from "../profile/ProfileObservationCardSkeleton";
import { ExploreFilterPanel } from "./ExploreFilterPanel";
import { ExploreGridCard } from "./ExploreGridCard";
import { FeedEndIndicator } from "./FeedEndIndicator";
import { observationGridSx } from "../common/observationGridLayout";
import { CenteredSpinner } from "../common/CenteredSpinner";
import { EmptyState } from "../common/EmptyState";

interface FeedViewProps {
  tab?: FeedTab;
}

export function FeedView({ tab = "home" }: FeedViewProps) {
  usePageTitle(tab === "explore" ? "Explore" : "Home");
  const dispatch = useAppDispatch();
  const contentRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = useFeed(tab);
  const observations = data?.pages.flatMap((page) => page.occurrences) ?? [];
  const hasMore = hasNextPage;

  const handleScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el || isFetchingNextPage || !hasNextPage) return;

    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      void fetchNextPage();
    }
  }, [fetchNextPage, isFetchingNextPage, hasNextPage]);

  const handleEdit = useCallback(
    (occurrence: Occurrence) => {
      dispatch(openEditModal(occurrence));
    },
    [dispatch],
  );

  const handleDelete = useCallback(
    (occurrence: Occurrence) => {
      dispatch(openDeleteConfirm(occurrence));
    },
    [dispatch],
  );

  return (
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", minHeight: 0 }}>
      {/* Filter panel for explore tab only */}
      {tab === "explore" && (
        <Box sx={{ flexShrink: 0 }}>
          <Container maxWidth="sm" disableGutters>
            <Box sx={{ px: 2, pt: 2 }}>
              <ExploreFilterPanel />
            </Box>
          </Container>
        </Box>
      )}
      <Box
        ref={contentRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: "auto",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        <Container maxWidth={tab === "explore" ? "md" : "sm"} disableGutters>
          {tab === "explore" ? (
            <>
              <Box sx={observationGridSx(4)}>
                {observations.map((obs) => (
                  <ExploreGridCard key={obs.uri} observation={obs} />
                ))}

                {isLoading && observations.length === 0 && (
                  <>
                    {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                      <ProfileObservationCardSkeleton key={i} />
                    ))}
                  </>
                )}
              </Box>

              {isFetchingNextPage && <CenteredSpinner color="primary" />}

              {!isLoading && observations.length === 0 && (
                <EmptyState message="No observations yet. Be the first to post!" />
              )}

              {!isLoading && !hasMore && observations.length > 0 && (
                <FeedEndIndicator count={observations.length} />
              )}
            </>
          ) : (
            <>
              <Box>
                {observations.map((obs) => (
                  <FeedItem
                    key={obs.uri}
                    observation={obs}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                  />
                ))}
              </Box>

              {isLoading && observations.length === 0 && <FeedSkeletonList count={3} />}

              {isFetchingNextPage && <CenteredSpinner color="primary" />}

              {!isLoading && observations.length === 0 && (
                <EmptyState message="No observations yet. Be the first to post!" />
              )}

              {!isLoading && !hasMore && observations.length > 0 && <FeedEndIndicator />}
            </>
          )}
        </Container>
      </Box>
    </Box>
  );
}
