import { describe, it, expect } from "vitest";
import { defaultCrosspost } from "./crosspost";

describe("defaultCrosspost", () => {
  it("is off when the user never turned posting on", () => {
    expect(defaultCrosspost(undefined, { photoCount: 1 })).toBe(false);
    expect(
      defaultCrosspost(
        { crosspostInaturalist: null, crosspostInaturalistRequirePhotos: null },
        { photoCount: 1 },
      ),
    ).toBe(false);
  });

  it("is off when posting is turned off", () => {
    expect(
      defaultCrosspost(
        { crosspostInaturalist: false, crosspostInaturalistRequirePhotos: false },
        { photoCount: 1 },
      ),
    ).toBe(false);
  });

  it("requires photos unless the user turned that off", () => {
    for (const crosspostInaturalistRequirePhotos of [null, true]) {
      const prefs = { crosspostInaturalist: true, crosspostInaturalistRequirePhotos };
      expect(defaultCrosspost(prefs, { photoCount: 0 })).toBe(false);
      expect(defaultCrosspost(prefs, { photoCount: 1 })).toBe(true);
    }
  });

  it("posts observations without photos when the user allows it", () => {
    expect(
      defaultCrosspost(
        { crosspostInaturalist: true, crosspostInaturalistRequirePhotos: false },
        { photoCount: 0 },
      ),
    ).toBe(true);
  });
});
