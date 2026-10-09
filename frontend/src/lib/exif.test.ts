import { describe, it, expect } from "vitest";
import { parseExifTags } from "./exif";

const gps = (lat: number, latRef: string, lng: number, lngRef: string) => ({
  GPSLatitude: { description: lat },
  GPSLatitudeRef: { value: [latRef] },
  GPSLongitude: { description: lng },
  GPSLongitudeRef: { value: [lngRef] },
});

describe("parseExifTags", () => {
  it("reads the capture time as wall-clock time with its offset", () => {
    const exif = parseExifTags({
      DateTimeOriginal: { description: "2026:10:03 10:42:19" },
      OffsetTimeOriginal: { description: "-07:00" },
    });

    expect(exif.date).toBe("2026-10-03T10:42");
    expect(exif.utcOffset).toBe("-07:00");
  });

  it("falls back to DateTime and its own offset tag", () => {
    const exif = parseExifTags({
      DateTime: { description: "2026:10:04 08:15:00" },
      OffsetTime: { description: "+09:00" },
      // Belongs to DateTimeOriginal, which is absent, so it must not be used.
      OffsetTimeOriginal: { description: "-07:00" },
    });

    expect(exif.date).toBe("2026-10-04T08:15");
    expect(exif.utcOffset).toBe("+09:00");
  });

  it("leaves the date empty when there is none or it is malformed", () => {
    expect(parseExifTags({}).date).toBeNull();
    expect(parseExifTags({ DateTimeOriginal: { description: "0000:00:00 00:00:00" } }).date).toBe(
      null,
    );
    expect(parseExifTags({ DateTimeOriginal: { description: "yesterday" } }).date).toBeNull();
  });

  it("ignores an offset that is not in ±HH:MM form", () => {
    const exif = parseExifTags({
      DateTimeOriginal: { description: "2026:10:03 10:42:19" },
      OffsetTimeOriginal: { description: "PDT" },
    });

    expect(exif.utcOffset).toBeNull();
  });

  it("signs coordinates from their hemisphere refs", () => {
    const exif = parseExifTags(gps(33.86, "S", 122.2445, "W"));

    expect(exif.latitude).toBe(-33.86);
    expect(exif.longitude).toBe(-122.2445);
  });

  it("parses coordinates given as strings", () => {
    const exif = parseExifTags({
      GPSLatitude: { description: "37.905" },
      GPSLongitude: { description: "122.2445" },
      GPSLongitudeRef: { value: ["W"] },
    });

    expect(exif.latitude).toBe(37.905);
    expect(exif.longitude).toBe(-122.2445);
  });

  it("ignores a 0,0 position", () => {
    const exif = parseExifTags(gps(0, "N", 0, "E"));

    expect(exif.latitude).toBeNull();
    expect(exif.longitude).toBeNull();
  });

  it("reads GPS horizontal accuracy in whole meters", () => {
    expect(parseExifTags({ GPSHPositioningError: { description: "12.4" } }).accuracyMeters).toBe(
      12,
    );
    expect(parseExifTags({ GPSHPositioningError: { value: [935, 100] } }).accuracyMeters).toBe(9);
  });

  it("never reports an accuracy below one meter, and drops unusable values", () => {
    expect(parseExifTags({ GPSHPositioningError: { description: 0.2 } }).accuracyMeters).toBe(1);
    expect(parseExifTags({ GPSHPositioningError: { description: 0 } }).accuracyMeters).toBeNull();
    expect(parseExifTags({ GPSHPositioningError: { value: [5, 0] } }).accuracyMeters).toBeNull();
    expect(parseExifTags({}).accuracyMeters).toBeNull();
  });
});
