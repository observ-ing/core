// Vetting for photos picked into an observation. Lives here rather than in
// UploadModal so the cap is enforced against a running count instead of a
// render-time `images.length`, and so it can be tested without mounting the
// modal.

/** Most photos one observation can carry. */
export const MAX_IMAGES = 10;

/** Largest accepted size for a single photo. Mirrors the uploader's own check. */
export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

export const VALID_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

export interface VettedImages {
  /** Files that passed every check, already trimmed to fit under MAX_IMAGES. */
  accepted: File[];
  invalidType: File[];
  tooLarge: File[];
  /** True when an otherwise-valid file was dropped to stay within MAX_IMAGES. */
  exceededCap: boolean;
}

/**
 * Split a picked batch into the files that can be added and the ones that
 * can't, given how many photos the observation already holds.
 *
 * Callers pass the whole batch at once: the cap is tracked across the batch,
 * so selecting 15 files into an empty observation yields 10 accepted rather
 * than all 15.
 */
export function vetImageFiles(files: File[], currentCount: number): VettedImages {
  const result: VettedImages = {
    accepted: [],
    invalidType: [],
    tooLarge: [],
    exceededCap: false,
  };
  let remaining = Math.max(0, MAX_IMAGES - currentCount);

  for (const file of files) {
    if (!VALID_IMAGE_TYPES.includes(file.type)) {
      result.invalidType.push(file);
      continue;
    }
    if (file.size > MAX_FILE_SIZE) {
      result.tooLarge.push(file);
      continue;
    }
    if (remaining === 0) {
      // Everything left over is surplus; one "at the limit" message covers it.
      result.exceededCap = true;
      break;
    }
    result.accepted.push(file);
    remaining -= 1;
  }

  return result;
}
