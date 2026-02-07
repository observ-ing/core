use sqlx::PgPool;
use tracing::info;

/// Run all database migrations (idempotent)
pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::Error> {
    info!("Running database migrations...");

    // Enable PostGIS extension
    sqlx::query("CREATE EXTENSION IF NOT EXISTS postgis")
        .execute(pool)
        .await?;

    // Ingester state table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS ingester_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await?;

    // Occurrences table (Darwin Core Occurrence class)
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS occurrences (
            uri TEXT PRIMARY KEY,
            cid TEXT NOT NULL,
            did TEXT NOT NULL,
            scientific_name TEXT,
            event_date TIMESTAMPTZ NOT NULL,
            location GEOGRAPHY(POINT, 4326) NOT NULL,
            coordinate_uncertainty_meters INTEGER,
            continent TEXT,
            country TEXT,
            country_code TEXT,
            state_province TEXT,
            county TEXT,
            municipality TEXT,
            locality TEXT,
            water_body TEXT,
            verbatim_locality TEXT,
            occurrence_remarks TEXT,
            associated_media JSONB,
            recorded_by TEXT,
            taxon_id TEXT,
            taxon_rank TEXT,
            vernacular_name TEXT,
            kingdom TEXT,
            phylum TEXT,
            class TEXT,
            "order" TEXT,
            family TEXT,
            genus TEXT,
            created_at TIMESTAMPTZ NOT NULL,
            indexed_at TIMESTAMPTZ DEFAULT NOW()
        )"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS occurrences_location_idx ON occurrences USING GIST(location)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS occurrences_scientific_name_idx ON occurrences(scientific_name)",
    )
    .execute(pool)
    .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS occurrences_did_idx ON occurrences(did)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS occurrences_event_date_idx ON occurrences(event_date)")
        .execute(pool)
        .await?;

    // Identifications table (Darwin Core Identification class)
    sqlx::query(
        r#"CREATE TABLE IF NOT EXISTS identifications (
            uri TEXT PRIMARY KEY,
            cid TEXT NOT NULL,
            did TEXT NOT NULL,
            subject_uri TEXT NOT NULL REFERENCES occurrences(uri) ON DELETE CASCADE,
            subject_cid TEXT NOT NULL,
            subject_index INTEGER NOT NULL DEFAULT 0,
            scientific_name TEXT NOT NULL,
            taxon_rank TEXT,
            identification_qualifier TEXT,
            taxon_id TEXT,
            identification_remarks TEXT,
            identification_verification_status TEXT,
            type_status TEXT,
            is_agreement BOOLEAN DEFAULT FALSE,
            date_identified TIMESTAMPTZ NOT NULL,
            indexed_at TIMESTAMPTZ DEFAULT NOW(),
            vernacular_name TEXT,
            kingdom TEXT,
            phylum TEXT,
            class TEXT,
            "order" TEXT,
            family TEXT,
            genus TEXT,
            confidence TEXT
        )"#,
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS identifications_subject_uri_idx ON identifications(subject_uri)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS identifications_subject_idx ON identifications(subject_uri, subject_index)",
    )
    .execute(pool)
    .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS identifications_did_idx ON identifications(did)")
        .execute(pool)
        .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS identifications_scientific_name_idx ON identifications(scientific_name)",
    )
    .execute(pool)
    .await?;

    // Comments table
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS comments (
            uri TEXT PRIMARY KEY,
            cid TEXT NOT NULL,
            did TEXT NOT NULL,
            subject_uri TEXT NOT NULL REFERENCES occurrences(uri) ON DELETE CASCADE,
            subject_cid TEXT NOT NULL,
            body TEXT NOT NULL,
            reply_to_uri TEXT,
            reply_to_cid TEXT,
            created_at TIMESTAMPTZ NOT NULL,
            indexed_at TIMESTAMPTZ DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS comments_subject_uri_idx ON comments(subject_uri)")
        .execute(pool)
        .await?;

    // OAuth state store (for PKCE flow, short-lived)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS oauth_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            expires_at TIMESTAMPTZ NOT NULL
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS oauth_state_expires_idx ON oauth_state(expires_at)")
        .execute(pool)
        .await?;

    // OAuth sessions (for logged-in users)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS oauth_sessions (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await?;

    // Occurrence observers (for multi-user observations)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS occurrence_observers (
            occurrence_uri TEXT NOT NULL REFERENCES occurrences(uri) ON DELETE CASCADE,
            observer_did TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'co-observer' CHECK (role IN ('owner', 'co-observer')),
            added_at TIMESTAMPTZ DEFAULT NOW(),
            PRIMARY KEY (occurrence_uri, observer_did)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS idx_occurrence_observers_did ON occurrence_observers(observer_did)",
    )
    .execute(pool)
    .await?;

    // Likes table (app.bsky.feed.like records)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS likes (
            uri TEXT PRIMARY KEY,
            cid TEXT NOT NULL,
            did TEXT NOT NULL,
            subject_uri TEXT NOT NULL REFERENCES occurrences(uri) ON DELETE CASCADE,
            subject_cid TEXT NOT NULL,
            created_at TIMESTAMP(3) NOT NULL,
            indexed_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
            UNIQUE (subject_uri, did)
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS likes_subject_uri_idx ON likes(subject_uri)")
        .execute(pool)
        .await?;
    sqlx::query("CREATE INDEX IF NOT EXISTS likes_did_idx ON likes(did)")
        .execute(pool)
        .await?;

    // Interactions table (species interactions between organisms)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS interactions (
            uri TEXT PRIMARY KEY,
            cid TEXT NOT NULL,
            did TEXT NOT NULL,
            subject_a_occurrence_uri TEXT REFERENCES occurrences(uri) ON DELETE CASCADE,
            subject_a_occurrence_cid TEXT,
            subject_a_subject_index INTEGER DEFAULT 0,
            subject_a_taxon_name TEXT,
            subject_a_kingdom TEXT,
            subject_b_occurrence_uri TEXT REFERENCES occurrences(uri) ON DELETE CASCADE,
            subject_b_occurrence_cid TEXT,
            subject_b_subject_index INTEGER DEFAULT 0,
            subject_b_taxon_name TEXT,
            subject_b_kingdom TEXT,
            interaction_type TEXT NOT NULL,
            direction TEXT NOT NULL DEFAULT 'AtoB',
            confidence TEXT,
            comment TEXT,
            created_at TIMESTAMPTZ NOT NULL,
            indexed_at TIMESTAMPTZ DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query("CREATE INDEX IF NOT EXISTS interactions_did_idx ON interactions(did)")
        .execute(pool)
        .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS interactions_subject_a_occurrence_idx ON interactions(subject_a_occurrence_uri)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS interactions_subject_b_occurrence_idx ON interactions(subject_b_occurrence_uri)",
    )
    .execute(pool)
    .await?;
    sqlx::query(
        "CREATE INDEX IF NOT EXISTS interactions_type_idx ON interactions(interaction_type)",
    )
    .execute(pool)
    .await?;

    // Private location data (AppView-managed, stores exact coords for privacy)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS occurrence_private_data (
            uri TEXT PRIMARY KEY,
            exact_location GEOGRAPHY(POINT, 4326),
            geoprivacy TEXT NOT NULL DEFAULT 'open'
                CHECK (geoprivacy IN ('open', 'obscured', 'private')),
            effective_geoprivacy TEXT
                CHECK (effective_geoprivacy IN ('open', 'obscured', 'private')),
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE INDEX IF NOT EXISTS occurrence_private_data_exact_location_idx ON occurrence_private_data USING GIST(exact_location)",
    )
    .execute(pool)
    .await?;

    // Sensitive species list (for auto-obscuration rules)
    sqlx::query(
        "CREATE TABLE IF NOT EXISTS sensitive_species (
            scientific_name TEXT NOT NULL,
            kingdom TEXT NOT NULL DEFAULT '',
            geoprivacy TEXT NOT NULL CHECK (geoprivacy IN ('obscured', 'private')),
            reason TEXT,
            source TEXT,
            PRIMARY KEY (scientific_name, kingdom)
        )",
    )
    .execute(pool)
    .await?;

    // Community ID materialized view (refreshed after identification changes)
    sqlx::query("DROP MATERIALIZED VIEW IF EXISTS community_ids")
        .execute(pool)
        .await?;

    sqlx::query(
        "CREATE MATERIALIZED VIEW community_ids AS
        WITH latest_ids AS (
            SELECT DISTINCT ON (did, subject_uri, subject_index)
                subject_uri, subject_index, scientific_name, kingdom, is_agreement
            FROM identifications
            ORDER BY did, subject_uri, subject_index, date_identified DESC
        )
        SELECT
            o.uri as occurrence_uri,
            li.subject_index,
            li.scientific_name,
            li.kingdom,
            COUNT(*) as id_count,
            COUNT(*) FILTER (WHERE li.is_agreement) as agreement_count
        FROM occurrences o
        JOIN latest_ids li ON li.subject_uri = o.uri
        GROUP BY o.uri, li.subject_index, li.scientific_name, li.kingdom
        ORDER BY o.uri, li.subject_index, id_count DESC",
    )
    .execute(pool)
    .await?;

    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS community_ids_uri_subject_taxon_idx
            ON community_ids(occurrence_uri, subject_index, scientific_name, kingdom)",
    )
    .execute(pool)
    .await?;

    info!("Database migrations completed");
    Ok(())
}
