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
