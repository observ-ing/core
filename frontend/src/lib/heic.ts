// HEIC/HEIF import. Photos are converted to JPEG as soon as they're picked so
// the preview, EXIF extraction, species ID and upload all see a format every
// browser (and the lexicon) accepts.
//
// Conversion order:
//   1. The browser's own decoder (Safari decodes HEIC; Chrome/Firefox don't),
//      drawn to a canvas and re-encoded. Works offline.
//   2. The appview's /api/media/heic-to-jpeg (libheif), when online.
//   3. Otherwise the photo is rejected with an explanation.
//
// Neither path keeps metadata reliably, so the original EXIF is copied from the
// HEIC onto the resulting JPEG. Both decoders already apply the HEIF rotation,
// so the copied Orientation tag is reset to 1 to avoid rotating twice.

import { convertHeicOnServer } from "../services/api";

const HEIC_TYPES = ["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"];

/** Largest HEIC accepted for conversion. Mirrors the server's body limit. */
export const MAX_HEIC_SIZE = 25 * 1024 * 1024;

const JPEG_QUALITY = 0.9;

/**
 * iOS Safari refuses canvases over ~16.7M pixels, which a 24MP or 48MP iPhone
 * photo exceeds. Scale down to fit rather than falling through to the server:
 * this is the path that works offline, and 16MP is ample for an observation.
 */
const MAX_CANVAS_PIXELS = 16_777_216;

/** `accept` value for photo file inputs. */
export const HEIC_ACCEPT = "image/heic,image/heif,.heic,.heif";

export class HeicConversionError extends Error {
  override name = "HeicConversionError";
}

export function isHeic(file: File): boolean {
  if (HEIC_TYPES.includes(file.type)) return true;
  // Some pickers hand back HEIC files with no MIME type at all.
  return (
    (file.type === "" || file.type === "application/octet-stream") && /\.hei[cf]$/i.test(file.name)
  );
}

type Bytes = Uint8Array<ArrayBuffer>;

export interface HeicConverters {
  decodeInBrowser: (file: File) => Promise<Bytes | null>;
  convertOnServer: (file: File) => Promise<Bytes>;
}

const defaultConverters: HeicConverters = {
  decodeInBrowser: decodeInBrowser,
  convertOnServer: convertOnServer,
};

/** Convert a HEIC/HEIF photo to a JPEG `File`, keeping its EXIF. */
export async function convertHeicToJpeg(
  file: File,
  converters: HeicConverters = defaultConverters,
): Promise<File> {
  if (file.size > MAX_HEIC_SIZE) {
    throw new HeicConversionError(`${file.name} is too large to convert (max 25MB).`);
  }

  const jpeg = (await converters.decodeInBrowser(file)) ?? (await converters.convertOnServer(file));

  let bytes = jpeg;
  const exif = extractHeifExif(new Uint8Array(await file.arrayBuffer()));
  if (exif) {
    bytes = insertJpegExif(jpeg, withOrientationReset(exif));
  }

  return new File([bytes], jpegFilename(file.name), {
    type: "image/jpeg",
    lastModified: file.lastModified,
  });
}

export interface ConvertedBatch {
  /** The batch in its original order, HEIC photos replaced by their JPEGs. */
  files: File[];
  failures: HeicConversionError[];
}

/** Convert every HEIC photo in a picked batch, passing other files through. */
export async function convertHeicFiles(
  files: File[],
  convert: (file: File) => Promise<File> = convertHeicToJpeg,
): Promise<ConvertedBatch> {
  const result: ConvertedBatch = { files: [], failures: [] };
  // One at a time: the server only converts a couple at once anyway, and a
  // browser decoding several 12MP+ photos in parallel can run out of memory.
  for (const file of files) {
    if (!isHeic(file)) {
      result.files.push(file);
      continue;
    }
    try {
      // eslint-disable-next-line no-await-in-loop -- deliberately sequential, see above
      result.files.push(await convert(file));
    } catch (error) {
      result.failures.push(
        error instanceof HeicConversionError
          ? error
          : new HeicConversionError(`Couldn't convert ${file.name} from HEIC.`),
      );
    }
  }
  return result;
}

function jpegFilename(name: string): string {
  return /\.hei[cf]$/i.test(name) ? name.replace(/\.hei[cf]$/i, ".jpg") : `${name}.jpg`;
}

/** Decode with the browser's own image decoder; `null` when it can't. */
async function decodeInBrowser(file: File): Promise<Bytes | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const { naturalWidth: width, naturalHeight: height } = img;
    if (!width || !height) return null;

    const scale = Math.min(1, Math.sqrt(MAX_CANVAS_PIXELS / (width * height)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(width * scale);
    canvas.height = Math.floor(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    if (!blob || blob.type !== "image/jpeg") return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    // `decode()` rejects for formats the browser can't read.
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function convertOnServer(file: File): Promise<Bytes> {
  let response: Response;
  try {
    response = await convertHeicOnServer(file);
  } catch {
    throw new HeicConversionError(
      `Couldn't convert ${file.name} from HEIC while offline. Try again when connected, or use a JPEG.`,
    );
  }
  if (response.status === 401) {
    throw new HeicConversionError(`Log in again to add HEIC photos like ${file.name}.`);
  }
  if (!response.ok) {
    throw new HeicConversionError(`Couldn't convert ${file.name} from HEIC. Try a JPEG instead.`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

// --- EXIF -------------------------------------------------------------------

interface Box {
  type: string;
  /** Offset of the box's payload (after the size/type header). */
  body: number;
  end: number;
}

function* readBoxes(view: DataView, start: number, end: number): Generator<Box> {
  let pos = start;
  while (pos + 8 <= end) {
    let size = view.getUint32(pos);
    const type = fourcc(view, pos + 4);
    let header = 8;
    if (size === 1) {
      if (pos + 16 > end) return;
      size = Number(view.getBigUint64(pos + 8));
      header = 16;
    } else if (size === 0) {
      size = end - pos;
    }
    if (size < header || pos + size > end) return;
    yield { type, body: pos + header, end: pos + size };
    pos += size;
  }
}

function fourcc(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

function findBox(view: DataView, start: number, end: number, type: string): Box | undefined {
  for (const box of readBoxes(view, start, end)) {
    if (box.type === type) return box;
  }
  return undefined;
}

/** Read a big-endian unsigned int of `size` bytes (0, 4 or 8). */
function readUint(view: DataView, offset: number, size: number): number {
  if (size === 0) return 0;
  if (size === 4) return view.getUint32(offset);
  if (size === 8) return Number(view.getBigUint64(offset));
  throw new RangeError(`unsupported field size ${size}`);
}

/**
 * The TIFF-structured EXIF block (starting at the `II*\0` / `MM\0*` header)
 * stored as the `Exif` item of a HEIF file, or `null` if there isn't one.
 */
export function extractHeifExif(heif: Uint8Array): Uint8Array | null {
  try {
    return findExifItem(heif);
  } catch {
    // Truncated or malformed container; the photo just loses its metadata.
    return null;
  }
}

function findExifItem(heif: Uint8Array): Uint8Array | null {
  const view = new DataView(heif.buffer, heif.byteOffset, heif.byteLength);
  const meta = findBox(view, 0, heif.length, "meta");
  if (!meta) return null;
  // `meta` is a FullBox: a version/flags word precedes its children.
  const metaChildren = meta.body + 4;
  const iinf = findBox(view, metaChildren, meta.end, "iinf");
  const iloc = findBox(view, metaChildren, meta.end, "iloc");
  if (!iinf || !iloc) return null;

  // iinf: FullBox, entry count, then one `infe` box per item.
  const iinfVersion = view.getUint8(iinf.body);
  let exifItemId: number | undefined;
  for (const infe of readBoxes(view, iinf.body + 4 + (iinfVersion === 0 ? 2 : 4), iinf.end)) {
    if (infe.type !== "infe") continue;
    const version = view.getUint8(infe.body);
    if (version < 2) continue;
    let pos = infe.body + 4;
    const itemId = version === 2 ? view.getUint16(pos) : view.getUint32(pos);
    pos += version === 2 ? 2 : 4;
    pos += 2; // item_protection_index
    if (fourcc(view, pos) === "Exif") {
      exifItemId = itemId;
      break;
    }
  }
  if (exifItemId === undefined) return null;

  // iloc: where each item's bytes live, as extents in the file or in `idat`.
  const ilocVersion = view.getUint8(iloc.body);
  let pos = iloc.body + 4;
  const offsetSize = view.getUint8(pos) >> 4;
  const lengthSize = view.getUint8(pos) & 0xf;
  const baseOffsetSize = view.getUint8(pos + 1) >> 4;
  const indexSize = ilocVersion === 1 || ilocVersion === 2 ? view.getUint8(pos + 1) & 0xf : 0;
  pos += 2;
  const itemCount = ilocVersion < 2 ? view.getUint16(pos) : view.getUint32(pos);
  pos += ilocVersion < 2 ? 2 : 4;

  for (let i = 0; i < itemCount; i++) {
    const itemId = ilocVersion < 2 ? view.getUint16(pos) : view.getUint32(pos);
    pos += ilocVersion < 2 ? 2 : 4;
    let constructionMethod = 0;
    if (ilocVersion === 1 || ilocVersion === 2) {
      constructionMethod = view.getUint16(pos) & 0xf;
      pos += 2;
    }
    pos += 2; // data_reference_index
    const baseOffset = readUint(view, pos, baseOffsetSize);
    pos += baseOffsetSize;
    const extentCount = view.getUint16(pos);
    pos += 2;

    const extents: [offset: number, length: number][] = [];
    for (let e = 0; e < extentCount; e++) {
      pos += indexSize;
      const offset = readUint(view, pos, offsetSize);
      pos += offsetSize;
      const length = readUint(view, pos, lengthSize);
      pos += lengthSize;
      extents.push([offset, length]);
    }
    if (itemId !== exifItemId) continue;

    // Method 0 addresses the file; method 1 the payload of meta's `idat`.
    let source: Uint8Array;
    if (constructionMethod === 0) {
      source = heif;
    } else if (constructionMethod === 1) {
      const idat = findBox(view, metaChildren, meta.end, "idat");
      if (!idat) return null;
      source = heif.subarray(idat.body, idat.end);
    } else {
      return null;
    }
    const payload = concat(
      extents.map(([offset, length]) => {
        const start = baseOffset + offset;
        // A zero length means "to the end of the source".
        return source.subarray(start, length === 0 ? source.length : start + length);
      }),
    );
    return tiffFromExifPayload(payload);
  }
  return null;
}

/**
 * The HEIF `Exif` item starts with a 4-byte offset to the TIFF header,
 * typically skipping an `Exif\0\0` prefix.
 */
function tiffFromExifPayload(payload: Uint8Array): Uint8Array | null {
  if (payload.length < 4) return null;
  const skip = new DataView(payload.buffer, payload.byteOffset, 4).getUint32(0);
  const tiff = payload.subarray(4 + skip);
  return isTiffHeader(tiff) ? tiff : null;
}

function isTiffHeader(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 8 &&
    ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
      (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))
  );
}

const ORIENTATION_TAG = 0x0112;

/** A copy of `tiff` with IFD0's Orientation tag (if any) set to 1 (upright). */
export function withOrientationReset(tiff: Uint8Array): Uint8Array {
  const copy = tiff.slice();
  try {
    const view = new DataView(copy.buffer);
    const little = copy[0] === 0x49;
    const ifd0 = view.getUint32(4, little);
    const count = view.getUint16(ifd0, little);
    for (let i = 0; i < count; i++) {
      const entry = ifd0 + 2 + i * 12;
      if (view.getUint16(entry, little) === ORIENTATION_TAG) {
        // SHORT value, stored inline in the first two bytes of the value field.
        view.setUint16(entry + 8, 1, little);
        break;
      }
    }
  } catch {
    // Malformed IFD; leave it be.
  }
  return copy;
}

const EXIF_HEADER = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"

/**
 * Put `tiff` into `jpeg` as its EXIF (APP1) segment, replacing any EXIF the
 * encoder wrote. Returns `jpeg` unchanged if the block can't fit in a single
 * segment.
 */
export function insertJpegExif(jpeg: Bytes, tiff: Uint8Array): Bytes {
  const segmentLength = 2 + EXIF_HEADER.length + tiff.length;
  if (segmentLength > 0xffff || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;

  const app1 = new Uint8Array(2 + segmentLength);
  app1.set([0xff, 0xe1, segmentLength >> 8, segmentLength & 0xff, ...EXIF_HEADER]);
  app1.set(tiff, 4 + EXIF_HEADER.length);

  // Walk the header segments up to the image data, dropping existing EXIF.
  const view = new DataView(jpeg.buffer, jpeg.byteOffset, jpeg.byteLength);
  const leading: Uint8Array[] = [];
  const kept: Uint8Array[] = [];
  let pos = 2;
  while (pos + 4 <= jpeg.length && jpeg[pos] === 0xff) {
    const marker = jpeg[pos + 1];
    // SOS: entropy-coded data follows; copy the rest verbatim.
    if (marker === 0xda) break;
    const end = pos + 2 + view.getUint16(pos + 2);
    if (end > jpeg.length) return jpeg;
    const segment = jpeg.subarray(pos, end);
    const isExif = marker === 0xe1 && EXIF_HEADER.every((byte, i) => jpeg[pos + 4 + i] === byte);
    if (!isExif) {
      // Keep a leading JFIF APP0 first, as JFIF readers expect.
      (marker === 0xe0 && kept.length === 0 ? leading : kept).push(segment);
    }
    pos = end;
  }

  return concat([jpeg.subarray(0, 2), ...leading, app1, ...kept, jpeg.subarray(pos)]);
}

function concat(parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
