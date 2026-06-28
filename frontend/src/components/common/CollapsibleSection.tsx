import { useState, type ReactNode } from "react";
import { Collapse, IconButton } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { Section, SectionHeader } from "./Section";

interface CollapsibleSectionProps {
  title: ReactNode;
  /** Optional leading icon (caller sets its color, typically `primary.main`). */
  icon?: ReactNode;
  /** Extra trailing content (e.g. a count chip), shown before the chevron. */
  trailing?: ReactNode;
  defaultExpanded?: boolean;
  /** Fired the first time the section expands — for lazy-mounting heavy bodies. */
  onFirstExpand?: () => void;
  /** Extra styles merged onto the {@link Section} card. */
  sx?: SxProps<Theme> | undefined;
  children: ReactNode;
}

/**
 * A bordered {@link Section} card whose body collapses behind a clickable
 * header with a rotating chevron — the site-wide collapsible-section pattern,
 * extracted so callers don't re-implement the expand state + chevron each time.
 */
export function CollapsibleSection({
  title,
  icon,
  trailing,
  defaultExpanded = false,
  onFirstExpand,
  sx,
  children,
}: CollapsibleSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [hasExpanded, setHasExpanded] = useState(defaultExpanded);

  const toggle = () => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && !hasExpanded) {
        setHasExpanded(true);
        onFirstExpand?.();
      }
      return next;
    });
  };

  return (
    <Section sx={sx}>
      <SectionHeader
        onClick={toggle}
        {...(icon != null ? { icon } : {})}
        title={title}
        sx={{ mb: expanded ? 1.5 : 0 }}
        trailing={
          <>
            {trailing}
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
          </>
        }
      />
      <Collapse in={expanded} unmountOnExit>
        {children}
      </Collapse>
    </Section>
  );
}
