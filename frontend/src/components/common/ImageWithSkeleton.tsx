import { useState } from "react";
import { Box, CardMedia, Skeleton, Typography } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

interface ImageWithSkeletonProps {
  src?: string | undefined;
  alt: string;
  sx?: SxProps<Theme>;
  loading?: "lazy" | "eager";
  emptyText?: string;
}

export function ImageWithSkeleton({
  src,
  alt,
  sx,
  loading = "lazy",
  emptyText = "No image",
}: ImageWithSkeletonProps) {
  const [loaded, setLoaded] = useState(false);

  if (!src) {
    return (
      <Box
        sx={{
          // Warm parchment fill rather than MUI's cool black-alpha grey, so
          // empty tiles sit in the bone/forest palette instead of clashing.
          bgcolor: "placeholder",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          ...sx,
        }}
      >
        <Typography variant="body2" sx={{ color: "text.disabled" }}>
          {emptyText}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ position: "relative", overflow: "hidden", ...sx }}>
      {!loaded && (
        <Skeleton
          variant="rectangular"
          animation="wave"
          sx={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
        />
      )}
      <CardMedia
        component="img"
        image={src}
        alt={alt}
        loading={loading}
        onLoad={() => setLoaded(true)}
        sx={{
          width: "100%",
          height: "100%",
          objectFit: "cover",
          opacity: loaded ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
      />
    </Box>
  );
}
