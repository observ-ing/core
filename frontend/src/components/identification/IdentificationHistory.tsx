import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Typography,
  Avatar,
  Stack,
  Chip,
  IconButton,
  Link as MuiLink,
  Menu,
  MenuItem,
} from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import { countChipSx } from "../common/chipSx";
import { accentListItemSx } from "../common/layoutSx";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import type { Identification } from "../../services/types";
import { TaxonLink } from "../common/TaxonLink";
import { getPdslsUrl } from "../../lib/utils";
import { RelativeTime } from "../common/RelativeTime";
import { Section, SectionHeader } from "../common/Section";

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
  const [deletingUri, setDeletingUri] = useState<string | null>(null);
  const [menuAnchorEl, setMenuAnchorEl] = useState<Record<string, HTMLElement | null>>({});

  const handleMenuOpen = (uri: string, event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl((prev) => ({ ...prev, [uri]: event.currentTarget }));
  };

  const handleMenuClose = (uri: string) => {
    setMenuAnchorEl((prev) => ({ ...prev, [uri]: null }));
  };
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
                    <IconButton
                      size="small"
                      onClick={(e) => handleMenuOpen(id.uri, e)}
                      aria-label="More options"
                      sx={{ color: "text.disabled", p: 0.5 }}
                    >
                      <MoreVertIcon fontSize="small" />
                    </IconButton>
                    <Menu
                      anchorEl={menuAnchorEl[id.uri]}
                      open={Boolean(menuAnchorEl[id.uri])}
                      onClose={() => handleMenuClose(id.uri)}
                      anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                      transformOrigin={{ vertical: "top", horizontal: "right" }}
                    >
                      <MenuItem
                        component="a"
                        href={getPdslsUrl(id.uri)}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={() => handleMenuClose(id.uri)}
                      >
                        View on AT Protocol
                      </MenuItem>
                      {currentUserDid && id.did === currentUserDid && onDeleteIdentification && (
                        <MenuItem
                          onClick={async () => {
                            handleMenuClose(id.uri);
                            setDeletingUri(id.uri);
                            try {
                              await onDeleteIdentification(id.uri);
                            } finally {
                              setDeletingUri(null);
                            }
                          }}
                          disabled={deletingUri === id.uri}
                          sx={{ color: "error.main" }}
                        >
                          Delete
                        </MenuItem>
                      )}
                    </Menu>
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
