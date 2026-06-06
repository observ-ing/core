//! Parser for Darwin Core `taxonID` URIs into a known taxonomy source.
//!
//! Identification records carry an optional `taxonID` — a stable URI pointing
//! at a taxon in some external authority (GBIF, iNaturalist, Wikidata, …).
//! This module classifies the URI so the resolver can turn it into a GBIF
//! `taxon_key`: GBIF URIs carry the key directly; iNaturalist / Wikidata URIs
//! cross-walk to one via Wikidata's external-ID properties.
//!
//! Pure and network-free — all the I/O lives in the caller.

/// A `taxonID` URI classified by source.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TaxonRef {
    /// GBIF backbone usage key (e.g. from `https://www.gbif.org/species/2880791`).
    Gbif(i64),
    /// iNaturalist taxon id (e.g. from `https://www.inaturalist.org/taxa/12345`).
    INaturalist(String),
    /// Wikidata entity id, including the leading `Q` (e.g. `Q158746`).
    Wikidata(String),
    /// Anything we don't recognize; carries the original string for logging.
    Unknown(String),
}

/// Classify a `taxonID` URI. Tolerates a trailing slash and a `?query`/`#frag`
/// suffix, and matches hosts case-insensitively.
pub fn parse(uri: &str) -> TaxonRef {
    let trimmed = uri.trim();

    // `gbif:2880791` shorthand.
    if let Some(rest) = trimmed.strip_prefix("gbif:") {
        return match rest.parse::<i64>() {
            Ok(key) => TaxonRef::Gbif(key),
            Err(_) => TaxonRef::Unknown(uri.to_string()),
        };
    }

    // Strip scheme + a `www.` prefix, then split off any query/fragment so the
    // last path segment is clean.
    let no_scheme = trimmed
        .split_once("://")
        .map(|(_, rest)| rest)
        .unwrap_or(trimmed);
    let path = no_scheme
        .split(['?', '#'])
        .next()
        .unwrap_or(no_scheme)
        .trim_end_matches('/');

    let Some((host, rest)) = path.split_once('/') else {
        return TaxonRef::Unknown(uri.to_string());
    };
    let host = host.to_ascii_lowercase();
    let host = host.strip_prefix("www.").unwrap_or(&host);
    let last = rest.rsplit('/').next().unwrap_or(rest);

    match host {
        "gbif.org" if rest.starts_with("species/") => match last.parse::<i64>() {
            Ok(key) => TaxonRef::Gbif(key),
            Err(_) => TaxonRef::Unknown(uri.to_string()),
        },
        "api.gbif.org" if rest.contains("/species/") => match last.parse::<i64>() {
            Ok(key) => TaxonRef::Gbif(key),
            Err(_) => TaxonRef::Unknown(uri.to_string()),
        },
        "inaturalist.org" if rest.starts_with("taxa/") => {
            if last.chars().all(|c| c.is_ascii_digit()) && !last.is_empty() {
                TaxonRef::INaturalist(last.to_string())
            } else {
                TaxonRef::Unknown(uri.to_string())
            }
        }
        // Wikidata exposes both `/wiki/Q…` (human) and `/entity/Q…` (data) URIs.
        "wikidata.org" if rest.starts_with("wiki/") || rest.starts_with("entity/") => {
            if is_wikidata_qid(last) {
                TaxonRef::Wikidata(last.to_string())
            } else {
                TaxonRef::Unknown(uri.to_string())
            }
        }
        _ => TaxonRef::Unknown(uri.to_string()),
    }
}

/// A Wikidata item id is `Q` followed by at least one digit.
fn is_wikidata_qid(s: &str) -> bool {
    matches!(s.strip_prefix('Q'), Some(digits)
        if !digits.is_empty() && digits.chars().all(|c| c.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gbif_web_url() {
        assert_eq!(
            parse("https://www.gbif.org/species/2880791"),
            TaxonRef::Gbif(2880791)
        );
    }

    #[test]
    fn parses_gbif_api_url() {
        assert_eq!(
            parse("https://api.gbif.org/v1/species/2880791"),
            TaxonRef::Gbif(2880791)
        );
    }

    #[test]
    fn parses_gbif_shorthand() {
        assert_eq!(parse("gbif:2880791"), TaxonRef::Gbif(2880791));
    }

    #[test]
    fn tolerates_trailing_slash_and_query() {
        assert_eq!(
            parse("https://www.gbif.org/species/2880791/"),
            TaxonRef::Gbif(2880791)
        );
        assert_eq!(
            parse("https://www.gbif.org/species/2880791?foo=bar"),
            TaxonRef::Gbif(2880791)
        );
    }

    #[test]
    fn parses_inaturalist_url() {
        assert_eq!(
            parse("https://www.inaturalist.org/taxa/12345"),
            TaxonRef::INaturalist("12345".to_string())
        );
        assert_eq!(
            parse("inaturalist.org/taxa/12345"),
            TaxonRef::INaturalist("12345".to_string())
        );
    }

    #[test]
    fn parses_wikidata_urls() {
        assert_eq!(
            parse("https://www.wikidata.org/wiki/Q158746"),
            TaxonRef::Wikidata("Q158746".to_string())
        );
        assert_eq!(
            parse("http://www.wikidata.org/entity/Q158746"),
            TaxonRef::Wikidata("Q158746".to_string())
        );
    }

    #[test]
    fn host_matching_is_case_insensitive() {
        assert_eq!(parse("https://WWW.GBIF.ORG/species/42"), TaxonRef::Gbif(42));
    }

    #[test]
    fn rejects_junk() {
        assert_eq!(
            parse("https://example.com/foo/1"),
            TaxonRef::Unknown("https://example.com/foo/1".to_string())
        );
        assert_eq!(
            parse("gbif:notanumber"),
            TaxonRef::Unknown("gbif:notanumber".to_string())
        );
        assert_eq!(
            parse("https://www.gbif.org/species/abc"),
            TaxonRef::Unknown("https://www.gbif.org/species/abc".to_string())
        );
        assert_eq!(
            parse("https://www.wikidata.org/wiki/P31"),
            TaxonRef::Unknown("https://www.wikidata.org/wiki/P31".to_string())
        );
        assert_eq!(parse(""), TaxonRef::Unknown("".to_string()));
    }
}
