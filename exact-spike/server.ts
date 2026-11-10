// The dev server app.ts reads (API). Two modes:
//   APPVIEW=https://observ.ing bun server.ts   proxy /api/* and /media/* to a real appview
//   bun server.ts                              answer from fixtures/ (recorded by record.ts)
// The proxy keeps the web host same-origin with something that sends CORS
// headers, so no appview has to allow Exact's dev origin.
import recorded from './fixtures/api.json' with { type: 'json' };
import { fixtureKey } from './fixture-key.ts';
import { API } from './app.ts';

// exact's test runner starts the server on an empty database it names in DB; this one keeps no database.
void process.env.DB;
const UPSTREAM = process.env.APPVIEW?.replace(/\/$/, '');
const CORS = { 'access-control-allow-origin': '*' };
const { hostname, port } = new URL(API);

async function proxy(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const upstream = await fetch(`${UPSTREAM}${url.pathname}${url.search}`, {
    method: req.method,
    headers: { accept: req.headers.get('accept') ?? '*/*' },
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

const fixtures = {
  '/api/*': (req: Request) => {
    const key = fixtureKey(new URL(req.url));
    if (!(key in RECORDED)) {
      console.error(`server.ts: no fixture for ${key}; add it to record.ts`);
      return Response.json({ error: `No fixture for ${key}` }, { status: 404, headers: CORS });
    }
    return Response.json(RECORDED[key], { headers: CORS });
  },
  '/media/blob/:did/:cid': (req: Request & { params: { cid: string } }) => placeholder(req.params.cid),
  '/media/thumb/:did/:cid': (req: Request & { params: { cid: string } }) => placeholder(req.params.cid),
};

Bun.serve({
  hostname,
  port: Number(port),
  routes: {
    '/health': () => new Response('ok'),
    ...(UPSTREAM ? { '/api/*': proxy, '/media/*': proxy } : fixtures),
  },
});
console.log(`server.ts: ${API} → ${UPSTREAM ?? 'fixtures/'}`);
