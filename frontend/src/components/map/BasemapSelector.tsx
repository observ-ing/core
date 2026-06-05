import { useState } from "react";
import { IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Tooltip } from "@mui/material";
import LayersIcon from "@mui/icons-material/Layers";
import CheckIcon from "@mui/icons-material/Check";
import { BASEMAPS } from "./mapStyle";
import { useBasemap } from "./useBasemap";

/**
 * Floating control (bottom-left of the map) for switching the basemap. The
 * choice is persisted and shared across every map in the app via useBasemap.
 */
export function BasemapSelector() {
  const [basemap, setBasemap] = useBasemap();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  return (
    <>
      <Tooltip title="Basemap">
        <IconButton
          size="small"
          aria-label="Choose basemap"
          onClick={(e) => setAnchorEl(e.currentTarget)}
          sx={{
            position: "absolute",
            bottom: 8,
            left: 8,
            zIndex: 1,
            color: "text.primary",
            bgcolor: "background.paper",
            boxShadow: 2,
            "&:hover": { bgcolor: "background.paper" },
          }}
        >
          <LayersIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {BASEMAPS.map((b) => (
          <MenuItem
            key={b.id}
            selected={b.id === basemap}
            onClick={() => {
              setBasemap(b.id);
              setAnchorEl(null);
            }}
          >
            <ListItemIcon>{b.id === basemap ? <CheckIcon fontSize="small" /> : null}</ListItemIcon>
            <ListItemText>{b.label}</ListItemText>
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
