// A stand-in for observ.ing's appview: GET /api/feeds/explore?limit=N answers
// rows in the appview's own JSON shape (fixtures.ts), and /photos/* the images.
// `bun server.ts`; it listens where app.ts calls it (API).
import { OCCURRENCES } from './fixtures.ts';
import { API } from './app.ts';

// exact's test runner starts the server on an empty database it names in DB; this one keeps no database.
void process.env.DB;
const CORS = { 'access-control-allow-origin': '*' };
const { hostname, port } = new URL(API);
Bun.serve({ hostname, port: Number(port), routes: {
  '/health': () => new Response('ok'),
  '/api/feeds/explore': (req) => {
    const limit = Math.max(1, Math.min(50, Number(new URL(req.url).searchParams.get('limit') ?? 20)));
    const occurrences = OCCURRENCES.slice(0, limit);
    const cursor = limit < OCCURRENCES.length ? String(limit) : undefined;
    return Response.json({ occurrences, ...(cursor ? { cursor } : {}) }, { headers: CORS });
  },
  '/photos/:name': (req) => new Response(Bun.file(`${import.meta.dir}/assets/photos/${req.params.name}`), { headers: CORS }),
} });
console.log(`server.ts: ${API}`);
