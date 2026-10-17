import { forwardRef } from "react";
import { Box } from "@mui/material";
import { mapContainerSx, MAPTILER_ENABLED } from "./mapStyle";
import { BasemapSelector } from "./BasemapSelector";

/**
 * Map container shell shared by LocationMap and LocationPicker: the maplibre
 * mount point plus the basemap selector overlay.
 */
export interface MapCanvasProps {
  /** Take whatever height a column flex parent has left, not the fixed default. */
  fill?: boolean;
}

export const MapCanvas = forwardRef<HTMLDivElement, MapCanvasProps>(function MapCanvas(
  { fill = false },
  ref,
) {
  return (
    <Box
      sx={[
        { position: "relative" },
        mapContainerSx,
        fill && { flex: "1 1 0", height: "auto", minHeight: 200 },
      ]}
    >
      {/* Fill the parent via width/height, NOT position:absolute+inset — maplibre
          adds `.maplibregl-map { position: relative }`, which ties on specificity
          with emotion's `position:absolute` and wins by load order in the prod CSS
          bundle, collapsing the container to height 0 (a blank map). */}
      <Box ref={ref} sx={{ width: "100%", height: "100%" }} />
      {MAPTILER_ENABLED && <BasemapSelector />}
    </Box>
  );
});
