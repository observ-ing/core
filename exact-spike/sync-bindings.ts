// Copies the appview's ts-rs bindings (frontend/src/bindings, generated from its
// Rust structs) into bindings/: an Exact build reads only files inside the app's
// own directory. `bun sync-bindings.ts`; `--check` exits 1 when they differ.
import { readdirSync, readFileSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';

const from = `${import.meta.dir}/../frontend/src/bindings`;
const to = `${import.meta.dir}/bindings`;
const check = process.argv.includes('--check');

const want = new Map(readdirSync(from).filter((f) => f.endsWith('.ts')).map((f) => [f, readFileSync(`${from}/${f}`, 'utf8')]));
const have = existsSync(to) ? readdirSync(to).filter((f) => f.endsWith('.ts')) : [];
const stale = have.filter((f) => !want.has(f) || readFileSync(`${to}/${f}`, 'utf8') !== want.get(f));
const missing = [...want.keys()].filter((f) => !have.includes(f));

if (check) {
  if (stale.length || missing.length) {
    console.error(`bindings/ is out of date (${[...stale, ...missing].join(', ')}): run bun sync-bindings.ts`);
    process.exit(1);
  }
  process.exit(0);
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to);
for (const [f, text] of want) writeFileSync(`${to}/${f}`, text);
console.log(`bindings/: ${want.size} files from frontend/src/bindings`);
