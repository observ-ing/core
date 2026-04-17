import { useEffect, useRef, useCallback } from "react";
import { Box, Container, Typography, CircularProgress } from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../store";
import { usePageTitle } from "../../hooks/usePageTitle";
import { loadFeed, loadInitialFeed, switchTab } from "../../store/feedSlice";
import { openEditModal, openDeleteConfirm } from "../../store/uiSlice";
import type { FeedTab, Occurrence } from "../../services/types";
import { FeedItem } from "./FeedItem";
import { FeedSkeletonList } from "./FeedItemSkeleton";
import { ProfileObservationCardSkeleton } from "../profile/ProfileObservationCardSkeleton";
import { ExploreFilterPanel } from "./ExploreFilterPanel";
import { ExploreGridCard } from "./ExploreGridCard";
import { FeedEndIndicator } from "./FeedEndIndicator";

interface FeedViewProps {
  tab?: FeedTab;
}

export function FeedView({ tab = "home" }: FeedViewProps) {
  usePageTitle(tab === "explore" ? "Explore" : "Home");
  const dispatch = useAppDispatch();
  const { observations, isLoading, currentTab, hasMore } = useAppSelector((state) => state.feed);
  const contentRef = useRef<HTMLDivElement>(null);

  // Sync route tab with store
  useEffect(() => {
    if (tab !== currentTab) {
      dispatch(switchTab(tab));
    }
  }, [dispatch, tab, currentTab]);

  useEffect(() => {
    dispatch(loadInitialFeed());
  }, [dispatch, currentTab]);

  const handleScroll = useCallback(() => {
    const el = contentRef.current;
    if (!el || isLoading || !hasMore) return;

    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      dispatch(loadFeed());
    }
  }, [dispatch, isLoading, hasMore]);

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
      {currentTab === "explore" && (
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
        <Container maxWidth={currentTab === "explore" ? "md" : "sm"} disableGutters>
          {currentTab === "explore" ? (
            <>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "repeat(2, 1fr)",
                    sm: "repeat(3, 1fr)",
                    md: "repeat(4, 1fr)",
                  },
                  gap: 1.5,
                  p: 1.5,
                }}
              >
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

              {isLoading && observations.length > 0 && (
                <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                  <CircularProgress color="primary" size={24} />
                </Box>
              )}

              {!isLoading && observations.length === 0 && (
                <Box sx={{ p: 4, textAlign: "center" }}>
                  <Typography
                    sx={{
                      color: "text.secondary",
                    }}
                  >
                    No observations yet. Be the first to post!
                  </Typography>
                </Box>
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

              {isLoading && observations.length > 0 && (
                <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
                  <CircularProgress color="primary" size={24} />
                </Box>
              )}

              {!isLoading && observations.length === 0 && (
                <Box sx={{ p: 4, textAlign: "center" }}>
                  <Typography
                    sx={{
                      color: "text.secondary",
                    }}
                  >
                    No observations yet. Be the first to post!
                  </Typography>
                </Box>
              )}

              {!isLoading && !hasMore && observations.length > 0 && <FeedEndIndicator />}
            </>
          )}
        </Container>
      </Box>
    </Box>
  );
}
