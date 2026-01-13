/**
 * Database Layer for Biosky Ingester
 *
 * PostgreSQL with PostGIS extension for storing and querying
 * biodiversity observations spatially.
 */

import pg from "pg";
import type { ObservationEvent, IdentificationEvent } from "./firehose.js";
import type { Observation, Identification } from "../generated/types.js";

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

      -- Observations table
      CREATE TABLE IF NOT EXISTS observations (
        uri TEXT PRIMARY KEY,
        cid TEXT NOT NULL,
        did TEXT NOT NULL,
        scientific_name TEXT NOT NULL,
        event_date TIMESTAMPTZ NOT NULL,
        location GEOGRAPHY(POINT, 4326) NOT NULL,
        coordinate_uncertainty_meters INTEGER,
        verbatim_locality TEXT,
        notes TEXT,
        blobs JSONB,
        created_at TIMESTAMPTZ NOT NULL,
        indexed_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Create spatial index
      CREATE INDEX IF NOT EXISTS observations_location_idx
        ON observations USING GIST(location);

      -- Create index on scientific name for taxonomy queries
      CREATE INDEX IF NOT EXISTS observations_scientific_name_idx
        ON observations(scientific_name);

      -- Create index on DID for user queries
      CREATE INDEX IF NOT EXISTS observations_did_idx
        ON observations(did);

      -- Create index on event date for temporal queries
      CREATE INDEX IF NOT EXISTS observations_event_date_idx
        ON observations(event_date);

      -- Identifications table
      CREATE TABLE IF NOT EXISTS identifications (
        uri TEXT PRIMARY KEY,
        cid TEXT NOT NULL,
        did TEXT NOT NULL,
        subject_uri TEXT NOT NULL REFERENCES observations(uri) ON DELETE CASCADE,
        subject_cid TEXT NOT NULL,
        taxon_name TEXT NOT NULL,
        taxon_rank TEXT,
        comment TEXT,
        is_agreement BOOLEAN DEFAULT FALSE,
        confidence TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        indexed_at TIMESTAMPTZ DEFAULT NOW()
      );

      -- Index for looking up identifications by observation
      CREATE INDEX IF NOT EXISTS identifications_subject_uri_idx
        ON identifications(subject_uri);

      -- Index for user's identifications
      CREATE INDEX IF NOT EXISTS identifications_did_idx
        ON identifications(did);

      -- Community ID materialized view (refreshed periodically)
      CREATE MATERIALIZED VIEW IF NOT EXISTS community_ids AS
      SELECT
        o.uri as observation_uri,
        i.taxon_name,
        COUNT(*) as id_count,
        COUNT(*) FILTER (WHERE i.is_agreement) as agreement_count
      FROM observations o
      JOIN identifications i ON i.subject_uri = o.uri
      GROUP BY o.uri, i.taxon_name
      ORDER BY o.uri, id_count DESC;

      CREATE UNIQUE INDEX IF NOT EXISTS community_ids_uri_taxon_idx
        ON community_ids(observation_uri, taxon_name);
    `);

    console.log("Database migrations completed");
  }

  async getCursor(): Promise<number | null> {
    const result = await this.pool.query(
      "SELECT value FROM ingester_state WHERE key = 'cursor'"
    );
    if (result.rows.length === 0) return null;
    return parseInt(result.rows[0].value);
  }

  async saveCursor(cursor: number): Promise<void> {
    await this.pool.query(
      `INSERT INTO ingester_state (key, value, updated_at)
       VALUES ('cursor', $1, NOW())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
      [cursor.toString()]
    );
  }

  async upsertObservation(event: ObservationEvent): Promise<void> {
    const record = event.record as Observation | undefined;
    if (!record) {
      console.warn(`No record data for observation ${event.uri}`);
      return;
    }

    const location = record.location;
    if (!location) {
      console.warn(`No location data for observation ${event.uri}`);
      return;
    }

    await this.pool.query(
      `INSERT INTO observations (
        uri, cid, did, scientific_name, event_date, location,
        coordinate_uncertainty_meters, verbatim_locality, notes, blobs, created_at
      ) VALUES (
        $1, $2, $3, $4, $5,
        ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
        $8, $9, $10, $11, $12
      )
      ON CONFLICT (uri) DO UPDATE SET
        cid = $2,
        scientific_name = $4,
        event_date = $5,
        location = ST_SetSRID(ST_MakePoint($6, $7), 4326)::geography,
        coordinate_uncertainty_meters = $8,
        verbatim_locality = $9,
        notes = $10,
        blobs = $11,
        indexed_at = NOW()`,
      [
        event.uri,
        event.cid,
        event.did,
        record.scientificName,
        record.eventDate,
        location.decimalLongitude,
        location.decimalLatitude,
        location.coordinateUncertaintyInMeters || null,
        record.verbatimLocality || null,
        record.notes || null,
        JSON.stringify(record.blobs || []),
        record.createdAt,
      ]
    );
  }

  async deleteObservation(uri: string): Promise<void> {
    await this.pool.query("DELETE FROM observations WHERE uri = $1", [uri]);
  }

  async upsertIdentification(event: IdentificationEvent): Promise<void> {
    const record = event.record as Identification | undefined;
    if (!record) {
      console.warn(`No record data for identification ${event.uri}`);
      return;
    }

    await this.pool.query(
      `INSERT INTO identifications (
        uri, cid, did, subject_uri, subject_cid, taxon_name,
        taxon_rank, comment, is_agreement, confidence, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (uri) DO UPDATE SET
        cid = $2,
        taxon_name = $6,
        taxon_rank = $7,
        comment = $8,
        is_agreement = $9,
        confidence = $10,
        indexed_at = NOW()`,
      [
        event.uri,
        event.cid,
        event.did,
        record.subject.uri,
        record.subject.cid,
        record.taxonName,
        record.taxonRank || null,
        record.comment || null,
        record.isAgreement || false,
        record.confidence || "medium",
        record.createdAt,
      ]
    );
  }

  async deleteIdentification(uri: string): Promise<void> {
    await this.pool.query("DELETE FROM identifications WHERE uri = $1", [uri]);
  }

  // Query methods for the AppView

  async getObservationsNearby(
    lat: number,
    lng: number,
    radiusMeters: number,
    limit = 100,
    offset = 0
  ): Promise<ObservationRow[]> {
    const result = await this.pool.query(
      `SELECT
        uri, cid, did, scientific_name, event_date,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        coordinate_uncertainty_meters, verbatim_locality, notes, blobs, created_at,
        ST_Distance(location, ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography) as distance_meters
      FROM observations
      WHERE ST_DWithin(
        location,
        ST_SetSRID(ST_MakePoint($2, $1), 4326)::geography,
        $3
      )
      ORDER BY distance_meters
      LIMIT $4 OFFSET $5`,
      [lat, lng, radiusMeters, limit, offset]
    );
    return result.rows;
  }

  async getObservationsByBoundingBox(
    minLat: number,
    minLng: number,
    maxLat: number,
    maxLng: number,
    limit = 1000
  ): Promise<ObservationRow[]> {
    const result = await this.pool.query(
      `SELECT
        uri, cid, did, scientific_name, event_date,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        coordinate_uncertainty_meters, verbatim_locality, notes, blobs, created_at
      FROM observations
      WHERE location && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography
      LIMIT $5`,
      [minLng, minLat, maxLng, maxLat, limit]
    );
    return result.rows;
  }

  async getObservation(uri: string): Promise<ObservationRow | null> {
    const result = await this.pool.query(
      `SELECT
        uri, cid, did, scientific_name, event_date,
        ST_Y(location::geometry) as latitude,
        ST_X(location::geometry) as longitude,
        coordinate_uncertainty_meters, verbatim_locality, notes, blobs, created_at
      FROM observations
      WHERE uri = $1`,
      [uri]
    );
    return result.rows[0] || null;
  }

  async getIdentificationsForObservation(
    observationUri: string
  ): Promise<IdentificationRow[]> {
    const result = await this.pool.query(
      `SELECT
        uri, cid, did, subject_uri, subject_cid, taxon_name,
        taxon_rank, comment, is_agreement, confidence, created_at
      FROM identifications
      WHERE subject_uri = $1
      ORDER BY created_at DESC`,
      [observationUri]
    );
    return result.rows;
  }

  async getCommunityId(observationUri: string): Promise<string | null> {
    const result = await this.pool.query(
      `SELECT taxon_name, id_count
       FROM community_ids
       WHERE observation_uri = $1
       ORDER BY id_count DESC
       LIMIT 1`,
      [observationUri]
    );
    return result.rows[0]?.taxon_name || null;
  }

  async refreshCommunityIds(): Promise<void> {
    await this.pool.query("REFRESH MATERIALIZED VIEW CONCURRENTLY community_ids");
  }
}

export interface ObservationRow {
  uri: string;
  cid: string;
  did: string;
  scientific_name: string;
  event_date: Date;
  latitude: number;
  longitude: number;
  coordinate_uncertainty_meters: number | null;
  verbatim_locality: string | null;
  notes: string | null;
  blobs: unknown[];
  created_at: Date;
  distance_meters?: number;
}

export interface IdentificationRow {
  uri: string;
  cid: string;
  did: string;
  subject_uri: string;
  subject_cid: string;
  taxon_name: string;
  taxon_rank: string | null;
  comment: string | null;
  is_agreement: boolean;
  confidence: string;
  created_at: Date;
}
