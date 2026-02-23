import { useEffect, useRef, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Box,
  Container,
  Typography,
  Button,
  CircularProgress,
  Card,
  CardActionArea,
  CardMedia,
  CardContent,
} from "@mui/material";
import { useAppDispatch, useAppSelector } from "../../store";
import { usePageTitle } from "../../hooks/usePageTitle";
import { loadFeed, loadInitialFeed, switchTab } from "../../store/feedSlice";
import { openEditModal, openDeleteConfirm } from "../../store/uiSlice";
import type { FeedTab, Occurrence } from "../../services/types";
import { FeedItem } from "./FeedItem";
import { FeedSkeletonList, ProfileObservationCardSkeleton } from "../common/Skeletons";
import { ExploreFilterPanel } from "./ExploreFilterPanel";
import { getImageUrl } from "../../services/api";
import { formatTimeAgo, getObservationUrl } from "../../lib/utils";

interface FeedViewProps {
  tab?: FeedTab;
}

export function FeedView({ tab = "home" }: FeedViewProps) {
  usePageTitle(tab === "explore" ? "Explore" : "Home");
  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const { observations, isLoading, currentTab, hasMore, homeFeedMeta } =
    useAppSelector((state) => state.feed);
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
    [dispatch]
  );

  const handleDelete = useCallback(
    (occurrence: Occurrence) => {
      dispatch(openDeleteConfirm(occurrence));
    },
    [dispatch]
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
                {observations.map((obs) => {
                  const species = obs.communityId || obs.effectiveTaxonomy?.scientificName;
                  return (
                    <Card key={obs.uri} sx={{ display: "flex", flexDirection: "column" }}>
                      <CardActionArea
                        component={Link}
                        to={getObservationUrl(obs.uri)}
                        sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch" }}
                      >
                        {obs.images[0] ? (
                          <CardMedia
                            component="img"
                            image={getImageUrl(obs.images[0])}
                            alt={species || "Observation"}
                            loading="lazy"
                            sx={{ aspectRatio: "1", objectFit: "cover" }}
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
                              fontStyle: "italic",
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
                            {formatTimeAgo(new Date(obs.createdAt))}
                            {obs.verbatimLocality && ` · ${obs.verbatimLocality}`}
                          </Typography>
                        </CardContent>
                      </CardActionArea>
                    </Card>
                  );
                })}

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
                  <Typography color="text.secondary">
                    No observations yet. Be the first to post!
                  </Typography>
                </Box>
              )}
            </>
          ) : (
            <>
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
                    component={Link}
                    to="/explore"
                  >
                    Browse all observations
                  </Button>
                </Box>
              )}
            </>
          )}
        </Container>
      </Box>
    </Box>
  );
}
