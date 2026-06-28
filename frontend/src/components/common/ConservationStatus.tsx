import { Box, Chip, Tooltip, Typography } from "@mui/material";
import type {
  IUCNCategory,
  ConservationStatus as ConservationStatusType,
} from "../../services/types";
import {
  IUCN_CATEGORY_COLORS,
  IUCN_CHIP_TEXT_DARK,
  IUCN_CHIP_TEXT_LIGHT,
  IUCN_DARK_TEXT_CATEGORIES,
  IUCN_NE_BORDER_COLOR,
} from "../../theme/iucnColors";

interface ConservationStatusProps {
  status: ConservationStatusType;
  /** Show full label instead of abbreviation */
  showLabel?: boolean;
  /** Size variant */
  size?: "sm" | "md";
}

const CATEGORY_INFO: Record<string, { label: string; color: string }> = {
  EX: { label: "Extinct", color: IUCN_CATEGORY_COLORS.EX },
  EW: { label: "Extinct in the Wild", color: IUCN_CATEGORY_COLORS.EW },
  CR: { label: "Critically Endangered", color: IUCN_CATEGORY_COLORS.CR },
  EN: { label: "Endangered", color: IUCN_CATEGORY_COLORS.EN },
  VU: { label: "Vulnerable", color: IUCN_CATEGORY_COLORS.VU },
  NT: { label: "Near Threatened", color: IUCN_CATEGORY_COLORS.NT },
  LC: { label: "Least Concern", color: IUCN_CATEGORY_COLORS.LC },
  DD: { label: "Data Deficient", color: IUCN_CATEGORY_COLORS.DD },
  NE: { label: "Not Evaluated", color: IUCN_CATEGORY_COLORS.NE },
};

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
  const info = CATEGORY_INFO[status.category];
  if (!info) return null;

  const needsDarkText = IUCN_DARK_TEXT_CATEGORIES.has(status.category);
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
          backgroundColor: info.color,
          color: needsDarkText ? IUCN_CHIP_TEXT_DARK : IUCN_CHIP_TEXT_LIGHT,
          borderColor: status.category === "NE" ? IUCN_NE_BORDER_COLOR : info.color,
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
