-- Seed data for e2e tests in CI.
-- Uses the test account DID so the identity resolver can find the handle.
--
-- eventDate is stored across three columns (see the eventDate-range work):
-- `event_date_start`/`event_date_end` are the sortable/filterable bounds and
-- `event_date_raw` is the verbatim string the appview displays.

INSERT INTO occurrences (uri, cid, did, scientific_name, kingdom, family, genus, taxon_rank, event_date_start, event_date_end, event_date_raw, location, created_at, associated_media)
VALUES
  ('at://did:plc:jh6n3ntljfhhtr4jbvrm3k5b/bio.lexicons.temp.occurrence/seed001',
   'bafyseed001', 'did:plc:jh6n3ntljfhhtr4jbvrm3k5b',
   'Eschscholzia californica', 'Plantae', 'Papaveraceae', 'Eschscholzia', 'species',
   NOW() - INTERVAL '1 hour',
   NOW() - INTERVAL '1 hour' + INTERVAL '1 second',
   to_char((NOW() - INTERVAL '1 hour') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326),
   NOW() - INTERVAL '1 hour',
   '[]'::jsonb),

  ('at://did:plc:jh6n3ntljfhhtr4jbvrm3k5b/bio.lexicons.temp.occurrence/seed002',
   'bafyseed002', 'did:plc:jh6n3ntljfhhtr4jbvrm3k5b',
   'Quercus agrifolia', 'Plantae', 'Fagaceae', 'Quercus', 'species',
   NOW() - INTERVAL '2 hours',
   NOW() - INTERVAL '2 hours' + INTERVAL '1 second',
   to_char((NOW() - INTERVAL '2 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   ST_SetSRID(ST_MakePoint(-118.2437, 34.0522), 4326),
   NOW() - INTERVAL '2 hours',
   '[]'::jsonb),

  ('at://did:plc:jh6n3ntljfhhtr4jbvrm3k5b/bio.lexicons.temp.occurrence/seed003',
   'bafyseed003', 'did:plc:jh6n3ntljfhhtr4jbvrm3k5b',
   'Calypte anna', 'Animalia', 'Trochilidae', 'Calypte', 'species',
   NOW() - INTERVAL '3 hours',
   NOW() - INTERVAL '3 hours' + INTERVAL '1 second',
   to_char((NOW() - INTERVAL '3 hours') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
   ST_SetSRID(ST_MakePoint(-121.8863, 36.6002), 4326),
   NOW() - INTERVAL '3 hours',
   '[]'::jsonb);
