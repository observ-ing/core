-- Seed data for e2e tests in CI.
-- Uses the test account DID so the identity resolver can find the handle.

INSERT INTO occurrences (uri, cid, did, scientific_name, vernacular_name, kingdom, family, genus, taxon_rank, event_date, location, created_at, associated_media)
VALUES
  ('at://did:plc:jh6n3ntljfhhtr4jbvrm3k5b/org.rwell.test.occurrence/seed001',
   'bafyseed001', 'did:plc:jh6n3ntljfhhtr4jbvrm3k5b',
   'Eschscholzia californica', 'California Poppy', 'Plantae', 'Papaveraceae', 'Eschscholzia', 'species',
   NOW() - INTERVAL '1 hour',
   ST_SetSRID(ST_MakePoint(-122.4194, 37.7749), 4326),
   NOW() - INTERVAL '1 hour',
   '[]'::jsonb),

  ('at://did:plc:jh6n3ntljfhhtr4jbvrm3k5b/org.rwell.test.occurrence/seed002',
   'bafyseed002', 'did:plc:jh6n3ntljfhhtr4jbvrm3k5b',
   'Quercus agrifolia', 'Coast Live Oak', 'Plantae', 'Fagaceae', 'Quercus', 'species',
   NOW() - INTERVAL '2 hours',
   ST_SetSRID(ST_MakePoint(-118.2437, 34.0522), 4326),
   NOW() - INTERVAL '2 hours',
   '[]'::jsonb),

  ('at://did:plc:jh6n3ntljfhhtr4jbvrm3k5b/org.rwell.test.occurrence/seed003',
   'bafyseed003', 'did:plc:jh6n3ntljfhhtr4jbvrm3k5b',
   'Calypte anna', 'Anna''s Hummingbird', 'Animalia', 'Trochilidae', 'Calypte', 'species',
   NOW() - INTERVAL '3 hours',
   ST_SetSRID(ST_MakePoint(-121.8863, 36.6002), 4326),
   NOW() - INTERVAL '3 hours',
   '[]'::jsonb);

-- Add observer entries so the feed enrichment can find them
INSERT INTO occurrence_observers (occurrence_uri, observer_did, role)
VALUES
  ('at://did:plc:jh6n3ntljfhhtr4jbvrm3k5b/org.rwell.test.occurrence/seed001', 'did:plc:jh6n3ntljfhhtr4jbvrm3k5b', 'owner'),
  ('at://did:plc:jh6n3ntljfhhtr4jbvrm3k5b/org.rwell.test.occurrence/seed002', 'did:plc:jh6n3ntljfhhtr4jbvrm3k5b', 'owner'),
  ('at://did:plc:jh6n3ntljfhhtr4jbvrm3k5b/org.rwell.test.occurrence/seed003', 'did:plc:jh6n3ntljfhhtr4jbvrm3k5b', 'owner');
