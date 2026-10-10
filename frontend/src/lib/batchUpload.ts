// State for the batch uploader: a list of observations-to-be, each holding one
// or more photos, plus the selection. Kept as a pure reducer so grouping,
// splitting, and completeness rules can be tested without mounting the page.
import type { ObservationInput } from "../services/api";
import type { TaxaResult } from "../services/types";
import type { PhotoExif } from "./exif";
import { MAX_IMAGES, vetImageFiles } from "./imageSelection";

/** Most photos one batch can hold. */
export const MAX_BATCH_PHOTOS = 100;

/** Uncertainty radius for a location with no known accuracy. */
export const DEFAULT_UNCERTAINTY_METERS = 50;

export interface BatchPhoto {
  id: string;
  file: File;
  previewUrl: string;
  /** `null` until the file has been read. Kept so a split can start over from it. */
  exif: PhotoExif | null;
}

export interface BatchTaxon {
  name: string;
  /** The taxonomy entry the name was picked from, or `null` for free text. */
  match: TaxaResult | null;
  kingdom: string;
  rank: string;
}

/**
 * "done" observations have been uploaded. They stay in the list, so the grid
 * doesn't shuffle while others are still going, until `clearDone`.
 */
export type UploadStatus = "idle" | "queued" | "uploading" | "failed" | "done";

export interface BatchObservation {
  id: string;
  /** Never empty. The first photo is the cover and the one sent to visual ID. */
  photos: BatchPhoto[];
  taxon: BatchTaxon;
  /** Wall-clock `datetime-local` value, or "" when unknown. */
  date: string;
  /** Optional `YYYY-MM-DD` end of a day range. */
  endDate: string;
  /** UTC offset `date` is in; `null` means the browser's own zone. */
  utcOffset: string | null;
  latitude: number | null;
  longitude: number | null;
  uncertaintyMeters: number;
  remarks: string;
  status: UploadStatus;
  error?: string;
}

export interface BatchState {
  observations: BatchObservation[];
  selected: string[];
  nextId: number;
  /** Observations uploaded so far, whether or not they have been cleared yet. */
  uploadedCount: number;
}

export const initialBatchState: BatchState = {
  observations: [],
  selected: [],
  nextId: 1,
  uploadedCount: 0,
};

export type BatchEdit = Partial<
  Pick<
    BatchObservation,
    "date" | "endDate" | "utcOffset" | "latitude" | "longitude" | "uncertaintyMeters" | "remarks"
  >
> & { taxon?: Partial<BatchTaxon> };

export type BatchAction =
  /** New observations, one per photo; or, with `targetId`, more photos for that one. */
  | { type: "addPhotos"; photos: BatchPhoto[]; targetId?: string }
  | { type: "exifLoaded"; photoId: string; exif: PhotoExif }
  | { type: "select"; id: string; additive: boolean }
  | { type: "selectAll"; ids: string[] }
  | { type: "clearSelection" }
  | { type: "edit"; patch: BatchEdit }
  | { type: "movePhotos"; photoIds: string[]; targetId: string | null }
  | { type: "combineSelected" }
  | { type: "splitSelected" }
  | { type: "reorderPhoto"; observationId: string; photoId: string; index: number }
  | { type: "remove"; id: string }
  | { type: "removeSelected" }
  | { type: "setStatus"; ids: string[]; status: UploadStatus; error?: string }
  | { type: "uploaded"; id: string }
  | { type: "clearDone" }
  | { type: "resetQueued" };

const EMPTY_TAXON: BatchTaxon = { name: "", match: null, kingdom: "", rank: "" };

/** A new observation for `photo`, built from nothing but the photo's own EXIF. */
function observationFromPhoto(id: string, photo: BatchPhoto): BatchObservation {
  const exif = photo.exif;
  return {
    id,
    photos: [photo],
    taxon: EMPTY_TAXON,
    date: exif?.date ?? "",
    endDate: "",
    utcOffset: exif?.date ? exif.utcOffset : null,
    latitude: exif?.latitude ?? null,
    longitude: exif?.longitude ?? null,
    uncertaintyMeters: exif?.accuracyMeters ?? DEFAULT_UNCERTAINTY_METERS,
    remarks: "",
    status: "idle",
  };
}

const hasLocation = (o: BatchObservation) => o.latitude !== null && o.longitude !== null;

/** `target` with each blank field filled from `donor`; the target's own values win. */
function fillBlanks(target: BatchObservation, donor: BatchObservation): BatchObservation {
  const next = { ...target };
  if (!next.taxon.name.trim()) next.taxon = donor.taxon;
  if (!next.date) {
    next.date = donor.date;
    next.endDate = donor.endDate;
    next.utcOffset = donor.utcOffset;
  }
  if (!hasLocation(next)) {
    next.latitude = donor.latitude;
    next.longitude = donor.longitude;
    next.uncertaintyMeters = donor.uncertaintyMeters;
  }
  if (!next.remarks.trim()) next.remarks = donor.remarks;
  return next;
}

function movePhotos(state: BatchState, photoIds: string[], targetId: string | null): BatchState {
  const target = state.observations.find((o) => o.id === targetId);
  if (targetId !== null && !target) return state;

  const ids = new Set(photoIds);
  target?.photos.forEach((p) => ids.delete(p.id));
  const donors = state.observations.filter(
    (o) => o.id !== targetId && o.photos.some((p) => ids.has(p.id)),
  );
  const moved = donors.flatMap((o) => o.photos.filter((p) => ids.has(p.id)));
  const [firstDonor] = donors;
  const [firstMoved] = moved;
  if (!firstDonor || !firstMoved) return state;

  const without = (o: BatchObservation) => ({
    ...o,
    photos: o.photos.filter((p) => !ids.has(p.id)),
  });

  if (target) {
    if (target.photos.length + moved.length > MAX_IMAGES) return state;
    const observations = state.observations
      .map((o) =>
        o.id === target.id
          ? { ...donors.reduce(fillBlanks, o), photos: [...o.photos, ...moved] }
          : without(o),
      )
      .filter((o) => o.photos.length > 0);
    return { ...state, observations, selected: [target.id] };
  }

  // Dragging out everything an observation holds would only recreate it.
  if (donors.length === 1 && moved.length === firstDonor.photos.length) return state;

  // A split-off photo starts over from its own EXIF and inherits nothing.
  const fresh = {
    ...observationFromPhoto(`o${state.nextId}`, firstMoved),
    photos: moved,
  };
  const observations = state.observations.flatMap((o) => {
    const kept = without(o);
    const rest = kept.photos.length > 0 ? [kept] : [];
    return o.id === firstDonor.id ? [...rest, fresh] : rest;
  });
  return { ...state, observations, selected: [fresh.id], nextId: state.nextId + 1 };
}

function splitSelected(state: BatchState): BatchState {
  let nextId = state.nextId;
  const selected: string[] = [];
  const observations = state.observations.flatMap((o) => {
    if (!state.selected.includes(o.id)) return [o];
    const [cover, ...rest] = o.photos;
    if (!cover) return [];
    const parts = [
      { ...o, photos: [cover] },
      ...rest.map((p) => observationFromPhoto(`o${nextId++}`, p)),
    ];
    selected.push(...parts.map((part) => part.id));
    return parts;
  });
  return { ...state, observations, selected, nextId };
}

function exifLoaded(state: BatchState, photoId: string, exif: PhotoExif): BatchState {
  const observations = state.observations.map((o) => {
    if (!o.photos.some((p) => p.id === photoId)) return o;
    const next = { ...o, photos: o.photos.map((p) => (p.id === photoId ? { ...p, exif } : p)) };
    // Only fill blanks: the user may have typed a value while the file was read.
    if (!next.date && exif.date) {
      next.date = exif.date;
      next.utcOffset = exif.utcOffset;
    }
    if (!hasLocation(next) && exif.latitude !== null && exif.longitude !== null) {
      next.latitude = exif.latitude;
      next.longitude = exif.longitude;
      next.uncertaintyMeters = exif.accuracyMeters ?? next.uncertaintyMeters;
    }
    return next;
  });
  return { ...state, observations };
}

export function batchReducer(state: BatchState, action: BatchAction): BatchState {
  switch (action.type) {
    case "addPhotos": {
      if (action.targetId !== undefined) {
        const target = state.observations.find((o) => o.id === action.targetId);
        if (!target || target.photos.length + action.photos.length > MAX_IMAGES) return state;
        // Its values stay as they are; `exifLoaded` fills any blanks as each file is read.
        const observations = state.observations.map((o) =>
          o === target ? { ...o, photos: [...o.photos, ...action.photos] } : o,
        );
        return { ...state, observations };
      }
      const added = action.photos.map((p, i) => observationFromPhoto(`o${state.nextId + i}`, p));
      return {
        ...state,
        observations: [...state.observations, ...added],
        nextId: state.nextId + added.length,
      };
    }
    case "exifLoaded":
      return exifLoaded(state, action.photoId, action.exif);
    case "select": {
      if (!action.additive) return { ...state, selected: [action.id] };
      const selected = state.selected.includes(action.id)
        ? state.selected.filter((id) => id !== action.id)
        : [...state.selected, action.id];
      return { ...state, selected };
    }
    case "selectAll":
      return { ...state, selected: action.ids };
    case "clearSelection":
      return { ...state, selected: [] };
    case "edit": {
      const { taxon, ...fields } = action.patch;
      const observations = state.observations.map((o) =>
        state.selected.includes(o.id)
          ? { ...o, ...fields, ...(taxon ? { taxon: { ...o.taxon, ...taxon } } : {}) }
          : o,
      );
      return { ...state, observations };
    }
    case "movePhotos":
      return movePhotos(state, action.photoIds, action.targetId);
    case "combineSelected": {
      const picked = state.observations.filter((o) => state.selected.includes(o.id));
      const [target, ...rest] = picked;
      if (!target) return state;
      const photoIds = rest.flatMap((o) => o.photos.map((p) => p.id));
      return movePhotos(state, photoIds, target.id);
    }
    case "splitSelected":
      return splitSelected(state);
    case "reorderPhoto": {
      const observations = state.observations.map((o) => {
        const photo = o.photos.find((p) => p.id === action.photoId);
        if (o.id !== action.observationId || !photo) return o;
        const photos = o.photos.filter((p) => p !== photo);
        photos.splice(action.index, 0, photo);
        return { ...o, photos };
      });
      return { ...state, observations };
    }
    case "remove":
      return {
        ...state,
        observations: state.observations.filter((o) => o.id !== action.id),
        selected: state.selected.filter((id) => id !== action.id),
      };
    case "removeSelected":
      return {
        ...state,
        observations: state.observations.filter((o) => !state.selected.includes(o.id)),
        selected: [],
      };
    case "setStatus": {
      const observations = state.observations.map((o) => {
        if (!action.ids.includes(o.id)) return o;
        const { error: _previous, ...rest } = o;
        return {
          ...rest,
          status: action.status,
          ...(action.error !== undefined ? { error: action.error } : {}),
        };
      });
      return { ...state, observations };
    }
    case "uploaded":
      return {
        ...state,
        observations: state.observations.map((o) =>
          o.id === action.id ? { ...o, status: "done" as const } : o,
        ),
        selected: state.selected.filter((id) => id !== action.id),
        uploadedCount: state.uploadedCount + 1,
      };
    case "clearDone":
      return {
        ...state,
        observations: state.observations.filter((o) => o.status !== "done"),
      };
    case "resetQueued":
      return {
        ...state,
        observations: state.observations.map((o) =>
          o.status === "queued" ? { ...o, status: "idle" } : o,
        ),
      };
  }
}

/** True while any of the observation's photos is still being read. */
export function isReading(observation: BatchObservation): boolean {
  return observation.photos.some((p) => p.exif === null);
}

export type MissingField = "date" | "location" | "kingdom" | "endDate";

/** What still has to be fixed before the observation can be uploaded. */
export function missingFields(observation: BatchObservation): MissingField[] {
  const missing: MissingField[] = [];
  if (!observation.date) missing.push("date");
  if (!hasLocation(observation)) missing.push("location");
  const { name, match, kingdom } = observation.taxon;
  if (name.trim() && !match && !kingdom) missing.push("kingdom");
  if (
    observation.endDate &&
    observation.date &&
    observation.endDate < observation.date.slice(0, 10)
  )
    missing.push("endDate");
  return missing;
}

/** One sentence for what `missingFields` found, e.g. "Missing date and location". */
export function describeMissing(missing: MissingField[]): string {
  const names = missing.filter((field) => field !== "endDate");
  const parts: string[] = [];
  if (names.length > 0) {
    parts.push(`Missing ${new Intl.ListFormat("en", { type: "conjunction" }).format(names)}`);
  }
  if (missing.includes("endDate")) parts.push("End date is before start");
  return parts.join(". ");
}

/** Whether these observations fit in one, under the per-observation photo limit. */
export function canCombine(observations: BatchObservation[]): boolean {
  const photos = observations.reduce((count, o) => count + o.photos.length, 0);
  return observations.length > 1 && photos <= MAX_IMAGES;
}

/** An offset in minutes east of UTC as EXIF and ISO 8601 write it, e.g. "-07:00". */
export function formatUtcOffset(minutesEast: number): string {
  const abs = Math.abs(minutesEast);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${minutesEast < 0 ? "-" : "+"}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** The offset the browser's own zone has at `date` (a `datetime-local` value), or now. */
export function browserUtcOffset(date: string): string {
  const at = date ? new Date(date) : new Date();
  return formatUtcOffset(-(isNaN(at.getTime()) ? new Date() : at).getTimezoneOffset());
}

/** Every UTC offset in civil use, west to east. */
export const UTC_OFFSETS: readonly string[] = [
  ...[-720, -660, -600, -570, -540, -480, -420, -360, -300, -240, -210, -180, -120, -60],
  ...[0, 60, 120, 180, 210, 240, 270, 300, 330, 345, 360, 390, 420, 480, 525, 540, 570],
  ...[600, 630, 660, 720, 765, 780, 840],
].map(formatUtcOffset);

export function toEventDate(observation: BatchObservation): string {
  const { date, endDate, utcOffset } = observation;
  if (endDate) return `${date.slice(0, 10)}/${endDate}`;
  // Without an offset the wall-clock time is read in the browser's zone, as
  // the single-observation form does.
  return new Date(utcOffset ? `${date}:00${utcOffset}` : date).toISOString();
}

export function toObservationInput(
  observation: BatchObservation,
  license: string,
  images: NonNullable<ObservationInput["images"]>,
): ObservationInput {
  const { taxon, latitude, longitude } = observation;
  if (latitude === null || longitude === null) {
    throw new Error("Observation has no location");
  }
  const name = taxon.name.trim();
  const remarks = observation.remarks.trim();
  return {
    ...(name ? { scientificName: name } : {}),
    ...(name && taxon.kingdom ? { kingdom: taxon.kingdom } : {}),
    ...(name && !taxon.match && taxon.rank ? { taxonRank: taxon.rank } : {}),
    ...(name && taxon.match?.taxonId ? { taxonId: taxon.match.taxonId } : {}),
    latitude,
    longitude,
    coordinateUncertaintyInMeters: observation.uncertaintyMeters,
    license,
    eventDate: toEventDate(observation),
    ...(remarks ? { occurrenceRemarks: remarks } : {}),
    ...(images.length > 0 ? { images } : {}),
  };
}

export interface SkippedFile {
  name: string;
  reason: string;
}

/** Split dropped files into the ones to add and the ones to report as skipped. */
export function vetBatchFiles(
  files: File[],
  currentPhotoCount: number,
): { accepted: File[]; skipped: SkippedFile[] } {
  const vetted = vetImageFiles(files, currentPhotoCount, MAX_BATCH_PHOTOS);
  const reasons = new Map<File, string>([
    ...vetted.invalidType.map((f) => [f, "Not a JPEG, PNG, or WebP"] as const),
    ...vetted.tooLarge.map((f) => [f, "Larger than 10 MB"] as const),
    ...vetted.overCap.map((f) => [f, `Over the ${MAX_BATCH_PHOTOS}-photo limit`] as const),
  ]);
  const skipped = files.flatMap((file) => {
    const reason = reasons.get(file);
    return reason ? [{ name: file.name, reason }] : [];
  });
  return { accepted: vetted.accepted, skipped };
}

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** The area two rectangles share, or `null` when they don't overlap. */
export function intersectRects(a: Rect, b: Rect): Rect | null {
  const rect = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return rect.left < rect.right && rect.top < rect.bottom ? rect : null;
}

/** Run `worker` over `items`, keeping at most `limit` calls in flight. */
export async function runPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const queue = [...items];
  const drain = async () => {
    for (let item = queue.shift(); item !== undefined; item = queue.shift()) {
      // eslint-disable-next-line no-await-in-loop -- each lane works through the queue in turn
      await worker(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, drain));
}
