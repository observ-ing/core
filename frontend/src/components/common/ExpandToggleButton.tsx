import { IconButton } from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

interface ExpandToggleButtonProps {
  expanded: boolean;
}

/**
 * The site-wide rotating chevron used to hint an expand/collapse toggle.
 * Purely visual — the click handler lives on the surrounding header.
 */
export function ExpandToggleButton({ expanded }: ExpandToggleButtonProps) {
  return (
    <IconButton
      size="small"
      aria-label={expanded ? "Collapse section" : "Expand section"}
      sx={{
        p: 0.25,
        transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
        transition: (theme) => theme.transitions.create("transform"),
      }}
    >
      <ExpandMoreIcon fontSize="small" />
    </IconButton>
  );
}
