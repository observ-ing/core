import type { StyleSpecification } from "maplibre-gl";
import type { SxProps, Theme } from "@mui/material";

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
export const darkMapFilter: SxProps<Theme> = {
  "& .maplibregl-canvas": {
    filter: "invert(1) hue-rotate(180deg)",
  },
};
