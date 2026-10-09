import { describe, it, expect } from "vitest";
import {
  MAX_BATCH_PHOTOS,
  batchReducer,
  canCombine,
  describeMissing,
  intersectRects,
  initialBatchState,
  isReading,
  missingFields,
  runPool,
  toEventDate,
  toObservationInput,
  vetBatchFiles,
  type BatchAction,
  type BatchPhoto,
  type BatchState,
} from "./batchUpload";
import { MAX_FILE_SIZE, MAX_IMAGES } from "./imageSelection";
import { EMPTY_EXIF, type PhotoExif } from "./exif";

function imageFile(name: string, { type = "image/jpeg", size = 1024 } = {}): File {
  const file = new File([""], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}

const OAKLAND: PhotoExif = {
  date: "2026-10-03T10:42",
  utcOffset: "-07:00",
  latitude: 37.905,
  longitude: -122.2445,
  accuracyMeters: 12,
};

function photo(id: string, exif: PhotoExif | null = OAKLAND): BatchPhoto {
  return { id, file: imageFile(`${id}.jpg`), previewUrl: `blob:${id}`, exif };
}

function run(actions: BatchAction[], from: BatchState = initialBatchState): BatchState {
  return actions.reduce(batchReducer, from);
}

/** A batch of one observation per photo id, each already read. */
function batchOf(...ids: string[]): BatchState {
  return run([{ type: "addPhotos", photos: ids.map((id) => photo(id)) }]);
}

const photoIds = (state: BatchState) => state.observations.map((o) => o.photos.map((p) => p.id));

describe("adding photos", () => {
  it("makes one observation per photo, seeded from its EXIF", () => {
    const state = batchOf("a", "b");

    expect(photoIds(state)).toEqual([["a"], ["b"]]);
    expect(state.observations[0]).toMatchObject({
      date: "2026-10-03T10:42",
      utcOffset: "-07:00",
      latitude: 37.905,
      longitude: -122.2445,
      uncertaintyMeters: 12,
    });
  });

  it("is reading until the photo's EXIF arrives, then fills in what it found", () => {
    let state = run([{ type: "addPhotos", photos: [photo("a", null)] }]);
    const [pending] = state.observations;
    expect(pending && isReading(pending)).toBe(true);
    expect(pending?.date).toBe("");

    state = batchReducer(state, { type: "exifLoaded", photoId: "a", exif: OAKLAND });

    const [loaded] = state.observations;
    expect(loaded && isReading(loaded)).toBe(false);
    expect(loaded).toMatchObject({ date: "2026-10-03T10:42", latitude: 37.905 });
    expect(loaded?.uncertaintyMeters).toBe(12);
  });

  it("leaves date and location empty when the photo has none, with 50 m uncertainty", () => {
    const state = run([
      { type: "addPhotos", photos: [photo("a", null)] },
      { type: "exifLoaded", photoId: "a", exif: EMPTY_EXIF },
    ]);

    const [obs] = state.observations;
    expect(obs).toMatchObject({ date: "", latitude: null, longitude: null });
    expect(obs?.uncertaintyMeters).toBe(50);
    expect(obs && missingFields(obs)).toEqual(["date", "location"]);
  });

  it("does not overwrite values entered while the photo was still being read", () => {
    const state = run([
      { type: "addPhotos", photos: [photo("a", null)] },
      { type: "select", id: "o1", additive: false },
      { type: "edit", patch: { date: "2020-01-01T09:00" } },
      { type: "exifLoaded", photoId: "a", exif: OAKLAND },
    ]);

    expect(state.observations[0]?.date).toBe("2020-01-01T09:00");
    expect(state.observations[0]?.latitude).toBe(37.905);
  });
});

describe("adding photos to an existing observation", () => {
  it("appends them and keeps the observation's own values", () => {
    const state = run(
      [
        { type: "select", id: "o1", additive: false },
        { type: "edit", patch: { remarks: "mine" } },
        { type: "addPhotos", photos: [photo("x", null), photo("y", null)], targetId: "o1" },
        { type: "exifLoaded", photoId: "x", exif: { ...OAKLAND, date: "2001-01-01T00:00" } },
      ],
      batchOf("a", "b"),
    );

    expect(photoIds(state)).toEqual([["a", "x", "y"], ["b"]]);
    expect(state.observations[0]).toMatchObject({ remarks: "mine", date: "2026-10-03T10:42" });
    const [target] = state.observations;
    expect(target && isReading(target)).toBe(true);
  });

  it("fills a missing date and location from the added photo's EXIF", () => {
    const state = run([
      { type: "addPhotos", photos: [photo("a", EMPTY_EXIF)] },
      { type: "addPhotos", photos: [photo("x", null)], targetId: "o1" },
      { type: "exifLoaded", photoId: "x", exif: OAKLAND },
    ]);

    expect(state.observations[0]).toMatchObject({ date: "2026-10-03T10:42", latitude: 37.905 });
  });

  it("refuses photos that would exceed the per-observation limit", () => {
    const state = batchOf("a");
    const tooMany = Array.from({ length: MAX_IMAGES }, (_, i) => photo(`x${i}`));

    expect(batchReducer(state, { type: "addPhotos", photos: tooMany, targetId: "o1" })).toBe(state);
  });
});

describe("selection and editing", () => {
  it("replaces the selection on a plain click and toggles on an additive one", () => {
    let state = run(
      [
        { type: "select", id: "o1", additive: false },
        { type: "select", id: "o2", additive: true },
      ],
      batchOf("a", "b", "c"),
    );
    expect(state.selected).toEqual(["o1", "o2"]);

    state = batchReducer(state, { type: "select", id: "o1", additive: true });
    expect(state.selected).toEqual(["o2"]);

    state = batchReducer(state, { type: "select", id: "o3", additive: false });
    expect(state.selected).toEqual(["o3"]);
  });

  it("applies an edit to every selected observation and no others", () => {
    const state = run(
      [
        { type: "selectAll", ids: ["o1", "o2"] },
        { type: "edit", patch: { remarks: "creek trail", taxon: { name: "Quercus" } } },
      ],
      batchOf("a", "b", "c"),
    );

    expect(state.observations.map((o) => o.remarks)).toEqual(["creek trail", "creek trail", ""]);
    expect(state.observations.map((o) => o.taxon.name)).toEqual(["Quercus", "Quercus", ""]);
  });

  it("removes the selected observations", () => {
    const state = run(
      [{ type: "selectAll", ids: ["o1", "o3"] }, { type: "removeSelected" }],
      batchOf("a", "b", "c"),
    );

    expect(photoIds(state)).toEqual([["b"]]);
    expect(state.selected).toEqual([]);
  });
});

describe("combining", () => {
  it("moves photos onto the target, whose own values win", () => {
    const state = run(
      [
        { type: "select", id: "o1", additive: false },
        { type: "edit", patch: { remarks: "target" } },
        { type: "select", id: "o2", additive: false },
        {
          type: "edit",
          patch: { remarks: "donor", taxon: { name: "Quercus", kingdom: "Plantae" } },
        },
        { type: "movePhotos", photoIds: ["b"], targetId: "o1" },
      ],
      batchOf("a", "b"),
    );

    expect(photoIds(state)).toEqual([["a", "b"]]);
    expect(state.observations[0]?.remarks).toBe("target");
    // The target had no identification, so the donor's fills the blank.
    expect(state.observations[0]?.taxon).toMatchObject({ name: "Quercus", kingdom: "Plantae" });
    expect(state.selected).toEqual(["o1"]);
  });

  it("fills a target's missing date and location from the dragged card", () => {
    const state = run([
      { type: "addPhotos", photos: [photo("a", EMPTY_EXIF), photo("b")] },
      { type: "movePhotos", photoIds: ["b"], targetId: "o1" },
    ]);

    expect(state.observations[0]).toMatchObject({
      date: "2026-10-03T10:42",
      utcOffset: "-07:00",
      latitude: 37.905,
      uncertaintyMeters: 12,
    });
  });

  it("combines the selection into its first observation", () => {
    const state = run(
      [{ type: "selectAll", ids: ["o2", "o3"] }, { type: "combineSelected" }],
      batchOf("a", "b", "c"),
    );

    expect(photoIds(state)).toEqual([["a"], ["b", "c"]]);
  });

  it("refuses a combine that would exceed the per-observation photo limit", () => {
    const ids = Array.from({ length: MAX_IMAGES + 1 }, (_, i) => `p${i}`);
    const full = run(
      [
        {
          type: "movePhotos",
          photoIds: ids.slice(1, MAX_IMAGES),
          targetId: "o1",
        },
      ],
      batchOf(...ids),
    );
    expect(full.observations[0]?.photos).toHaveLength(MAX_IMAGES);
    const [target, extra] = full.observations;
    expect(target && extra && canCombine([target, extra])).toBe(false);

    const after = batchReducer(full, {
      type: "movePhotos",
      photoIds: [`p${MAX_IMAGES}`],
      targetId: "o1",
    });

    expect(after).toBe(full);
  });
});

describe("splitting", () => {
  const combined = () =>
    run([
      { type: "addPhotos", photos: [photo("a"), photo("b", EMPTY_EXIF), photo("c")] },
      { type: "selectAll", ids: ["o1", "o2", "o3"] },
      { type: "combineSelected" },
      { type: "edit", patch: { remarks: "shared", taxon: { name: "Quercus" } } },
    ]);

  it("gives a photo dragged out its own observation built only from its EXIF", () => {
    const state = batchReducer(combined(), { type: "movePhotos", photoIds: ["b"], targetId: null });

    expect(photoIds(state)).toEqual([["a", "c"], ["b"]]);
    const fresh = state.observations[1];
    expect(fresh).toMatchObject({ date: "", latitude: null, remarks: "" });
    expect(fresh?.taxon.name).toBe("");
    expect(fresh && missingFields(fresh)).toEqual(["date", "location"]);
    expect(state.selected).toEqual([fresh?.id]);
  });

  it("splits every photo of the selected observations apart", () => {
    const state = batchReducer(combined(), { type: "splitSelected" });

    expect(photoIds(state)).toEqual([["a"], ["b"], ["c"]]);
    // The first photo keeps the observation; the rest start over.
    expect(state.observations.map((o) => o.remarks)).toEqual(["shared", "", ""]);
    expect(state.observations[2]).toMatchObject({ date: "2026-10-03T10:42", latitude: 37.905 });
    expect(state.selected).toHaveLength(3);
  });

  it("does nothing when a whole observation is dragged to a new one", () => {
    const state = batchOf("a", "b");

    expect(batchReducer(state, { type: "movePhotos", photoIds: ["a"], targetId: null })).toBe(
      state,
    );
  });
});

describe("reordering", () => {
  it("moves a photo to the given position, changing the cover", () => {
    const state = run(
      [
        { type: "selectAll", ids: ["o1", "o2", "o3"] },
        { type: "combineSelected" },
        { type: "reorderPhoto", observationId: "o1", photoId: "c", index: 0 },
      ],
      batchOf("a", "b", "c"),
    );

    expect(photoIds(state)).toEqual([["c", "a", "b"]]);
  });
});

describe("upload bookkeeping", () => {
  it("drops an uploaded observation and counts it", () => {
    const state = run(
      [
        { type: "selectAll", ids: ["o1", "o2"] },
        { type: "setStatus", ids: ["o1", "o2"], status: "queued" },
        { type: "uploaded", id: "o1" },
        { type: "setStatus", ids: ["o2"], status: "failed", error: "boom" },
      ],
      batchOf("a", "b"),
    );

    expect(photoIds(state)).toEqual([["b"]]);
    expect(state.uploadedCount).toBe(1);
    expect(state.selected).toEqual(["o2"]);
    expect(state.observations[0]).toMatchObject({ status: "failed", error: "boom" });
  });

  it("returns cancelled observations to idle", () => {
    const state = run(
      [
        { type: "setStatus", ids: ["o1", "o2"], status: "queued" },
        { type: "setStatus", ids: ["o1"], status: "uploading" },
        { type: "resetQueued" },
      ],
      batchOf("a", "b"),
    );

    expect(state.observations.map((o) => o.status)).toEqual(["uploading", "idle"]);
  });
});

describe("completeness", () => {
  const edited = (patch: Extract<BatchAction, { type: "edit" }>["patch"]) => {
    const state = run(
      [
        { type: "select", id: "o1", additive: false },
        { type: "edit", patch },
      ],
      batchOf("a"),
    );
    const [obs] = state.observations;
    if (!obs) throw new Error("no observation");
    return obs;
  };

  it("is complete with a date and a location", () => {
    expect(missingFields(edited({}))).toEqual([]);
  });

  it("needs a kingdom for a name that is not in the taxonomy", () => {
    expect(missingFields(edited({ taxon: { name: "Hippodamia sp. A" } }))).toEqual(["kingdom"]);
    expect(
      missingFields(edited({ taxon: { name: "Hippodamia sp. A", kingdom: "Animalia" } })),
    ).toEqual([]);
  });

  it("rejects an end date before the start date", () => {
    expect(missingFields(edited({ endDate: "2026-10-01" }))).toEqual(["endDate"]);
    expect(missingFields(edited({ endDate: "2026-10-05" }))).toEqual([]);
  });
});

describe("describeMissing", () => {
  it("names what is missing in one sentence", () => {
    expect(describeMissing(["date"])).toBe("Missing date");
    expect(describeMissing(["date", "location"])).toBe("Missing date and location");
    expect(describeMissing(["date", "location", "kingdom"])).toBe(
      "Missing date, location, and kingdom",
    );
  });

  it("reports an end date before the start in its own words", () => {
    expect(describeMissing(["endDate"])).toBe("End date is before start");
    expect(describeMissing(["location", "endDate"])).toBe(
      "Missing location. End date is before start",
    );
  });
});

describe("intersectRects", () => {
  const box = (left: number, top: number, right: number, bottom: number) => ({
    left,
    top,
    right,
    bottom,
  });

  it("returns the overlap of two rectangles", () => {
    expect(intersectRects(box(0, 0, 10, 10), box(5, 6, 20, 20))).toEqual(box(5, 6, 10, 10));
  });

  it("returns null when they are apart or only touch", () => {
    expect(intersectRects(box(0, 0, 10, 10), box(11, 0, 20, 10))).toBeNull();
    expect(intersectRects(box(0, 0, 10, 10), box(10, 0, 20, 10))).toBeNull();
  });
});

describe("building the request", () => {
  const observation = (patch: Extract<BatchAction, { type: "edit" }>["patch"] = {}) => {
    const state = run(
      [
        { type: "select", id: "o1", additive: false },
        { type: "edit", patch },
      ],
      batchOf("a"),
    );
    const [obs] = state.observations;
    if (!obs) throw new Error("no observation");
    return obs;
  };

  it("reads the capture time in the zone it was taken in", () => {
    expect(toEventDate(observation())).toBe("2026-10-03T17:42:00.000Z");
  });

  it("sends a day range when there is an end date", () => {
    expect(toEventDate(observation({ endDate: "2026-10-05" }))).toBe("2026-10-03/2026-10-05");
  });

  it("sends the matched taxon's id and omits rank", () => {
    const input = toObservationInput(
      observation({
        remarks: "  worn wings ",
        taxon: {
          name: "Hippodamia convergens",
          kingdom: "Animalia",
          match: {
            id: "hippodamia-convergens",
            taxonId: "gbif:1",
            scientificName: "Hippodamia convergens",
            rank: "species",
          },
        },
      }),
      "CC-BY-4.0",
      [{ data: "abc", mimeType: "image/jpeg" }],
    );

    expect(input).toEqual({
      scientificName: "Hippodamia convergens",
      kingdom: "Animalia",
      taxonId: "gbif:1",
      latitude: 37.905,
      longitude: -122.2445,
      coordinateUncertaintyInMeters: 12,
      license: "CC-BY-4.0",
      eventDate: "2026-10-03T17:42:00.000Z",
      occurrenceRemarks: "worn wings",
      images: [{ data: "abc", mimeType: "image/jpeg" }],
    });
  });

  it("sends kingdom and rank for an unmatched name, and no taxon when blank", () => {
    const unmatched = toObservationInput(
      observation({ taxon: { name: "Hippodamia sp. A", kingdom: "Animalia", rank: "species" } }),
      "CC0-1.0",
      [],
    );
    expect(unmatched).toMatchObject({
      scientificName: "Hippodamia sp. A",
      kingdom: "Animalia",
      taxonRank: "species",
    });
    expect(unmatched).not.toHaveProperty("taxonId");

    const blank = toObservationInput(observation(), "CC0-1.0", []);
    expect(blank).not.toHaveProperty("scientificName");
    expect(blank).not.toHaveProperty("occurrenceRemarks");
  });
});

describe("vetBatchFiles", () => {
  it("accepts valid files and explains each skipped one, in drop order", () => {
    const files = [
      imageFile("IMG_5001.heic", { type: "image/heic" }),
      imageFile("ok.jpg"),
      imageFile("pano.jpg", { size: MAX_FILE_SIZE + 1 }),
      imageFile("over.jpg"),
    ];

    const result = vetBatchFiles(files, MAX_BATCH_PHOTOS - 1);

    expect(result.accepted.map((f) => f.name)).toEqual(["ok.jpg"]);
    expect(result.skipped).toEqual([
      { name: "IMG_5001.heic", reason: "Not a JPEG, PNG, or WebP" },
      { name: "pano.jpg", reason: "Larger than 10 MB" },
      { name: "over.jpg", reason: "Over the 100-photo limit" },
    ]);
  });
});

describe("runPool", () => {
  it("runs every item with at most `limit` in flight", async () => {
    let inFlight = 0;
    let peak = 0;
    const done: number[] = [];

    await runPool([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
      done.push(n);
    });

    expect(peak).toBe(3);
    expect(done.toSorted((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});
