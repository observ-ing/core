import { useState, type ReactNode } from "react";
import { Box, Collapse } from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import { Section, SectionHeader, SECTION_PADDING } from "./Section";
import { ExpandToggleButton } from "./ExpandToggleButton";

// The toggle target is the same box whether open or closed: the header row
// bleeds out to fill the card's full width and padding (negative top/side
// margins to the edges, matching padding to put the content back), giving a
// click area and hover highlight the size of the collapsed card. `borderRadius`
// matches the card so the highlight is a rounded rectangle in both states; the
// card's `overflow: hidden` clips its top corners flush to the card edge. There
// is deliberately no negative *bottom* margin: the row's own bottom padding is
// the full click target down to the body, and nothing overlaps it. The card
// drops its own bottom padding (`pb: 0` below) so the row still fills the card
// when collapsed, and the body supplies that padding back when expanded.
const headerSx: SxProps<Theme> = {
  mt: -SECTION_PADDING,
  mx: -SECTION_PADDING,
  p: SECTION_PADDING,
  borderRadius: 2,
  transition: (theme) => theme.transitions.create("background-color"),
  "&:hover": { bgcolor: "action.hover" },
};

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
    <Section sx={{ overflow: "hidden", pb: 0, ...sx }}>
      <SectionHeader
        onClick={toggle}
        expanded={expanded}
        {...(typeof title === "string" ? { "aria-label": title } : {})}
        {...(icon != null ? { icon } : {})}
        title={title}
        sx={headerSx}
        trailing={
          <>
            {trailing}
            <ExpandToggleButton expanded={expanded} />
          </>
        }
      />
      <Collapse in={expanded} unmountOnExit>
        {/*
          All of the expanded-only spacing lives here, inside the one element
          whose height MUI animates, so open/close is a single smooth height
          transition with no margin step on the header. `pt` is the gap between
          the header and the body; `pb` is the card's bottom padding, which the
          card itself drops (`pb: 0` above) so the collapsed card stays tight
          around the header.
        */}
        <Box sx={{ pt: 1.5, pb: SECTION_PADDING }}>{children}</Box>
      </Collapse>
    </Section>
  );
}
