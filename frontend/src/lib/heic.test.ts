import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import ExifReader from "exifreader";
import {
  HeicConversionError,
  convertHeicFiles,
  convertHeicToJpeg,
  extractHeifExif,
  insertJpegExif,
  isHeic,
  withOrientationReset,
} from "./heic";

// 64x32 HEIC encoded by libheif's `heif-enc` from a JPEG carrying GPS
// 37°46'30"N 122°25'6"W, DateTimeOriginal 2024:05:17 08:42:10 and
// Orientation 6.
const FIXTURE = new Uint8Array(readFileSync(join(import.meta.dirname, "testdata/exif-gps.heic")));

// Structurally valid JPEG header segments around placeholder image data; the
// EXIF code only walks segment markers, so the pixels don't matter.
const APP0 = [0xff, 0xe0, 0x00, 0x07, 0x4a, 0x46, 0x49, 0x46, 0x00]; // JFIF
const STALE_EXIF = [0xff, 0xe1, 0x00, 0x0a, 0x45, 0x78, 0x69, 0x66, 0x00, 0x00, 0xde, 0xad];
const DQT = [0xff, 0xdb, 0x00, 0x04, 0x01, 0x02];
const SCAN = [0xff, 0xda, 0x00, 0x04, 0x07, 0x08, 0x09, 0x0a, 0xff, 0xd9];
const jpegBytes = (...segments: number[][]) => new Uint8Array([0xff, 0xd8, ...segments.flat()]);

function tags(jpeg: Uint8Array) {
  return ExifReader.load(jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength));
}

/** A big-endian TIFF block whose IFD0 holds just Orientation. */
function tiffWithOrientation(orientation: number): Uint8Array {
  // prettier-ignore
  return new Uint8Array([
    0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // header, IFD0 at 8
    0x00, 0x01,                                     // one entry
    0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // Orientation, SHORT, count 1
    0x00, orientation, 0x00, 0x00,                  // value
    0x00, 0x00, 0x00, 0x00,                         // no next IFD
  ]);
}

describe("isHeic", () => {
  it("recognizes HEIC/HEIF MIME types", () => {
    expect(isHeic(new File([], "a.heic", { type: "image/heic" }))).toBe(true);
    expect(isHeic(new File([], "IMG_1.HEIF", { type: "image/heif" }))).toBe(true);
    expect(isHeic(new File([], "a.jpg", { type: "image/jpeg" }))).toBe(false);
  });

  it("falls back to the extension when the type is missing", () => {
    expect(isHeic(new File([], "IMG_1.HEIC"))).toBe(true);
    expect(isHeic(new File([], "a.heic", { type: "application/octet-stream" }))).toBe(true);
    expect(isHeic(new File([], "notes.txt"))).toBe(false);
  });
});

describe("extractHeifExif", () => {
  it("finds the EXIF item in a real HEIC", () => {
    const tiff = extractHeifExif(FIXTURE);

    expect(Array.from(tiff?.subarray(0, 4) ?? [])).toEqual([0x4d, 0x4d, 0x00, 0x2a]);
  });

  it("returns null for non-HEIF input", () => {
    expect(extractHeifExif(jpegBytes(APP0, SCAN))).toBeNull();
    expect(extractHeifExif(new Uint8Array())).toBeNull();
  });

  it("returns null rather than throwing on a truncated file", () => {
    expect(extractHeifExif(FIXTURE.subarray(0, 200))).toBeNull();
  });
});

describe("withOrientationReset", () => {
  it("sets Orientation to 1 without touching the input", () => {
    const original = tiffWithOrientation(6);
    const reset = withOrientationReset(original);

    expect(tags(insertJpegExif(jpegBytes(SCAN), reset))["Orientation"]?.value).toBe(1);
    expect(tags(insertJpegExif(jpegBytes(SCAN), original))["Orientation"]?.value).toBe(6);
  });
});

describe("insertJpegExif", () => {
  it("replaces the encoder's EXIF and keeps JFIF first", () => {
    const tiff = tiffWithOrientation(1);
    const out = insertJpegExif(jpegBytes(APP0, STALE_EXIF, DQT, SCAN), tiff);

    const app1 = [0xff, 0xe1, 0x00, 2 + 6 + tiff.length, 0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    expect(Array.from(out)).toEqual([0xff, 0xd8, ...APP0, ...app1, ...DQT, ...SCAN]);
  });

  it("leaves a non-JPEG alone", () => {
    const notJpeg = new Uint8Array([1, 2, 3, 4]);
    expect(insertJpegExif(notJpeg, tiffWithOrientation(1))).toBe(notJpeg);
  });
});

describe("convertHeicToJpeg", () => {
  const heicFile = () => new File([FIXTURE], "IMG_0001.HEIC", { type: "image/heic" });

  it("falls back to the server and carries the original EXIF over", async () => {
    const convertOnServer = vi.fn(async () => jpegBytes(APP0, STALE_EXIF, DQT, SCAN));
    const file = await convertHeicToJpeg(heicFile(), {
      decodeInBrowser: async () => null,
      convertOnServer,
    });

    expect(convertOnServer).toHaveBeenCalledOnce();
    expect(file.name).toBe("IMG_0001.jpg");
    expect(file.type).toBe("image/jpeg");

    const exif = tags(new Uint8Array(await file.arrayBuffer()));
    expect(exif["GPSLatitude"]?.description).toBeCloseTo(37.775, 3);
    expect(exif["GPSLongitudeRef"]?.value).toEqual(["W"]);
    expect(exif["DateTimeOriginal"]?.description).toBe("2024:05:17 08:42:10");
    // The decoder already rotated the pixels; the tag mustn't rotate them again.
    expect(exif["Orientation"]?.value ?? 1).toBe(1);
  });

  it("skips the server when the browser can decode HEIC", async () => {
    const convertOnServer = vi.fn();
    await convertHeicToJpeg(heicFile(), {
      decodeInBrowser: async () => jpegBytes(SCAN),
      convertOnServer,
    });

    expect(convertOnServer).not.toHaveBeenCalled();
  });

  it("rejects files over the size limit before converting", async () => {
    const file = heicFile();
    Object.defineProperty(file, "size", { value: 26 * 1024 * 1024 });
    const decodeInBrowser = vi.fn();

    await expect(
      convertHeicToJpeg(file, { decodeInBrowser, convertOnServer: vi.fn() }),
    ).rejects.toThrow(HeicConversionError);
    expect(decodeInBrowser).not.toHaveBeenCalled();
  });
});

describe("convertHeicFiles", () => {
  it("converts HEIC photos in place and passes others through", async () => {
    const jpeg = new File([], "a.jpg", { type: "image/jpeg" });
    const heic = new File([], "b.heic", { type: "image/heic" });
    const converted = new File([], "b.jpg", { type: "image/jpeg" });

    const result = await convertHeicFiles([heic, jpeg], async () => converted);

    expect(result.files).toEqual([converted, jpeg]);
    expect(result.failures).toEqual([]);
  });

  it("reports failures without dropping the rest of the batch", async () => {
    const jpeg = new File([], "a.jpg", { type: "image/jpeg" });
    const heic = new File([], "b.heic", { type: "image/heic" });

    const result = await convertHeicFiles([heic, jpeg], async () => {
      throw new HeicConversionError("offline");
    });

    expect(result.files).toEqual([jpeg]);
    expect(result.failures.map((e) => e.message)).toEqual(["offline"]);
  });

  it("wraps unexpected errors with the file name", async () => {
    const heic = new File([], "b.heic", { type: "image/heic" });

    const result = await convertHeicFiles([heic], async () => {
      throw new TypeError("boom");
    });

    expect(result.failures[0]?.message).toContain("b.heic");
  });
});
