/**
 * Data-quality criteria a user can require in the Explore filter.
 *
 * The ids double as the wire tokens sent in `?quality=` (comma-separated) and
 * mirror the criteria shown in the observation DataQualitySection, so the UI,
 * the filter, and the backend share one vocabulary. The server also accepts
 * `complete` as shorthand for all of them (used by the home feed); the Explore
 * UI always sends explicit ids.
 */
export type QualityCriterion = "date" | "location" | "precise" | "media" | "consensus";

export const QUALITY_CRITERIA: ReadonlyArray<{ id: QualityCriterion; label: string }> = [
  { id: "date", label: "Has date" },
  { id: "location", label: "Has location" },
  { id: "precise", label: "Precise location" },
  { id: "media", label: "Has photo/sound" },
  { id: "consensus", label: "Community ID" },
];
