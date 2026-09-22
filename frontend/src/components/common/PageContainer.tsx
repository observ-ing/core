import type { ReactNode, Ref, UIEventHandler } from "react";
import { Box, Container } from "@mui/material";
import type { ContainerProps } from "@mui/material";

export interface PageContainerProps {
  /** Passed through to the inner `Container`. */
  maxWidth?: ContainerProps["maxWidth"];
  /** Ref on the scrollable outer `Box`, for pages that track scroll position (e.g. infinite scroll). */
  scrollRef?: Ref<HTMLDivElement>;
  /** Scroll handler on the outer `Box`. */
  onScroll?: UIEventHandler<HTMLDivElement>;
  children: ReactNode;
}

/**
 * Scrollable full-height page shell (Box + Container) shared by top-level
 * pages (Notifications, Settings, Transparency, Docs) so the outer chrome
 * isn't hand-copied per page.
 */
export function PageContainer({
  maxWidth = "sm",
  scrollRef,
  onScroll,
  children,
}: PageContainerProps) {
  return (
    <Box ref={scrollRef} onScroll={onScroll} sx={{ flex: 1, overflow: "auto", height: "100%" }}>
      <Container maxWidth={maxWidth} sx={{ py: 3 }}>
        {children}
      </Container>
    </Box>
  );
}
