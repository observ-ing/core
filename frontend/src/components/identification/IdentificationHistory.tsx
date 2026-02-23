import { useState } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Typography,
  Avatar,
  Stack,
  Paper,
  Chip,
  IconButton,
  Menu,
  MenuItem,
} from "@mui/material";
import HistoryIcon from "@mui/icons-material/History";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import type { Identification, Profile } from "../../services/types";
import { TaxonLink } from "../common/TaxonLink";
import { getPdslsUrl } from "../../lib/utils";

interface ObserverInitialId {
  scientificName: string;
  observer: Profile;
  date: string;
  kingdom?: string | undefined;
}

export interface IdentificationHistoryProps {
  identifications: Identification[];
  subjectIndex?: number | undefined;
  /** Fallback kingdom to use if identification doesn't have kingdom data */
  kingdom?: string | undefined;
  /** Observer's original scientificName from the observation payload */
  observerInitialId?: ObserverInitialId | undefined;
  /** Optional content rendered at the bottom of the panel (e.g. login prompt, add ID form) */
  footer?: React.ReactNode | undefined;
  /** Current user's DID, used to show delete button on own identifications */
  currentUserDid?: string | undefined;
  /** Called when an identification is deleted */
  onDeleteIdentification?: ((uri: string) => Promise<void>) | undefined;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

function getConfidenceLabel(confidence?: string): string {
  switch (confidence) {
    case "high":
      return "High confidence";
    case "low":
      return "Low confidence";
    default:
      return "";
  }
}

export function IdentificationHistory({
  identifications,
  subjectIndex = 0,
  kingdom,
  observerInitialId,
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
  // Filter identifications by subject index and sort oldest first
  const filteredIds = identifications
    .filter((id) => id.subject_index === subjectIndex)
    .sort((a, b) => new Date(a.date_identified).getTime() - new Date(b.date_identified).getTime());

  // Build set of superseded identification URIs (user has a newer ID)
  const supersededUris = new Set<string>();
  const latestByUser = new Map<string, Identification>();
  for (const id of filteredIds) {
    const existing = latestByUser.get(id.did);
    if (!existing || new Date(id.date_identified).getTime() > new Date(existing.date_identified).getTime()) {
      if (existing) supersededUris.add(existing.uri);
      latestByUser.set(id.did, id);
    } else {
      supersededUris.add(id.uri);
    }
  }

  // Only show observer's initial ID for subject 0
  const showObserverInitialId = observerInitialId && subjectIndex === 0;

  // Observer's initial ID is superseded if they have any later identification
  const observerInitialIdSuperseded = showObserverInitialId &&
    filteredIds.some((id) => id.did === observerInitialId.observer.did);

  if (filteredIds.length === 0 && !showObserverInitialId) {
    return (
      <Paper
        elevation={0}
        sx={{
          p: 2.5,
          bgcolor: "background.paper",
          borderRadius: 2,
          border: 1,
          borderColor: "divider",
        }}
      >
        <Typography variant="body2" color="text.secondary">
          No identifications yet. Be the first to suggest an ID!
        </Typography>
        {footer}
      </Paper>
    );
  }

  return (
    <Paper
      elevation={0}
      sx={{
        p: 2.5,
        bgcolor: "background.paper",
        borderRadius: 2,
        border: 1,
        borderColor: "divider",
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <HistoryIcon fontSize="small" sx={{ color: "primary.main" }} />
        <Typography variant="subtitle2" fontWeight={600}>
          Identification History
        </Typography>
        <Chip
          label={filteredIds.length + (showObserverInitialId ? 1 : 0)}
          size="small"
          sx={{ ml: "auto", height: 20, fontSize: "0.75rem" }}
        />
      </Stack>
      <Stack spacing={2}>
        {showObserverInitialId && (
          <Box
            key="observer-initial-id"
            sx={{
              pl: 2,
              borderLeft: 3,
              borderColor: observerInitialIdSuperseded ? "text.disabled" : "info.main",
              transition: "background-color 0.2s ease",
              borderRadius: "0 4px 4px 0",
              py: 1,
              opacity: observerInitialIdSuperseded ? 0.5 : 1,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <RouterLink to={`/profile/${encodeURIComponent(observerInitialId.observer.did)}`}>
                <Avatar
                  {...(observerInitialId.observer.avatar ? { src: observerInitialId.observer.avatar } : {})}
                  sx={{ width: 32, height: 32 }}
                >
                  {(observerInitialId.observer.displayName || observerInitialId.observer.handle || "?")[0]}
                </Avatar>
              </RouterLink>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <RouterLink
                    to={`/profile/${encodeURIComponent(observerInitialId.observer.did)}`}
                    style={{ textDecoration: "none" }}
                  >
                    <Typography variant="body2" fontWeight="medium" color="text.primary">
                      {observerInitialId.observer.displayName || observerInitialId.observer.handle || "Unknown"}
                    </Typography>
                  </RouterLink>
                  <Typography variant="caption" color="text.secondary">
                    {formatRelativeTime(observerInitialId.date)}
                  </Typography>
                  <Chip label="Observer's ID" size="small" color="info" variant="outlined" />
                </Stack>
                <Box sx={{ mt: 0.5, textDecoration: observerInitialIdSuperseded ? "line-through" : "none" }}>
                  <TaxonLink
                    name={observerInitialId.scientificName}
                    kingdom={observerInitialId.kingdom || kingdom}
                    rank="species"
                  />
                </Box>
              </Box>
            </Stack>
          </Box>
        )}
        {filteredIds.map((id) => {
          const isSuperseded = supersededUris.has(id.uri);
          return (
          <Box
            key={id.uri}
            sx={{
              pl: 2,
              borderLeft: 3,
              borderColor: isSuperseded ? "text.disabled" : id.is_agreement ? "success.main" : "primary.main",
              transition: "background-color 0.2s ease",
              borderRadius: "0 4px 4px 0",
              py: 1,
              opacity: isSuperseded ? 0.5 : 1,
              "&:hover": { bgcolor: "action.hover" },
            }}
          >
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <RouterLink to={`/profile/${encodeURIComponent(id.identifier?.did || id.did)}`}>
                <Avatar
                  {...(id.identifier?.avatar ? { src: id.identifier.avatar } : {})}
                  sx={{ width: 32, height: 32 }}
                >
                  {(id.identifier?.displayName || id.identifier?.handle || "?")[0]}
                </Avatar>
              </RouterLink>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                  <RouterLink
                    to={`/profile/${encodeURIComponent(id.identifier?.did || id.did)}`}
                    style={{ textDecoration: "none" }}
                  >
                    <Typography variant="body2" fontWeight="medium" color="text.primary">
                      {id.identifier?.displayName || id.identifier?.handle || "Unknown"}
                    </Typography>
                  </RouterLink>
                  <Typography variant="caption" color="text.secondary">
                    {formatRelativeTime(id.date_identified)}
                  </Typography>
                  {isSuperseded && (
                    <Chip label="Superseded" size="small" variant="outlined" />
                  )}
                  {!isSuperseded && id.is_agreement && (
                    <Chip label="Agrees" size="small" color="success" variant="outlined" />
                  )}
                </Stack>
                <Box sx={{ mt: 0.5, textDecoration: isSuperseded ? "line-through" : "none" }}>
                  <TaxonLink
                    name={id.scientific_name}
                    kingdom={id.kingdom || kingdom}
                    rank={id.taxon_rank || "species"}
                  />
                </Box>
                {id.identification_remarks && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    "{id.identification_remarks}"
                  </Typography>
                )}
                {getConfidenceLabel(id.confidence) && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                    {getConfidenceLabel(id.confidence)}
                  </Typography>
                )}
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
      {footer}
    </Paper>
  );
}
