// The built site (`bun exact.mjs web-build --out <dir>`) as `exact.mjs serve`
// says a static host should serve it: the file at the path, else shell.html
// (the client draws the route, or its notfound). The site calls observ.ing
// itself (the appview's CORS_ORIGINS names it), so nothing here proxies.
//   SITE=<dir> [PORT=8080] bun deploy/site.ts
const SITE = process.env.SITE ?? `${import.meta.dir}/dist`;

async function site(req: Request): Promise<Response> {
  const path = decodeURIComponent(new URL(req.url).pathname);
  if (path === '/health') return new Response('ok');
  if (path.includes('..')) return new Response('Not found', { status: 404 });
  const file = Bun.file(`${SITE}${path.endsWith('/') ? `${path}index.html` : path}`);
  const found = (await file.exists()) && !path.endsWith('/');
  const callback = path.startsWith('/.exact/auth/');
  const headers: Record<string, string> = {
    'cache-control': callback || !found ? 'no-store' : 'no-cache',
    ...(callback ? { 'referrer-policy': 'no-referrer' } : {}),
    // The callback page has no extension.
    ...(callback && !path.endsWith('.js') ? { 'content-type': 'text/html; charset=utf-8' } : {}),
  };
  return new Response(found ? file : Bun.file(`${SITE}/shell.html`), { headers: found ? headers : { ...headers, 'content-type': 'text/html; charset=utf-8' } });
}

Bun.serve({ hostname: '0.0.0.0', port: Number(process.env.PORT ?? 8080), fetch: site });
console.log(`site: ${SITE}`);
