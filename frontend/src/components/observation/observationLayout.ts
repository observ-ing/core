import type { SxProps, Theme } from "@mui/material";

/** Backdrop panel around the photo, shared between ObservationDetail and ObservationDetailSkeleton */
export const OBSERVATION_PHOTO_STAGE_SX: SxProps<Theme> = {
  bgcolor: (theme) => theme.palette.overlay["backdrop"],
  p: { xs: 0, sm: 2 },
};

/** Rounding of the photo inside the stage (flush to the edges on mobile) */
export const OBSERVATION_PHOTO_RADIUS = { xs: 0, sm: 2 } as const;

/** Max height of the main observation photo */
export const OBSERVATION_PHOTO_MAX_HEIGHT = 400;

/** License caption line under the photo */
export const OBSERVATION_PHOTO_LICENSE_SX = {
  display: "block",
  textAlign: "center",
  px: 1,
  pt: { xs: 1, sm: 0.5 },
} as const;

/** Species / vernacular-name block at the top of the identity header */
export const OBSERVATION_SPECIES_HEADER_SX = { px: 3, pt: 2, pb: 1.5 } as const;

/** Inset divider between the species block and the observer row */
export const OBSERVATION_HEADER_DIVIDER_SX = { mx: 3 } as const;

/** Observer (avatar, name, date) row with the like control */
export const OBSERVATION_OBSERVER_ROW_SX = { alignItems: "center", px: 3, py: 1.5 } as const;

/** Padding around the stack of section cards below the photo */
export const OBSERVATION_CONTENT_SX = { p: { xs: 2, sm: 3 } } as const;

/** Vertical spacing between the section cards */
export const OBSERVATION_SECTION_SPACING = 2.5;
