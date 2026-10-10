import type { DragEvent } from "react";

const SIZE = 96;
const TAG_HEIGHT = 30;

/**
 * Drag preview for one photo pulled out of a multi-photo observation: the
 * photo alone with a "1 photo" tag, so it can't be mistaken for dragging the
 * whole card. Falls back to the browser's default preview if drawing fails.
 */
export function setPhotoDragImage(
  event: DragEvent,
  image: HTMLImageElement | null,
  color: string,
): void {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE;
    canvas.height = SIZE + TAG_HEIGHT;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.beginPath();
    ctx.roundRect(0, 0, SIZE, SIZE, 12);
    if (image?.complete && image.naturalWidth > 0) {
      const scale = Math.max(SIZE / image.naturalWidth, SIZE / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      ctx.save();
      ctx.clip();
      ctx.drawImage(image, (SIZE - width) / 2, (SIZE - height) / 2, width, height);
      ctx.restore();
    }
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.beginPath();
    ctx.roundRect(14, SIZE + 6, SIZE - 28, 24, 12);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = '600 13px "DM Sans", system-ui, sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("1 photo", SIZE / 2, SIZE + 19);

    // The preview has to be in the document when the browser snapshots it.
    canvas.style.cssText = "position: fixed; top: -400px; left: 0; pointer-events: none";
    document.body.appendChild(canvas);
    event.dataTransfer.setDragImage(canvas, SIZE / 2, SIZE / 2);
    setTimeout(() => canvas.remove(), 0);
  } catch {
    // Keep the browser's default preview.
  }
}
