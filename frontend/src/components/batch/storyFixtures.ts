import type { BatchObservation, BatchPhoto } from "../../lib/batchUpload";

const PHOTO_URLS = [
  "https://commons.wikimedia.org/wiki/Special:FilePath/Quercus_robur.jpg?width=400",
  "https://commons.wikimedia.org/wiki/Special:FilePath/Eschscholzia_californica_2.jpg?width=400",
  "https://commons.wikimedia.org/wiki/Special:FilePath/Hippodamia_convergens.jpg?width=400",
];

const EXIF = {
  date: "2026-10-03T10:42",
  utcOffset: "-07:00",
  latitude: 37.905,
  longitude: -122.2445,
  accuracyMeters: 12,
};

export function storyPhoto(index: number, read = true): BatchPhoto {
  const name = `IMG_${4412 + index}.jpg`;
  return {
    id: `p${index}`,
    file: new File([], name, { type: "image/jpeg" }),
    previewUrl: PHOTO_URLS[index % PHOTO_URLS.length] ?? "",
    exif: read ? EXIF : null,
  };
}

export function storyObservation(overrides: Partial<BatchObservation> = {}): BatchObservation {
  return {
    id: "o1",
    photos: [storyPhoto(0)],
    taxon: { name: "", match: null, kingdom: "", rank: "" },
    date: EXIF.date,
    endDate: "",
    utcOffset: EXIF.utcOffset,
    latitude: EXIF.latitude,
    longitude: EXIF.longitude,
    uncertaintyMeters: EXIF.accuracyMeters,
    remarks: "",
    status: "idle",
    ...overrides,
  };
}
