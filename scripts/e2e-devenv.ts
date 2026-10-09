/**
 * Orchestrates the isolated dev-env e2e run.
 *
 *   1. Boot a local @atproto/dev-env network (PLC + PDS + firehose) and seed a
 *      test account.
 *   2. Start the Rust stack (process-compose.yaml + the process-compose.devenv.yaml
 *      overlay) with PLC_DIRECTORY_URL / HANDLE_RESOLVER_URL / TAP_RELAY_URL
 *      pointing at that network, so no identity or firehose traffic ever leaves
 *      the machine. Each run gets a freshly recreated Postgres database and a
 *      temp Tap cursor DB, so nothing leaks into (or out of) the dev stack's
 *      state or a previous run's.
 *   3. Run the Playwright dev-env config (logs in via the local PDS, creates an
 *      observation, asserts it appears).
 *   4. Tear everything down.
 *
 * Prereqs: Postgres running (same server as the normal stack; `psql` on PATH),
 * and the `tap` binary on PATH. Run:  npm run test:e2e:devenv
 */

import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";
import { bootDevEnv, type DevEnv, devEnvVars } from "../frontend/tests/dev-env/network";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
// The normal stack plus the dev-env overlay (later files override earlier ones).
const COMPOSE_FILES = ["process-compose.yaml", "process-compose.devenv.yaml"];
// Passed to process-compose.yaml as APPVIEW_PORT / TAP_INGESTER_PORT / VITE_PORT.
const APPVIEW_PORT = 3000;
const TAP_INGESTER_PORT = 8090;
const VITE_PORT = 5173;
const APPVIEW_HEALTH = `http://127.0.0.1:${APPVIEW_PORT}/health`;
// tap-ingester's /health. Its `connected` flag flips true once Tap's firehose
// channel is up.
const TAP_HEALTH = `http://127.0.0.1:${TAP_INGESTER_PORT}/health`;
// Embedded Tap's admin endpoint (its built-in default port; see
// docs/deployment.md TAP_URL). `/repos/add` registers a DID for tracking.
const TAP_ADMIN_PORT = 2480;
const TAP_REPOS_ADD = `http://127.0.0.1:${TAP_ADMIN_PORT}/repos/add`;
// Keep process-compose's own API off its default 8080, which a concurrently
// running normal stack's process-compose would already hold.
const PC_PORT = 8099;
// Every fixed port the stack binds. They must all be free before starting: if
// e.g. the normal dev stack holds them, our services fail to bind while the
// health checks happily pass against *its* appview, and `/repos/add` registers
// the test DID with *its* Tap — which is attached to the public relay.
const STACK_PORTS: Record<string, number> = {
  appview: APPVIEW_PORT,
  "tap-ingester": TAP_INGESTER_PORT,
  "Tap admin": TAP_ADMIN_PORT,
  Vite: VITE_PORT,
  "process-compose API": PC_PORT,
};
// Dropped and recreated at the start of every run. Deliberately a fixed name
// distinct from the dev stack's `observing` DB, so a run can never wipe it.
const DEVENV_DB = "observing_devenv";

function onPath(bin: string): Promise<boolean> {
  const r = spawn("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" });
  return new Promise<boolean>((res) => {
    r.on("error", () => res(false));
    r.on("exit", (code) => res(code === 0));
  });
}

/**
 * Whether something accepts TCP connections on loopback `port`. Probes by
 * connecting rather than binding: macOS lets a specific-address bind coexist
 * with another process's wildcard listener, so a bind test can miss a server
 * that our health checks would still reach.
 */
async function portInUse(port: number): Promise<boolean> {
  const probe = (host: string) =>
    new Promise<boolean>((res) => {
      const sock = connect({ port, host });
      sock.setTimeout(1000);
      sock.once("connect", () => {
        sock.destroy();
        res(true);
      });
      sock.once("timeout", () => {
        sock.destroy();
        res(false);
      });
      sock.once("error", () => res(false));
    });
  const hits = await Promise.all([probe("127.0.0.1"), probe("::1")]);
  return hits.some(Boolean);
}

async function preflight(): Promise<void> {
  const bins = ["process-compose", "tap", "psql"];
  const present = await Promise.all(bins.map(onPath));
  const missing = bins.filter((_, i) => !present[i]);
  if (missing.length) {
    throw new Error(
      `Missing on PATH: ${missing.join(", ")}. See docs/development.md ` +
        "(process-compose; scripts/install-tap.sh; the Postgres client).",
    );
  }

  const ports = Object.entries(STACK_PORTS);
  const inUse = await Promise.all(ports.map(([, port]) => portInUse(port)));
  const busy = ports.filter((_, i) => inUse[i]).map(([name, port]) => `${name} :${port}`);
  if (busy.length) {
    throw new Error(
      `Port(s) already in use: ${busy.join(", ")}. Stop whatever holds them ` +
        "(usually the normal dev stack: `process-compose down`) and re-run.",
    );
  }
}

async function waitForHealth(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  // Sequential polling is the point here — await-in-loop is intentional.
  /* eslint-disable no-await-in-loop */
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  /* eslint-enable no-await-in-loop */
  throw new Error(`timed out waiting for ${url}`);
}

/** Wait until tap-ingester reports its Tap firehose channel is connected. */
async function waitForTapConnected(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  /* eslint-disable no-await-in-loop */
  while (Date.now() < deadline) {
    try {
      const res = await fetch(TAP_HEALTH);
      if (res.ok && (await res.json())?.connected === true) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  /* eslint-enable no-await-in-loop */
  throw new Error("tap-ingester never became channel-connected");
}

/**
 * Register the test DID with Tap so it tracks + forwards that repo's commits.
 *
 * Tap only forwards commits for repos it tracks. tap-ingester's cross-repo
 * resolver auto-adds DIDs that appear as a record's *subject*, but an occurrence
 * record has no subject — so the creating DID would never be tracked and the
 * create→firehose→ingester→DB round-trip never completes. Add it explicitly,
 * mirroring the real-network CI's pre-warm. The dev-env account is freshly
 * created each run, so the backfill this triggers is trivially small.
 */
async function prewarmTap(did: string): Promise<void> {
  const res = await fetch(TAP_REPOS_ADD, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dids: [did] }),
  });
  if (!res.ok) {
    throw new Error(`Tap /repos/add failed: ${res.status} ${await res.text()}`);
  }
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  return spawn(cmd, args, { cwd: ROOT, env, stdio: "inherit" });
}

/**
 * Resolves with the child's exit code (1 if killed by a signal). Rejects if it
 * couldn't be spawned (e.g. ENOENT), which emits `error` and never `exit`.
 */
function exitCode(child: ChildProcess): Promise<number> {
  return new Promise((res, rej) => {
    child.once("error", rej);
    child.once("exit", (code) => res(code ?? 1));
  });
}

/**
 * Rejects as soon as process-compose exits — at any code, since it also exits
 * 0 once nothing is left runnable (e.g. migrate failed, so appview and
 * tap-ingester never start). Raced against the startup waits so a dead stack
 * fails the run immediately instead of after the health-check timeouts.
 */
function composeExited(compose: ChildProcess): Promise<never> {
  const exited = exitCode(compose).then((code) => {
    throw new Error(`process-compose exited early (code ${code}); see the service output above`);
  });
  // Rejection is only meaningful while a race is listening; after a
  // successful startup the normal teardown exit must not surface as unhandled.
  exited.catch(() => {});
  return exited;
}

/**
 * The Postgres server URL, resolved the way process-compose.yaml does:
 * DATABASE_URL, else the DB_PASSWORD-templated local default. Falls back to
 * `.env` for both, since process-compose normally loads it but this script
 * runs outside it (and starts process-compose with dotenv disabled).
 */
function serverDatabaseUrl(): URL {
  const envFile = join(ROOT, ".env");
  const dotenv = existsSync(envFile) ? parseEnv(readFileSync(envFile, "utf8")) : {};
  const get = (key: string) => process.env[key] || dotenv[key];
  return new URL(
    get("DATABASE_URL") ||
      `postgresql://postgres:${get("DB_PASSWORD") || "mysecretpassword"}@localhost:5432/observing`,
  );
}

/**
 * Drop and recreate DEVENV_DB on the dev Postgres server, returning its URL.
 * The run's DIDs live on a throwaway PLC, so their rows must never land in the
 * dev stack's database, and a previous run's rows must not leak into this one.
 * The `migrate` process then applies the schema to the empty database.
 */
async function recreateDatabase(): Promise<string> {
  const server = serverDatabaseUrl();
  const admin = new URL(server);
  admin.pathname = "/postgres";
  const code = await exitCode(
    run(
      "psql",
      [
        admin.href,
        "-q",
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        `DROP DATABASE IF EXISTS ${DEVENV_DB} WITH (FORCE)`,
        "-c",
        `CREATE DATABASE ${DEVENV_DB}`,
      ],
      process.env,
    ),
  );
  if (code !== 0) {
    throw new Error(`recreating ${DEVENV_DB} failed (psql exited ${code}); is Postgres running?`);
  }
  const target = new URL(server);
  target.pathname = `/${DEVENV_DB}`;
  return target.href;
}

async function main() {
  await preflight();

  let dev: DevEnv | undefined;
  let compose: ChildProcess | undefined;
  // Tap's sqlite cursor DB. Per-run, because each run's PDS restarts its
  // firehose sequence near 0: a persisted cursor from a previous run would be
  // ahead of the new PDS's head (and its tracked DIDs dead), so Tap would miss
  // this run's commits.
  const tapDir = mkdtempSync(join(tmpdir(), "observing-devenv-tap-"));
  try {
    console.log(`[e2e-devenv] recreating database ${DEVENV_DB}...`);
    const databaseUrl = await recreateDatabase();

    console.log("[e2e-devenv] booting local ATProto network...");
    dev = await bootDevEnv();
    const env = {
      ...process.env,
      ...devEnvVars(dev),
      DATABASE_URL: databaseUrl,
      // Absolute path, so this is the three-slash form Tap's parser expects.
      TAP_DATABASE_URL: `sqlite://${join(tapDir, "tap.db")}`,
      APPVIEW_PORT: String(APPVIEW_PORT),
      TAP_INGESTER_PORT: String(TAP_INGESTER_PORT),
      VITE_PORT: String(VITE_PORT),
      // Surface Tap's stdout/stderr (via tap-ingester) so startup failures are
      // debuggable; tapped defaults this to /dev/null.
      TAP_INHERIT_STDIO: "1",
    };
    console.log(`[e2e-devenv] account ${dev.account.handle} (${dev.account.did})`);
    console.log(`[e2e-devenv] PLC=${dev.endpoints.plcUrl} PDS=${dev.endpoints.pdsUrl}`);

    console.log(`[e2e-devenv] starting services (${COMPOSE_FILES.join(" + ")})...`);
    compose = run(
      "process-compose",
      [
        ...COMPOSE_FILES.flatMap((f) => ["-f", f]),
        // process-compose's .env values override its inherited environment,
        // so a dev's .env DATABASE_URL would silently point this run back at
        // the dev database. serverDatabaseUrl() reads what it needs from .env.
        "--disable-dotenv",
        "-p",
        String(PC_PORT),
        "up",
        "-t=false",
      ],
      env,
    );
    const stackDown = composeExited(compose);

    console.log("[e2e-devenv] waiting for appview health...");
    await Promise.race([waitForHealth(APPVIEW_HEALTH, 180_000), stackDown]);

    console.log("[e2e-devenv] waiting for tap-ingester firehose channel...");
    await Promise.race([waitForTapConnected(120_000), stackDown]);
    console.log(`[e2e-devenv] registering test DID with Tap (${dev.account.did})...`);
    await Promise.race([prewarmTap(dev.account.did), stackDown]);

    console.log("[e2e-devenv] running Playwright...");
    const pw = run(
      "npx",
      ["playwright", "test", "--config=frontend/tests/playwright.devenv.config.ts"],
      env,
    );
    const code = await exitCode(pw);
    console.log(`[e2e-devenv] Playwright exited ${code}`);
    process.exitCode = code;
  } finally {
    // pid is undefined if process-compose never spawned; there's nothing to stop.
    if (compose?.pid !== undefined && compose.exitCode === null && compose.signalCode === null) {
      console.log("[e2e-devenv] stopping services...");
      compose.kill("SIGINT");
      await Promise.race([exitCode(compose), new Promise((r) => setTimeout(r, 15_000))]);
    }
    if (dev) {
      console.log("[e2e-devenv] closing dev-env network...");
      await dev.close();
    }
    rmSync(tapDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("[e2e-devenv] failed:", err);
  process.exit(1);
});
