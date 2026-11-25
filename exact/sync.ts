// Copies what the app shares with the rest of the repo into it: an Exact build
// reads only files inside the app's own directory.
// - bindings/: the appview's ts-rs types (frontend/src/bindings, generated from its Rust structs).
// - data/lexicons.json: the record schemas (lexicons/**/*.json), one list sorted by id, for Lexicons.
// - data/transparency.json: the hosting costs (frontend/src/data/transparency.json, which
//   .github/workflows/transparency.yml rewrites each month), for Transparency.
// `bun sync.ts`; `--check` exits 1 when any of them differs.
import { readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';

const repo = `${import.meta.dir}/..`;
const check = process.argv.includes('--check');

// Every file this writes, by its path in the app, with the text it should hold.
const want = new Map<string, string>();
for (const f of readdirSync(`${repo}/frontend/src/bindings`).filter((f) => f.endsWith('.ts'))) {
  want.set(`bindings/${f}`, readFileSync(`${repo}/frontend/src/bindings/${f}`, 'utf8'));
}
const lexicons = readdirSync(`${repo}/lexicons`, { recursive: true, encoding: 'utf8' })
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(readFileSync(`${repo}/lexicons/${f}`, 'utf8')) as { id: string })
  .sort((a, b) => a.id.localeCompare(b.id));
want.set('data/lexicons.json', `${JSON.stringify(lexicons, null, 2)}\n`);
want.set('data/transparency.json', readFileSync(`${repo}/frontend/src/data/transparency.json`, 'utf8'));

const bindings = existsSync(`${import.meta.dir}/bindings`) ? readdirSync(`${import.meta.dir}/bindings`).map((f) => `bindings/${f}`) : [];
const extra = bindings.filter((p) => !want.has(p));
const stale = [...want].filter(([p, text]) => !existsSync(`${import.meta.dir}/${p}`) || readFileSync(`${import.meta.dir}/${p}`, 'utf8') !== text).map(([p]) => p);

if (check) {
  if (stale.length || extra.length) {
    console.error(`out of date (${[...stale, ...extra].join(', ')}): run bun sync.ts`);
    process.exit(1);
  }
  process.exit(0);
}
rmSync(`${import.meta.dir}/bindings`, { recursive: true, force: true });
mkdirSync(`${import.meta.dir}/bindings`);
mkdirSync(`${import.meta.dir}/data`, { recursive: true });
for (const [p, text] of want) writeFileSync(`${import.meta.dir}/${p}`, text);
console.log(`synced ${want.size} files: bindings/, data/lexicons.json, data/transparency.json`);
