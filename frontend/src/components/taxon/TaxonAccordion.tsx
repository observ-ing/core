import type { ReactNode } from "react";
import { Accordion, AccordionSummary, AccordionDetails, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

// Card-style accordion shared by the taxon detail sections: bordered, rounded,
// and stripped of MUI's default elevation + divider so each section reads as a
// standalone card (matching the design mockup).
const cardSx: SxProps<Theme> = {
  borderRadius: "14px",
  border: 1,
  borderColor: "divider",
  backgroundColor: "background.paper",
  boxShadow: "0 1px 2px rgba(60,50,30,0.04)",
  "&:before": { display: "none" },
  "&.Mui-expanded": { margin: 0 },
};

interface TaxonAccordionProps {
  /** Section heading shown in the summary bar. */
  title: ReactNode;
  defaultExpanded?: boolean | undefined;
  /** Fired when the user expands/collapses the section. */
  onChange?: ((expanded: boolean) => void) | undefined;
  /** Extra styles merged onto the card (e.g. top margin between sections). */
  sx?: SxProps<Theme> | undefined;
  children: ReactNode;
}

/**
 * A bordered, rounded accordion "card" used for the Media, Description, and
 * References sections of the taxon detail panel. Owns the shared chrome
 * (summary label + expand icon); callers supply the body as children.
 */
export function TaxonAccordion({
  title,
  defaultExpanded,
  onChange,
  sx,
  children,
}: TaxonAccordionProps) {
  return (
    <Accordion
      disableGutters
      elevation={0}
      defaultExpanded={defaultExpanded}
      onChange={onChange ? (_e, expanded) => onChange(expanded) : undefined}
      sx={[cardSx, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
        <Typography variant="subtitle2" sx={{ color: "text.secondary" }}>
          {title}
        </Typography>
      </AccordionSummary>
      <AccordionDetails>{children}</AccordionDetails>
    </Accordion>
  );
}
