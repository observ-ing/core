import { Link as RouterLink } from "react-router-dom";
import {
  Box,
  Typography,
  Avatar,
  Stack,
  Paper,
  Chip,
} from "@mui/material";
import type { Identification } from "../../services/types";

interface IdentificationHistoryProps {
  identifications: Identification[];
  subjectIndex?: number;
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
}: IdentificationHistoryProps) {
  // Filter identifications by subject index
  const filteredIds = identifications.filter(
    (id) => id.subject_index === subjectIndex
  );

  if (filteredIds.length === 0) {
    return (
      <Paper sx={{ p: 2, bgcolor: "background.paper" }}>
        <Typography variant="body2" color="text.secondary">
          No identifications yet. Be the first to suggest an ID!
        </Typography>
      </Paper>
    );
  }

  return (
    <Paper sx={{ p: 2, bgcolor: "background.paper" }}>
      <Typography variant="subtitle2" gutterBottom sx={{ mb: 2 }}>
        Identification History
      </Typography>
      <Stack spacing={2}>
        {filteredIds.map((id) => (
          <Box key={id.uri} sx={{ pl: 1, borderLeft: 2, borderColor: "divider" }}>
            <Stack direction="row" spacing={1.5} alignItems="flex-start">
              <RouterLink to={`/profile/${encodeURIComponent(id.identifier?.did || id.did)}`}>
                <Avatar
                  src={id.identifier?.avatar}
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
                  {id.is_agreement && (
                    <Chip label="Agrees" size="small" color="success" variant="outlined" />
                  )}
                </Stack>
                <Typography
                  variant="body2"
                  sx={{ fontStyle: "italic", color: "primary.main", mt: 0.5 }}
                >
                  {id.scientific_name}
                </Typography>
                {id.identification_remarks && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    "{id.identification_remarks}"
                  </Typography>
                )}
                {getConfidenceLabel((id as Identification & { confidence?: string }).confidence) && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                    {getConfidenceLabel((id as Identification & { confidence?: string }).confidence)}
                  </Typography>
                )}
              </Box>
            </Stack>
          </Box>
        ))}
      </Stack>
    </Paper>
  );
}
