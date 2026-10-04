/**
 * Orchestrates the isolated dev-env e2e run.
 *
 *   1. Boot a local @atproto/dev-env network (PLC + PDS + firehose) and seed a
 *      test account.
 *   2. Start the Rust stack (process-compose.devenv.yaml) with PLC_DIRECTORY_URL
 *      / HANDLE_RESOLVER_URL / TAP_RELAY_URL pointing at that network, so no
 *      identity or firehose traffic ever leaves the machine.
 *   3. Run the Playwright dev-env config (logs in via the local PDS, creates an
 *      observation, asserts it appears).
 *   4. Tear everything down.
 *
 * Prereqs (same as the normal stack): Postgres running, and the `tap` binary on
 * PATH. Run:  npm run test:e2e:devenv
 */

import { type ChildProcess, spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bootDevEnv, type DevEnv, devEnvVars } from "../frontend/tests/dev-env/network";

const ROOT = resolve(fileURLToPath(import.meta.url), "../..");
const COMPOSE_FILE = "process-compose.devenv.yaml";
const APPVIEW_HEALTH = "http://127.0.0.1:3000/health";
// tap-ingester's /health (process-compose.devenv.yaml maps it to 8080). Its
// `connected` flag flips true once Tap's firehose channel is up.
const TAP_HEALTH = "http://127.0.0.1:8080/health";
// Embedded Tap's admin endpoint (its built-in default port; see
// docs/deployment.md TAP_URL). `/repos/add` registers a DID for tracking.
const TAP_REPOS_ADD = "http://127.0.0.1:2480/repos/add";
// Keep process-compose's own API off 8080 (tap-ingester uses it).
const PC_PORT = "8099";

function onPath(bin: string): Promise<boolean> {
  const r = spawn("sh", ["-c", `command -v ${bin}`], { stdio: "ignore" });
  return new Promise<boolean>((res) => r.on("exit", (code) => res(code === 0)));
}

async function preflight(): Promise<void> {
  const present = await Promise.all(["process-compose", "tap"].map(onPath));
  const missing = ["process-compose", "tap"].filter((_, i) => !present[i]);
  if (missing.length) {
    throw new Error(
      `Missing on PATH: ${missing.join(", ")}. See docs/development.md ` +
        "(process-compose; scripts/install-tap.sh).",
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

function exitCode(child: ChildProcess): Promise<number> {
  return new Promise((res) => child.on("exit", (code) => res(code ?? 1)));
}

async function main() {
  await preflight();

  let dev: DevEnv | undefined;
  let compose: ChildProcess | undefined;
  try {
    console.log("[e2e-devenv] booting local ATProto network...");
    dev = await bootDevEnv();
    const env = { ...process.env, ...devEnvVars(dev) };
    console.log(`[e2e-devenv] account ${dev.account.handle} (${dev.account.did})`);
    console.log(`[e2e-devenv] PLC=${dev.endpoints.plcUrl} PDS=${dev.endpoints.pdsUrl}`);

    console.log("[e2e-devenv] starting services (process-compose.devenv.yaml)...");
    compose = run("process-compose", ["-f", COMPOSE_FILE, "-p", PC_PORT, "up", "-t=false"], env);

    console.log("[e2e-devenv] waiting for appview health...");
    await waitForHealth(APPVIEW_HEALTH, 180_000);

    console.log("[e2e-devenv] waiting for tap-ingester firehose channel...");
    await waitForTapConnected(120_000);
    console.log(`[e2e-devenv] registering test DID with Tap (${dev.account.did})...`);
    await prewarmTap(dev.account.did);

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
    if (compose && compose.exitCode === null) {
      console.log("[e2e-devenv] stopping services...");
      compose.kill("SIGINT");
      await Promise.race([exitCode(compose), new Promise((r) => setTimeout(r, 15_000))]);
    }
    if (dev) {
      console.log("[e2e-devenv] closing dev-env network...");
      await dev.close();
    }
  }
}

main().catch((err) => {
  console.error("[e2e-devenv] failed:", err);
  process.exit(1);
});
