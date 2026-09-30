-- Author-written Darwin Core remarks (#839): `bio.lexicons.temp.v0-1.remark`
-- records, and the occurrence forward references that give them meaning.
--
-- A remark is free text that fills one Darwin Core remarks term on another
-- record. The record it describes points at it (occurrence.occurrenceRemarksID,
-- occurrence.eventRemarksID), and upstream is explicit that the forward
-- reference is authoritative: "a remark nothing references fills no term".
-- So the remark's own `subject` is stored for integrity checks only; reads
-- resolve through the occurrence's `*_remarks_uri` columns and additionally
-- require the remark to agree on author, subject and term (see
-- `observing_db::remarks::get_for_occurrences`).
--
-- No FK from either side: the two records are written separately and can
-- arrive in either order (the appview writes the remark first), and a
-- `putRecord` on the occurrence can re-point to a new remark and orphan the
-- old one. An unresolved reference or an orphaned remark simply fills nothing.
--
-- No unique index on (subject_uri, dwc_term) either, though the issue floated
-- one: `subject` is self-declared, so anyone can publish a remark naming
-- someone else's occurrence, and a unique index would let that squatter make
-- the author's real remark fail to ingest. One-per-term already holds where it
-- matters — an occurrence has exactly one field per term.
--
-- Lives in the `ingester` schema with the other firehose-owned tables;
-- ALTER DEFAULT PRIVILEGES from 20260428000001 grants ingester_runtime full
-- CRUD and appview_runtime SELECT automatically.

CREATE TABLE IF NOT EXISTS ingester.remarks (
    uri         TEXT        PRIMARY KEY,
    cid         TEXT        NOT NULL,
    did         TEXT        NOT NULL,
    subject_uri TEXT        NOT NULL,
    dwc_term    TEXT        NOT NULL,
    body        TEXT        NOT NULL,
    license     TEXT,
    indexed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Remark URIs referenced by the occurrence. NULL for every row ingested before
-- these columns existed; `task-runner backfill-occurrences --all` re-fetches
-- the records to fill them in (no current write path set them anyway).
ALTER TABLE occurrences
    ADD COLUMN IF NOT EXISTS occurrence_remarks_uri TEXT,
    ADD COLUMN IF NOT EXISTS event_remarks_uri TEXT;

-- The dead column the original schema carried for dwc:occurrenceRemarks was
-- dropped in 20260416000000; the value now lives in `remarks.body`.
