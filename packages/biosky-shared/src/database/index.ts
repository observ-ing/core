/**
 * Database Layer for BioSky
 *
 * PostgreSQL with PostGIS extension for storing and querying
 * biodiversity occurrences spatially. Uses Darwin Core terminology.
 */

import pg from "pg";
import type {
  OccurrenceEvent,
  IdentificationEvent,
  OccurrenceRow,
  IdentificationRow,
} from "../types.js";
import type * as OrgRwellTestOccurrence from "../generated/types/org/rwell/test/occurrence.js";
import type * as OrgRwellTestIdentification from "../generated/types/org/rwell/test/identification.js";

const { Pool } = pg;

// Type aliases for the record types
type Occurrence = OrgRwellTestOccurrence.Main;
type Identification = OrgRwellTestIdentification.Main;

export class Database {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({
      connectionString,
      // Cloud SQL connections can be closed by the proxy after idle time.
      // These settings help handle connection drops gracefully.
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      // Automatically reconnect if connection is lost
      allowExitOnIdle: false,
    });

    // Handle pool errors to prevent crashes
    this.pool.on("error", (err) => {
      console.error("Unexpected database pool error:", err.message);
    });
  }

  async connect(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT 1");
      console.log("Database connected successfully");
    } finally {
      client.release();
    }
  }

  async disconnect(): Promise<void> {
    await this.pool.end();
    console.log("Database disconnected");
  }

  async migrate(): Promise<void> {
    console.log("Running database migrations...");

    await this.pool.query(`
      -- Enable PostGIS extension
      CREATE EXTENSION IF NOT EXISTS postgis;

      -- Ingester state table
      CREATE TABLE IF NOT EXISTS ingester_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Occurrences table (Darwin Core Occurrence class)
      CREATE TABLE IF NOT EXISTS occurrences (
        uri TEXT PRIMARY KEY,
        cid TEXT NOT NULL,
        did TEXT NOT NULL,
        -- Darwin Core terms
        basis_of_record TEXT NOT NULL DEFAULT 'HumanObservation',
        scientific_name TEXT,
        event_date TIMESTAMPTZ NOT NULL,
        location GEOGRAPHY(POINT, 4326) NOT NULL,
        coordinate_uncertainty_meters INTEGER,
        verbatim_locality TEXT,
        habitat TEXT,
        occurrence_status TEXT DEFAULT 'present',
        occurrence_remarks TEXT,
        individual_count INTEGER,
        sex TEXT,
        life_stage TEXT,
        reproductive_condition TEXT,
        behavior TEXT,
        establishment_means TEXT,
        associated_media JSONB,
        recorded_by TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        indexed_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Create spatial index
      CREATE INDEX IF NOT EXISTS occurrences_location_idx
        ON occurrences USING GIST(location);

      -- Create index on scientific name for taxonomy queries
      CREATE INDEX IF NOT EXISTS occurrences_scientific_name_idx
        ON occurrences(scientific_name);

      -- Create index on DID for user queries
      CREATE INDEX IF NOT EXISTS occurrences_did_idx
        ON occurrences(did);

      -- Create index on event date for temporal queries
      CREATE INDEX IF NOT EXISTS occurrences_event_date_idx
        ON occurrences(event_date);

      -- Create index on basis of record
      CREATE INDEX IF NOT EXISTS occurrences_basis_of_record_idx
        ON occurrences(basis_of_record);

      -- Identifications table (Darwin Core Identification class)
      CREATE TABLE IF NOT EXISTS identifications (
        uri TEXT PRIMARY KEY,
        cid TEXT NOT NULL,
        did TEXT NOT NULL,
        subject_uri TEXT NOT NULL REFERENCES occurrences(uri) ON DELETE CASCADE,
        subject_cid TEXT NOT NULL,
        -- Darwin Core terms
        scientific_name TEXT NOT NULL,
        taxon_rank TEXT,
        identification_qualifier TEXT,
        taxon_id TEXT,
        identification_remarks TEXT,
        identification_verification_status TEXT,
        type_status TEXT,
        is_agreement BOOLEAN DEFAULT FALSE,
        date_identified TIMESTAMPTZ NOT NULL,
        indexed_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Index for looking up identifications by occurrence
      CREATE INDEX IF NOT EXISTS identifications_subject_uri_idx
        ON identifications(subject_uri);

      -- Index for user's identifications
      CREATE INDEX IF NOT EXISTS identifications_did_idx
        ON identifications(did);

      -- Index for taxon lookups
      CREATE INDEX IF NOT EXISTS identifications_scientific_name_idx
        ON identifications(scientific_name);

      -- OAuth state store (for PKCE flow, short-lived)
      CREATE TABLE IF NOT EXISTS oauth_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL
      );

      -- Create index for cleanup of expired state
      CREATE INDEX IF NOT EXISTS oauth_state_expires_idx ON oauth_state(expires_at);

      -- OAuth sessions (for logged-in users)
      -- Stores AT Protocol OAuth client session data as JSON
      CREATE TABLE IF NOT EXISTS oauth_sessions (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Community ID materialized view (refreshed periodically)
      CREATE MATERIALIZED VIEW IF NOT EXISTS community_ids AS
      SELECT
        o.uri as occurrence_uri,
        i.scientific_name,
        COUNT(*) as id_count,
        COUNT(*) FILTER (WHERE i.is_agreement) as agreement_count
      FROM occurrences o
      JOIN identifications i ON i.subject_uri = o.uri
      GROUP BY o.uri, i.scientific_name
      ORDER BY o.uri, id_count DESC;

      CREATE UNIQUE INDEX IF NOT EXISTS community_ids_uri_taxon_idx
        ON community_ids(occurrence_uri, scientific_name);
    `);

    console.log("Database migrations completed");
  }

  async getCursor(): Promise<number | null> {
    const result = await this.pool.query(
      "SELECT value FROM ingester_state WHERE key = 'cursor'",
    );
    if (result.rows.length === 0) return null;
    return parseInt(result.rows[0].value);
  }

  async saveCursor(cursor: number): Promise<void> {
    // Retry on connection errors since Cloud SQL connections can drop
    const isConnectionError = (err: unknown): boolean => {
      if (!(err instanceof Error)) return false;
      const msg = err.message.toLowerCase();
      return (
        msg.includes("connection terminated") ||
        msg.includes("connection timeout") ||
        msg.includes("epipe") ||
        msg.includes("econnreset") ||
        msg.includes("connection refused")
      );
    };

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.pool.query(
          `INSERT INTO ingester_state (key, value, updated_at)
           VALUES ('cursor', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
          [cursor.toString()],
        );
        return;
      } catch (err) {
        if (attempt < 2 && isConnectionError(err)) {
          console.warn(`Connection error on attempt ${attempt + 1}, retrying saveCursor...`);
          // Brief delay before retry
          await new Promise((r) => setTimeout(r, 100 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }

  async upsertOccurrence(event: OccurrenceEvent): Promise<void> {
    const record = event.record as Occurrence | undefined;
    if (!record) {
      console.warn(`No record data for occurrence ${event.uri}`);
      return;
    }

    const location = record.location;
    if (!location) {
      console.warn(`No location data for occurrence ${event.uri}`);
      return;
    }

    await this.pool.query(
      `INSERT INTO occurrences (
        uri, cid, did, basis_of_record, scientific_name, event_date, location,
        coordinate_uncertainty_meters, verbatim_locality, habitat, occurrence_status,
        occurrence_remarks, individual_count, sex, life_stage, reproductive_condition,
        behavior, establishment_means, associated_media, recorded_by, created_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
        $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
      )
      ON CONFLICT (uri) DO UPDATE SET
        cid = $2,
        basis_of_record = $4,
        scientific_name = $5,
        event_date = $6,
        location = ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography,
        coordinate_uncertainty_meters = $9,
        verbatim_locality = $10,
        habitat = $11,
        occurrence_status = $12,
        occurrence_remarks = $13,
        individual_count = $14,
        sex = $15,
        life_stage = $16,
        reproductive_condition = $17,
        behavior = $18,
        establishment_means = $19,
        associated_media = $20,
        recorded_by = $21,
        indexed_at = NOW()`,
      [
        event.uri,
        event.cid,
        event.did,
        "HumanObservation",
        record.scientificName || null,
        record.eventDate,
        location.decimalLongitude,
        location.decimalLatitude,
        location.coordinateUncertaintyInMeters || null,
        record.verbatimLocality || null,
        null, // habitat
        "present", // occurrenceStatus
        record.notes || null,
        null, // individualCount
        null, // sex
        null, // lifeStage
        null, // reproductiveCondition
        null, // behavior
        null, // establishmentMeans
        JSON.stringify(record.blobs || []),
        null, // recordedBy
        record.createdAt,
      ],
    );
  }

  async deleteOccurrence(uri: string): Promise<void> {
    await this.pool.query("DELETE FROM occurrences WHERE uri = $1", [uri]);
  }

  async upsertIdentification(event: IdentificationEvent): Promise<void> {
    const record = event.record as Identification | undefined;
    if (!record) {
      console.warn(`No record data for identification ${event.uri}`);
      return;
    }

    await this.pool.query(
      `INSERT INTO identifications (
        uri, cid, did, subject_uri, subject_cid, scientific_name,
        taxon_rank, identification_qualifier, taxon_id, identification_remarks,
        identification_verification_status, type_status, is_agreement, date_identified
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (uri) DO UPDATE SET
        cid = $2,
        scientific_name = $6,
        taxon_rank = $7,
        identification_qualifier = $8,
        taxon_id = $9,
        identification_remarks = $10,
        identification_verification_status = $11,
        type_status = $12,
        is_agreement = $13,
        indexed_at = NOW()`,
      [
        event.uri,
        event.cid,
        event.did,
        record.subject.uri,
        record.subject.cid,
        record.taxonName,
        record.taxonRank || null,
        null, // identificationQualifier
        null, // taxonID
        record.comment || null,
        null, // identificationVerificationStatus
        null, // typeStatus
        record.isAgreement || false,
        record.createdAt,
      ],
    );
  }

  async deleteIdentification(uri: string): Promise<void> {
    await this.pool.query("DELETE FROM identifications WHERE uri = $1", [uri]);
  }

  // Query methods for the AppView

  async getOccurrencesNearby(
    lat: number,
    lng: number,
    radiusMeters: number,
    limit = 100,
    offset = 0,
  ): Promise<OccurrenceRow[]> {
    const result = await this.pool.query(
      `SELECT
        uri, cid, did, basis_of_record, scientific_name, event_date,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        coordinate_uncertainty_meters, verbatim_locality, habitat,
        occurrence_status, occurrence_remarks, individual_count, sex,
        life_stage, reproductive_condition, behavior, establishment_means,
        associated_media, recorded_by, created_at,
        ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_meters
      FROM occurrences
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        $3
      )
      ORDER BY distance_meters
      LIMIT $4 OFFSET $5`,
      [lat, lng, radiusMeters, limit, offset],
    );
    return result.rows;
  }

  async getOccurrencesByBoundingBox(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number,
    limit = 1000,
  ): Promise<OccurrenceRow[]> {
    const result = await this.pool.query(
      `SELECT
        uri, cid, did, basis_of_record, scientific_name, event_date,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        coordinate_uncertainty_meters, verbatim_locality, habitat,
        occurrence_status, occurrence_remarks, individual_count, sex,
        life_stage, reproductive_condition, behavior, establishment_means,
        associated_media, recorded_by, created_at
      FROM occurrences
      WHERE location && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
      LIMIT $5`,
      [minLng, minLat, maxLng, maxLat, limit],
    );
    return result.rows;
  }

  async getOccurrencesFeed(
    limit = 20,
    cursor?: string,
  ): Promise<OccurrenceRow[]> {
    const params: (number | string)[] = [limit];
    let cursorCondition = "";

    if (cursor) {
      cursorCondition = "WHERE created_at < $2";
      params.push(cursor);
    }

    const result = await this.pool.query(
      `SELECT
        uri, cid, did, basis_of_record, scientific_name, event_date,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        coordinate_uncertainty_meters, verbatim_locality, habitat,
        occurrence_status, occurrence_remarks, individual_count, sex,
        life_stage, reproductive_condition, behavior, establishment_means,
        associated_media, recorded_by, created_at
      FROM occurrences
      ${cursorCondition}
      ORDER BY created_at DESC
      LIMIT $1`,
      params,
    );
    return result.rows;
  }

  async getExploreFeed(options: {
    limit?: number;
    cursor?: string;
    taxon?: string;
    lat?: number;
    lng?: number;
    radius?: number;
  }): Promise<OccurrenceRow[]> {
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (options.taxon) {
      conditions.push(`scientific_name ILIKE $${paramIndex++}`);
      params.push(`${options.taxon}%`);
    }

    if (options.lat !== undefined && options.lng !== undefined) {
      const radius = options.radius || 10000;
      conditions.push(`ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint($${paramIndex++}, $${paramIndex++}), 4326)::geography,
        $${paramIndex++}
      )`);
      params.push(options.lng, options.lat, radius);
    }

    if (options.cursor) {
      conditions.push(`created_at < $${paramIndex++}`);
      params.push(options.cursor);
    }

    const whereClause =
      conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const limit = options.limit || 20;
    params.push(limit);

    const result = await this.pool.query(
      `SELECT
        uri, cid, did, basis_of_record, scientific_name, event_date,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        coordinate_uncertainty_meters, verbatim_locality, habitat,
        occurrence_status, occurrence_remarks, individual_count, sex,
        life_stage, reproductive_condition, behavior, establishment_means,
        associated_media, recorded_by, created_at
      FROM occurrences
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex}`,
      params,
    );
    return result.rows;
  }

  async getProfileFeed(
    did: string,
    options: {
      limit?: number;
      cursor?: string;
      type?: "observations" | "identifications" | "all";
    },
  ): Promise<{
    occurrences: OccurrenceRow[];
    identifications: IdentificationRow[];
    counts: { observations: number; identifications: number; species: number };
  }> {
    const limit = options.limit || 20;
    const type = options.type || "all";

    // Get counts
    const countsResult = await this.pool.query(
      `SELECT
        (SELECT COUNT(*) FROM occurrences WHERE did = $1) as observation_count,
        (SELECT COUNT(*) FROM identifications WHERE did = $1) as identification_count,
        (SELECT COUNT(DISTINCT scientific_name) FROM occurrences WHERE did = $1 AND scientific_name IS NOT NULL) as species_count`,
      [did],
    );

    let occurrences: OccurrenceRow[] = [];
    let identifications: IdentificationRow[] = [];

    if (type === "observations" || type === "all") {
      const occParams: (string | number)[] = [did, limit];
      let occCursor = "";
      if (options.cursor) {
        occCursor = "AND created_at < $3";
        occParams.push(options.cursor);
      }

      const occResult = await this.pool.query(
        `SELECT
          uri, cid, did, basis_of_record, scientific_name, event_date,
          ST_Y(location::geometry) as latitude,
          ST_X(location::geometry) as longitude,
          coordinate_uncertainty_meters, verbatim_locality, habitat,
          occurrence_status, occurrence_remarks, individual_count, sex,
          life_stage, reproductive_condition, behavior, establishment_means,
          associated_media, recorded_by, created_at
        FROM occurrences
        WHERE did = $1 ${occCursor}
        ORDER BY created_at DESC
        LIMIT $2`,
        occParams,
      );
      occurrences = occResult.rows;
    }

    if (type === "identifications" || type === "all") {
      const idParams: (string | number)[] = [did, limit];
      let idCursor = "";
      if (options.cursor) {
        idCursor = "AND date_identified < $3";
        idParams.push(options.cursor);
      }

      const idResult = await this.pool.query(
        `SELECT
          uri, cid, did, subject_uri, subject_cid, scientific_name,
          taxon_rank, identification_qualifier, taxon_id, identification_remarks,
          identification_verification_status, type_status, is_agreement, date_identified
        FROM identifications
        WHERE did = $1 ${idCursor}
        ORDER BY date_identified DESC
        LIMIT $2`,
        idParams,
      );
      identifications = idResult.rows;
    }

    return {
      occurrences,
      identifications,
      counts: {
        observations: parseInt(countsResult.rows[0].observation_count),
        identifications: parseInt(countsResult.rows[0].identification_count),
        species: parseInt(countsResult.rows[0].species_count),
      },
    };
  }

  async getHomeFeed(
    followedDids: string[],
    options: {
      limit?: number;
      cursor?: string;
      lat?: number;
      lng?: number;
      nearbyRadius?: number;
    },
  ): Promise<{
    rows: OccurrenceRow[];
    followedCount: number;
    nearbyCount: number;
  }> {
    const limit = options.limit || 20;
    const nearbyRadius = options.nearbyRadius || 50000;

    // If no follows and no location, return empty
    if (followedDids.length === 0 && (options.lat === undefined || options.lng === undefined)) {
      return { rows: [], followedCount: 0, nearbyCount: 0 };
    }

    const hasFollows = followedDids.length > 0;
    const hasLocation = options.lat !== undefined && options.lng !== undefined;

    let paramIndex = 1;
    const params: (string | number | string[])[] = [];

    // Build the query using CTEs for follows and nearby
    let query = "WITH ";
    const ctes: string[] = [];

    if (hasFollows) {
      params.push(followedDids);
      const cursorCondition = options.cursor
        ? `AND created_at < $${++paramIndex}`
        : "";
      if (options.cursor) params.push(options.cursor);

      ctes.push(`follows_feed AS (
        SELECT *, 'follows' as source
        FROM occurrences
        WHERE did = ANY($1) ${cursorCondition}
      )`);
    }

    if (hasLocation) {
      const lngIdx = ++paramIndex;
      const latIdx = ++paramIndex;
      const radiusIdx = ++paramIndex;
      params.push(options.lng!, options.lat!, nearbyRadius);

      const cursorCondition =
        options.cursor && !hasFollows
          ? `AND created_at < $${++paramIndex}`
          : options.cursor && hasFollows
            ? `AND created_at < $2`
            : "";
      if (options.cursor && !hasFollows) params.push(options.cursor);

      ctes.push(`nearby_feed AS (
        SELECT *, 'nearby' as source
        FROM occurrences
        WHERE ST_DWithin(
          location,
          ST_SetSRID(ST_MakePoint($${lngIdx}, $${latIdx}), 4326)::geography,
          $${radiusIdx}
        ) ${cursorCondition}
      )`);
    }

    query += ctes.join(", ");

    // Combine feeds
    const unionParts: string[] = [];
    if (hasFollows) unionParts.push("SELECT * FROM follows_feed");
    if (hasLocation) unionParts.push("SELECT * FROM nearby_feed");

    const limitIdx = ++paramIndex;
    params.push(limit);

    query += `, combined AS (
      SELECT DISTINCT ON (uri) * FROM (
        ${unionParts.join(" UNION ALL ")}
      ) sub
      ORDER BY uri, created_at DESC
    )
    SELECT
      uri, cid, did, basis_of_record, scientific_name, event_date,
      ST_Y(location::geometry) as latitude,
      ST_X(location::geometry) as longitude,
      coordinate_uncertainty_meters, verbatim_locality, habitat,
      occurrence_status, occurrence_remarks, individual_count, sex,
      life_stage, reproductive_condition, behavior, establishment_means,
      associated_media, recorded_by, created_at, source
    FROM combined
    ORDER BY created_at DESC
    LIMIT $${limitIdx}`;

    const result = await this.pool.query(query, params);

    // Count sources
    let followedCount = 0;
    let nearbyCount = 0;
    for (const row of result.rows) {
      if (row.source === "follows") followedCount++;
      else if (row.source === "nearby") nearbyCount++;
    }

    return { rows: result.rows, followedCount, nearbyCount };
  }

  async getOccurrence(uri: string): Promise<OccurrenceRow | null> {
    const result = await this.pool.query(
      `SELECT
        uri, cid, did, basis_of_record, scientific_name, event_date,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        coordinate_uncertainty_meters, verbatim_locality, habitat,
        occurrence_status, occurrence_remarks, individual_count, sex,
        life_stage, reproductive_condition, behavior, establishment_means,
        associated_media, recorded_by, created_at
      FROM occurrences
      WHERE uri = $1`,
      [uri],
    );
    return result.rows[0] || null;
  }

  async getIdentificationsForOccurrence(
    occurrenceUri: string,
  ): Promise<IdentificationRow[]> {
    const result = await this.pool.query(
      `SELECT
        uri, cid, did, subject_uri, subject_cid, scientific_name,
        taxon_rank, identification_qualifier, taxon_id, identification_remarks,
        identification_verification_status, type_status, is_agreement, date_identified
      FROM identifications
      WHERE subject_uri = $1
      ORDER BY date_identified DESC`,
      [occurrenceUri],
    );
    return result.rows;
  }

  async getCommunityId(occurrenceUri: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT scientific_name, id_count
       FROM community_ids
       WHERE occurrence_uri = $1
       ORDER BY id_count DESC
       LIMIT 1`,
      [occurrenceUri],
    );
    return result.rows[0]?.scientific_name || null;
  }

  async refreshCommunityIds(): Promise<void> {
    await this.pool.query(
      "REFRESH MATERIALIZED VIEW CONCURRENTLY community_ids",
    );
  }

  // OAuth state methods (for PKCE flow)
  async getOAuthState(key: string): Promise<string | undefined> {
    const result = await this.pool.query(
      "SELECT value FROM oauth_state WHERE key = $1 AND expires_at > NOW()",
      [key],
    );
    return result.rows[0]?.value;
  }

  async setOAuthState(key: string, value: string, ttlMs = 600000): Promise<void> {
    const expiresAt = new Date(Date.now() + ttlMs);
    await this.pool.query(
      `INSERT INTO oauth_state (key, value, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = $2, expires_at = $3`,
      [key, value, expiresAt],
    );
  }

  async deleteOAuthState(key: string): Promise<void> {
    await this.pool.query("DELETE FROM oauth_state WHERE key = $1", [key]);
  }

  async cleanupExpiredOAuthState(): Promise<void> {
    await this.pool.query("DELETE FROM oauth_state WHERE expires_at < NOW()");
  }

  // OAuth session methods (stores AT Protocol client session as JSON)
  async getOAuthSession(key: string): Promise<string | undefined> {
    const result = await this.pool.query(
      "SELECT value FROM oauth_sessions WHERE key = $1",
      [key],
    );
    return result.rows[0]?.value;
  }

  async setOAuthSession(key: string, value: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO oauth_sessions (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = $2`,
      [key, value],
    );
  }

  async deleteOAuthSession(key: string): Promise<void> {
    await this.pool.query("DELETE FROM oauth_sessions WHERE key = $1", [key]);
  }
}

// Re-export row types
export type { OccurrenceRow, IdentificationRow };

// Legacy type aliases for backwards compatibility
export type ObservationRow = OccurrenceRow;
