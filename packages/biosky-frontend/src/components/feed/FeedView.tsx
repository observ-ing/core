import { useEffect, useRef, useCallback } from "react";
import { Box, Container, Tabs, Tab, Typography, Button, CircularProgress } from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../store";
import { loadFeed, loadInitialFeed, switchTab } from "../../store/feedSlice";
import { openEditModal, openDeleteConfirm } from "../../store/uiSlice";
import type { FeedTab, Occurrence } from "../../services/types";
import { FeedItem } from "./FeedItem";
import { FeedSkeletonList } from "../common/Skeletons";

export function FeedView() {
  const dispatch = useAppDispatch();
  const { observations, isLoading, currentTab, hasMore, homeFeedMeta } =
    useAppSelector((state) => state.feed);
  const contentRef = useRef<HTMLDivElement>(null);

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

  const handleTabClick = (_: React.SyntheticEvent, tab: FeedTab) => {
    if (tab !== currentTab) {
      dispatch(switchTab(tab));
    }
  };

  const handleEdit = useCallback(
    (occurrence: Occurrence) => {
      dispatch(openEditModal(occurrence));
    },
    [dispatch]
  );

  const handleDelete = useCallback(
    (occurrence: Occurrence) => {
      dispatch(openDeleteConfirm(occurrence));
    },
    [dispatch]
  );

  return (
    <Container
      maxWidth="md"
      disableGutters
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        borderLeft: { sm: 1 },
        borderRight: { sm: 1 },
        borderColor: "divider",
      }}
    >
      <Tabs
        value={currentTab}
        onChange={handleTabClick}
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          position: "sticky",
          top: 0,
          zIndex: 10,
          "& .MuiTab-root": { flex: 1, minWidth: 0 },
        }}
      >
        <Tab label="Home" value="home" />
        <Tab label="Explore" value="explore" />
      </Tabs>

      <Box
        ref={contentRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          overflowY: "auto",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        <Box>
          {observations.map((obs) => (
            <FeedItem key={obs.uri} observation={obs} onEdit={handleEdit} onDelete={handleDelete} />
          ))}
        </Box>

        {isLoading && observations.length === 0 && (
          <FeedSkeletonList count={3} />
        )}

        {isLoading && observations.length > 0 && (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress color="primary" size={24} />
          </Box>
        )}

        {!isLoading && observations.length === 0 && (
          <Box sx={{ p: 4, textAlign: "center" }}>
            {currentTab === "home" ? (
              <>
                <Typography color="text.secondary" sx={{ mb: 1 }}>
                  No observations from people you follow yet.
                </Typography>
                {homeFeedMeta && homeFeedMeta.totalFollows > 0 && (
                  <Typography variant="body2" color="text.disabled" sx={{ mb: 2 }}>
                    You follow {homeFeedMeta.totalFollows} people, but none have
                    posted observations.
                  </Typography>
                )}
                <Button
                  variant="outlined"
                  color="primary"
                  onClick={() => dispatch(switchTab("explore"))}
                >
                  Browse all observations
                </Button>
              </>
            ) : (
              <Typography color="text.secondary">
                No observations yet. Be the first to post!
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Container>
  );
}
