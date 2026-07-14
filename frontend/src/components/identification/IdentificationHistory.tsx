import { Link as RouterLink } from "react-router-dom";
import { Box, Typography, Avatar, Stack, Chip, Link as MuiLink } from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import { countChipSx } from "../common/chipSx";
import { accentListItemSx } from "../common/layoutSx";
import type { Identification } from "../../services/types";
import { TaxonLink } from "../common/TaxonLink";
import { RelativeTime } from "../common/RelativeTime";
import { Section, SectionHeader } from "../common/Section";
import { RecordOverflowMenu } from "../common/RecordOverflowMenu";

export interface IdentificationHistoryProps {
  identifications: Identification[];
  /** Fallback kingdom to use if identification doesn't have kingdom data */
  kingdom?: string | undefined;
  /** DID of the observation's creator, used to show "Observer's ID" badge */
  observerDid?: string | undefined;
  /** Optional content rendered at the bottom of the panel (e.g. login prompt, add ID form) */
  footer?: React.ReactNode | undefined;
  /** Current user's DID, used to show delete button on own identifications */
  currentUserDid?: string | undefined;
  /** Called when an identification is deleted */
  onDeleteIdentification?: ((uri: string) => Promise<void>) | undefined;
}

export function IdentificationHistory({
  identifications,
  kingdom,
  observerDid,
  footer,
  currentUserDid,
  onDeleteIdentification,
}: IdentificationHistoryProps) {
  // Sort oldest first
  const sortedIds = [...identifications].sort(
    (a, b) => new Date(a.date_identified).getTime() - new Date(b.date_identified).getTime(),
  );

  // Build set of superseded identification URIs (user has a newer ID)
  const supersededUris = new Set<string>();
  const latestByUser = new Map<string, Identification>();
  for (const id of sortedIds) {
    const existing = latestByUser.get(id.did);
    if (
      !existing ||
      new Date(id.date_identified).getTime() > new Date(existing.date_identified).getTime()
    ) {
      if (existing) supersededUris.add(existing.uri);
      latestByUser.set(id.did, id);
    } else {
      supersededUris.add(id.uri);
    }
  }

  // Find the observer's earliest (first) identification for the "Observer's ID" badge
  const observerFirstIdUri = observerDid
    ? sortedIds.find((id) => id.did === observerDid)?.uri
    : undefined;

  return (
    <Section>
      <SectionHeader
        icon={<HistoryIcon fontSize="small" sx={{ color: "primary.main" }} />}
        title="Identification History"
        sx={{ mb: 2 }}
        {...(sortedIds.length > 0
          ? {
              trailing: <Chip label={sortedIds.length} size="small" sx={countChipSx} />,
            }
          : {})}
      />
      {sortedIds.length === 0 ? (
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
          }}
        >
          No identifications yet. Be the first to suggest an ID!
        </Typography>
      ) : (
        <Stack spacing={2}>
          {sortedIds.map((id) => {
            const isSuperseded = supersededUris.has(id.uri);
            return (
              <Box
                key={id.uri}
                sx={{
                  ...accentListItemSx,
                  borderColor: isSuperseded ? "text.disabled" : "primary.main",
                  transition: "background-color 0.2s ease",
                  opacity: isSuperseded ? 0.5 : 1,
                  "&:hover": { bgcolor: "action.hover" },
                }}
              >
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{
                    alignItems: "flex-start",
                  }}
                >
                  <RouterLink to={`/profile/${encodeURIComponent(id.identifier?.did || id.did)}`}>
                    <Avatar
                      {...(id.identifier?.avatar ? { src: id.identifier.avatar } : {})}
                      sx={{ width: 32, height: 32 }}
                    >
                      {(id.identifier?.displayName || id.identifier?.handle || "?")[0]}
                    </Avatar>
                  </RouterLink>
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack
                      direction="row"
                      spacing={1}
                      sx={{
                        alignItems: "center",
                        flexWrap: "wrap",
                      }}
                    >
                      <MuiLink
                        component={RouterLink}
                        to={`/profile/${encodeURIComponent(id.identifier?.did || id.did)}`}
                        underline="none"
                        color="inherit"
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: "medium",
                            color: "text.primary",
                          }}
                        >
                          {id.identifier?.displayName || id.identifier?.handle || "Unknown"}
                        </Typography>
                      </MuiLink>
                      <Typography
                        variant="caption"
                        sx={{
                          color: "text.secondary",
                        }}
                      >
                        <RelativeTime date={new Date(id.date_identified)} withAgo />
                      </Typography>
                      {id.uri === observerFirstIdUri && (
                        <Chip label="Observer's ID" size="small" color="info" variant="outlined" />
                      )}
                      {isSuperseded && <Chip label="Superseded" size="small" variant="outlined" />}
                    </Stack>
                    <Box sx={{ mt: 0.5, textDecoration: isSuperseded ? "line-through" : "none" }}>
                      <TaxonLink
                        name={id.scientific_name}
                        kingdom={id.kingdom || kingdom}
                        rank={id.taxon_rank}
                      />
                    </Box>
                  </Box>
                  <Box sx={{ alignSelf: "flex-start", mt: 0.5 }}>
                    <RecordOverflowMenu
                      atUri={id.uri}
                      sx={{ p: 0.5 }}
                      {...(currentUserDid && id.did === currentUserDid && onDeleteIdentification
                        ? { onDelete: () => onDeleteIdentification(id.uri) }
                        : {})}
                    />
                  </Box>
                </Stack>
              </Box>
            );
          })}
        </Stack>
      )}
      {footer}
    </Section>
  );
}
