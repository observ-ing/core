#!/usr/bin/env node
/**
 * Visit every Storybook story, capture console errors, page errors, and
 * unhandled rejections. Write a JSON report to scripts/storybook-smoke.json
 * and a per-story screenshot to scripts/storybook-smoke-shots/.
 *
 * Storybook must be running on http://localhost:6006.
 */
import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHOT_DIR = resolve(__dirname, "storybook-smoke-shots");
const REPORT = resolve(__dirname, "storybook-smoke.json");
const BASE = "http://localhost:6006";

// Stories where we *expect* a network error or 404 (testing error states).
const EXPECTED_NETWORK_ERROR_IDS = new Set([
  "admin-adminpage--forbidden",
  "admin-adminpage--server-error",
  "admin-collectiondetailpage--forbidden",
  "admin-tabledetailpage--forbidden",
  "taxon-taxondetail--not-found",
  "taxon-taxonexplorer--not-found",
  "observation-observationdetail--not-found",
]);

// Errors that don't indicate a broken story.
function isIgnorableConsoleError(text, storyId) {
  // Storybook chrome / favicon noise
  if (/favicon\.ico/.test(text)) return true;
  if (/\[MSW\]/.test(text)) return true;
  // External tile servers we don't reach during smoke
  if (/cartocdn|tile\.openstreetmap|nominatim|basemaps/i.test(text)) return true;
  if (/maplibre|maplibregl/i.test(text)) return true;
  if (/AJAXError: Failed to fetch/.test(text)) return true;
  // wikidata/commons APIs we don't mock by default
  if (/commons\.wikimedia|wikidata\.org|wikipedia\.org/.test(text)) return true;
  // The AiSuggestions hook fetches the imageUrl as a blob; that URL is a
  // wikimedia commons link in the stories so it will fail without mocking.
  if (/Species identification unavailable/.test(text)) return true;
  // Stories that intentionally exercise an error / 404 path
  if (
    EXPECTED_NETWORK_ERROR_IDS.has(storyId) &&
    /Failed to load resource|status of 404|status of 403|status of 500/.test(text)
  ) {
    return true;
  }
  // Image fixtures pointing at remote URLs may fail to load in offline runs;
  // they don't break the layout we're trying to verify.
  if (/Failed to load resource: net::ERR_FAILED/.test(text)) return true;
  if (/Failed to load resource: net::ERR_NAME_NOT_RESOLVED/.test(text)) return true;
  // Fetch failure from skeleton stories that import ObservationDetail's API
  // helper indirectly — covered by the "Loading"/"Not Found" cases above.
  if (/fetchObservation error/.test(text)) return true;
  return false;
}

const indexResponse = await fetch(`${BASE}/index.json`);
if (!indexResponse.ok) {
  console.error(`Failed to fetch story index: ${indexResponse.status}`);
  process.exit(1);
}
const index = await indexResponse.json();
const stories = Object.values(index.entries).filter((e) => e.type === "story");
console.log(`Found ${stories.length} stories`);

rmSync(SHOT_DIR, { recursive: true, force: true });
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch();

const results = [];
let i = 0;
for (const story of stories) {
  i += 1;
  // Fresh context per story so console errors and network state don't leak.
  const context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  const page = await context.newPage();

  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (isIgnorableConsoleError(text, story.id)) return;
    errors.push({ kind: "console.error", text: text.slice(0, 400) });
  });
  page.on("pageerror", (err) => {
    errors.push({ kind: "pageerror", text: err.message.slice(0, 400) });
  });

  const url = `${BASE}/iframe.html?id=${encodeURIComponent(story.id)}&viewMode=story`;
  let renderState = "ok";
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    // The root is always present; we just need the story to have had time to mount.
    await page.waitForSelector("#storybook-root", { state: "attached", timeout: 5000 });
    await page.waitForTimeout(800);
    const rootInfo = await page.evaluate(() => {
      const root = document.getElementById("storybook-root");
      // Modals/tooltips render in portals on document.body — count those too.
      const portals = document.querySelectorAll(
        "body > .MuiPopover-root, body > .MuiDialog-root, body > .MuiModal-root, body > [role=presentation]",
      ).length;
      return { rootChildren: root?.children.length ?? 0, portals };
    });
    if (rootInfo.rootChildren === 0 && rootInfo.portals === 0) {
      renderState = "empty";
    }
  } catch (e) {
    renderState = "error";
    errors.push({ kind: "navigation", text: e.message.slice(0, 200) });
  }

  const shot = `${SHOT_DIR}/${story.id}.png`;
  try {
    await page.screenshot({ path: shot, fullPage: false });
  } catch (e) {
    errors.push({ kind: "screenshot", text: e.message.slice(0, 200) });
  }

  await context.close();

  const ok = renderState !== "error" && errors.length === 0;
  results.push({
    id: story.id,
    title: story.title,
    name: story.name,
    ok,
    renderState,
    errors,
  });

  const status = ok ? (renderState === "empty" ? "○ empty" : "✓") : `✗ (${errors.length})`;
  console.log(`[${i}/${stories.length}] ${status} ${story.title} / ${story.name}`);
}

await browser.close();

const failing = results.filter((r) => !r.ok);
const empty = results.filter((r) => r.ok && r.renderState === "empty");
writeFileSync(
  REPORT,
  JSON.stringify(
    { total: results.length, failing: failing.length, empty: empty.length, results },
    null,
    2,
  ),
);

console.log("");
console.log(`Total: ${results.length}`);
console.log(`Failing: ${failing.length}`);
console.log(`Empty (no DOM rendered):  ${empty.length}`);
if (failing.length > 0) {
  console.log("");
  console.log("FAILING:");
  for (const f of failing) {
    console.log(`  ✗ ${f.title} / ${f.name}`);
    for (const e of f.errors) {
      const oneLine = e.text.split("\n")[0].slice(0, 240);
      console.log(`     [${e.kind}] ${oneLine}`);
    }
  }
}
if (empty.length > 0) {
  console.log("");
  console.log("EMPTY (rendered nothing — may be intentional, e.g. hidden FAB):");
  for (const f of empty) {
    console.log(`  ○ ${f.title} / ${f.name}`);
  }
}
console.log("");
console.log(`Report: ${REPORT}`);
console.log(`Screenshots: ${SHOT_DIR}/`);

process.exit(failing.length === 0 ? 0 : 1);
