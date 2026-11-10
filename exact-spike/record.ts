// Records a real appview's responses into fixtures/, verbatim, for server.ts's
// fixture mode and the tests. `bun record.ts [https://observ.ing]`.
const appview = (process.argv[2] ?? process.env.APPVIEW ?? 'https://observ.ing').replace(/\/$/, '');
const dir = `${import.meta.dir}/fixtures`;

async function record(name: string, path: string) {
  const response = await fetch(`${appview}${path}`);
  if (!response.ok) throw new Error(`${path} answered ${response.status}`);
  const body = await response.json();
  await Bun.write(`${dir}/${name}.json`, `${JSON.stringify(body, null, 2)}\n`);
  console.log(`${name}.json ← ${appview}${path}`);
}

await record('explore', '/api/feeds/explore?limit=24');
