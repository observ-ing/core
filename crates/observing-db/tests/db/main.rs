//! Database regression tests. One test binary for all of them, so they
//! share a single build and link; `common` is the scratch-database harness.

mod common;
mod crosspost_awaits;

mod identification_edits;
mod likes_per_record;
mod notification_dedupe;
mod occurrence_edits;
mod profile_feed;
mod remarks;
mod user_preferences;
