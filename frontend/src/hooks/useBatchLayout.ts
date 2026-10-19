import { useMediaQuery, useTheme } from "@mui/material";

export interface BatchLayout {
  /** The primary pointer is a finger: no hover, and dragging starts with a long press. */
  touch: boolean;
  /**
   * Narrow and touch: the full-screen phone layout, not the grid with a side
   * panel. A narrow window with a mouse keeps the wide layout.
   */
  phone: boolean;
  /**
   * A long press can start a drag. Firefox on Android only drags with a mouse,
   * so there the uploader offers its buttons and doesn't mention touch and hold.
   */
  touchDrag: boolean;
}

const dragsByTouch = () => {
  const agent = navigator.userAgent;
  return !(/Android/i.test(agent) && /Firefox\//.test(agent));
};

/** Which of the batch uploader's layouts fits this screen and pointer (#887). */
export function useBatchLayout(): BatchLayout {
  const theme = useTheme();
  // Read at once, not after the first paint, so the page doesn't draw one
  // layout and then swap to the other.
  const touch = useMediaQuery("(pointer: coarse)", { noSsr: true });
  const narrow = useMediaQuery(theme.breakpoints.down("md"), { noSsr: true });
  return { touch, phone: touch && narrow, touchDrag: dragsByTouch() };
}
