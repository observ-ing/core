import type { Answer, Result, Sources, Store } from './app.contract.d.ts';
// The appview's own response types, generated from its Rust structs by ts-rs.
import type { Occurrence } from './bindings/Occurrence.ts';
import type { Identification } from './bindings/Identification.ts';
import type { Comment } from './bindings/Comment.ts';
import type { Profile } from './bindings/Profile.ts';
import type { TaxaResult } from './bindings/TaxaResult.ts';
import type { TaxonDetailWithCount } from './bindings/TaxonDetailWithCount.ts';

// Exact's host functions for a browser sign-in (as @exact/oauth declares them).
declare function openAuthSession(url: string, options: { callback: string; state: string; ephemeral?: boolean }): Promise<string>;
declare function authCallback(): string;

// The dev server (server.ts): it proxies a real appview when started with
// APPVIEW=…, else answers from fixtures/ recorded from one.
export const API = 'http://127.0.0.1:8787';
// Where the system browser signs in: the appview itself, since its atproto
// OAuth client redirects back to its own origin. The dev server stands in
// for one in tests; a live build names the appview APPVIEW proxies.
const AUTH = import.meta.env.OBSERVING_AUTH_ORIGIN ?? 'http://127.0.0.1:8787';
// The session token the appview issued, kept in the platform's secret store.
const SESSION = 'observing.session';
// A native app's sign-in callback (its URL scheme); the web uses its own page's.
const NATIVE_CALLBACK = 'ing.observ.exactspike:/oauth';
export const grants = [`net.fetch ${API}`, `auth.session ${AUTH}`, `auth.callback ${NATIVE_CALLBACK}`, `secret.keep ${SESSION}`].join('\n');

const PAGE = 20;
const LINEAGE = ['kingdom', 'phylum', 'class', 'order', 'family', 'genus'] as const;

type Observation = Result<'loadFeed'>['items'][number];
type TaxonRow = Result<'searchTaxa'>[number];
type Paged = { occurrences: Occurrence[]; cursor?: string | null };

// Responses the appview sends without a ts-rs binding (crates/observing-appview/src/responses.rs).
type OccurrenceDetailResponse = { occurrence: Occurrence; identifications: Identification[]; comments: Comment[] };
type ProfileFeedResponse = Paged & {
  profile: Profile;
  counts: { observations: number; identifications: number; species: number };
};

type Kept = { token: string; did: string };
const kept = (store: Store): Kept | null => {
  try {
    const raw = store.get(SESSION);
    return raw ? (JSON.parse(raw) as Kept) : null;
  } catch {
    return null;
  }
};
// Every request carries the session's token when there is one, so reads show
// what the signed-in person may see (their likes, the home feed).
const authHeaders = (store: Store): Record<string, string> => {
  const session = kept(store);
  return session ? { Authorization: `Bearer ${session.token}` } : {};
};

class ApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function get<T>(path: string, store: Store): Promise<T> {
  const response = await fetch(`${API}${path}`, { headers: authHeaders(store), exactTimeout: 15000 });
  if (!response.ok) throw new ApiError(response.status, `${path} answered ${response.status}.`);
  return (await response.json()) as T;
}

const base64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = (n: number) => base64url(crypto.getRandomValues(new Uint8Array(n)));
const challengeOf = async (verifier: string) =>
  base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
const SIGNED_OUT = { signedIn: false, did: '', handle: '', name: '', avatar: '', error: '' };

const absolute = (url: string | null | undefined) => (!url ? '' : url.startsWith('/') ? `${API}${url}` : url);
// The feed's rows show the appview's thumbnail of a blob, not the blob itself.
const thumb = (url: string) => absolute(url.startsWith('/media/blob/') ? url.replace('/media/blob/', '/media/thumb/') : url);
const name = (p: Profile) => p.displayName || p.handle || p.did;
// "https://creativecommons.org/licenses/by-nc/4.0/" reads "CC BY-NC 4.0"; anything else as given.
function licenseLabel(license: string | null | undefined): string {
  if (!license) return '';
  const cc = /creativecommons\.org\/(licenses|publicdomain)\/([a-z-]+)\/([\d.]+)/i.exec(license);
  if (!cc) return license;
  return cc[1] === 'publicdomain' ? (cc[2] === 'zero' ? 'CC0' : 'Public domain') : `CC ${cc[2].toUpperCase()} ${cc[3]}`;
}
const stripTags = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

// at://<did>/<collection>/<rkey>
function parts(uri: string) {
  const [did = '', , rkey = ''] = uri.slice('at://'.length).split('/');
  return { did, rkey };
}

// A taxon's route is /taxon/:kingdom/:name; the appview's id is "Kingdom/Name", or "Kingdom" for a kingdom.
function taxonRoute(id: string, kingdom?: string | null, scientificName?: string) {
  const slash = id.indexOf('/');
  if (slash > 0) return { kingdom: id.slice(0, slash), name: id.slice(slash + 1) };
  if (kingdom && scientificName) return { kingdom, name: scientificName };
  return { kingdom: id, name: id };
}

// An ISO instant or a Darwin Core interval ("a/b"), read by its start.
const instant = (s: string | null | undefined, fallback = 0) => {
  const ms = s ? Date.parse(s.split('/')[0] ?? s) : NaN;
  return Number.isFinite(ms) ? ms : fallback;
};

function toObservation(o: Occurrence): Observation {
  const { did, rkey } = parts(o.uri);
  const tax = o.effectiveTaxonomy;
  const loc = o.location;
  const image = o.images[0]?.url ?? '';
  return {
    did,
    rkey,
    commonName: tax?.vernacularName ?? '',
    scientificName: tax?.scientificName ?? '',
    rank: tax?.rank ?? '',
    kingdom: tax?.kingdom ?? '',
    lineage: tax ? LINEAGE.map((r) => tax[r]).filter((x): x is string => !!x).join(' › ') : '',
    observer: name(o.observer),
    observerDid: o.observer.did,
    handle: o.observer.handle ? `@${o.observer.handle}` : '',
    observedAt: instant(o.eventDate ?? o.createdAt, instant(o.createdAt)),
    photo: image === '' ? '' : thumb(image),
    license: licenseLabel(o.images[0]?.license),
    place: loc
      ? `${loc.latitude.toFixed(4)}, ${loc.longitude.toFixed(4)}${loc.uncertaintyMeters != null ? ` (±${loc.uncertaintyMeters} m)` : ''}`
      : '',
    identifications: o.identificationCount,
    likes: o.likeCount ?? 0,
    remarks: o.occurrenceRemarks ?? '',
    needsId: o.qualityIssues.includes('NO_CONSENSUS_ID'),
  };
}

// Pages already read, by the query they answer: Show More asks for one more
// page, not for every page again. A filter change is a new query.
const pages = new Map<string, Paged[]>();
async function readPages(path: string, wanted: number, store: Store): Promise<{ occurrences: Occurrence[]; more: boolean }> {
  // What a page holds depends on who reads it (likes, the home feed): key by the session too.
  const key = `${kept(store)?.did ?? ''} ${path}`;
  const read = pages.get(key) ?? [];
  while (read.length < Math.max(1, wanted)) {
    const last = read.at(-1);
    if (last && !hasMore(last)) break;
    const sep = path.includes('?') ? '&' : '?';
    const cursor = last?.cursor ? `&cursor=${encodeURIComponent(last.cursor)}` : '';
    read.push(await get<Paged>(`${path}${sep}limit=${PAGE}${cursor}`, store));
    pages.set(key, read);
  }
  const shown = read.slice(0, Math.max(1, wanted));
  const end = shown.at(-1);
  return { occurrences: shown.flatMap((p) => p.occurrences), more: !!end && hasMore(end) };
}
// Some endpoints send a cursor with their last page too: a short page is the end.
const hasMore = (p: Paged) => !!p.cursor && p.occurrences.length >= PAGE;

const QUALITY: Record<string, string> = {
  MISSING_DATE: 'No date',
  MISSING_LOCATION: 'No location',
  MISSING_MEDIA: 'No photo or sound',
  COORDINATES_IMPRECISE: 'Location is imprecise',
  NO_CONSENSUS_ID: 'No community identification yet',
};

const sources: Sources = {
  loadFeed: async ([kingdom, taxon, quality, startDate, endDate, wanted], store) => {
    const q = new URLSearchParams();
    if (kingdom) q.set('kingdom', kingdom);
    if (taxon) q.set('taxon', taxon);
    if (quality) q.set('quality', quality);
    if (startDate) q.set('startDate', startDate);
    if (endDate) q.set('endDate', endDate);
    const query = q.toString();
    const { occurrences, more } = await readPages(`/api/feeds/explore${query ? `?${query}` : ''}`, wanted, store);
    return { items: occurrences.map(toObservation), more };
  },

  loadObservation: async ([did, rkey], store) => {
    const empty = {
      did, rkey, found: false, obs: toObservation({ uri: `at://${did}//${rkey}`, cid: '', observer: { did }, identificationCount: 0,
        images: [], externalRecords: [], createdAt: '', qualityIssues: [] }),
      photos: [], latitude: 0, longitude: 0, hasLocation: false, uncertainty: '', eventRemarks: '', taxonKingdom: '', taxonName: '',
      issues: [], identifications: [], comments: [], links: [],
    };
    if (!did || !rkey) return empty;
    const uri = `at://${did}/bio.lexicons.temp.v0-1.occurrence/${rkey}`;
    const d = await get<OccurrenceDetailResponse>(`/api/occurrences/${encodeURIComponent(uri)}`, store);
    const o = d.occurrence;
    const tax = o.effectiveTaxonomy;
    // A taxon page is addressed by kingdom and name (taxonId is a GBIF URL, not a route).
    const route = tax?.kingdom && tax.scientificName ? { kingdom: tax.kingdom, name: tax.scientificName } : null;
    return {
      did, rkey, found: true,
      obs: toObservation(o),
      photos: o.images.map((img, index) => ({ index, url: absolute(img.url), thumb: thumb(img.url), license: licenseLabel(img.license) })),
      latitude: o.location?.latitude ?? 0,
      longitude: o.location?.longitude ?? 0,
      hasLocation: !!o.location,
      uncertainty: o.location?.uncertaintyMeters != null ? `±${o.location.uncertaintyMeters} m` : '',
      eventRemarks: o.eventRemarks ?? '',
      taxonKingdom: route?.kingdom ?? '',
      taxonName: route?.name ?? '',
      issues: o.qualityIssues.map((i) => QUALITY[i] ?? i),
      identifications: d.identifications.map((i) => ({
        uri: i.uri,
        who: name(i.identifier),
        whoDid: i.identifier.did,
        scientificName: i.scientific_name,
        rank: i.taxon_rank ?? '',
        kingdom: i.kingdom ?? '',
        at: instant(i.date_identified),
      })),
      comments: d.comments.map((c) => ({ uri: c.uri, who: name(c.commenter), whoDid: c.commenter.did, body: c.body, at: instant(c.created_at) })),
      links: o.externalRecords.map((r) => ({ url: r.uri, label: r.service === 'inaturalist' ? 'iNaturalist' : (r.service ?? new URL(r.uri).host) })),
    };
  },

  loadProfile: async ([did, wanted], store) => {
    if (!did) return { did, found: false, name: '', handle: '', avatar: '', observations: 0, identifications: 0, species: 0, items: [], more: false };
    const path = `/api/profiles/${encodeURIComponent(did)}/feed?type=observations`;
    const first = await get<ProfileFeedResponse>(`${path}&limit=1`, store);
    const { occurrences, more } = await readPages(path, wanted, store);
    return {
      did, found: true,
      name: name(first.profile),
      handle: first.profile.handle ? `@${first.profile.handle}` : '',
      avatar: first.profile.avatar ?? '',
      observations: first.counts.observations,
      identifications: first.counts.identifications,
      species: first.counts.species,
      items: occurrences.map(toObservation),
      more,
    };
  },

  loadTaxon: async ([kingdom, taxonName, wanted], store) => {
    const none = { kingdom, name: taxonName, found: false, scientificName: '', commonName: '', rank: '', photo: '', status: '',
      extinct: false, description: '', descriptionSource: '', observationCount: 0, descendants: 0, ancestors: [], children: [],
      media: [], gbifUrl: '', wikidataUrl: '', items: [], more: false };
    if (!kingdom || !taxonName) return none;
    const base = `/api/taxa/${encodeURIComponent(kingdom)}/${encodeURIComponent(taxonName)}`;
    const t = await get<TaxonDetailWithCount>(base, store);
    const { occurrences, more } = await readPages(`${base}/occurrences`, wanted, store);
    const description = t.descriptions?.find((d) => d.description.trim() !== '');
    return {
      kingdom, name: taxonName, found: true,
      scientificName: t.scientificName,
      commonName: t.commonName ?? '',
      rank: t.rank,
      photo: t.photoUrl ?? '',
      status: t.conservationStatus ? `${t.conservationStatus.category} (${t.conservationStatus.source})` : '',
      extinct: t.extinct ?? false,
      description: stripTags(t.description ?? description?.description ?? ''),
      descriptionSource: t.description ? '' : (description?.source ?? ''),
      observationCount: Number(t.observationCount),
      descendants: t.numDescendants ?? 0,
      ancestors: t.ancestors.map((a) => ({ ...taxonRoute(a.id), scientificName: a.name, rank: a.rank })),
      children: [...new Map(t.children.map(toTaxonRow).map((c) => [`${c.kingdom}/${c.name}`, c])).values()],
      media: (t.media ?? []).filter((m) => m.type === 'StillImage').slice(0, 12)
        .map((m, i) => ({ index: i, url: m.url, credit: [m.creator, m.license, m.source].filter(Boolean).join(' · ') })),
      gbifUrl: t.gbifUrl ?? '',
      wikidataUrl: t.wikidataUrl ?? '',
      items: occurrences.map(toObservation),
      more,
    };
  },

  searchTaxa: async ([query], store) => {
    if (query.trim().length < 2) return [];
    const body = await get<{ results: TaxaResult[] }>(`/api/taxa/search?q=${encodeURIComponent(query.trim())}`, store);
    // The appview can list one taxon once per source it found it in: show it once.
    const seen = new Set<string>();
    return body.results.map(toTaxonRow).filter((t) => {
      const key = `${t.kingdom}/${t.name}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },

  // Who is signed in. The appview answers `user: null` once the session has
  // ended (expired, signed out elsewhere, or its atproto session lapsed).
  session: async (_args, store) => {
    const session = kept(store);
    if (!session) return SIGNED_OUT;
    const me = await get<{ user: { did: string; handle: string; displayName?: string; avatar?: string } | null }>('/oauth/me', store);
    if (!me.user) {
      store.forget(SESSION);
      return { ...SIGNED_OUT, error: 'Your session ended. Sign in again.' };
    }
    return {
      signedIn: true,
      did: me.user.did,
      handle: `@${me.user.handle}`,
      name: me.user.displayName || me.user.handle,
      avatar: me.user.avatar ?? '',
      error: '',
    };
  },

  // Sign in with an atproto handle: the system browser runs the appview's
  // OAuth flow, which hands back a one-time code; the code and this sign-in's
  // PKCE verifier buy the session token, so the token never travels in a URL.
  signIn: async ([handle], store) => {
    const who = handle.trim().replace(/^@/, '');
    if (!who) return { ok: false, error: 'Enter your handle, like alice.bsky.social.' };
    const verifier = randomString(32);
    const state = randomString(16);
    const callback = authCallback();
    const q = new URLSearchParams({
      handle: who,
      redirect_uri: callback,
      state,
      code_challenge: await challengeOf(verifier),
      code_challenge_method: 'S256',
    });
    let answered: string;
    try {
      answered = await openAuthSession(`${AUTH}/oauth/app/login?${q}`, { callback, state });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'USER_CANCEL' || code === 'cancelled' || code === 'AbortError') return { ok: false, error: '' };
      return { ok: false, error: 'Sign-in couldn’t start. Try again.' };
    }
    const back = new URL(answered);
    if (back.searchParams.get('state') !== state) return { ok: false, error: 'Sign-in was interrupted. Try again.' };
    const failed = back.searchParams.get('error');
    if (failed) return { ok: false, error: failed === 'access_denied' ? '' : 'Your server didn’t sign you in. Try again.' };
    const code = back.searchParams.get('code');
    if (!code) return { ok: false, error: 'Sign-in was interrupted. Try again.' };
    const response = await fetch(`${API}/oauth/app/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier }),
      exactTimeout: 15000,
    });
    if (!response.ok) return { ok: false, error: 'Sign-in didn’t finish. Try again.' };
    const { token, did } = (await response.json()) as Kept;
    store.set(SESSION, JSON.stringify({ token, did }));
    pages.clear();
    return { ok: true, error: '' };
  },

  // Sign out: the appview ends the session, so the token stops working even
  // if a copy of it survives somewhere; the app forgets it either way.
  signOut: async (_args, store) => {
    const headers = authHeaders(store);
    store.forget(SESSION);
    pages.clear();
    try {
      await fetch(`${API}/oauth/logout`, { method: 'POST', headers, exactTimeout: 15000 });
    } catch {
      // Offline: the token is forgotten here and expires on the server.
    }
    return { ok: true, error: '' };
  },

  // Observations for the signed-in viewer, complete ones only, as observ.ing's home shows.
  loadHome: async ([did, wanted], store) => {
    if (!did) return { items: [], more: false };
    const { occurrences, more } = await readPages('/api/feeds/home?quality=complete', wanted, store);
    return { items: occurrences.map(toObservation), more };
  },
};

function toTaxonRow(t: TaxaResult): TaxonRow {
  return {
    ...taxonRoute(t.id, t.kingdom, t.scientificName),
    scientificName: t.scientificName,
    commonName: t.commonName ?? '',
    rank: t.rank,
    photo: t.photoUrl ?? '',
  };
}

export const answer: Answer = (source, args, store, storage, native) => sources[source](args, store, storage, native);
