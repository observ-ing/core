import { Stack, Chip, Tooltip } from "@mui/material";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import type { QualityIssue } from "../../bindings/QualityIssue";

interface QualityIssueBadgesProps {
  issues: QualityIssue[];
}

/**
 * User-facing label + explanation for each issue code. Kept here rather than
 * in `bindings/` so the wire enum stays a thin transport type — copy lives
 * with the component that renders it.
 */
const ISSUE_COPY: Record<QualityIssue, { label: string; tooltip: string }> = {
  MISSING_DATE: {
    label: "No date",
    tooltip: "This observation doesn't record when it was made.",
  },
  MISSING_LOCATION: {
    label: "No location",
    tooltip: "This observation doesn't have coordinates.",
  },
  MISSING_MEDIA: {
    label: "No photo",
    tooltip: "This observation has no photos or sounds attached.",
  },
  COORDINATES_IMPRECISE: {
    label: "Imprecise location",
    tooltip: "Coordinate uncertainty is missing or larger than 5 km.",
  },
  NO_CONSENSUS_ID: {
    label: "No community ID",
    tooltip: "No consensus identification has emerged yet.",
  },
};

export function QualityIssueBadges({ issues }: QualityIssueBadgesProps) {
  if (issues.length === 0) return null;
  return (
    <Stack direction="row" spacing={0.75} sx={{ flexWrap: "wrap", gap: 0.75 }}>
      {issues.map((issue) => {
        const copy = ISSUE_COPY[issue];
        return (
          <Tooltip key={issue} title={copy.tooltip}>
            <Chip
              size="small"
              icon={<WarningAmberIcon />}
              label={copy.label}
              color="warning"
              variant="outlined"
            />
          </Tooltip>
        );
      })}
    </Stack>
  );
}
