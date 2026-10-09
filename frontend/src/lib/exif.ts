// Reads the handful of EXIF tags an observation is seeded from. Shared by the
// single-observation modal and the batch uploader so both interpret a photo
// the same way.
import ExifReader from "exifreader";

export interface PhotoExif {
  /** Capture time as a wall-clock `datetime-local` value (YYYY-MM-DDTHH:mm). */
  date: string | null;
  /** UTC offset the capture time was recorded in, e.g. "-07:00". */
  utcOffset: string | null;
  latitude: number | null;
  longitude: number | null;
  /** GPS horizontal accuracy, in whole meters. */
  accuracyMeters: number | null;
}

export const EMPTY_EXIF: PhotoExif = {
  date: null,
  utcOffset: null,
  latitude: null,
  longitude: null,
  accuracyMeters: null,
};

interface ExifTag {
  description?: unknown;
  value?: unknown;
}

type ExifTagName =
  | "DateTimeOriginal"
  | "DateTime"
  | "OffsetTimeOriginal"
  | "OffsetTime"
  | "GPSLatitude"
  | "GPSLatitudeRef"
  | "GPSLongitude"
  | "GPSLongitudeRef"
  | "GPSHPositioningError";

export type ExifTags = Partial<Record<ExifTagName, ExifTag>>;

function toNumber(value: unknown): number {
  return typeof value === "number" ? value : parseFloat(String(value));
}

function firstValue(tag: ExifTag | undefined): unknown {
  return Array.isArray(tag?.value) ? tag.value[0] : undefined;
}

function parseDate(tag: ExifTag | undefined): string | null {
  const match = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(String(tag?.description ?? ""));
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  const value = `${year}-${month}-${day}T${hour}:${minute}`;
  // Cameras with an unset clock write zeros, which match the pattern.
  return isNaN(new Date(value).getTime()) ? null : value;
}

function parseOffset(tag: ExifTag | undefined): string | null {
  const offset = String(tag?.description ?? "").trim();
  return /^[+-]\d{2}:\d{2}$/.test(offset) ? offset : null;
}

function parseAccuracy(tag: ExifTag | undefined): number | null {
  let meters = toNumber(tag?.description);
  if (!Number.isFinite(meters) && Array.isArray(tag?.value)) {
    meters = toNumber(tag.value[0]) / toNumber(tag.value[1]);
  }
  if (!Number.isFinite(meters) || meters <= 0) return null;
  return Math.max(1, Math.round(meters));
}

export function parseExifTags(tags: ExifTags): PhotoExif {
  const exif: PhotoExif = { ...EMPTY_EXIF };

  // Each timestamp tag has its own offset tag; pairing them up keeps a file
  // with only DateTime from borrowing the capture offset of a different time.
  const original = parseDate(tags.DateTimeOriginal);
  if (original) {
    exif.date = original;
    exif.utcOffset = parseOffset(tags.OffsetTimeOriginal);
  } else {
    exif.date = parseDate(tags.DateTime);
    exif.utcOffset = exif.date ? parseOffset(tags.OffsetTime) : null;
  }

  if (tags.GPSLatitude && tags.GPSLongitude) {
    let latitude = toNumber(tags.GPSLatitude.description);
    let longitude = toNumber(tags.GPSLongitude.description);
    const isZeroIsland = latitude === 0 && longitude === 0;
    if (Number.isFinite(latitude) && Number.isFinite(longitude) && !isZeroIsland) {
      if (firstValue(tags.GPSLatitudeRef) === "S") latitude = -Math.abs(latitude);
      if (firstValue(tags.GPSLongitudeRef) === "W") longitude = -Math.abs(longitude);
      exif.latitude = latitude;
      exif.longitude = longitude;
    }
  }

  exif.accuracyMeters = parseAccuracy(tags.GPSHPositioningError);
  return exif;
}

/** Read a photo's EXIF. A file with none, or one that can't be parsed, reads as empty. */
export async function readPhotoExif(file: File): Promise<PhotoExif> {
  try {
    return parseExifTags(ExifReader.load(await file.arrayBuffer()));
  } catch (error) {
    console.error("EXIF extraction error:", error);
    return { ...EMPTY_EXIF };
  }
}
