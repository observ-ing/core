import { Box, Stack, Typography, List, ListItem, ListItemIcon, ListItemText } from "@mui/material";
import VerifiedOutlinedIcon from "@mui/icons-material/VerifiedOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import type { QualityIssue } from "../../bindings/QualityIssue";

interface DataQualitySectionProps {
  issues: QualityIssue[];
}

/**
 * The data-quality checklist. Each criterion is phrased as a positive
 * assertion and is "met" when the corresponding quality issue is absent.
 *
 * `met` is derived from the issue codes rather than a naive "not in list" so
 * dependent checks stay coherent — precision can't be met when the location is
 * missing entirely (the backend suppresses `COORDINATES_IMPRECISE` in that
 * case, which would otherwise read as a passing precision check).
 *
 * Copy lives here rather than in `bindings/` so the wire enum stays a thin
 * transport type.
 */
const CRITERIA: Array<{
  id: string;
  label: string;
  unmetDetail: string;
  met: (issues: Set<QualityIssue>) => boolean;
}> = [
  {
    id: "date",
    label: "Date specified",
    unmetDetail: "This observation doesn't record when it was made.",
    met: (issues) => !issues.has("MISSING_DATE"),
  },
  {
    id: "location",
    label: "Location specified",
    unmetDetail: "This observation doesn't have coordinates.",
    met: (issues) => !issues.has("MISSING_LOCATION"),
  },
  {
    id: "precise",
    label: "Location is precise",
    unmetDetail: "Coordinate uncertainty is missing or larger than 5 km.",
    met: (issues) => !issues.has("MISSING_LOCATION") && !issues.has("COORDINATES_IMPRECISE"),
  },
  {
    id: "media",
    label: "Has a photo or sound",
    unmetDetail: "This observation has no photos or sounds attached.",
    met: (issues) => !issues.has("MISSING_MEDIA"),
  },
  {
    id: "consensus",
    label: "Has a community ID",
    unmetDetail: "No consensus identification has emerged yet.",
    met: (issues) => !issues.has("NO_CONSENSUS_ID"),
  },
];

export function DataQualitySection({ issues }: DataQualitySectionProps) {
  const issueSet = new Set(issues);
  const metCount = CRITERIA.filter((criterion) => criterion.met(issueSet)).length;

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
        <VerifiedOutlinedIcon fontSize="small" sx={{ color: "primary.main" }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Data quality
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", ml: "auto" }}>
          {metCount}/{CRITERIA.length}
        </Typography>
      </Stack>
      <List disablePadding>
        {CRITERIA.map((criterion) => {
          const met = criterion.met(issueSet);
          return (
            <ListItem key={criterion.id} disableGutters alignItems="flex-start" sx={{ py: 0.25 }}>
              <ListItemIcon sx={{ minWidth: 32, mt: 0.25 }}>
                {met ? (
                  <CheckCircleIcon sx={{ fontSize: 18, color: "success.main" }} />
                ) : (
                  <CancelIcon sx={{ fontSize: 18, color: "warning.main" }} />
                )}
              </ListItemIcon>
              <ListItemText
                primary={criterion.label}
                secondary={met ? undefined : criterion.unmetDetail}
                slotProps={{
                  primary: {
                    variant: "body2",
                    color: met ? "text.primary" : "text.secondary",
                  },
                  secondary: { variant: "caption" },
                }}
              />
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
}
