//! Resolve `associatedMedia` strong refs to blob entries by fetching the
//! referenced `bio.lexicons.temp.v0-1.media` records from their author's PDS.
//!
//! The appview write path already has blob metadata in memory when it writes
//! the occurrence row, so it bypasses this resolution. The firehose path has
//! only the strong refs, so the ingester performs the network round trip to
//! materialize the blobs into the `associated_media` JSONB column.
//!
//! When a Slingshot endpoint is configured, the resolver tries it first.
//! Slingshot is a firehose-warmed edge cache (https://slingshot.microcosm.blue)
//! that mirrors `com.atproto.repo.getRecord`, so a hit avoids both the
//! plc.directory DID lookup and the cold PDS round trip. On any non-success
//! response the resolver falls back to the direct PDS path.
//!
//! Best-effort: if a media record cannot be fetched (e.g. firehose
//! out-of-order delivery, PDS error), that ref is skipped with a warning
//! rather than failing the whole occurrence upsert. Most of the time media
//! records arrive on the firehose before the occurrence that references them
//! — the appview uploads them first — so this typically succeeds.

use at_uri_parser::AtUri;
use atproto_blob_resolver::BlobResolver;
use atproto_identity::Did;
use observing_db::processing::AssociatedMediaRef;
use observing_db::types::{BlobEntry, BlobImage, BlobRef};
use reqwest::Client;
use serde_json::Value;
use std::time::Duration;
use tracing::warn;

/// Fetches `bio.lexicons.temp.v0-1.media` records from PDSes (or Slingshot when
/// configured) and converts them to the `BlobEntry` shape stored in
/// `occurrences.associated_media`.
pub struct MediaResolver {
    client: Client,
    blob_resolver: BlobResolver,
    /// Optional Slingshot base URL (e.g. `https://slingshot.microcosm.blue`).
    /// Trailing slash is normalized away at construction.
    slingshot_url: Option<String>,
}

impl MediaResolver {
    pub fn new(slingshot_url: Option<String>) -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(10))
                .user_agent(concat!("observing-ingester/", env!("CARGO_PKG_VERSION")))
                .build()
                .expect("reqwest client build should not fail with defaults"),
            blob_resolver: BlobResolver::new(),
            slingshot_url: slingshot_url.map(|s| s.trim_end_matches('/').to_string()),
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
        let at_uri = AtUri::parse(&r.uri)?;

        if let Some(base) = &self.slingshot_url {
            if let Some(record) = self
                .fetch_record(base, &at_uri.did, &at_uri.collection, &at_uri.rkey)
                .await
            {
                return media_record_to_blob_entry(&record);
            }
        }

        let did = Did::parse(&at_uri.did).ok()?;
        let pds_url = self.blob_resolver.resolve_pds_url(&did).await.ok()?;
        let record = self
            .fetch_record(&pds_url, &at_uri.did, &at_uri.collection, &at_uri.rkey)
            .await?;
        media_record_to_blob_entry(&record)
    }

    async fn fetch_record(
        &self,
        base_url: &str,
        did: &str,
        collection: &str,
        rkey: &str,
    ) -> Option<Value> {
        let url = build_get_record_url(base_url, did, collection, rkey);
        let resp = self.client.get(&url).send().await.ok()?;
        if !resp.status().is_success() {
            return None;
        }
        let body: Value = resp.json().await.ok()?;
        // getRecord wraps the record in `{ uri, cid, value }`.
        body.get("value").cloned()
    }
}

impl Default for MediaResolver {
    fn default() -> Self {
        Self::new(None)
    }
}

fn build_get_record_url(base_url: &str, did: &str, collection: &str, rkey: &str) -> String {
    format!(
        "{}/xrpc/com.atproto.repo.getRecord?repo={}&collection={}&rkey={}",
        base_url.trim_end_matches('/'),
        urlencoding::encode(did),
        urlencoding::encode(collection),
        urlencoding::encode(rkey),
    )
}

/// Pull the blob ref, mime type, and alt text out of a `bio.lexicons.temp.v0-1.media`
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
    Some(BlobEntry {
        image: BlobImage {
            ref_: BlobRef::Link { link: cid },
            mime_type,
        },
        alt,
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

    #[test]
    fn builds_get_record_url_with_url_encoding() {
        let url = build_get_record_url(
            "https://slingshot.microcosm.blue",
            "did:plc:z72i7hdynmk6r22z27h6tvur",
            "bio.lexicons.temp.v0-1.media",
            "3kabc",
        );
        assert_eq!(
            url,
            "https://slingshot.microcosm.blue/xrpc/com.atproto.repo.getRecord\
             ?repo=did%3Aplc%3Az72i7hdynmk6r22z27h6tvur\
             &collection=bio.lexicons.temp.v0-1.media\
             &rkey=3kabc"
        );
    }

    #[test]
    fn build_get_record_url_normalizes_trailing_slash() {
        let with = build_get_record_url("https://example.com/", "did:plc:x", "c", "r");
        let without = build_get_record_url("https://example.com", "did:plc:x", "c", "r");
        assert_eq!(with, without);
    }

    #[test]
    fn slingshot_url_trims_trailing_slash_at_construction() {
        let r = MediaResolver::new(Some("https://slingshot.microcosm.blue/".to_string()));
        assert_eq!(
            r.slingshot_url.as_deref(),
            Some("https://slingshot.microcosm.blue")
        );
    }

    #[test]
    fn slingshot_disabled_when_none() {
        let r = MediaResolver::new(None);
        assert!(r.slingshot_url.is_none());
    }
}
