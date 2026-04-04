import type { StyleSpecification } from "maplibre-gl";
import type { Theme } from "@mui/material";
import type { SystemStyleObject } from "@mui/system";

export const mapStyle: StyleSpecification = {
  version: 8,
  sources: {
    carto: {
      type: "raster",
      tiles: [
        "https://a.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://b.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://c.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
        "https://d.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}@2x.png",
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/">CARTO</a>',
    },
  },
  layers: [
    {
      id: "carto",
      type: "raster",
      source: "carto",
    },
  ],
};

/** CSS filter applied to the map canvas to invert Voyager tiles for dark mode. */
export const darkMapFilter: SystemStyleObject<Theme> = {
  "& .maplibregl-canvas": {
    filter: "invert(1) hue-rotate(180deg)",
  },
};

/** Shared styles for the map container element. */
export const mapContainerSx: SystemStyleObject<Theme> = {
  width: "100%",
  height: 200,
  borderRadius: 1,
  overflow: "hidden",
  border: 1,
  borderColor: "divider",
};
