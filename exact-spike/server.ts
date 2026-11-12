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
