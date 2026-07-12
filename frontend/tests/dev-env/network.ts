/**
 * Reusable @atproto/dev-env harness for isolated e2e.
 *
 * Boots a throwaway local ATProto network (PLC + PDS + firehose) and seeds a
 * test account. Nothing federates to the public network, so e2e test records
 * never reach production or any other AppView.
 *
 * `@atproto/dev-env` is NOT a committed dependency — it drags in ~1260
 * transitive packages that only this isolated-e2e path needs, so vendoring it
 * would bloat the root lockfile for every dev and CI job. Instead it is fetched
 * on demand into a gitignored `.deps/` dir the first time the harness runs
 * (see `ensureDevEnv`) and imported dynamically from there.
 *
 * Consumed by:
 *   - bootstrap.ts          — standalone demo / manual inspection
 *   - scripts/e2e-devenv.ts — boots the network, exports endpoints to the Rust
 *                             services, runs Playwright, tears down
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Pinned so on-demand installs are reproducible without a committed lockfile. */
const DEV_ENV_VERSION = "0.5.8";
/** Gitignored install target — kept out of the root package tree on purpose. */
const DEPS_DIR = join(dirname(fileURLToPath(import.meta.url)), ".deps");

/**
 * Minimal structural view of the bits of `@atproto/dev-env`'s
 * `TestNetworkNoAppView` this harness actually uses. Avoids a compile-time
 * dependency on the package's types while keeping the call sites checked.
 */
interface TestNetwork {
  pds: { url: string };
  plc: { url: string };
  getSeedClient(): {
    createAccount(
      name: string,
      opts: { handle: string; email: string; password: string },
    ): Promise<{ did: string; handle: string }>;
  };
  close(): Promise<void>;
}

interface DevEnvModule {
  TestNetworkNoAppView: { create(config: object): Promise<TestNetwork> };
}

/**
 * Resolve `@atproto/dev-env`, installing it on demand (no-save, gitignored)
 * the first time. Returns the dynamically-imported module.
 */
async function ensureDevEnv(): Promise<DevEnvModule> {
  // Anchor resolution inside DEPS_DIR; the anchor file need not exist.
  const requireFromDeps = createRequire(join(DEPS_DIR, "noop.cjs"));
  const resolveEntry = (): string => requireFromDeps.resolve("@atproto/dev-env");

  let entry: string;
  try {
    entry = resolveEntry();
  } catch {
    console.log(
      `[dev-env] installing @atproto/dev-env@${DEV_ENV_VERSION} on demand ` +
        `(~1260 packages, one time) into ${DEPS_DIR} ...`,
    );
    execFileSync(
      "npm",
      [
        "install",
        "--no-save",
        "--no-package-lock",
        "--no-audit",
        "--no-fund",
        "--prefix",
        DEPS_DIR,
        `@atproto/dev-env@${DEV_ENV_VERSION}`,
      ],
      { stdio: "inherit" },
    );
    entry = resolveEntry();
  }

  const mod = (await import(pathToFileURL(entry).href)) as Partial<DevEnvModule> & {
    default?: Partial<DevEnvModule>;
  };
  const TestNetworkNoAppView = mod.TestNetworkNoAppView ?? mod.default?.TestNetworkNoAppView;
  if (!TestNetworkNoAppView) {
    throw new Error("@atproto/dev-env: TestNetworkNoAppView export not found");
  }
  return { TestNetworkNoAppView };
}

export interface DevEnvEndpoints {
  /** PLC directory base URL — set as `PLC_DIRECTORY_URL` for the Rust stack. */
  plcUrl: string;
  /**
   * PDS base URL. Set as `HANDLE_RESOLVER_URL` (serves `resolveHandle`) and as
   * `TAP_RELAY_URL` — a PDS serves `subscribeRepos` like a relay, and indigo's
   * Tap requires an `http(s)://` relay URL (it upgrades to a websocket itself).
   */
  pdsUrl: string;
  /**
   * PDS firehose host as a `ws://` URL. Set as `LAG_PROBE_RELAY_URL`: the
   * tap-ingester heartbeat connects with `tokio_tungstenite`, which needs a
   * `ws(s)://` scheme (Tap itself takes the `http://` form above).
   */
  pdsWsUrl: string;
  /** Full `subscribeRepos` websocket URL, for reference/lag probing. */
  firehoseUrl: string;
}

export interface DevEnvAccount {
  did: string;
  handle: string;
  email: string;
  password: string;
}

export interface DevEnv {
  network: TestNetwork;
  endpoints: DevEnvEndpoints;
  account: DevEnvAccount;
  close: () => Promise<void>;
}

export interface BootOptions {
  handle?: string;
  password?: string;
  email?: string;
}

/**
 * Boot a local network and create one seeded account.
 *
 * Handle defaults to `alice.test` — the `.test` domain is dev-env's default
 * available user domain. The account is created via the PDS, so it resolves
 * through the local PLC + the PDS's `resolveHandle`.
 */
export async function bootDevEnv(opts: BootOptions = {}): Promise<DevEnv> {
  const { TestNetworkNoAppView } = await ensureDevEnv();
  const network = await TestNetworkNoAppView.create({});

  const pdsUrl = network.pds.url;
  const plcUrl = network.plc.url;
  const pdsWsUrl = pdsUrl.replace(/^http/, "ws");
  const firehoseUrl = `${pdsWsUrl}/xrpc/com.atproto.sync.subscribeRepos`;

  const handle = opts.handle ?? "alice.test";
  const password = opts.password ?? "e2e-test-pw";
  const email = opts.email ?? "alice@example.test";

  const sc = network.getSeedClient();
  const acct = await sc.createAccount("alice", { handle, email, password });

  return {
    network,
    endpoints: { plcUrl, pdsUrl, pdsWsUrl, firehoseUrl },
    account: { did: acct.did, handle: acct.handle, email, password },
    close: () => network.close(),
  };
}

/**
 * The env vars that point the Rust stack (appview + tap-ingester) at this
 * network. Spread into a child process's environment.
 */
export function devEnvVars(dev: DevEnv): Record<string, string> {
  return {
    PLC_DIRECTORY_URL: dev.endpoints.plcUrl,
    HANDLE_RESOLVER_URL: dev.endpoints.pdsUrl,
    // Tap consumes the PDS firehose as a relay; indigo requires an http(s)://
    // relay URL (it does the ws upgrade itself) — a ws:// value makes Tap exit
    // with "relay-url must start with http:// or https://".
    TAP_RELAY_URL: dev.endpoints.pdsUrl,
    // The heartbeat's lag probe connects via tokio_tungstenite, which needs a
    // ws:// scheme — point it at the same firehose, ws-form.
    LAG_PROBE_RELAY_URL: dev.endpoints.pdsWsUrl,
    // Account creds for the Playwright auth setup.
    DEVENV_DID: dev.account.did,
    DEVENV_HANDLE: dev.account.handle,
    DEVENV_PASSWORD: dev.account.password,
  };
}
