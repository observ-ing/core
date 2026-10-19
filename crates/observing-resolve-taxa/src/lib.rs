//! Fills in `accepted_taxon_key` on identifications.
//!
//! Identification ingest writes `accepted_taxon_key = NULL`; a resolution
//! pass ([`pass`]) is the only thing that fills it in. The `observing-worker`
//! service runs passes on Cloud Tasks (`/tasks/resolve-taxa` in the appview),
//! and this crate's binary runs them by hand.

pub mod pass;
