/**
 * Database Layer for Biosky Ingester
 *
 * PostgreSQL with PostGIS extension for storing and querying
 * biodiversity occurrences spatially. Uses Darwin Core terminology.
 */

import pg from "pg";
import type { OccurrenceEvent, IdentificationEvent } from "./firehose.js";
import type { Occurrence, Identification } from "../generated/types.js";

const { Pool } = pg;

export class Database {
  private pool: pg.Pool;

  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString });
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
    await this.pool.query(
      `INSERT INTO ingester_state (key, value, updated_at)
       VALUES ('cursor', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [cursor.toString()],
    );
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
        record.basisOfRecord || "HumanObservation",
        record.scientificName || null,
        record.eventDate,
        location.decimalLongitude,
        location.decimalLatitude,
        location.coordinateUncertaintyInMeters || null,
        record.verbatimLocality || null,
        record.habitat || null,
        record.occurrenceStatus || "present",
        record.occurrenceRemarks || null,
        record.individualCount || null,
        record.sex || null,
        record.lifeStage || null,
        record.reproductiveCondition || null,
        record.behavior || null,
        record.establishmentMeans || null,
        JSON.stringify(record.associatedMedia || []),
        record.recordedBy || null,
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
        record.scientificName,
        record.taxonRank || null,
        record.identificationQualifier || null,
        record.taxonID || null,
        record.identificationRemarks || null,
        record.identificationVerificationStatus || null,
        record.typeStatus || null,
        record.isAgreement || false,
        record.dateIdentified,
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
}

export interface OccurrenceRow {
  uri: string;
  cid: string;
  did: string;
  basis_of_record: string;
  scientific_name: string | null;
  event_date: Date;
  latitude: number;
  longitude: number;
  coordinate_uncertainty_meters: number | null;
  verbatim_locality: string | null;
  habitat: string | null;
  occurrence_status: string;
  occurrence_remarks: string | null;
  individual_count: number | null;
  sex: string | null;
  life_stage: string | null;
  reproductive_condition: string | null;
  behavior: string | null;
  establishment_means: string | null;
  associated_media: unknown[];
  recorded_by: string | null;
  created_at: Date;
  distance_meters?: number;
}

export interface IdentificationRow {
  uri: string;
  cid: string;
  did: string;
  subject_uri: string;
  subject_cid: string;
  scientific_name: string;
  taxon_rank: string | null;
  identification_qualifier: string | null;
  taxon_id: string | null;
  identification_remarks: string | null;
  identification_verification_status: string | null;
  type_status: string | null;
  is_agreement: boolean;
  date_identified: Date;
}

// Legacy type aliases for backwards compatibility
export type ObservationRow = OccurrenceRow;
