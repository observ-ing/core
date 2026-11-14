// Records a real appview's responses into fixtures/api.json, verbatim, for
// server.ts's fixture mode and the tests: each request the tests make, filed by
// fixtureKey. `bun record.ts [https://observ.ing]`.
import { fixtureKey } from './fixture-key.ts';

const appview = (process.argv[2] ?? process.env.APPVIEW ?? 'https://observ.ing').replace(/\/$/, '');
const PAGE = 20;
// What the tests read: an observer, a species they saw, an unidentified observation.
const DID = 'did:plc:jt6xegjm6ba2lt34aztyi2mn';
const OCCURRENCE = (rkey: string) => `at://${DID}/bio.lexicons.temp.v0-1.occurrence/${rkey}`;

const recorded: Record<string, unknown> = {};
async function record(path: string): Promise<any> {
  const url = new URL(`${appview}${path}`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  const body = await response.json();
  recorded[fixtureKey(url)] = body;
  console.log(`${fixtureKey(url)}`);
  return body;
}

const first = await record(`/api/feeds/explore?limit=${PAGE}`);
await record(`/api/feeds/explore?limit=${PAGE}&cursor=${encodeURIComponent(first.cursor)}`);
await record(`/api/feeds/explore?kingdom=Plantae&limit=${PAGE}`);
await record(`/api/occurrences/${encodeURIComponent(OCCURRENCE('3mzucjhpluy22'))}`); // Common Loon
await record(`/api/occurrences/${encodeURIComponent(OCCURRENCE('3mzvx3lfxlr22'))}`); // unidentified, no photo
await record(`/api/profiles/${encodeURIComponent(DID)}/feed?type=observations&limit=1`);
await record(`/api/profiles/${encodeURIComponent(DID)}/feed?type=observations&limit=${PAGE}`);
await record(`/api/profiles/${encodeURIComponent(DID)}/feed?type=identifications&limit=${PAGE}`);
await record(`/api/taxa/Animalia/Gavia%20immer`);
await record(`/api/taxa/Animalia/Gavia%20immer/occurrences?limit=${PAGE}`);
await record(`/api/taxa/Animalia/Gavia`);
await record(`/api/taxa/Animalia/Gavia/occurrences?limit=${PAGE}`);
await record(`/api/taxa/search?q=gavia`);
await record(`/api/feeds/explore?kingdom=Animalia&taxon=${encodeURIComponent('Gavia immer')}&limit=${PAGE}`); // Show in Explore

await Bun.write(`${import.meta.dir}/fixtures/api.json`, `${JSON.stringify(recorded, null, 1)}\n`);
console.log(`fixtures/api.json ← ${appview}: ${Object.keys(recorded).length} responses`);
