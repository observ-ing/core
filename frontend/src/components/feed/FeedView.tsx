import { useRef, useCallback, useState } from "react";
import { Box, Container, ToggleButton, ToggleButtonGroup, Tooltip } from "@mui/material";
import GridViewIcon from "@mui/icons-material/GridView";
import TableRowsIcon from "@mui/icons-material/TableRows";
import { useAppDispatch } from "../../store";
import { usePageTitle } from "../../hooks/usePageTitle";
import { useFeed } from "../../lib/query/hooks";
import { openEditModal, openDeleteConfirm } from "../../store/uiSlice";
import type { FeedTab, Occurrence } from "../../services/types";
import { FeedItem } from "./FeedItem";
import { FeedSkeletonList } from "./FeedItemSkeleton";
import { ObservationGridCardSkeleton } from "../common/ObservationGridCardSkeleton";
import { ExploreFilterPanel } from "./ExploreFilterPanel";
import { ExploreGridCard } from "./ExploreGridCard";
import { ExploreTable } from "./ExploreTable";
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

  // Explore results layout: dense card grid (default) or a CSV-style table.
  // Presentation-only state — no need to share it beyond this component.
  const [viewMode, setViewMode] = useState<"grid" | "table">("grid");

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
              {/* On narrow screens the layout toggle shares a line with the
                  filter panel header to save vertical space; on wider screens
                  it sits in its own right-aligned row above the panel. */}
              <Box
                sx={{
                  display: "flex",
                  flexDirection: { xs: "row", sm: "column" },
                  alignItems: { xs: "flex-start", sm: "stretch" },
                  gap: { xs: 1, sm: 0 },
                }}
              >
                <Box
                  sx={{
                    display: "flex",
                    justifyContent: "flex-end",
                    mb: { xs: 0, sm: 1 },
                    order: { xs: 2, sm: 0 },
                  }}
                >
                  <ToggleButtonGroup
                    size="small"
                    exclusive
                    value={viewMode}
                    onChange={(_, value) => {
                      if (value) setViewMode(value);
                    }}
                    aria-label="Results layout"
                  >
                    <ToggleButton value="grid" aria-label="Grid view">
                      <Tooltip title="Grid">
                        <GridViewIcon fontSize="small" />
                      </Tooltip>
                    </ToggleButton>
                    <ToggleButton value="table" aria-label="Table view">
                      <Tooltip title="Table">
                        <TableRowsIcon fontSize="small" />
                      </Tooltip>
                    </ToggleButton>
                  </ToggleButtonGroup>
                </Box>
                <Box sx={{ flex: { xs: 1, sm: "unset" }, minWidth: 0, order: { xs: 1, sm: 0 } }}>
                  <ExploreFilterPanel />
                </Box>
              </Box>
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
        <Container
          maxWidth={tab !== "explore" ? "sm" : viewMode === "table" ? false : "md"}
          disableGutters
        >
          {tab === "explore" ? (
            <>
              {viewMode === "table" ? (
                <>
                  {observations.length > 0 && <ExploreTable observations={observations} />}
                  {isLoading && observations.length === 0 && <CenteredSpinner color="primary" />}
                </>
              ) : (
                <Box sx={observationGridSx(4)}>
                  {observations.map((obs) => (
                    <ExploreGridCard key={obs.uri} observation={obs} />
                  ))}

                  {isLoading && observations.length === 0 && (
                    <>
                      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                        <ObservationGridCardSkeleton key={i} />
                      ))}
                    </>
                  )}
                </Box>
              )}

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
