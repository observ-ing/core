import { describe, it, expect, vi } from "vitest";
import { suppressMissingImages, type StyleImageMissingMap } from "./mapUtils";

// maplibre-gl is a heavy WebGL module and `suppressMissingImages` only needs
// the `on`/`hasImage`/`addImage` surface of the map it's handed, so stub the
// package to keep this a pure unit test (mapUtils default-imports it).
vi.mock("maplibre-gl", () => ({ default: {} }));

describe("suppressMissingImages", () => {
  function makeFakeMap(hasImage = false) {
    const handlers: Record<string, (e: { id: string }) => void> = {};
    const addImage =
      vi.fn<(id: string, image: { width: number; height: number; data: Uint8Array }) => void>();
    const map: StyleImageMissingMap = {
      on: (type, listener) => {
        handlers[type] = listener;
      },
      hasImage: () => hasImage,
      addImage,
    };
    return {
      map,
      addImage,
      fire: (id: string) => handlers["styleimagemissing"]?.({ id }),
    };
  }

  it("registers a styleimagemissing handler that handles missing ids", () => {
    const { map, addImage, fire } = makeFakeMap(false);
    suppressMissingImages(map);

    fire("artwork");
    expect(addImage).toHaveBeenCalledTimes(1);
  });

  it("adds a 1x1 fully-transparent placeholder for a missing image id", () => {
    const { map, addImage, fire } = makeFakeMap(false);
    suppressMissingImages(map);

    fire("artwork");

    const [id, image] = addImage.mock.calls[0];
    expect(id).toBe("artwork");
    expect(image.width).toBe(1);
    expect(image.height).toBe(1);
    expect(image.data).toBeInstanceOf(Uint8Array);
    expect([...image.data]).toEqual([0, 0, 0, 0]); // RGBA, fully transparent
  });

  it("does not re-add an image that already exists", () => {
    const { map, addImage, fire } = makeFakeMap(true);
    suppressMissingImages(map);

    fire("artwork");

    expect(addImage).not.toHaveBeenCalled();
  });
});
