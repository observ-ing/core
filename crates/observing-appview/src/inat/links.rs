//! The `externalRecords` entry that ties an occurrence to its iNaturalist
//! observation: recognizing one, and writing ours onto a record.

use observing_db::types::ExternalRecordEntry;
use serde_json::Value;

use super::SERVICE;

/// Permalink of an iNaturalist observation, as written to `externalRecords`.
pub fn observation_url(site_url: &str, id: i32) -> String {
    format!("{}/observations/{id}", site_url.trim_end_matches('/'))
}

/// Whether an `externalRecords` entry points at iNaturalist. An occurrence
/// with one is already there, and cross-posting it would make the duplicate
/// `externalRecords` exists to avoid.
///
/// Matches the `service`, or a host containing `inaturalist`, the same rule as
/// `SERVICE_HOSTS` in `frontend/src/lib/externalRecords.ts`, so localized nodes
/// (inaturalist.nz, inaturalist.ca) count.
pub fn is_inat_record(entry: &ExternalRecordEntry) -> bool {
    let by_service = entry
        .service
        .as_deref()
        .is_some_and(|service| service.trim().eq_ignore_ascii_case(SERVICE));
    let by_host = url::Url::parse(&entry.uri).is_ok_and(|uri| {
        uri.host_str()
            .is_some_and(|host| host.to_ascii_lowercase().contains("inaturalist"))
    });
    by_service || by_host
}

/// What [`add_external_record`] did to the record.
#[derive(Debug, PartialEq)]
pub enum WriteBack {
    Added,
    AlreadyPresent,
    /// The record already has as many `externalRecords` as the lexicon allows
    /// (or isn't shaped like something we can append to).
    Full,
}

/// Append our `externalRecords` entry to an occurrence record fetched from the
/// PDS, leaving every other field as it was. Patching the fetched value, rather
/// than rebuilding the record from our own model of it, keeps fields this
/// appview doesn't know about.
pub fn add_external_record(record: &mut Value, uri: &str, max_records: usize) -> WriteBack {
    let Some(fields) = record.as_object_mut() else {
        return WriteBack::Full;
    };
    let entries = fields
        .entry("externalRecords")
        .or_insert_with(|| Value::Array(Vec::new()));
    let Some(entries) = entries.as_array_mut() else {
        return WriteBack::Full;
    };
    if entries.iter().any(|entry| entry["uri"] == uri) {
        return WriteBack::AlreadyPresent;
    }
    if entries.len() >= max_records {
        return WriteBack::Full;
    }
    entries.push(serde_json::json!({ "uri": uri, "service": SERVICE }));
    WriteBack::Added
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn entry(uri: &str, service: Option<&str>) -> ExternalRecordEntry {
        ExternalRecordEntry {
            uri: uri.into(),
            service: service.map(Into::into),
        }
    }

    #[test]
    fn builds_the_canonical_permalink() {
        assert_eq!(
            observation_url("https://www.inaturalist.org", 123),
            "https://www.inaturalist.org/observations/123"
        );
        assert_eq!(
            observation_url("https://www.inaturalist.org/", 123),
            "https://www.inaturalist.org/observations/123"
        );
    }

    #[test]
    fn recognizes_an_entry_by_service() {
        assert!(is_inat_record(&entry(
            "https://example.org/1",
            Some("iNaturalist")
        )));
    }

    #[test]
    fn recognizes_an_entry_by_host_including_localized_nodes() {
        assert!(is_inat_record(&entry(
            "https://www.inaturalist.org/observations/1",
            None
        )));
        assert!(is_inat_record(&entry(
            "https://inaturalist.nz/observations/1",
            None
        )));
    }

    #[test]
    fn ignores_other_services_and_inaturalist_in_a_path() {
        for other in [
            entry("https://bugguide.net/node/view/1", Some("bugguide")),
            entry("https://example.org/inaturalist/1", None),
            entry("at://did:plc:abc/app.example.obs/1", None),
        ] {
            assert!(!is_inat_record(&other), "{other:?}");
        }
    }

    #[test]
    fn appends_to_a_record_without_external_records() {
        let mut record = json!({ "$type": "x", "eventDate": "2026-10-06", "unknown": [1] });
        assert_eq!(
            add_external_record(
                &mut record,
                "https://www.inaturalist.org/observations/1",
                10
            ),
            WriteBack::Added
        );
        assert_eq!(
            record,
            json!({
                "$type": "x",
                "eventDate": "2026-10-06",
                "unknown": [1],
                "externalRecords": [
                    { "uri": "https://www.inaturalist.org/observations/1", "service": "inaturalist" }
                ],
            })
        );
    }

    #[test]
    fn appends_after_existing_entries() {
        let mut record = json!({
            "externalRecords": [{ "uri": "https://bugguide.net/node/view/1", "service": "bugguide" }]
        });
        assert_eq!(
            add_external_record(
                &mut record,
                "https://www.inaturalist.org/observations/1",
                10
            ),
            WriteBack::Added
        );
        assert_eq!(
            record["externalRecords"],
            json!([
                { "uri": "https://bugguide.net/node/view/1", "service": "bugguide" },
                { "uri": "https://www.inaturalist.org/observations/1", "service": "inaturalist" },
            ])
        );
    }

    #[test]
    fn leaves_the_record_alone_when_the_entry_is_there() {
        let original = json!({
            "externalRecords": [{ "uri": "https://www.inaturalist.org/observations/1" }]
        });
        let mut record = original.clone();
        assert_eq!(
            add_external_record(
                &mut record,
                "https://www.inaturalist.org/observations/1",
                10
            ),
            WriteBack::AlreadyPresent
        );
        assert_eq!(record, original);
    }

    #[test]
    fn leaves_a_full_record_alone() {
        let original = json!({
            "externalRecords": [{ "uri": "https://a.example/1" }, { "uri": "https://b.example/1" }]
        });
        let mut record = original.clone();
        assert_eq!(
            add_external_record(&mut record, "https://www.inaturalist.org/observations/1", 2),
            WriteBack::Full
        );
        assert_eq!(record, original);
    }
}
