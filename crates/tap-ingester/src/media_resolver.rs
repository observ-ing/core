//! Resolve `associatedMedia` strong refs to blob entries by fetching the
//! referenced `bio.lexicons.temp.v0-1.media` records from their author's PDS.
//!
//! The appview write path already has blob metadata in memory when it writes
//! the occurrence row, so it bypasses this resolution. The firehose path has
//! only the strong refs, so the ingester performs the network round trip to
//! materialize the blobs into the `associated_media` JSONB column.
//!
//! Best-effort: if a media record cannot be fetched (e.g. firehose
//! out-of-order delivery, PDS error), that ref is skipped with a warning
//! rather than failing the whole occurrence upsert. Most of the time media
//! records arrive on the firehose before the occurrence that references them
//! — the appview uploads them first — so this typically succeeds.

use atproto_blob_resolver::BlobResolver;
use observing_db::processing::AssociatedMediaRef;
use observing_db::types::{BlobEntry, BlobImage, BlobRef};
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;
use tracing::warn;

/// Fetches `bio.lexicons.temp.v0-1.media` records from PDSes and converts them to
/// the `BlobEntry` shape stored in `occurrences.associated_media`.
pub struct MediaResolver {
    blob_resolver: BlobResolver,
}

impl MediaResolver {
    pub fn new() -> Self {
        let client = Client::builder()
            .timeout(Duration::from_secs(10))
            .build()
            .expect("reqwest client build should not fail with defaults");
        Self {
            blob_resolver: BlobResolver::with_client(client),
        }
    }

    /// Resolve a slice of strong refs to blob entries. Refs that fail to
    /// resolve (invalid URI, DID resolution failure, PDS error, malformed
    /// media record) are dropped with a warning.
    pub async fn resolve(&self, refs: &[AssociatedMediaRef]) -> Vec<BlobEntry> {
        let mut entries = Vec::with_capacity(refs.len());
        for r in refs {
            match self.resolve_one(r).await {
                Some(entry) => entries.push(entry),
                None => warn!(uri = %r.uri, "Failed to resolve associatedMedia ref"),
            }
        }
        entries
    }

    async fn resolve_one(&self, r: &AssociatedMediaRef) -> Option<BlobEntry> {
        let record = self
            .blob_resolver
            .fetch_record_by_aturi(&r.uri)
            .await
            .ok()?;
        media_record_to_blob_entry(&record)
    }
}

impl Default for MediaResolver {
    fn default() -> Self {
        Self::new()
    }
}

/// Pull the blob ref, mime type, alt text, and license out of a `bio.lexicons.temp.v0-1.media`
/// record JSON to build a `BlobEntry`. Returns `None` if the record is missing
/// the required blob fields.
fn media_record_to_blob_entry(record: &Value) -> Option<BlobEntry> {
    let image = record.get("image")?;
    let cid = image
        .get("ref")
        .and_then(|r| r.get("$link"))
        .and_then(|l| l.as_str())?
        .to_string();
    let mime_type = image.get("mimeType").and_then(|m| m.as_str())?.to_string();
    let alt = record
        .get("alt")
        .and_then(|a| a.as_str())
        .map(|s| s.to_string());
    let license = record
        .get("license")
        .and_then(|a| a.as_str())
        .map(|s| s.to_string());
    Some(BlobEntry {
        image: BlobImage {
            ref_: BlobRef::Link { link: cid },
            mime_type,
        },
        alt,
        license,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn extracts_blob_entry_from_canonical_media_record() {
        let record = json!({
            "$type": "bio.lexicons.temp.v0-1.media",
            "image": {
                "$type": "blob",
                "ref": { "$link": "bafyreiabc123" },
                "mimeType": "image/jpeg",
                "size": 12345,
            },
            "alt": "A ruby-throated hummingbird at a feeder.",
            "license": "CC-BY-4.0",
        });

        let entry = media_record_to_blob_entry(&record).expect("should parse");
        match &entry.image.ref_ {
            BlobRef::Link { link } => assert_eq!(link, "bafyreiabc123"),
            _ => panic!("expected Link variant"),
        }
        assert_eq!(entry.image.mime_type, "image/jpeg");
        assert_eq!(
            entry.alt.as_deref(),
            Some("A ruby-throated hummingbird at a feeder.")
        );
        assert_eq!(entry.license.as_deref(), Some("CC-BY-4.0"));
    }

    #[test]
    fn alt_is_optional() {
        let record = json!({
            "image": {
                "ref": { "$link": "bafyreiabc" },
                "mimeType": "image/png",
            }
        });
        let entry = media_record_to_blob_entry(&record).expect("should parse");
        assert!(entry.alt.is_none());
        assert!(entry.license.is_none());
    }

    #[test]
    fn returns_none_without_image() {
        let record = json!({ "alt": "no image here" });
        assert!(media_record_to_blob_entry(&record).is_none());
    }

    #[test]
    fn returns_none_without_cid() {
        let record = json!({
            "image": { "mimeType": "image/png" }
        });
        assert!(media_record_to_blob_entry(&record).is_none());
    }

    #[test]
    fn returns_none_without_mime_type() {
        let record = json!({
            "image": { "ref": { "$link": "bafyreiabc" } }
        });
        assert!(media_record_to_blob_entry(&record).is_none());
    }
}
