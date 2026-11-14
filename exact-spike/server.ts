// The dev server app.ts reads (API). Two modes:
//   APPVIEW=https://observ.ing bun server.ts   proxy /api/*, /media/* and /oauth/* to a real appview
//   bun server.ts                              answer from fixtures/ (recorded by record.ts), and
//                                              sign in one fake person, as the appview's app
//                                              sign-in would (GET /oauth/app/login, POST /oauth/app/token)
// The proxy sends CORS headers of its own, so no appview has to allow Exact's dev origin.
import recorded from './fixtures/api.json' with { type: 'json' };
import { fixtureKey } from './fixture-key.ts';
import { API } from './app.ts';

// exact's test runner starts the server on an empty database it names in DB; this one keeps no database.
void process.env.DB;
const UPSTREAM = process.env.APPVIEW?.replace(/\/$/, '');
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, content-type',
  'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
};
const { hostname, port } = new URL(API);

async function proxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const upstream = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, {
    method: req.method,
    headers: Object.fromEntries(
      ['accept', 'authorization', 'content-type'].flatMap((h) => (req.headers.get(h) ? [[h, req.headers.get(h)!]] : [])),
    ),
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : await req.arrayBuffer(),
    redirect: 'follow',
  });
  const headers = new Headers(CORS);
  for (const h of ['content-type', 'cache-control', 'etag', 'last-modified']) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers });
}

// Recorded responses, by the request that asked for them (record.ts).
const RECORDED = recorded as Record<string, unknown>;
const PLACEHOLDERS = ['amanita', 'cardinal', 'fern', 'monarch', 'oak', 'redeft'];
// A recorded photo's URL names its blob CID: answer with a placeholder PNG
// picked from it, so tests run offline and on hosts with no JPEG decoder.
function placeholder(cid: string): Response {
  let h = 0;
  for (const c of cid) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const name = PLACEHOLDERS[h % PLACEHOLDERS.length];
  return new Response(Bun.file(`${import.meta.dir}/assets/photos/${name}.png`), { headers: { ...CORS, 'content-type': 'image/png' } });
}

// The fake appview's sign-in: one person, codes and sessions kept in memory.
const PERSON = { did: 'did:plc:fixturenaturalist', handle: 'naturalist.test', displayName: 'Test Naturalist' };
const codes = new Map<string, { challenge: string; redirect: string }>();
const sessions = new Set<string>();
const random = () => Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
const bearer = (req: Request) => req.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
const signedIn = (req: Request) => sessions.has(bearer(req));
// Where the appview may send a code: the web host's callback page, or the native app's scheme.
const allowedRedirect = (uri: string) => /^http:\/\/127\.0\.0\.1:\d+\/\.exact\/auth\/callback$/.test(uri) || uri === 'ing.observ.exactspike:/oauth';

// What the fake person has done, laid over the recorded observations.
type Detail = { occurrence: { uri: string; observer: unknown; likeCount?: number; viewerHasLiked?: boolean; identificationCount: number };
  identifications: { uri: string }[]; comments: unknown[] };
const likes = new Set<string>();
const deleted = new Set<string>();
const overlays = new Map<string, { identifications: { uri: string }[]; comments: unknown[] }>();
const added = (uri: string) => overlays.get(uri) ?? overlays.set(uri, { identifications: [], comments: [] }).get(uri)!;
// The fake person owns this recorded observation, so deleting it can be tested.
const OWN = '3mzvx3lfxlr22';
function overlay(d: Detail, viewer: boolean): Detail {
  const o = d.occurrence;
  const extra = overlays.get(o.uri) ?? { identifications: [], comments: [] };
  const liked = viewer && likes.has(o.uri);
  const identifications = [...d.identifications, ...extra.identifications];
  return {
    occurrence: { ...o, ...(o.uri.endsWith(`/${OWN}`) ? { observer: PERSON } : {}), viewerHasLiked: liked,
      likeCount: (o.likeCount ?? 0) + (liked ? 1 : 0), identificationCount: identifications.length },
    identifications,
    comments: [...d.comments, ...extra.comments],
  };
}
type CreateBody = { latitude?: number; longitude?: number; coordinateUncertaintyInMeters?: number; eventDate?: string;
  images?: { data: string; mimeType: string }[]; license?: string; scientificName?: string; taxonRank?: string; kingdom?: string;
  occurrenceRemarks?: string };
const createdOnes = new Map<string, CreateBody>();
let lastCreate: CreateBody | null = null;
const isJpeg = (base64: string) => { try { const b = Buffer.from(base64, 'base64'); return b[0] === 0xff && b[1] === 0xd8; } catch { return false; } };
// A made observation, answered the way the appview answers a recorded one.
function createdDetail(uri: string, r: CreateBody) {
  return {
    occurrence: {
      uri, cid: 'bafyfixture', observer: PERSON, identificationCount: 0,
      effectiveTaxonomy: r.scientificName ? { scientificName: r.scientificName, rank: r.taxonRank, kingdom: r.kingdom } : undefined,
      eventDate: r.eventDate, location: { latitude: r.latitude, longitude: r.longitude, uncertaintyMeters: r.coordinateUncertaintyInMeters },
      occurrenceRemarks: r.occurrenceRemarks,
      images: (r.images ?? []).map((_, i) => ({ url: `/media/blob/${PERSON.did}/bafynew${i}`, license: r.license })),
      externalRecords: [], createdAt: new Date().toISOString(), likeCount: 0,
      qualityIssues: r.scientificName ? [] : ['NO_CONSENSUS_ID'],
    },
    identifications: [], comments: [],
  };
}
const OTHER = { did: 'did:plc:fixtureother', handle: 'another.test', displayName: 'Another Naturalist' };
const LOON = 'at://did:plc:jt6xegjm6ba2lt34aztyi2mn/bio.lexicons.temp.v0-1.occurrence/3mzucjhpluy22';
const NOTIFICATIONS = [
  { id: 2, actorDid: OTHER.did, kind: 'comment', subjectUri: LOON, createdAt: '2026-11-09T20:00:00Z', actor: OTHER },
  { id: 1, actorDid: OTHER.did, kind: 'identification', subjectUri: LOON, createdAt: '2026-11-08T20:00:00Z', actor: OTHER },
];
const read = new Set<number>();
const preferences = { defaultLicense: null as string | null, basemap: null, crosspostInaturalist: null, crosspostInaturalistRequirePhotos: null };
const unauthorized = () => Response.json({ error: 'Not signed in' }, { status: 401, headers: CORS });

const fixtures: Record<string, (req: Request & { params: Record<string, string> }) => Response | Promise<Response>> = {
  '/oauth/app/login': (req) => {
    const q = new URL(req.url).searchParams;
    const redirect = q.get('redirect_uri') ?? '';
    if (!allowedRedirect(redirect) || q.get('code_challenge_method') !== 'S256' || !q.get('code_challenge') || !q.get('state') || !q.get('handle')) {
      return new Response('Bad app sign-in request', { status: 400 });
    }
    const back = new URL(redirect);
    back.searchParams.set('state', q.get('state')!);
    // The handle "decline.test" stands for someone who declines on their server's page.
    if (q.get('handle') === 'decline.test') back.searchParams.set('error', 'access_denied');
    else {
      const code = random();
      codes.set(code, { challenge: q.get('code_challenge')!, redirect });
      back.searchParams.set('code', code);
    }
    return Response.redirect(back.toString(), 303);
  },
  '/oauth/app/token': async (req) => {
    const { code, code_verifier } = (await req.json()) as { code?: string; code_verifier?: string };
    const pending = code ? codes.get(code) : undefined;
    if (code) codes.delete(code); // one use, right or wrong
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code_verifier ?? '')));
    if (!pending || Buffer.from(digest).toString('base64url') !== pending.challenge) {
      return Response.json({ error: 'invalid_grant' }, { status: 400, headers: CORS });
    }
    const token = random();
    sessions.add(token);
    return Response.json({ token, did: PERSON.did }, { headers: CORS });
  },
  '/oauth/me': (req) => Response.json({ user: signedIn(req) ? PERSON : null }, { headers: CORS }),
  '/oauth/logout': (req) => {
    sessions.delete(bearer(req));
    return Response.json({ success: true }, { headers: CORS });
  },
  // Writes, kept in memory for the fake person (see `overlay`).
  '/api/likes': async (req) => {
    if (!signedIn(req)) return unauthorized();
    const { occurrenceUri } = (await req.json()) as { occurrenceUri: string };
    if (req.method === 'POST') likes.add(occurrenceUri); else likes.delete(occurrenceUri);
    return Response.json({ success: true }, { headers: CORS });
  },
  '/api/comments': async (req) => {
    if (!signedIn(req)) return unauthorized();
    const { occurrenceUri, occurrenceCid, body } = (await req.json()) as { occurrenceUri: string; occurrenceCid: string; body: string };
    const uri = `at://${PERSON.did}/bio.lexicons.temp.v0-1.comment/${random()}`;
    added(occurrenceUri).comments.push({ commenter: PERSON, uri, cid: 'bafyfixture', did: PERSON.did, subject_uri: occurrenceUri,
      subject_cid: occurrenceCid, body, created_at: new Date().toISOString() });
    return Response.json({ success: true, uri, cid: 'bafyfixture' }, { headers: CORS });
  },
  '/api/identifications': async (req) => {
    if (!signedIn(req)) return unauthorized();
    const r = (await req.json()) as { occurrenceUri: string; occurrenceCid: string; scientificName: string; taxonRank?: string; kingdom?: string };
    const uri = `at://${PERSON.did}/bio.lexicons.temp.v0-1.identification/${random()}`;
    added(r.occurrenceUri).identifications.push({ identifier: PERSON, uri, cid: 'bafyfixture', did: PERSON.did, subject_uri: r.occurrenceUri,
      subject_cid: r.occurrenceCid, scientific_name: r.scientificName, taxon_rank: r.taxonRank, kingdom: r.kingdom,
      date_identified: new Date().toISOString() });
    return Response.json({ success: true, uri, cid: 'bafyfixture' }, { headers: CORS });
  },
  '/api/identifications/*': (req) => {
    if (!signedIn(req)) return unauthorized();
    const uri = decodeURIComponent(new URL(req.url).pathname.slice('/api/identifications/'.length));
    for (const a of overlays.values()) a.identifications = a.identifications.filter((i) => i.uri !== uri);
    return Response.json({ success: true }, { headers: CORS });
  },
  // A new observation: refused unless it has what the appview requires and
  // every photo is a JPEG, so the tests see what the app really sent.
  '/api/occurrences': async (req) => {
    if (!signedIn(req)) return unauthorized();
    const r = (await req.json()) as CreateBody;
    const problem =
      typeof r.latitude !== 'number' || typeof r.longitude !== 'number' ? 'latitude and longitude are required'
      : (r.images ?? []).some((i) => i.mimeType !== 'image/jpeg' || !isJpeg(i.data)) ? 'every image must be a JPEG'
      : r.eventDate && Number.isNaN(Date.parse(r.eventDate)) ? 'eventDate must be a date'
      : '';
    if (problem) return Response.json({ error: problem }, { status: 400, headers: CORS });
    const rkey = `new${createdOnes.size + 1}`;
    const uri = `at://${PERSON.did}/bio.lexicons.temp.v0-1.occurrence/${rkey}`;
    lastCreate = r;
    createdOnes.set(uri, r);
    return Response.json({ success: true, uri, cid: 'bafyfixture' }, { headers: CORS });
  },
  // What the test made last, for a test to read back (`request GET "/__fixture/last-create"`).
  '/__fixture/last-create': () => Response.json(lastCreate ? { ...lastCreate, images: (lastCreate.images ?? []).length } : null, { headers: CORS }),
  '/api/occurrences/*': (req) => {
    const uri = decodeURIComponent(new URL(req.url).pathname.slice('/api/occurrences/'.length));
    const made = createdOnes.get(uri);
    if (made && req.method === 'GET') return Response.json(createdDetail(uri, made), { headers: CORS });
    if (req.method === 'DELETE') {
      if (!signedIn(req)) return unauthorized();
      if (!uri.endsWith(`/${OWN}`)) return Response.json({ error: 'You can only delete your own observations' }, { status: 403, headers: CORS });
      deleted.add(uri);
      return Response.json({ success: true }, { headers: CORS });
    }
    if (deleted.has(uri)) return Response.json({ error: 'Occurrence not found' }, { status: 404, headers: CORS });
    const key = fixtureKey(new URL(req.url));
    if (!(key in RECORDED)) return Response.json({ error: `No fixture for ${key}` }, { status: 404, headers: CORS });
    return Response.json(overlay(RECORDED[key] as Detail, signedIn(req)), { headers: CORS });
  },
  '/api/notifications': (req) => signedIn(req)
    ? Response.json({ notifications: NOTIFICATIONS.map((n) => ({ ...n, read: read.has(n.id) })) }, { headers: CORS })
    : unauthorized(),
  '/api/notifications/unread-count': (req) => signedIn(req)
    ? Response.json({ count: NOTIFICATIONS.filter((n) => !read.has(n.id)).length }, { headers: CORS })
    : unauthorized(),
  '/api/notifications/read': async (req) => {
    if (!signedIn(req)) return unauthorized();
    const { id } = (await req.json()) as { id?: number };
    for (const n of NOTIFICATIONS) if (id === undefined || n.id === id) read.add(n.id);
    return Response.json({ success: true }, { headers: CORS });
  },
  '/api/user/upload-limit': (req) => signedIn(req)
    ? Response.json({ maxImageBytes: 1_000_000, limitedByPds: false }, { headers: CORS })
    : unauthorized(),
  // The model's answer, the same for any photo.
  '/api/species-id': async (req) => {
    if (!signedIn(req)) return unauthorized();
    const { image } = (await req.json()) as { image?: string };
    if (!image || !isJpeg(image)) return Response.json({ error: 'image must be a base64 JPEG' }, { status: 400, headers: CORS });
    return Response.json({ modelVersion: 'fixture', inferenceTimeMs: 1, suggestions: [
      { scientificName: 'Notophthalmus viridescens', commonName: 'Eastern Newt', confidence: 0.91, kingdom: 'Animalia', inRange: false,
        taxonMatch: { id: 'Animalia/Notophthalmus viridescens', scientificName: 'Notophthalmus viridescens', commonName: 'Eastern Newt',
          rank: 'species', kingdom: 'Animalia', source: 'gbif' } },
      { scientificName: 'Taricha torosa', commonName: 'California Newt', confidence: 0.06, kingdom: 'Animalia', inRange: true },
    ] }, { headers: CORS });
  },
  '/api/user/preferences': async (req) => {
    if (!signedIn(req)) return unauthorized();
    if (req.method === 'PUT') {
      const body = (await req.json()) as { defaultLicense?: string | null };
      if ('defaultLicense' in body) preferences.defaultLicense = body.defaultLicense ?? null;
    }
    return Response.json(preferences, { headers: CORS });
  },
  // The home feed needs a session; its rows stand in from Explore's first recorded page.
  '/api/feeds/home': (req) => signedIn(req)
    ? Response.json(RECORDED['/api/feeds/explore?limit=20'], { headers: CORS })
    : Response.json({ error: 'Not signed in' }, { status: 401, headers: CORS }),
  '/api/*': (req) => {
    const key = fixtureKey(new URL(req.url));
    if (!(key in RECORDED)) {
      console.error(`server.ts: no fixture for ${key}; add it to record.ts`);
      return Response.json({ error: `No fixture for ${key}` }, { status: 404, headers: CORS });
    }
    return Response.json(RECORDED[key], { headers: CORS });
  },
  '/media/blob/:did/:cid': (req) => placeholder(req.params.cid),
  '/media/thumb/:did/:cid': (req) => placeholder(req.params.cid),
};

const live = { '/api/*': proxy, '/media/*': proxy, '/oauth/*': proxy };

// A route answers every method, so each answers the preflight a request with
// the session's Authorization header sends first.
type Handler = (req: any) => Response | Promise<Response>;
const preflighted = (routes: Record<string, Handler>) => Object.fromEntries(
  Object.entries(routes).map(([path, handle]) => [path, (req: Request) =>
    req.method === 'OPTIONS' ? new Response(null, { status: 204, headers: CORS }) : handle(req)]),
);

Bun.serve({
  hostname,
  port: Number(port),
  routes: {
    '/health': () => new Response('ok'),
    ...preflighted(UPSTREAM ? live : fixtures),
  },
});
console.log(`server.ts: ${API} → ${UPSTREAM ?? 'fixtures/'}`);
