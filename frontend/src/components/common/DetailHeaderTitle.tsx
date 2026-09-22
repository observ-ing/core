import { Typography, type TypographyProps } from "@mui/material";

type DetailHeaderTitleProps = Omit<TypographyProps, "variant">;

/**
 * Title text for a detail-page header bar (`detailHeaderSx`/`stickyHeaderSx`
 * in layoutSx), shared by the observation and taxon detail headers so their
 * titles can't drift apart in size/weight the way they previously did.
 */
export function DetailHeaderTitle({ sx, ...props }: DetailHeaderTitleProps) {
  return <Typography variant="h6" sx={{ flex: 1, ...sx }} {...props} />;
}
