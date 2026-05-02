#!/usr/bin/env node
import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../frontend/src/components/", import.meta.url).pathname;

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else {
      out.push(full);
    }
  }
  return out;
}

const files = walk(ROOT);
const stories = new Set(files.filter((f) => f.endsWith(".stories.tsx")));
const missing = [];

for (const file of files) {
  if (!file.endsWith(".tsx")) continue;
  if (file.endsWith(".stories.tsx")) continue;
  if (file.endsWith(".test.tsx")) continue;
  const expected = file.replace(/\.tsx$/, ".stories.tsx");
  if (!stories.has(expected)) {
    missing.push(relative(process.cwd(), file));
  }
}

if (missing.length > 0) {
  console.error(
    `Missing Storybook stories for ${missing.length} component(s):\n`,
  );
  for (const f of missing) console.error(`  - ${f}`);
  console.error(
    `\nEvery component in frontend/src/components must have a sibling *.stories.tsx file.`,
  );
  process.exit(1);
}

console.log(
  `OK: all ${files.filter((f) => f.endsWith(".tsx") && !f.endsWith(".stories.tsx") && !f.endsWith(".test.tsx")).length} components have stories.`,
);
