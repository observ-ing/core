import { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  Box,
  Container,
  Avatar,
  Typography,
  Tabs,
  Tab,
  Button,
  CircularProgress,
  Stack,
  Chip,
  Badge,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import GrassIcon from "@mui/icons-material/Grass";
import { fetchProfileFeed, getImageUrl } from "../../services/api";
import type {
  ProfileFeedResponse,
  Occurrence,
  Identification,
} from "../../services/types";
import { formatTimeAgo } from "../../lib/utils";
import { ProfileHeaderSkeleton, ProfileFeedItemSkeleton } from "../common/Skeletons";

type ProfileTab = "all" | "observations" | "identifications";

export function ProfileView() {
  const { did } = useParams<{ did: string }>();
  const [data, setData] = useState<ProfileFeedResponse | null>(null);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [identifications, setIdentifications] = useState<Identification[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>("all");

  const loadData = useCallback(
    async (loadMore = false) => {
      if (!did) return;

      setIsLoading(true);
      setError(null);

      try {
        const response = await fetchProfileFeed(
          did,
          loadMore ? cursor : undefined,
          activeTab
        );

        if (!loadMore) {
          setData(response);
          setOccurrences(response.occurrences);
          setIdentifications(response.identifications);
        } else {
          setOccurrences((prev) => [...prev, ...response.occurrences]);
          setIdentifications((prev) => [...prev, ...response.identifications]);
        }

        setCursor(response.cursor);
        setHasMore(!!response.cursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load profile");
      } finally {
        setIsLoading(false);
      }
    },
    [did, cursor, activeTab]
  );

  useEffect(() => {
    setOccurrences([]);
    setIdentifications([]);
    setCursor(undefined);
    setHasMore(true);
    loadData(false);
  }, [did, activeTab]);

  if (!did) {
    return (
      <Container maxWidth="md" sx={{ p: 4 }}>
        <Typography color="text.secondary">Profile not found</Typography>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="md" sx={{ p: 4 }}>
        <Typography color="error">{error}</Typography>
      </Container>
    );
  }

  const profile = data?.profile;
  const counts = data?.counts;

  return (
    <Container
      maxWidth="md"
      disableGutters
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Profile Header */}
      {isLoading && !profile ? (
        <ProfileHeaderSkeleton />
      ) : (
      <Box sx={{ p: 3, borderBottom: 1, borderColor: "divider" }}>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar
            src={profile?.avatar}
            alt={profile?.displayName || profile?.handle || did}
            sx={{ width: 80, height: 80 }}
          />
          <Box>
            <Typography variant="h5" fontWeight={600}>
              {profile?.displayName || profile?.handle || did.slice(0, 20)}
            </Typography>
            {profile?.handle && (
              <Typography color="text.disabled">@{profile.handle}</Typography>
            )}
          </Box>
        </Stack>

        {/* Stats with Badges */}
        {counts && (
          <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
            <Box sx={{ textAlign: "center", flex: 1, bgcolor: "action.hover", borderRadius: 2, py: 1.5, px: 1 }}>
              <Badge
                badgeContent={counts.observations}
                color="primary"
                max={9999}
                sx={{
                  "& .MuiBadge-badge": {
                    position: "static",
                    transform: "none",
                    fontSize: "1rem",
                    fontWeight: 700,
                    height: "auto",
                    minWidth: "auto",
                    padding: "4px 8px",
                    borderRadius: 1,
                  },
                }}
              />
              <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5} sx={{ mt: 0.5 }}>
                <CameraAltIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                <Typography variant="caption" color="text.secondary">
                  Observations
                </Typography>
              </Stack>
            </Box>
            <Box sx={{ textAlign: "center", flex: 1, bgcolor: "action.hover", borderRadius: 2, py: 1.5, px: 1 }}>
              <Badge
                badgeContent={counts.identifications}
                color="secondary"
                max={9999}
                sx={{
                  "& .MuiBadge-badge": {
                    position: "static",
                    transform: "none",
                    fontSize: "1rem",
                    fontWeight: 700,
                    height: "auto",
                    minWidth: "auto",
                    padding: "4px 8px",
                    borderRadius: 1,
                  },
                }}
              />
              <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5} sx={{ mt: 0.5 }}>
                <FingerprintIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                <Typography variant="caption" color="text.secondary">
                  IDs
                </Typography>
              </Stack>
            </Box>
            <Box sx={{ textAlign: "center", flex: 1, bgcolor: "action.hover", borderRadius: 2, py: 1.5, px: 1 }}>
              <Badge
                badgeContent={counts.species}
                color="success"
                max={9999}
                sx={{
                  "& .MuiBadge-badge": {
                    position: "static",
                    transform: "none",
                    fontSize: "1rem",
                    fontWeight: 700,
                    height: "auto",
                    minWidth: "auto",
                    padding: "4px 8px",
                    borderRadius: 1,
                  },
                }}
              />
              <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5} sx={{ mt: 0.5 }}>
                <GrassIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                <Typography variant="caption" color="text.secondary">
                  Species
                </Typography>
              </Stack>
            </Box>
          </Stack>
        )}

        {/* AT Protocol Link */}
        <Button
          component="a"
          href={`https://pdsls.dev/at://${did}/org.rwell.test.occurrence`}
          target="_blank"
          rel="noopener noreferrer"
          variant="outlined"
          size="small"
          endIcon={<OpenInNewIcon />}
          sx={{ mt: 2 }}
        >
          View on AT Protocol
        </Button>
      </Box>
      )}

      {/* Tabs */}
      <Tabs
        value={activeTab}
        onChange={(_, tab) => setActiveTab(tab)}
        sx={{
          borderBottom: 1,
          borderColor: "divider",
          "& .MuiTab-root": { flex: 1, minWidth: 0 },
        }}
      >
        <Tab label="All" value="all" />
        <Tab label="Observations" value="observations" />
        <Tab label="IDs" value="identifications" />
      </Tabs>

      {/* Feed */}
      <Box sx={{ flex: 1 }}>
        {(activeTab === "all" || activeTab === "observations") &&
          occurrences.map((occ) => (
            <Box
              key={occ.uri}
              component={Link}
              to={`/observation/${encodeURIComponent(occ.uri)}`}
              sx={{
                display: "block",
                p: 2,
                borderBottom: 1,
                borderColor: "divider",
                textDecoration: "none",
                color: "inherit",
                "&:hover": { bgcolor: "rgba(255, 255, 255, 0.03)" },
              }}
            >
              <Chip label="Observation" size="small" sx={{ mb: 1 }} />
              <Stack direction="row" spacing={2} alignItems="flex-start">
                <Box sx={{ flex: 1 }}>
                  <Typography
                    sx={{
                      fontStyle: "italic",
                      color: "primary.main",
                      fontWeight: 500,
                    }}
                  >
                    {occ.communityId || occ.scientificName || "Unknown species"}
                  </Typography>
                  <Typography variant="caption" color="text.disabled">
                    {formatTimeAgo(new Date(occ.createdAt))}
                    {occ.verbatimLocality && ` · ${occ.verbatimLocality}`}
                  </Typography>
                </Box>
                {occ.images[0] && (
                  <Box
                    component="img"
                    src={getImageUrl(occ.images[0])}
                    alt=""
                    loading="lazy"
                    sx={{
                      width: 60,
                      height: 60,
                      borderRadius: 1,
                      objectFit: "cover",
                    }}
                  />
                )}
              </Stack>
            </Box>
          ))}

        {(activeTab === "all" || activeTab === "identifications") &&
          identifications.map((id) => (
            <Box
              key={id.uri}
              component={Link}
              to={`/observation/${encodeURIComponent(id.subject_uri)}`}
              sx={{
                display: "block",
                p: 2,
                borderBottom: 1,
                borderColor: "divider",
                textDecoration: "none",
                color: "inherit",
                "&:hover": { bgcolor: "rgba(255, 255, 255, 0.03)" },
              }}
            >
              <Chip label="Identification" size="small" sx={{ mb: 1 }} />
              <Typography
                sx={{
                  fontStyle: "italic",
                  color: "primary.main",
                  fontWeight: 500,
                }}
              >
                {id.scientific_name}
              </Typography>
              {id.identification_remarks && (
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  {id.identification_remarks}
                </Typography>
              )}
              <Typography variant="caption" color="text.disabled">
                {formatTimeAgo(new Date(id.date_identified))}
                {id.is_agreement && " · Agrees"}
              </Typography>
            </Box>
          ))}

        {isLoading && occurrences.length === 0 && identifications.length === 0 && (
          <>
            {[1, 2, 3].map((i) => (
              <ProfileFeedItemSkeleton key={i} />
            ))}
          </>
        )}

        {isLoading && (occurrences.length > 0 || identifications.length > 0) && (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress color="primary" size={24} />
          </Box>
        )}

        {!isLoading && occurrences.length === 0 && identifications.length === 0 && (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography color="text.secondary">No activity yet</Typography>
          </Box>
        )}

        {hasMore && !isLoading && (
          <Box sx={{ p: 2, textAlign: "center" }}>
            <Button variant="outlined" onClick={() => loadData(true)}>
              Load more
            </Button>
          </Box>
        )}
      </Box>
    </Container>
  );
}
