import type { Answer, Result, Sources, Storage, Store } from './app.contract.d.ts';
// The appview's own response types, generated from its Rust structs by ts-rs.
import type { Occurrence } from './bindings/Occurrence.ts';
import type { Identification } from './bindings/Identification.ts';
import type { Comment } from './bindings/Comment.ts';
import type { Profile } from './bindings/Profile.ts';
import type { TaxaResult } from './bindings/TaxaResult.ts';
import type { TaxonDetailWithCount } from './bindings/TaxonDetailWithCount.ts';
import type { CreateOccurrenceRequest } from './bindings/CreateOccurrenceRequest.ts';
import type { SpeciesSuggestion } from './bindings/SpeciesSuggestion.ts';
import { readExif } from './exif.ts';
import { discard, enqueue, readQueue, retry, sendWaiting } from './queue.ts';

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
export const grants = [
  `net.fetch ${API}`, `auth.session ${AUTH}`, `auth.callback ${NATIVE_CALLBACK}`, `secret.keep ${SESSION}`,
  // Photos for a new observation: the picked copies, and the JPEGs made from them for preview and upload.
  'fs.read app:/tmp/picked', 'fs.read app:/tmp/upload', 'fs.write app:/tmp/upload',
  'device.geolocation locationPurpose',
  // Live ID: the camera, and the photos it takes.
  'device.camera cameraPurpose', 'fs.read app:/tmp/camera',
  // Linking iNaturalist runs its authorize page in the system browser.
  'auth.session https://www.inaturalist.org',
  // The upload queue (queue.ts).
  'fs.read app:/data', 'fs.write app:/data',
].join('\n');

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
// A write's answer: done, or why not, in words to show beside what was tried.
type Reply = { ok: boolean; error: string };
async function send(method: string, path: string, store: Store, body?: unknown): Promise<Reply> {
  if (!kept(store)) return { ok: false, error: 'Sign in first.' };
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      method,
      headers: { ...authHeaders(store), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      exactTimeout: 30000,
    });
  } catch {
    return { ok: false, error: 'Can’t reach observ.ing. Check your connection and try again.' };
  }
  if (response.ok) {
    // What was read before may now be stale (counts, likes, the feeds).
    pages.clear();
    return { ok: true, error: '' };
  }
  if (response.status === 401) return { ok: false, error: 'Your session ended. Sign in again.' };
  let message = '';
  try {
    message = ((await response.json()) as { error?: string }).error ?? '';
  } catch {
    // Not JSON: say what failed by its status.
  }
  return { ok: false, error: message || `That didn’t work (${response.status}). Try again.` };
}

// --- New observations' photos -------------------------------------------

// Bytes as base64, in chunks (a photo is too big for one apply).
function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
const readBytes = async (storage: Storage, path: string) => new Uint8Array(await storage.fs.readFile(path));
// Where previews and uploads are written; made on first use.
let uploadDir: Promise<void> | null = null;
const ensureUploadDir = (storage: Storage) =>
  (uploadDir ??= storage.fs.mkdir('app:/tmp/upload').catch((e: { code?: string }) => {
    if (e.code !== 'EEXIST') {
      uploadDir = null;
      throw e;
    }
  }));
const stem = (path: string) => (path.split('/').pop() ?? path).replace(/\.[^.]*$/, '');
// HEIC/HEIF: an ISO-BMFF "ftyp" box naming a HEIF brand.
const isHeic = (b: Uint8Array) =>
  b.length > 12 && String.fromCharCode(...b.subarray(4, 8)) === 'ftyp' &&
  /^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(String.fromCharCode(...b.subarray(8, 12)));

// A picked photo as a JPEG path: itself, or (HEIC, which no browser canvas
// decodes) the appview's conversion, which keeps the EXIF.
const jpegs = new Map<string, Promise<string>>();
function asJpeg(path: string, store: Store, storage: Storage): Promise<string> {
  let done = jpegs.get(path);
  if (!done) {
    done = (async () => {
      const bytes = await readBytes(storage, path);
      if (!isHeic(bytes)) return path;
      const response = await fetch(`${API}/api/media/heic-to-jpeg`, {
        method: 'POST', headers: { ...authHeaders(store), 'Content-Type': 'image/heic' }, body: bytes, exactTimeout: 60000,
      });
      if (!response.ok) throw new ApiError(response.status, 'This HEIC photo couldn’t be converted.');
      const out = `app:/tmp/upload/${stem(path)}.jpg`;
      await ensureUploadDir(storage);
      await storage.fs.atomicWriteFile(out, new Uint8Array(await response.arrayBuffer()));
      return out;
    })();
    done.catch(() => jpegs.delete(path));
    jpegs.set(path, done);
  }
  return done;
}

// A JPEG of at most `maxBytes` (and `maxDimension` px) from a photo; where the
// host has no encoder (Linux, Windows, Android), the photo itself if it fits.
async function shrunk(path: string, tag: string, maxDimension: number, maxBytes: number, storage: Storage): Promise<Uint8Array> {
  await ensureUploadDir(storage);
  try {
    const out = await storage.fs.compressImage(path, `app:/tmp/upload/${stem(path)}-${tag}.jpg`, { maxDimension, maxBytes });
    return await readBytes(storage, out.path);
  } catch (e) {
    if ((e as { code?: string }).code !== 'unsupported') throw e;
    const bytes = await readBytes(storage, path);
    if (bytes.length > maxBytes) throw new Error('This photo is too large to upload from this device.');
    return bytes;
  }
}

type PhotoFact = Result<'describePhotos'>[number];
const described = new Map<string, Promise<PhotoFact>>();
function describe(path: string, store: Store, storage: Storage): Promise<PhotoFact> {
  let done = described.get(path);
  if (!done) {
    done = (async () => {
      const jpeg = await asJpeg(path, store, storage);
      const exif = readExif(await readBytes(storage, jpeg));
      let thumb = '';
      try {
        thumb = `data:image/jpeg;base64,${toBase64(await shrunk(jpeg, 'thumb', 240, 40_000, storage))}`;
      } catch {
        // No preview on this host: the photo still uploads.
      }
      return {
        path,
        thumb,
        takenAt: exif.takenAt,
        hasPlace: exif.latitude !== null && exif.longitude !== null,
        latitude: exif.latitude ?? 0,
        longitude: exif.longitude ?? 0,
        uncertainty: exif.uncertainty ?? 0,
      };
    })();
    done.catch(() => described.delete(path));
    described.set(path, done);
  }
  return done;
}

type EnrichedSuggestion = SpeciesSuggestion & { taxonMatch?: TaxaResult | null };
type Suggestion = Result<'suggestSpecies'>[number];

// The appview's model on a photo, near `place` when given. `live` asks for the
// faster model the camera loop uses. No model (or a busy one): none.
async function suggest(
  path: string, place: { latitude: number; longitude: number } | null, store: Store, storage: Storage, limit: number, live = false,
): Promise<Suggestion[]> {
  const image = toBase64(await shrunk(await asJpeg(path, store, storage), 'id', 1024, 600_000, storage));
  const response = await fetch(`${API}/api/species-id`, {
    method: 'POST',
    headers: { ...authHeaders(store), 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, limit, ...(place ?? {}), ...(live ? { live: true } : {}) }),
    exactTimeout: 60000,
  });
  if (!response.ok) return [];
  const body = (await response.json()) as { suggestions: EnrichedSuggestion[] };
  return body.suggestions.map((s) => ({
    scientificName: s.taxonMatch?.scientificName ?? s.scientificName,
    commonName: s.taxonMatch?.commonName ?? s.commonName ?? '',
    rank: s.taxonMatch?.rank ?? 'species',
    kingdom: s.taxonMatch?.kingdom ?? s.kingdom ?? '',
    confidence: Math.round(s.confidence * 100),
    inRange: s.inRange ?? true,
  }));
}

const NOTICE: Record<string, string> = {
  identification: 'identified your observation',
  comment: 'commented on your observation',
  like: 'liked your observation',
};
type NotificationJson = {
  id: number;
  actorDid: string;
  kind: string;
  subjectUri: string;
  read: boolean;
  createdAt: string;
  actor?: { did: string; handle?: string; displayName?: string; avatar?: string };
};

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
    // Minutes east of UTC on that day: a date across a clock change from today
    // shows in its own offset, not today's.
    observedOffset: -new Date(instant(o.eventDate ?? o.createdAt, instant(o.createdAt))).getTimezoneOffset(),
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
      issues: [], identifications: [], comments: [], links: [], uri: '', cid: '', liked: false, mine: false,
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
      uri: o.uri,
      cid: o.cid,
      liked: !!o.viewerHasLiked,
      mine: o.observer.did === kept(store)?.did,
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
        mine: i.identifier.did === kept(store)?.did,
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

  // --- Writes: each answers ok, or why not (a refusal is a reply, not a throw).
  setLiked: ([uri, cid, liked], store) =>
    liked
      ? send('POST', '/api/likes', store, { occurrenceUri: uri, occurrenceCid: cid })
      : send('DELETE', '/api/likes', store, { occurrenceUri: uri }),
  addComment: ([uri, cid, body], store) => {
    const text = body.trim();
    if (!text) return { ok: false, error: 'Write a comment first.' };
    return send('POST', '/api/comments', store, { occurrenceUri: uri, occurrenceCid: cid, body: text });
  },
  addIdentification: ([uri, cid, scientificName, rank, kingdom], store) =>
    send('POST', '/api/identifications', store, {
      occurrenceUri: uri,
      occurrenceCid: cid,
      scientificName,
      ...(rank ? { taxonRank: rank } : {}),
      ...(kingdom ? { kingdom } : {}),
    }),
  removeIdentification: ([uri], store) => send('DELETE', `/api/identifications/${encodeURIComponent(uri)}`, store),
  removeObservation: ([uri], store) => send('DELETE', `/api/occurrences/${encodeURIComponent(uri)}`, store),

  // --- Notifications: the signed-in person's, newest first.
  loadNotifications: async ([did, wanted], store) => {
    if (!did) return { items: [], more: false };
    // The appview pages up to 50 at a time; Show More widens the one page.
    const limit = Math.min(50, PAGE * Math.max(1, wanted));
    const body = await get<{ notifications: NotificationJson[]; cursor?: string | null }>(`/api/notifications?limit=${limit}`, store);
    return {
      items: body.notifications.map((n) => {
        const { did: subjectDid, rkey } = parts(n.subjectUri);
        const who = n.actor ? name({ did: n.actor.did, handle: n.actor.handle, displayName: n.actor.displayName }) : n.actorDid;
        return {
          id: n.id,
          kind: n.kind,
          who,
          whoDid: n.actorDid,
          avatar: n.actor?.avatar ?? '',
          read: n.read,
          at: instant(n.createdAt),
          did: subjectDid,
          rkey,
          text: `${who} ${NOTICE[n.kind] ?? 'acted on your observation'}`,
        };
      }),
      more: !!body.cursor && limit < 50,
    };
  },
  unreadCount: async ([did], store) => {
    if (!did) return { count: 0 };
    return get<{ count: number }>('/api/notifications/unread-count', store);
  },
  // 0 marks every notification read.
  markRead: ([id], store) => send('POST', '/api/notifications/read', store, id > 0 ? { id } : {}),

  // --- Preferences: the license new observations get by default.
  loadPreferences: async ([did], store) => {
    if (!did) return { license: '' };
    const p = await get<{ defaultLicense: string | null }>('/api/user/preferences', store);
    return { license: p.defaultLicense ?? '' };
  },
  setLicense: ([license], store) => send('PUT', '/api/user/preferences', store, { defaultLicense: license || null }),

  // --- A new observation ---------------------------------------------------
  // Each picked photo: a small preview and what its EXIF says (when, where).
  describePhotos: ([paths], store, storage) => Promise.all(paths.map((p) => describe(p, store, storage))),

  // What the appview's model sees in the first photo, near where it was taken.
  suggestSpecies: async ([path, latitude, longitude, placed], store, storage) => {
    if (!path || !kept(store)) return [];
    return suggest(path, placed ? { latitude, longitude } : null, store, storage, 5);
  },

  createObservation: async (
    [paths, scientificName, rank, kingdom, eventDate, latitude, longitude, uncertainty, notes, license, crosspost], store, storage,
  ) => {
    const fail = (error: string) => ({ ok: false, error, did: '', rkey: '' });
    if (!kept(store)) return fail('Sign in first.');
    let request: CreateOccurrenceRequest;
    try {
      // The appview says how big a photo the person's own server takes.
      const limit = await get<{ maxImageBytes: number }>('/api/user/upload-limit', store).then(
        (l) => l.maxImageBytes, () => 1_000_000);
      const images = [];
      for (const path of paths) {
        const bytes = await shrunk(await asJpeg(path, store, storage), 'upload', 4000, limit, storage);
        images.push({ data: toBase64(bytes), mimeType: 'image/jpeg' });
      }
      request = {
        latitude,
        longitude,
        ...(uncertainty > 0 ? { coordinateUncertaintyInMeters: Math.round(uncertainty) } : {}),
        // The form's local date and time, as an instant in this device's zone.
        ...(eventDate ? { eventDate: new Date(eventDate).toISOString() } : {}),
        images,
        ...(license ? { license } : {}),
        ...(scientificName ? { scientificName, ...(rank ? { taxonRank: rank } : {}), ...(kingdom ? { kingdom } : {}) } : {}),
        ...(notes.trim() ? { occurrenceRemarks: notes.trim() } : {}),
        ...(crosspost ? { crosspostToInaturalist: true } : {}),
      };
    } catch (e) {
      return fail((e as Error).message || 'A photo couldn’t be prepared. Try another.');
    }
    let response: Response;
    try {
      response = await fetch(`${API}/api/occurrences`, {
        method: 'POST',
        headers: { ...authHeaders(store), 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        exactTimeout: 120000,
      });
    } catch {
      return fail('Can’t reach observ.ing. Check your connection and try again.');
    }
    if (response.status === 401) return fail('Your session ended. Sign in again.');
    if (!response.ok) {
      const message = await response.json().then((b: { error?: string }) => b.error ?? '', () => '');
      return fail(message || `The observation wasn’t saved (${response.status}). Try again.`);
    }
    const created = (await response.json()) as { uri: string };
    pages.clear();
    return { ok: true, error: '', ...parts(created.uri) };
  },

  // --- The upload queue ------------------------------------------------------
  loadQueue: async (_args, _store, storage) =>
    (await readQueue(storage)).map((q) => ({ id: q.id, title: q.title, thumb: q.thumb, status: q.status, error: q.error, photos: q.photos.length })),

  // Send what's waiting. Signed out, nothing is sent and the queue keeps it.
  sendQueue: async (_args, store, storage) => {
    if (!kept(store)) return { sent: 0, failed: 0, waiting: (await readQueue(storage)).filter((q) => q.status === 'waiting').length, offline: false, error: 'Sign in to upload.' };
    const result = await sendWaiting(storage, (body) => fetch(`${API}/api/occurrences`, {
      method: 'POST',
      headers: { ...authHeaders(store), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      exactTimeout: 120000,
    }), toBase64);
    if (result.sent > 0) pages.clear();
    return result;
  },
  retryQueued: async ([id], _store, storage) => {
    await retry(storage, id);
    return { ok: true, error: '' };
  },
  discardQueued: async ([id], _store, storage) => {
    await discard(storage, id);
    return { ok: true, error: '' };
  },

  // --- Batch upload: one observation per photo -------------------------------
  // The model's best guess for each photo, for a one-tap species.
  batchSuggestions: ([paths], store, storage) => Promise.all(paths.map(async (path) => {
    const none = { path, scientificName: '', rank: '', kingdom: '', label: '', confidence: 0 };
    try {
      const [top] = await suggest(path, null, store, storage, 1);
      return top ? { path, scientificName: top.scientificName, rank: top.rank, kingdom: top.kingdom,
        label: top.commonName ? `${top.commonName} · ${top.scientificName}` : top.scientificName, confidence: top.confidence } : none;
    } catch {
      return none;
    }
  })),

  // Queue one observation per photo with a place: its own GPS, else `here`
  // when the person gave one. `taxa` entries are "path|name|rank|kingdom|label".
  enqueueBatch: async ([paths, taxa, hereLat, hereLng, hereUncertainty, useHere, license, crosspost], store, storage) => {
    if (!kept(store)) return { ok: false, error: 'Sign in first.', queued: 0, skipped: 0 };
    const limit = await get<{ maxImageBytes: number }>('/api/user/upload-limit', store).then((l) => l.maxImageBytes, () => 1_000_000);
    const drafts = [];
    let skipped = 0;
    try {
      for (const path of paths) {
        const fact = await describe(path, store, storage);
        const placed = fact.hasPlace || useHere;
        if (!placed) {
          skipped += 1;
          continue;
        }
        const [, name = '', rank = '', kingdom = '', label = ''] = (taxa.find((t) => t.startsWith(`${path}|`)) ?? '').split('|');
        drafts.push({
          title: label || name || 'Unidentified',
          thumb: fact.thumb,
          jpegs: [await shrunk(await asJpeg(path, store, storage), 'upload', 4000, limit, storage)],
          body: {
            latitude: fact.hasPlace ? fact.latitude : hereLat,
            longitude: fact.hasPlace ? fact.longitude : hereLng,
            ...((fact.hasPlace ? fact.uncertainty : hereUncertainty) > 0
              ? { coordinateUncertaintyInMeters: Math.round(fact.hasPlace ? fact.uncertainty : hereUncertainty) } : {}),
            ...(fact.takenAt ? { eventDate: new Date(fact.takenAt).toISOString() } : {}),
            ...(license ? { license } : {}),
            ...(crosspost ? { crosspostToInaturalist: true } : {}),
            ...(name ? { scientificName: name, ...(rank ? { taxonRank: rank } : {}), ...(kingdom ? { kingdom } : {}) } : {}),
          },
        });
      }
    } catch (e) {
      return { ok: false, error: (e as Error).message || 'A photo couldn’t be prepared.', queued: 0, skipped };
    }
    const queued = await enqueue(storage, drafts);
    return { ok: true, error: '', queued, skipped };
  },

  // --- Live ID: what the appview's fast model sees in the camera's last frame.
  liveSuggest: async ([path], store, storage) => {
    if (!path || !kept(store)) return [];
    return (await suggest(path, null, store, storage, 3, true)).map((s) => ({ ...s }));
  },

  // --- iNaturalist -----------------------------------------------------------
  // Whether this appview cross-posts at all, the linked account, and the
  // person's cross-post preferences.
  loadInat: async ([did], store) => {
    const off = { enabled: false, linked: false, login: '', crosspost: false, requirePhotos: false };
    if (!did) return off;
    const response = await fetch(`${API}/api/inat/account`, { headers: authHeaders(store), exactTimeout: 15000 });
    // 404: this appview has no iNaturalist application configured.
    if (response.status === 404) return off;
    if (!response.ok) throw new ApiError(response.status, `/api/inat/account answered ${response.status}.`);
    const account = (await response.json()) as { enabled: boolean; login: string | null };
    const prefs = await get<{ crosspostInaturalist: boolean | null; crosspostInaturalistRequirePhotos: boolean | null }>(
      '/api/user/preferences', store);
    return {
      enabled: account.enabled,
      linked: !!account.login,
      login: account.login ?? '',
      crosspost: !!prefs.crosspostInaturalist,
      requirePhotos: !!prefs.crosspostInaturalistRequirePhotos,
    };
  },

  // Link an iNaturalist account: its authorize page in the system browser;
  // the appview hands the answer back here, and this session finishes it.
  linkInat: async (_args, store) => {
    if (!kept(store)) return { ok: false, error: 'Sign in first.' };
    const callback = authCallback();
    let url: string;
    try {
      ({ url } = await get<{ url: string }>(`/api/inat/authorize?redirect_uri=${encodeURIComponent(callback)}`, store));
    } catch {
      return { ok: false, error: 'Linking couldn’t start. Try again.' };
    }
    const state = new URL(url).searchParams.get('state') ?? '';
    let answered: string;
    try {
      answered = await openAuthSession(url, { callback, state });
    } catch {
      return { ok: false, error: '' };
    }
    const back = new URL(answered);
    if (back.searchParams.get('error')) {
      return { ok: false, error: back.searchParams.get('error') === 'access_denied' ? '' : 'iNaturalist didn’t link your account. Try again.' };
    }
    return send('POST', '/api/inat/link', store, { code: back.searchParams.get('code') ?? '', state: back.searchParams.get('state') ?? '' });
  },
  unlinkInat: (_args, store) => send('DELETE', '/api/inat/account', store),
  setCrosspost: ([on, requirePhotos], store) =>
    send('PUT', '/api/user/preferences', store, { crosspostInaturalist: on, crosspostInaturalistRequirePhotos: requirePhotos }),

  // One of your observations on iNaturalist: not posted (""), pending, synced or failed.
  crosspostStatus: async ([uri], store) => {
    const none = { uri, status: '', error: '', url: '' };
    if (!uri || !kept(store)) return none;
    const response = await fetch(`${API}/api/inat/crosspost/${encodeURIComponent(uri)}`, { headers: authHeaders(store), exactTimeout: 15000 });
    if (!response.ok) return none;
    const c = (await response.json()) as { status: string | null; lastError: string | null; inatUrl: string | null };
    return { uri, status: c.status ?? '', error: c.lastError ?? '', url: c.inatUrl ?? '' };
  },
  crosspostNow: ([uri], store) => send('POST', '/api/inat/crosspost', store, { uri }),

  // A person's identifications, newest first, each linking to its observation.
  loadProfileIds: async ([did, wanted], store) => {
    if (!did) return { items: [], more: false };
    const limit = Math.min(50, PAGE * Math.max(1, wanted));
    const body = await get<{ identifications: Identification[]; cursor?: string | null }>(
      `/api/profiles/${encodeURIComponent(did)}/feed?type=identifications&limit=${limit}`, store);
    return {
      items: body.identifications.map((i) => ({
        uri: i.uri,
        scientificName: i.scientific_name,
        rank: i.taxon_rank ?? '',
        at: instant(i.date_identified),
        ...parts(i.subject_uri),
      })),
      more: !!body.cursor && body.identifications.length >= limit && limit < 50,
    };
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
