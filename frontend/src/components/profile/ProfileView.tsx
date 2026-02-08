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
  Card,
  CardActionArea,
  CardMedia,
  CardContent,
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
import { formatTimeAgo, getObservationUrl } from "../../lib/utils";
import { ProfileHeaderSkeleton, ProfileObservationCardSkeleton, ProfileIdentificationCardSkeleton } from "../common/Skeletons";
import { usePageTitle } from "../../hooks/usePageTitle";

type ProfileTab = "observations" | "identifications";

export function ProfileView() {
  const { did } = useParams<{ did: string }>();
  const [data, setData] = useState<ProfileFeedResponse | null>(null);
  const [occurrences, setOccurrences] = useState<Occurrence[]>([]);
  const [identifications, setIdentifications] = useState<Identification[]>([]);
  const [cursor, setCursor] = useState<string | undefined>();
  const [hasMore, setHasMore] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProfileTab>("observations");

  usePageTitle(data?.profile.displayName || data?.profile.handle || "Profile");

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

        {/* Stats */}
        {counts && (
          <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
            <Box sx={{ textAlign: "center", flex: 1, bgcolor: "action.hover", borderRadius: 2, py: 1.5, px: 1 }}>
              <Typography variant="h6" fontWeight={700} color="primary.main">
                {counts.observations.toLocaleString()}
              </Typography>
              <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5} sx={{ mt: 0.5 }}>
                <CameraAltIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                <Typography variant="caption" color="text.secondary">
                  Observations
                </Typography>
              </Stack>
            </Box>
            <Box sx={{ textAlign: "center", flex: 1, bgcolor: "action.hover", borderRadius: 2, py: 1.5, px: 1 }}>
              <Typography variant="h6" fontWeight={700} color="secondary.main">
                {counts.identifications.toLocaleString()}
              </Typography>
              <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5} sx={{ mt: 0.5 }}>
                <FingerprintIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                <Typography variant="caption" color="text.secondary">
                  IDs
                </Typography>
              </Stack>
            </Box>
            <Box sx={{ textAlign: "center", flex: 1, bgcolor: "action.hover", borderRadius: 2, py: 1.5, px: 1 }}>
              <Typography variant="h6" fontWeight={700} color="success.main">
                {counts.species.toLocaleString()}
              </Typography>
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
        <Tab label="Observations" value="observations" />
        <Tab label="IDs" value="identifications" />
      </Tabs>

      {/* Observations Grid */}
      {activeTab === "observations" && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(2, 1fr)",
              sm: "repeat(3, 1fr)",
            },
            gap: 1.5,
            p: 1.5,
          }}
        >
          {occurrences.map((occ) => (
            <Card key={occ.uri} sx={{ display: "flex", flexDirection: "column" }}>
              <CardActionArea
                component={Link}
                to={getObservationUrl(occ.uri)}
                sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch" }}
              >
                {occ.images[0] ? (
                  <CardMedia
                    component="img"
                    image={getImageUrl(occ.images[0])}
                    alt={occ.communityId || occ.scientificName || "Observation"}
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
                    {occ.communityId || occ.scientificName || "Unknown species"}
                  </Typography>
                  <Typography variant="caption" color="text.disabled" noWrap>
                    {formatTimeAgo(new Date(occ.createdAt))}
                    {occ.verbatimLocality && ` · ${occ.verbatimLocality}`}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}

          {isLoading && occurrences.length === 0 && (
            <>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <ProfileObservationCardSkeleton key={i} />
              ))}
            </>
          )}
        </Box>
      )}

      {/* Identifications Grid */}
      {activeTab === "identifications" && (
        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "repeat(2, 1fr)",
              sm: "repeat(3, 1fr)",
            },
            gap: 1.5,
            p: 1.5,
          }}
        >
          {identifications.map((id) => (
            <Card key={id.uri} sx={{ display: "flex", flexDirection: "column" }}>
              <CardActionArea
                component={Link}
                to={getObservationUrl(id.subject_uri)}
                sx={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "stretch" }}
              >
                <Box
                  sx={{
                    py: 3,
                    px: 1.5,
                    bgcolor: "action.hover",
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    justifyContent: "center",
                    textAlign: "center",
                  }}
                >
                  <FingerprintIcon sx={{ fontSize: 28, color: "secondary.main", mb: 1 }} />
                  <Typography
                    variant="body2"
                    sx={{
                      fontStyle: "italic",
                      color: "primary.main",
                      fontWeight: 500,
                    }}
                  >
                    {id.scientific_name}
                  </Typography>
                  {id.vernacular_name && (
                    <Typography variant="caption" color="text.secondary">
                      {id.vernacular_name}
                    </Typography>
                  )}
                </Box>
                <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 }, flex: 1 }}>
                  {id.identification_remarks && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        mb: 0.5,
                      }}
                    >
                      {id.identification_remarks}
                    </Typography>
                  )}
                  <Typography variant="caption" color="text.disabled" noWrap>
                    {formatTimeAgo(new Date(id.date_identified))}
                    {id.is_agreement && " · Agrees"}
                  </Typography>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}

          {isLoading && identifications.length === 0 && (
            <>
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <ProfileIdentificationCardSkeleton key={i} />
              ))}
            </>
          )}
        </Box>
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
    </Container>
  );
}
