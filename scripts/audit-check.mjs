#!/usr/bin/env node
/**
 * Custom npm audit checker that supports acknowledging specific advisories.
 *
 * Usage:
 *   npm audit --json | node scripts/audit-check.mjs
 *
 * Exit code 0 = no unacknowledged high/critical vulnerabilities.
 * Exit code 1 = one or more unacknowledged high/critical vulnerabilities found.
 *
 * ─── Acknowledged advisories ──────────────────────────────────────────────────
 *
 * GHSA-qwww-vcr4-c8h2  React Router RSC Mode CSRF Bypass
 *   Affected: react-router >=7.12.0 <8.3.0
 *   Fix:      react-router 8.3.0 (not yet published to npm as of 2026-07-24)
 *   Reason:   This app uses BrowserRouter only — no server-side rendering or
 *             React Server Components — so the server-side CSRF bypass is not
 *             reachable. Re-evaluate once react-router 8.3.0 is available on npm.
 */

import { createInterface } from "node:readline";

const ACKNOWLEDGED = new Set([
  "GHSA-qwww-vcr4-c8h2", // React Router RSC CSRF bypass; not applicable (BrowserRouter only)
]);

let raw = "";
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => (raw += line));
rl.on("close", () => {
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    console.error("audit-check: failed to parse npm audit JSON output");
    process.exit(1);
  }

  let failures = 0;
  for (const [pkg, info] of Object.entries(data.vulnerabilities ?? {})) {
    if (!["high", "critical"].includes(info.severity)) continue;

    // Only look at entries that carry at least one direct advisory object.
    // Entries whose `via` array contains only strings are purely transitive —
    // they are already represented by the parent package that has the direct
    // advisory, so we skip them to avoid double-counting.
    const directAdvisories = (info.via ?? []).filter(
      (v) => typeof v === "object",
    );
    if (directAdvisories.length === 0) continue;

    const unacknowledged = directAdvisories.filter((a) => {
      const ghsa = a.url?.match(/GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}$/)?.[0];
      return !ACKNOWLEDGED.has(ghsa);
    });

    if (unacknowledged.length > 0) {
      failures++;
      const details = unacknowledged
        .map((a) => `${a.title} (${a.url})`)
        .join("; ");
      console.error(`Unacknowledged ${info.severity}: ${pkg} — ${details}`);
    }
  }

  if (failures > 0) {
    console.error(
      `\n${failures} unacknowledged high/critical vulnerability(ies) found.`,
    );
    process.exit(1);
  }

  console.log("npm audit: no unacknowledged high/critical vulnerabilities.");
});
