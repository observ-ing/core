import { describe, it, expect } from "vitest";
import { MAX_IMAGES, MAX_FILE_SIZE, vetImageFiles } from "./imageSelection";

function imageFile(name: string, { type = "image/jpeg", size = 1024 } = {}): File {
  const file = new File([""], name, { type });
  // Files built in jsdom are empty; fake the size rather than allocating bytes.
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const batchOf = (count: number) =>
  Array.from({ length: count }, (_, i) => imageFile(`photo-${i}.jpg`));

describe("vetImageFiles", () => {
  it("accepts a batch that fits under the cap", () => {
    const result = vetImageFiles(batchOf(3), 0);

    expect(result.accepted).toHaveLength(3);
    expect(result.exceededCap).toBe(false);
  });

  it("caps a single oversized batch instead of accepting all of it", () => {
    // Regression: the cap used to be checked against a render-time
    // `images.length` that never advanced within one call, so all 15 landed.
    const result = vetImageFiles(batchOf(15), 0);

    expect(result.accepted).toHaveLength(MAX_IMAGES);
    expect(result.exceededCap).toBe(true);
  });

  it("counts photos already attached when computing headroom", () => {
    const result = vetImageFiles(batchOf(5), MAX_IMAGES - 2);

    expect(result.accepted).toHaveLength(2);
    expect(result.exceededCap).toBe(true);
  });

  it("accepts nothing once the observation is already full", () => {
    const result = vetImageFiles(batchOf(3), MAX_IMAGES);

    expect(result.accepted).toEqual([]);
    expect(result.exceededCap).toBe(true);
  });

  it("treats an over-full count as no headroom rather than negative", () => {
    const result = vetImageFiles(batchOf(3), MAX_IMAGES + 5);

    expect(result.accepted).toEqual([]);
    expect(result.exceededCap).toBe(true);
  });

  it("separates out unsupported types without consuming headroom", () => {
    const files = [imageFile("doc.pdf", { type: "application/pdf" }), ...batchOf(2)];

    const result = vetImageFiles(files, 0);

    expect(result.invalidType.map((f) => f.name)).toEqual(["doc.pdf"]);
    expect(result.accepted).toHaveLength(2);
    expect(result.exceededCap).toBe(false);
  });

  it("separates out files above the size limit", () => {
    const files = [imageFile("huge.jpg", { size: MAX_FILE_SIZE + 1 }), ...batchOf(1)];

    const result = vetImageFiles(files, 0);

    expect(result.tooLarge.map((f) => f.name)).toEqual(["huge.jpg"]);
    expect(result.accepted).toHaveLength(1);
  });

  it("accepts a file sitting exactly on the size limit", () => {
    const result = vetImageFiles([imageFile("exact.jpg", { size: MAX_FILE_SIZE })], 0);

    expect(result.accepted).toHaveLength(1);
    expect(result.tooLarge).toEqual([]);
  });

  it("preserves the picked order among accepted files", () => {
    const result = vetImageFiles(batchOf(4), 0);

    expect(result.accepted.map((f) => f.name)).toEqual([
      "photo-0.jpg",
      "photo-1.jpg",
      "photo-2.jpg",
      "photo-3.jpg",
    ]);
  });

  it("reports nothing for an empty batch", () => {
    const result = vetImageFiles([], 0);

    expect(result).toEqual({
      accepted: [],
      invalidType: [],
      tooLarge: [],
      exceededCap: false,
    });
  });
});
