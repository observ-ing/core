import type { QualityCriterion } from "../bindings/QualityCriterion";

/**
 * Data-quality criteria a user can require in the Explore filter.
 *
 * The criterion ids are generated from the Rust `QualityCriterion` enum
 * (`bindings/QualityCriterion.ts`) and double as the wire tokens sent in
 * `?quality=` (comma-separated). The backend additionally accepts `complete`
 * as shorthand for all of them (used by the home feed); the Explore UI always
 * sends explicit ids.
 */
export type { QualityCriterion };

/**
 * Display labels keyed by criterion. Typing this as a `Record` over the
 * generated union makes adding a criterion in Rust a frontend compile error
 * until a label is provided here, so the filter can never silently omit one.
 */
const QUALITY_CRITERION_LABELS: Record<QualityCriterion, string> = {
  HAS_DATE: "Has date",
  HAS_LOCATION: "Has location",
  PRECISE_LOCATION: "Precise location",
  HAS_MEDIA: "Has photo/sound",
  HAS_CONSENSUS_ID: "Community ID",
};

/**
 * Criteria in checklist/display order. Listing the ids explicitly (rather than
 * `Object.entries`, which widens keys to `string`) keeps `id` typed as
 * `QualityCriterion` without a type assertion; `QUALITY_CRITERION_LABELS` above
 * is the exhaustiveness guard.
 */
const QUALITY_CRITERION_ORDER: readonly QualityCriterion[] = [
  "HAS_DATE",
  "HAS_LOCATION",
  "PRECISE_LOCATION",
  "HAS_MEDIA",
  "HAS_CONSENSUS_ID",
];

export const QUALITY_CRITERIA: ReadonlyArray<{ id: QualityCriterion; label: string }> =
  QUALITY_CRITERION_ORDER.map((id) => ({ id, label: QUALITY_CRITERION_LABELS[id] }));
