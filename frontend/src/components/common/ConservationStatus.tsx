import { Box, Chip, Tooltip, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";
import type {
  IUCNCategory,
  ConservationStatus as ConservationStatusType,
} from "../../services/types";

interface ConservationStatusProps {
  status: ConservationStatusType;
  /** Show full label instead of abbreviation */
  showLabel?: boolean;
  /** Size variant */
  size?: "sm" | "md";
}

const CATEGORY_INFO: Record<string, { label: string }> = {
  EX: { label: "Extinct" },
  EW: { label: "Extinct in the Wild" },
  CR: { label: "Critically Endangered" },
  EN: { label: "Endangered" },
  VU: { label: "Vulnerable" },
  NT: { label: "Near Threatened" },
  LC: { label: "Least Concern" },
  DD: { label: "Data Deficient" },
  NE: { label: "Not Evaluated" },
};

const DARK_TEXT_CATEGORIES: ReadonlySet<string> = new Set(["VU", "NT", "LC", "DD", "NE"]);

const SOURCE_INFO: Record<string, { name: string; fullName: string }> = {
  IUCN: {
    name: "IUCN Red List",
    fullName: "International Union for Conservation of Nature",
  },
};

/**
 * Displays IUCN Red List conservation status as a colored badge
 */
export function ConservationStatus({
  status,
  showLabel = false,
  size = "md",
}: ConservationStatusProps) {
  const theme = useTheme();
  const info = CATEGORY_INFO[status.category];
  if (!info) return null;

  const iucnColor = theme.palette.iucn[status.category];
  const needsDarkText = DARK_TEXT_CATEGORIES.has(status.category);
  const source = SOURCE_INFO[status.source];

  const tooltipContent = (
    <Box sx={{ py: 0.25 }}>
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {info.label}
      </Typography>
      <Typography variant="caption" sx={{ display: "block", opacity: 0.85 }}>
        {source ? `Classified by ${source.name}` : `Classified by ${status.source}`}
      </Typography>
      {source && (
        <Typography variant="caption" sx={{ display: "block", opacity: 0.7, fontStyle: "italic" }}>
          {source.fullName}
        </Typography>
      )}
    </Box>
  );

  return (
    <Tooltip title={tooltipContent} arrow enterTouchDelay={0} leaveTouchDelay={4000}>
      <Chip
        label={showLabel ? info.label : status.category}
        size={size === "sm" ? "small" : "medium"}
        sx={{
          backgroundColor: iucnColor,
          color: needsDarkText ? "common.black" : "common.white",
          borderColor: status.category === "NE" ? theme.palette.iucn["DD"] : iucnColor,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.025em",
          fontSize: size === "sm" ? "0.625rem" : "0.75rem",
          cursor: "help",
        }}
      />
    </Tooltip>
  );
}

/**
 * Returns the display info for an IUCN category
 */
export function getConservationInfo(category: IUCNCategory) {
  return CATEGORY_INFO[category];
}

export type { ConservationStatusProps };
