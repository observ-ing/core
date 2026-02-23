import { Box } from "@mui/material";

export interface WikiTaxonThumbnailProps {
  /** Pre-resolved thumbnail URL (from batch Wikidata fetch). */
  src?: string | undefined;
  size?: number | undefined;
}

export function WikiTaxonThumbnail({
  src,
  size = 24,
}: WikiTaxonThumbnailProps) {
  if (!src) {
    return (
      <Box
        sx={{
          width: size,
          height: size,
          minWidth: size,
          borderRadius: "4px",
        }}
      />
    );
  }

  return (
    <Box
      component="img"
      src={src}
      alt=""
      sx={{
        width: size,
        height: size,
        minWidth: size,
        borderRadius: "4px",
        objectFit: "cover",
      }}
    />
  );
}
