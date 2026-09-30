use crate::types::{ResolvedRemarkRow, UpsertRemarkParams};

/// `dwc_term` value of a remark filling dwc:occurrenceRemarks.
pub const OCCURRENCE_REMARKS: &str = "occurrenceRemarks";
/// `dwc_term` value of a remark filling dwc:eventRemarks.
pub const EVENT_REMARKS: &str = "eventRemarks";

/// Upsert a remark record
pub async fn upsert(
    executor: impl sqlx::PgExecutor<'_>,
    p: &UpsertRemarkParams,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"
        INSERT INTO remarks (uri, cid, did, subject_uri, dwc_term, body, license, indexed_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
        ON CONFLICT (uri) DO UPDATE SET
            cid = EXCLUDED.cid,
            subject_uri = EXCLUDED.subject_uri,
            dwc_term = EXCLUDED.dwc_term,
            body = EXCLUDED.body,
            license = EXCLUDED.license,
            indexed_at = NOW()
        "#,
        p.uri,
        p.cid,
        p.did,
        p.subject_uri,
        p.dwc_term,
        p.body,
        p.license as _,
    )
    .execute(executor)
    .await?;
    Ok(())
}

/// Delete a remark
pub async fn delete(executor: impl sqlx::PgExecutor<'_>, uri: &str) -> Result<(), sqlx::Error> {
    sqlx::query!("DELETE FROM remarks WHERE uri = $1", uri)
        .execute(executor)
        .await?;
    Ok(())
}

/// Resolve the remarks that fill Darwin Core terms on each of `occurrence_uris`.
///
/// Resolution starts from the occurrence's forward reference
/// (`occurrence_remarks_uri` / `event_remarks_uri`), which upstream makes
/// authoritative. The remark must also agree with that reference on who wrote
/// it, what it describes and which term it fills; a disagreement means the
/// occurrence points at the wrong record, so it fills nothing rather than
/// surfacing text the author may not have meant to attach here. A reference
/// whose remark hasn't been ingested yet (or was deleted) likewise resolves to
/// nothing until it arrives.
pub async fn get_for_occurrences(
    executor: impl sqlx::PgExecutor<'_>,
    occurrence_uris: &[String],
) -> Result<Vec<ResolvedRemarkRow>, sqlx::Error> {
    sqlx::query_as!(
        ResolvedRemarkRow,
        r#"
        SELECT
            o.uri AS "occurrence_uri!",
            r.uri AS "uri!",
            r.dwc_term AS "dwc_term!",
            r.body AS "body!",
            r.license
        FROM occurrences o
        CROSS JOIN LATERAL (
            VALUES
                ($2::text, o.occurrence_remarks_uri),
                ($3::text, o.event_remarks_uri)
        ) AS ref(dwc_term, remark_uri)
        JOIN remarks r
            ON r.uri = ref.remark_uri
            AND r.did = o.did
            AND r.subject_uri = o.uri
            AND r.dwc_term = ref.dwc_term
        WHERE o.uri = ANY($1)
        "#,
        occurrence_uris,
        OCCURRENCE_REMARKS,
        EVENT_REMARKS,
    )
    .fetch_all(executor)
    .await
}

/// URIs of `did`'s remarks that name `subject_uri` as their subject, whether or
/// not the subject currently references them. Used to clean up after deleting
/// the subject.
pub async fn get_uris_for_subject(
    executor: impl sqlx::PgExecutor<'_>,
    subject_uri: &str,
    did: &str,
) -> Result<Vec<String>, sqlx::Error> {
    sqlx::query_scalar!(
        "SELECT uri FROM remarks WHERE subject_uri = $1 AND did = $2",
        subject_uri,
        did,
    )
    .fetch_all(executor)
    .await
}
