//! Cross-posting occurrences to iNaturalist (#878).
//!
//! An occurrence is pushed once, at its owner's request. Nothing is pulled
//! back, and later edits here are not pushed.

pub mod ids;
pub mod links;
pub mod payload;

/// This destination's `service`, in `linked_accounts`, `crossposts`, and the
/// lexicon's `externalRecords`.
pub const SERVICE: &str = "inaturalist";
