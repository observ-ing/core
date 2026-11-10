import type { Answer, Result, Sources } from './app.contract.d.ts';
// The appview's own response types, generated from its Rust structs by ts-rs.
import type { Occurrence } from './bindings/Occurrence.ts';
import explore from './fixtures/explore.json' with { type: 'json' };

// The dev server (server.ts): it proxies a real appview when started with
// APPVIEW=…, else answers from fixtures/ recorded from one.
export const API = 'http://127.0.0.1:8787';
export const grants = `net.fetch ${API}`;
// true: answer from fixtures/ with no server (the published demo build).
const DEMO = false;

const LINEAGE = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'] as const;
type Observation = Result<'loadFeed'>['items'][number];

// The appview's row, flattened into the shape the view declares.
function toObservation(o: Occurrence, photoBase: string): Observation {
  // at://<did>/<collection>/<rkey>
  const [did = '', , rkey = ''] = o.uri.slice('at://'.length).split('/');
  const tax = o.effectiveTaxonomy;
  const loc = o.location;
  const place = loc
    ? `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}${loc.uncertaintyMeters != null ? ` (±${loc.uncertaintyMeters} m)` : ''}`
    : '';
  const image = o.images[0]?.url ?? '';
  return {
    did,
    rkey,
    commonName: tax?.vernacularName ?? '',
    scientificName: tax?.scientificName ?? '',
    rank: tax?.rank ?? '',
    lineage: tax ? LINEAGE.map((r) => tax[r]).filter((x): x is string => !!x).join(' › ') : '',
    observer: o.observer.displayName ?? o.observer.handle ?? o.observer.did,
    handle: o.observer.handle ? `@${o.observer.handle}` : '',
    // A Darwin Core interval ("a/b") is shown by its start.
    observedAt: Date.parse((o.eventDate ?? o.createdAt).split('/')[0] ?? o.createdAt),
    photo: image === '' ? '' : image.startsWith('/') ? `${photoBase}${image}` : image,
    license: o.images[0]?.license ?? '',
    place,
    identifications: o.identificationCount,
    likes: o.likeCount ?? 0,
    remarks: o.occurrenceRemarks ?? '',
    needsId: o.qualityIssues.includes('NO_CONSENSUS_ID'),
  };
}

const sources: Sources = {
  loadFeed: async ([limit]): Promise<Result<'loadFeed'>> => {
    if (DEMO) {
      const all = (explore as { occurrences: Occurrence[] }).occurrences;
      return { items: all.slice(0, limit).map((o) => toObservation(o, API)), more: limit < all.length };
    }
    const response = await fetch(`${API}/api/feeds/explore?limit=${limit}`, { exactTimeout: 10000 });
    if (!response.ok) throw new Error(`The feed answered ${response.status}.`);
    const body = (await response.json()) as { occurrences?: Occurrence[]; cursor?: string };
    if (!Array.isArray(body.occurrences)) throw new Error('The feed returned no occurrences.');
    return { items: body.occurrences.map((o) => toObservation(o, API)), more: body.cursor != null };
  },
};
export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native);
