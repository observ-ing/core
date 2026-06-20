import { useState } from "react";
import {
  Box,
  Stack,
  Typography,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Collapse,
  IconButton,
} from "@mui/material";
import VerifiedOutlinedIcon from "@mui/icons-material/VerifiedOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CancelIcon from "@mui/icons-material/Cancel";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
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
  const allMet = metCount === CRITERIA.length;

  // When every criterion passes there's nothing actionable to show, so the
  // checklist starts collapsed and the header alone communicates the result.
  // Anything outstanding stays expanded so it's visible without a click.
  const [expanded, setExpanded] = useState(!allMet);

  return (
    <Box>
      <Stack
        direction="row"
        spacing={1}
        onClick={() => setExpanded((prev) => !prev)}
        sx={{
          alignItems: "center",
          mb: expanded ? 1 : 0,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <VerifiedOutlinedIcon fontSize="small" sx={{ color: "primary.main" }} />
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Data quality
        </Typography>
        <Typography variant="caption" sx={{ color: "text.secondary", ml: "auto" }}>
          {allMet ? "All criteria met" : `${metCount}/${CRITERIA.length}`}
        </Typography>
        <IconButton
          size="small"
          aria-label={expanded ? "Collapse data quality" : "Expand data quality"}
          sx={{
            p: 0.25,
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: (theme) => theme.transitions.create("transform"),
          }}
        >
          <ExpandMoreIcon fontSize="small" />
        </IconButton>
      </Stack>
      <Collapse in={expanded} unmountOnExit>
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
      </Collapse>
    </Box>
  );
}
