import { Box, IconButton } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import AccountTreeIcon from "@mui/icons-material/AccountTree";
import { stickyHeaderSx } from "../common/layoutSx";
import { DetailHeaderTitle } from "../common/DetailHeaderTitle";

interface TaxonDetailHeaderProps {
  /** Taxon rank, shown (capitalized) as the panel title — e.g. "Species". */
  rank: string;
  onBack: () => void;
  /** When provided, renders a tree-toggle button (mobile only). */
  onToggleTree?: (() => void) | undefined;
}

/**
 * Sticky, blurred sub-header for the taxon detail panel: a back button, the
 * taxon's rank as title, and (on mobile) a button to reveal the classification
 * tree drawer.
 */
export function TaxonDetailHeader({ rank, onBack, onToggleTree }: TaxonDetailHeaderProps) {
  return (
    <Box sx={stickyHeaderSx}>
      <IconButton onClick={onBack} sx={{ mr: 1 }} aria-label="Back">
        <ArrowBackIcon />
      </IconButton>
      <DetailHeaderTitle>{rank.charAt(0).toUpperCase() + rank.slice(1)}</DetailHeaderTitle>
      {onToggleTree && (
        <IconButton
          onClick={onToggleTree}
          sx={{ display: { xs: "inline-flex", md: "none" } }}
          aria-label="Classification tree"
        >
          <AccountTreeIcon />
        </IconButton>
      )}
    </Box>
  );
}
