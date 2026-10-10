#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
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

// The global decorator in frontend/.storybook/preview.tsx already wraps every
// story in a MemoryRouter. A story that adds its own still builds, but throws
// "You cannot render a <Router> inside another <Router>" when mounted (#706).
const ROUTER_IMPORT = /import\s*\{([^}]*)\}\s*from\s*["']react-router(?:-dom)?["']/g;
const nestedRouters = [];

for (const story of stories) {
  const source = readFileSync(story, "utf8");
  for (const [, specifiers] of source.matchAll(ROUTER_IMPORT)) {
    const routers = specifiers
      .split(",")
      .map((s) => s.trim().split(/\s+as\s+/)[0])
      .filter((name) => /Router(Provider)?$/.test(name));
    if (routers.length > 0) {
      nestedRouters.push(`${relative(process.cwd(), story)} (${routers.join(", ")})`);
    }
  }
}

let failed = false;

if (missing.length > 0) {
  failed = true;
  console.error(`Missing Storybook stories for ${missing.length} component(s):\n`);
  for (const f of missing) console.error(`  - ${f}`);
  console.error(
    `\nEvery component in frontend/src/components must have a sibling *.stories.tsx file.`,
  );
}

if (nestedRouters.length > 0) {
  failed = true;
  console.error(`\nStories that render their own router (${nestedRouters.length}):\n`);
  for (const f of nestedRouters) console.error(`  - ${f}`);
  console.error(
    `\nThe global decorator in frontend/.storybook/preview.tsx already provides a MemoryRouter;` +
      `\na nested one throws at render. Drop it, and set \`parameters.routerInitialEntries\`` +
      `\nif the story needs a specific URL.`,
  );
}

if (failed) process.exit(1);

console.log(
  `OK: no nested routers; all ${files.filter((f) => f.endsWith(".tsx") && !f.endsWith(".stories.tsx") && !f.endsWith(".test.tsx")).length} components have stories.`,
);
