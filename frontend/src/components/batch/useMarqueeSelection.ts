// Rubber-band selection for the batch uploader's grid: press on the page
// background and drag out a rectangle; the cards it touches are selected.
//
// The rectangle's starting corner is tied to the scrolling content, not the
// screen, so it grows as the grid scrolls (by wheel, or by holding the pointer
// at an edge). Both corners are kept inside the area where cards are visible,
// so the rectangle only ever covers content that has actually been swept.
import { useRef, useState, type MouseEvent, type RefObject } from "react";
import { intersectRects, type Rect } from "../../lib/batchUpload";
import { OBSERVATION_ID } from "./BatchCard";

/** How far the pointer must travel before a press becomes a rectangle. */
const THRESHOLD_PX = 5;
/** Distance from the top or bottom edge at which the grid starts to scroll. */
const EDGE_PX = 48;
/** Fastest auto-scroll, in pixels per frame. */
const MAX_SPEED_PX = 24;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

interface MarqueeOptions {
  /** The page's always-scrollable area. */
  bodyRef: RefObject<HTMLElement | null>;
  /** The grid column, which scrolls on its own in the wide layout. */
  sectionRef: RefObject<HTMLElement | null>;
  /** The control row pinned over the top of the cards, when shown. */
  controlsRef: RefObject<HTMLElement | null>;
}

export function useMarqueeSelection({ bodyRef, sectionRef, controlsRef }: MarqueeOptions) {
  // The rectangle is moved by writing its style directly: it changes on every
  // pointer move, and re-rendering the whole grid that often would stutter.
  const rectRef = useRef<HTMLDivElement>(null);
  /** Ids the rectangle currently selects, or `null` when none is being drawn. */
  const [provisional, setProvisional] = useState<string[] | null>(null);

  /**
   * Begin tracking a press. `base` is kept selected throughout (for an
   * additive drag). `onCommit` gets the final selection, and is not called if
   * the press never travels far enough to become a rectangle.
   */
  const start = (event: MouseEvent, base: string[], onCommit: (ids: string[]) => void) => {
    const body = bodyRef.current;
    const section = sectionRef.current;
    if (!body || !section) return;
    // Whichever of the two is scrolling the cards in the current layout.
    const scroller = getComputedStyle(section).overflowY === "visible" ? body : section;

    /** The part of the screen where cards can actually be seen right now. */
    const visibleArea = (): Rect | null => {
      const area = intersectRects(body.getBoundingClientRect(), section.getBoundingClientRect());
      // Cards scroll under the pinned control row; what it covers doesn't count.
      const controlsBottom = controlsRef.current?.getBoundingClientRect().bottom;
      return area && controlsBottom !== undefined
        ? { ...area, top: Math.max(area.top, controlsBottom) }
        : area;
    };
    const intoArea = (point: { x: number; y: number }) => {
      const area = visibleArea();
      return area
        ? { x: clamp(point.x, area.left, area.right), y: clamp(point.y, area.top, area.bottom) }
        : point;
    };

    const press = { x: event.clientX, y: event.clientY };
    const pressInArea = intoArea(press);
    // In content coordinates, so it moves with the cards as they scroll.
    const anchor = {
      x: pressInArea.x + scroller.scrollLeft,
      y: pressInArea.y + scroller.scrollTop,
    };
    let pointer = press;
    let active = false;
    let ids: string[] = [];
    let frame = 0;

    const update = () => {
      const from = { x: anchor.x - scroller.scrollLeft, y: anchor.y - scroller.scrollTop };
      const to = intoArea(pointer);
      const rect: Rect = {
        left: Math.min(from.x, to.x),
        top: Math.min(from.y, to.y),
        right: Math.max(from.x, to.x),
        bottom: Math.max(from.y, to.y),
      };

      const hits = Array.from(section.querySelectorAll(`[${OBSERVATION_ID}]`)).flatMap((card) => {
        const id = card.getAttribute(OBSERVATION_ID);
        return id && intersectRects(card.getBoundingClientRect(), rect) ? [id] : [];
      });
      const next = [...new Set([...base, ...hits])];
      if (next.join() !== ids.join() || !active) setProvisional(next);
      ids = next;

      // Draw only the part still on screen; the start may have scrolled away.
      const area = visibleArea();
      const shown = area ? intersectRects(rect, area) : rect;
      const style = rectRef.current?.style;
      if (!style) return;
      style.display = shown ? "block" : "none";
      if (shown) {
        style.left = `${shown.left}px`;
        style.top = `${shown.top}px`;
        style.width = `${shown.right - shown.left}px`;
        style.height = `${shown.bottom - shown.top}px`;
      }
    };

    // While the pointer sits near (or past) the top or bottom of the cards,
    // scroll them, faster the further it goes.
    const autoScroll = () => {
      frame = 0;
      const area = visibleArea();
      if (!area) return;
      const past =
        pointer.y > area.bottom - EDGE_PX
          ? pointer.y - (area.bottom - EDGE_PX)
          : pointer.y < area.top + EDGE_PX
            ? pointer.y - (area.top + EDGE_PX)
            : 0;
      if (past === 0) return;
      // The scroll listener below redraws the rectangle.
      scroller.scrollTop += clamp(past / 2, -MAX_SPEED_PX, MAX_SPEED_PX);
      frame = requestAnimationFrame(autoScroll);
    };

    const handleMove = (e: globalThis.MouseEvent) => {
      // No button is down, so the release never reached us (a context menu or
      // a native drag took it). End the press here, or the rectangle would
      // follow the bare pointer until the next click.
      if (e.buttons === 0) {
        handleUp();
        return;
      }
      pointer = { x: e.clientX, y: e.clientY };
      if (!active) {
        if (Math.hypot(pointer.x - press.x, pointer.y - press.y) < THRESHOLD_PX) return;
        // The press may have begun a text selection before it became a rectangle.
        window.getSelection()?.removeAllRanges();
        update();
        active = true;
      } else {
        update();
      }
      if (!frame) frame = requestAnimationFrame(autoScroll);
    };
    const handleScroll = () => {
      if (active) update();
    };
    const handleUp = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", handleUp);
      scroller.removeEventListener("scroll", handleScroll);
      cancelAnimationFrame(frame);
      if (rectRef.current) rectRef.current.style.display = "none";
      setProvisional(null);
      if (active) onCommit(ids);
    };
    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", handleUp);
    scroller.addEventListener("scroll", handleScroll);
  };

  return { rectRef, provisional, start };
}
