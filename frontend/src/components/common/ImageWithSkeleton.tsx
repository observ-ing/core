import { useState } from "react";
import { Box, CardMedia, Skeleton } from "@mui/material";
import type { SxProps, Theme } from "@mui/material";

interface ImageWithSkeletonProps {
  src: string;
  alt: string;
  sx?: SxProps<Theme>;
  loading?: "lazy" | "eager";
}

export function ImageWithSkeleton({ src, alt, sx, loading = "lazy" }: ImageWithSkeletonProps) {
  const [loaded, setLoaded] = useState(false);

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
