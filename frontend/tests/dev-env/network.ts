/**
 * Reusable @atproto/dev-env harness for isolated e2e.
 *
 * Boots a throwaway local ATProto network (PLC + PDS + firehose) and seeds a
 * test account. Nothing federates to the public network, so e2e test records
 * never reach production or any other AppView.
 *
 * Consumed by:
 *   - bootstrap.ts          — standalone demo / manual inspection
 *   - scripts/e2e-devenv.ts — boots the network, exports endpoints to the Rust
 *                             services, runs Playwright, tears down
 */

import { TestNetworkNoAppView } from "@atproto/dev-env";

export interface DevEnvEndpoints {
  /** PLC directory base URL — set as `PLC_DIRECTORY_URL` for the Rust stack. */
  plcUrl: string;
  /** PDS base URL — set as `HANDLE_RESOLVER_URL` (serves `resolveHandle`). */
  pdsUrl: string;
  /** PDS firehose host (no xrpc path) — set as `TAP_RELAY_URL` for Tap. */
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
  network: TestNetworkNoAppView;
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
    TAP_RELAY_URL: dev.endpoints.pdsWsUrl,
    // Account creds for the Playwright auth setup.
    DEVENV_DID: dev.account.did,
    DEVENV_HANDLE: dev.account.handle,
    DEVENV_PASSWORD: dev.account.password,
  };
}
