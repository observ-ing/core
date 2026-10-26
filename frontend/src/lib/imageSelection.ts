// Vetting for photos picked into an observation. Lives here rather than in
// UploadModal so the cap is enforced against a running count instead of a
// render-time `images.length`, and so it can be tested without mounting the
// modal.

import { HEIC_ACCEPT } from "./heic";

/** Most photos one observation can carry. */
export const MAX_IMAGES = 10;

/**
 * Largest accepted size for a single photo, in bytes. Mirrors the `maxSize` on
 * the media lexicon's image blob (and the appview's `MAX_IMAGE_BYTES`), so it's
 * 10 MB in decimal, not 10 MiB.
 */
export const MAX_FILE_SIZE = 10_000_000;

/** `bytes` as decimal megabytes for display, e.g. "10 MB" or "5.2 MB". */
export function formatMegabytes(bytes: number): string {
  return `${parseFloat((bytes / 1_000_000).toFixed(1))} MB`;
}

export const VALID_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/**
 * `accept` value for photo file inputs. HEIC is offered too, but converted to
 * JPEG (see `heic.ts`) before it reaches `vetImageFiles`.
 */
export const IMAGE_INPUT_ACCEPT = [...VALID_IMAGE_TYPES, HEIC_ACCEPT].join(",");

export interface VettedImages {
  /** Files that passed every check, already trimmed to fit under the cap. */
  accepted: File[];
  invalidType: File[];
  tooLarge: File[];
  /** Otherwise-valid files dropped to stay within the cap. */
  overCap: File[];
  /** True when an otherwise-valid file was dropped to stay within the cap. */
  exceededCap: boolean;
}

export interface VetLimits {
  maxPhotos?: number;
  maxFileSize?: number;
}

/**
 * Split a picked batch into the files that can be added and the ones that
 * can't, given how many photos the observation already holds.
 *
 * Callers pass the whole batch at once: the cap is tracked across the batch,
 * so selecting 15 files into an empty observation yields 10 accepted rather
 * than all 15. `maxPhotos` defaults to the per-observation limit; the batch
 * uploader passes its own. `maxFileSize` defaults to the lexicon's cap; pass
 * the viewer's own when their PDS advertises a lower one.
 */
export function vetImageFiles(
  files: File[],
  currentCount: number,
  { maxPhotos = MAX_IMAGES, maxFileSize = MAX_FILE_SIZE }: VetLimits = {},
): VettedImages {
  const result: VettedImages = {
    accepted: [],
    invalidType: [],
    tooLarge: [],
    overCap: [],
    exceededCap: false,
  };
  let remaining = Math.max(0, maxPhotos - currentCount);

  for (const file of files) {
    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      result.invalidType.push(file);
      continue;
    }
    if (file.size > maxFileSize) {
      result.tooLarge.push(file);
      continue;
    }
    if (remaining === 0) {
      result.overCap.push(file);
      result.exceededCap = true;
      continue;
    }
    result.accepted.push(file);
    remaining -= 1;
  }

  return result;
}
