mod auto_id;
// `pub(crate)` so `openapi.rs` can reach the `#[utoipa::path]` items, which
// the re-exports below don't carry.
pub(crate) mod read;
mod remarks;
pub(crate) mod write;

pub use read::{get_bbox, get_feed, get_geojson, get_nearby, get_occurrence};
pub use write::{create_occurrence, delete_occurrence, update_occurrence};
