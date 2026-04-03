//! Pre-built GraphQL queries for the observ-ing lexicons.

use crate::types::*;
use crate::{QuickSliceClient, Result};
use serde_json::json;

/// Fragment for occurrence fields commonly needed in feeds.
const OCCURRENCE_FIELDS: &str = r#"
    uri cid did actorHandle indexedAt
    eventDate createdAt license notes verbatimLocality
    recordedBy
    location {
        decimalLatitude decimalLongitude
        coordinateUncertaintyInMeters
        continent country countryCode stateProvince
        county municipality locality waterBody
    }
    blobs { image alt aspectRatio { width height } }
"#;

const IDENTIFICATION_FIELDS: &str = r#"
    uri cid did actorHandle
    subjectIndex
    taxon {
        scientificName scientificNameAuthorship taxonRank
        vernacularName kingdom phylum class order family genus
    }
    taxonId comment isAgreement createdAt
"#;

const COMMENT_FIELDS: &str = "uri cid did actorHandle body createdAt";

const LIKE_FIELDS: &str = "uri cid did createdAt";

impl QuickSliceClient {
    // ── Occurrences ────────────────────────────────────────────────

    /// Fetch a single occurrence by URI.
    pub async fn get_occurrence(&self, uri: &str) -> Result<Option<Occurrence>> {
        let query = format!(
            r#"query($uri: String!) {{
                orgRwellTestOccurrence(first: 1, where: {{ uri: {{ eq: $uri }} }}) {{
                    edges {{ node {{ {OCCURRENCE_FIELDS} }} }}
                }}
            }}"#
        );

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Data {
            org_rwell_test_occurrence: Connection<Occurrence>,
        }

        let data: Data = self.query(&query, Some(json!({ "uri": uri }))).await?;
        Ok(data.org_rwell_test_occurrence.nodes().into_iter().next())
    }

    /// Fetch a single occurrence with inline joins (identifications, likes, comments).
    pub async fn get_occurrence_with_joins(&self, uri: &str) -> Result<Option<OccurrenceWithJoins>> {
        let query = format!(
            r#"query($uri: String!) {{
                orgRwellTestOccurrence(first: 1, where: {{ uri: {{ eq: $uri }} }}) {{
                    edges {{ node {{
                        {OCCURRENCE_FIELDS}
                        orgRwellTestIdentificationViaSubject(first: 100) {{
                            edges {{ node {{ {IDENTIFICATION_FIELDS} }} }}
                            totalCount
                        }}
                        orgRwellTestLikeViaSubject(first: 0) {{
                            totalCount
                        }}
                        orgRwellTestCommentViaSubject(first: 100) {{
                            edges {{ node {{ {COMMENT_FIELDS} }} }}
                            totalCount
                        }}
                    }} }}
                }}
            }}"#
        );

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Data {
            org_rwell_test_occurrence: Connection<OccurrenceWithJoins>,
        }

        let data: Data = self.query(&query, Some(json!({ "uri": uri }))).await?;
        Ok(data.org_rwell_test_occurrence.nodes().into_iter().next())
    }

    /// Fetch occurrences for the explore feed with filtering and pagination.
    pub async fn get_explore_feed(
        &self,
        first: i32,
        after: Option<&str>,
        did_filter: Option<&str>,
    ) -> Result<Connection<Occurrence>> {
        let mut where_parts = Vec::new();
        let mut vars = json!({ "first": first });

        if let Some(cursor) = after {
            vars["after"] = json!(cursor);
        }
        if let Some(did) = did_filter {
            where_parts.push(format!("did: {{ eq: \"{}\" }}", did));
        }

        let where_clause = if where_parts.is_empty() {
            String::new()
        } else {
            format!(", where: {{ {} }}", where_parts.join(", "))
        };

        let query = format!(
            r#"query($first: Int!, $after: String) {{
                orgRwellTestOccurrence(
                    first: $first
                    after: $after
                    sortBy: [{{ field: INDEXED_AT, direction: DESC }}]
                    {where_clause}
                ) {{
                    edges {{
                        node {{ {OCCURRENCE_FIELDS} }}
                        cursor
                    }}
                    totalCount
                }}
            }}"#
        );

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Data {
            org_rwell_test_occurrence: Connection<Occurrence>,
        }

        let data: Data = self.query(&query, Some(vars)).await?;
        Ok(data.org_rwell_test_occurrence)
    }

    /// Fetch occurrences for a specific user (profile feed).
    pub async fn get_user_occurrences(
        &self,
        did: &str,
        first: i32,
        after: Option<&str>,
    ) -> Result<Connection<Occurrence>> {
        let query = format!(
            r#"query($did: String!, $first: Int!, $after: String) {{
                orgRwellTestOccurrence(
                    first: $first
                    after: $after
                    where: {{ did: {{ eq: $did }} }}
                    sortBy: [{{ field: INDEXED_AT, direction: DESC }}]
                ) {{
                    edges {{
                        node {{ {OCCURRENCE_FIELDS} }}
                        cursor
                    }}
                    totalCount
                }}
            }}"#
        );

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Data {
            org_rwell_test_occurrence: Connection<Occurrence>,
        }

        let data: Data = self
            .query(&query, Some(json!({ "did": did, "first": first, "after": after })))
            .await?;
        Ok(data.org_rwell_test_occurrence)
    }

    // ── Identifications ────────────────────────────────────────────

    /// Fetch identifications for an occurrence (via subject strong ref).
    pub async fn get_identifications_for_occurrence(
        &self,
        occurrence_uri: &str,
    ) -> Result<Vec<Identification>> {
        let query = format!(
            r#"query($uri: String!) {{
                orgRwellTestOccurrence(first: 1, where: {{ uri: {{ eq: $uri }} }}) {{
                    edges {{ node {{
                        orgRwellTestIdentificationViaSubject(first: 100) {{
                            edges {{ node {{ {IDENTIFICATION_FIELDS} }} }}
                        }}
                    }} }}
                }}
            }}"#
        );

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Inner {
            #[serde(rename = "orgRwellTestIdentificationViaSubject")]
            identifications: Connection<Identification>,
        }
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Data {
            org_rwell_test_occurrence: Connection<Inner>,
        }

        let data: Data = self
            .query(&query, Some(json!({ "uri": occurrence_uri })))
            .await?;
        Ok(data
            .org_rwell_test_occurrence
            .nodes()
            .into_iter()
            .next()
            .map(|inner| inner.identifications.nodes())
            .unwrap_or_default())
    }

    /// Fetch identifications made by a specific user.
    pub async fn get_user_identifications(
        &self,
        did: &str,
        first: i32,
        after: Option<&str>,
    ) -> Result<Connection<Identification>> {
        let query = format!(
            r#"query($did: String!, $first: Int!, $after: String) {{
                orgRwellTestIdentification(
                    first: $first
                    after: $after
                    where: {{ did: {{ eq: $did }} }}
                    sortBy: [{{ field: INDEXED_AT, direction: DESC }}]
                ) {{
                    edges {{
                        node {{ {IDENTIFICATION_FIELDS} }}
                        cursor
                    }}
                    totalCount
                }}
            }}"#
        );

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Data {
            org_rwell_test_identification: Connection<Identification>,
        }

        let data: Data = self
            .query(&query, Some(json!({ "did": did, "first": first, "after": after })))
            .await?;
        Ok(data.org_rwell_test_identification)
    }

    // ── Comments ───────────────────────────────────────────────────

    /// Fetch comments for an occurrence.
    pub async fn get_comments_for_occurrence(
        &self,
        occurrence_uri: &str,
    ) -> Result<Vec<Comment>> {
        let query = format!(
            r#"query($uri: String!) {{
                orgRwellTestOccurrence(first: 1, where: {{ uri: {{ eq: $uri }} }}) {{
                    edges {{ node {{
                        orgRwellTestCommentViaSubject(first: 100) {{
                            edges {{ node {{ {COMMENT_FIELDS} }} }}
                        }}
                    }} }}
                }}
            }}"#
        );

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Inner {
            #[serde(rename = "orgRwellTestCommentViaSubject")]
            comments: Connection<Comment>,
        }
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Data {
            org_rwell_test_occurrence: Connection<Inner>,
        }

        let data: Data = self
            .query(&query, Some(json!({ "uri": occurrence_uri })))
            .await?;
        Ok(data
            .org_rwell_test_occurrence
            .nodes()
            .into_iter()
            .next()
            .map(|inner| inner.comments.nodes())
            .unwrap_or_default())
    }

    // ── Likes ──────────────────────────────────────────────────────

    /// Get like count for an occurrence.
    pub async fn get_like_count(&self, occurrence_uri: &str) -> Result<i64> {
        let query = r#"query($uri: String!) {
            orgRwellTestOccurrence(first: 1, where: { uri: { eq: $uri } }) {
                edges { node {
                    orgRwellTestLikeViaSubject(first: 0) {
                        totalCount
                    }
                } }
            }
        }"#;

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Inner {
            #[serde(rename = "orgRwellTestLikeViaSubject")]
            likes: Connection<Like>,
        }
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Data {
            org_rwell_test_occurrence: Connection<Inner>,
        }

        let data: Data = self
            .query(query, Some(json!({ "uri": occurrence_uri })))
            .await?;
        Ok(data
            .org_rwell_test_occurrence
            .nodes()
            .into_iter()
            .next()
            .and_then(|inner| inner.likes.total_count)
            .unwrap_or(0))
    }

    // ── Aggregations ───────────────────────────────────────────────

    /// Count occurrences for a user.
    pub async fn count_user_occurrences(&self, did: &str) -> Result<i64> {
        let query = r#"query($did: String!) {
            orgRwellTestOccurrenceAggregated(
                where: { did: { eq: $did } }
                groupBy: [{ field: DID }]
            ) { count }
        }"#;

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Data {
            org_rwell_test_occurrence_aggregated: Vec<AggregatedResult>,
        }

        let data: Data = self.query(query, Some(json!({ "did": did }))).await?;
        Ok(data
            .org_rwell_test_occurrence_aggregated
            .first()
            .and_then(|r| r.count)
            .unwrap_or(0))
    }

    /// Count identifications for a user.
    pub async fn count_user_identifications(&self, did: &str) -> Result<i64> {
        let query = r#"query($did: String!) {
            orgRwellTestIdentificationAggregated(
                where: { did: { eq: $did } }
                groupBy: [{ field: DID }]
            ) { count }
        }"#;

        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Data {
            org_rwell_test_identification_aggregated: Vec<AggregatedResult>,
        }

        let data: Data = self.query(query, Some(json!({ "did": did }))).await?;
        Ok(data
            .org_rwell_test_identification_aggregated
            .first()
            .and_then(|r| r.count)
            .unwrap_or(0))
    }
}
