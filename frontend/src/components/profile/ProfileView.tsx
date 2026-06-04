import { useState } from "react";
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
  CardContent,
} from "@mui/material";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import CameraAltIcon from "@mui/icons-material/CameraAlt";
import FingerprintIcon from "@mui/icons-material/Fingerprint";
import GrassIcon from "@mui/icons-material/Grass";
import { getImageUrl } from "../../services/api";
import { useProfileFeed } from "../../lib/query/hooks";
import { getDisplayName, getObservationUrl } from "../../lib/utils";
import { RelativeTime } from "../common/RelativeTime";
import { shouldItalicizeTaxonName } from "../common/TaxonLink";
import { ImageWithSkeleton } from "../common/ImageWithSkeleton";
import { ProfileHeaderSkeleton } from "./ProfileHeaderSkeleton";
import { ProfileObservationCardSkeleton } from "./ProfileObservationCardSkeleton";
import { ProfileIdentificationCardSkeleton } from "./ProfileIdentificationCardSkeleton";
import { PROFILE_HEADER_SX, PROFILE_STAT_BOX_SX, PROFILE_AVATAR_SIZE } from "./profileLayout";
import { usePageTitle } from "../../hooks/usePageTitle";

type ProfileTab = "observations" | "identifications";

export function ProfileView() {
  const { did } = useParams<{ did: string }>();
  const [activeTab, setActiveTab] = useState<ProfileTab>("observations");

  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage, error } = useProfileFeed(
    did ?? "",
    activeTab,
  );

  const profile = data?.pages[0]?.profile;
  const counts = data?.pages[0]?.counts;
  const occurrences = data?.pages.flatMap((p) => p.occurrences) ?? [];
  const identifications = data?.pages.flatMap((p) => p.identifications) ?? [];
  const hasMore = hasNextPage;

  usePageTitle(profile?.displayName || profile?.handle || "Profile");

  if (!did) {
    return (
      <Container maxWidth="md" sx={{ p: 4 }}>
        <Typography
          sx={{
            color: "text.secondary",
          }}
        >
          Profile not found
        </Typography>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="md" sx={{ p: 4 }}>
        <Typography color="error">
          {error instanceof Error ? error.message : "Failed to load profile"}
        </Typography>
      </Container>
    );
  }

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
        <Box sx={PROFILE_HEADER_SX}>
          <Stack
            direction="row"
            spacing={2}
            sx={{
              alignItems: "center",
            }}
          >
            <Avatar
              {...(profile?.avatar ? { src: profile.avatar } : {})}
              alt={profile?.displayName || profile?.handle || did}
              sx={{ width: PROFILE_AVATAR_SIZE, height: PROFILE_AVATAR_SIZE }}
            />
            <Box>
              <Typography
                variant="h5"
                sx={{
                  fontWeight: 600,
                }}
              >
                {getDisplayName({ ...profile, did })}
              </Typography>
              {profile?.handle && (
                <Typography
                  sx={{
                    color: "text.disabled",
                  }}
                >
                  @{profile.handle}
                </Typography>
              )}
            </Box>
          </Stack>

          {/* Stats */}
          {counts && (
            <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
              <Box sx={PROFILE_STAT_BOX_SX}>
                <Typography
                  variant="h6"
                  component="span"
                  sx={{
                    fontWeight: 700,
                    color: "primary.main",
                  }}
                >
                  {counts.observations.toLocaleString()}
                </Typography>
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{
                    alignItems: "center",
                    justifyContent: "center",
                    mt: 0.5,
                  }}
                >
                  <CameraAltIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                    }}
                  >
                    Observations
                  </Typography>
                </Stack>
              </Box>
              <Box sx={PROFILE_STAT_BOX_SX}>
                <Typography
                  variant="h6"
                  component="span"
                  sx={{
                    fontWeight: 700,
                    color: "secondary.main",
                  }}
                >
                  {counts.identifications.toLocaleString()}
                </Typography>
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{
                    alignItems: "center",
                    justifyContent: "center",
                    mt: 0.5,
                  }}
                >
                  <FingerprintIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                    }}
                  >
                    IDs
                  </Typography>
                </Stack>
              </Box>
              <Box sx={PROFILE_STAT_BOX_SX}>
                <Typography
                  variant="h6"
                  component="span"
                  sx={{
                    fontWeight: 700,
                    color: "success.main",
                  }}
                >
                  {counts.species.toLocaleString()}
                </Typography>
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{
                    alignItems: "center",
                    justifyContent: "center",
                    mt: 0.5,
                  }}
                >
                  <GrassIcon sx={{ fontSize: 14, color: "text.secondary" }} />
                  <Typography
                    variant="caption"
                    sx={{
                      color: "text.secondary",
                    }}
                  >
                    Species
                  </Typography>
                </Stack>
              </Box>
            </Stack>
          )}

          {/* AT Protocol Link */}
          <Button
            component="a"
            href={`https://pdsls.dev/at://${did}/bio.lexicons.temp.v0-1.occurrence`}
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
                <ImageWithSkeleton
                  src={occ.images[0] ? getImageUrl(occ.images[0].url) : undefined}
                  alt={occ.communityId || occ.effectiveTaxonomy?.scientificName || "Observation"}
                  sx={{ aspectRatio: "1" }}
                />
                <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 }, flex: 1 }}>
                  <Typography
                    variant="body2"
                    sx={{
                      fontStyle: shouldItalicizeTaxonName(
                        occ.communityId || occ.effectiveTaxonomy?.scientificName || "",
                        occ.effectiveTaxonomy?.rank,
                      )
                        ? "italic"
                        : "normal",
                      color: "primary.main",
                      fontWeight: 500,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {occ.communityId || occ.effectiveTaxonomy?.scientificName || "Unknown species"}
                  </Typography>
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{
                      color: "text.disabled",
                    }}
                  >
                    <RelativeTime date={new Date(occ.createdAt)} />
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
                      fontStyle: shouldItalicizeTaxonName(id.scientific_name, id.taxon_rank)
                        ? "italic"
                        : "normal",
                      color: "primary.main",
                      fontWeight: 500,
                    }}
                  >
                    {id.scientific_name}
                  </Typography>
                </Box>
                <CardContent sx={{ p: 1.5, "&:last-child": { pb: 1.5 }, flex: 1 }}>
                  <Typography
                    variant="caption"
                    noWrap
                    sx={{
                      color: "text.disabled",
                    }}
                  >
                    <RelativeTime date={new Date(id.date_identified)} />
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
      {isFetchingNextPage && (
        <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
          <CircularProgress color="primary" size={24} />
        </Box>
      )}
      {!isLoading && occurrences.length === 0 && identifications.length === 0 && (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography
            sx={{
              color: "text.secondary",
            }}
          >
            No activity yet
          </Typography>
        </Box>
      )}
      {hasMore && !isLoading && !isFetchingNextPage && (
        <Box sx={{ p: 2, textAlign: "center" }}>
          <Button variant="outlined" onClick={() => void fetchNextPage()}>
            Load more
          </Button>
        </Box>
      )}
    </Container>
  );
}
