/**
 * Validates every record the dev-env e2e run wrote against `lexicons/`.
 *
 * The appview writes with `validate` unset, and a PDS only checks records
 * against schemas it knows (it reports `validationStatus: "unknown"` for ours),
 * so nothing else checks that what the write paths produce matches the
 * lexicons. The specs delete their records as they go, so reading the repo at
 * the end would find almost nothing. Instead this replays the PDS firehose
 * from cursor 0 with `goat firehose --ops`, which yields every create and
 * update since the network booted, and runs `goat lex validate` on each.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { DevEnv } from "../frontend/tests/dev-env/network";

// Collections whose schemas live in lexicons/. Anything else on the firehose
// (e.g. app.bsky.actor.profile) is validated by the PDS itself.
const OWN_PREFIXES = ["bio.lexicons.", "ing.observ."];
const REPLAY_TIMEOUT_MS = 60_000;

interface FirehoseOp {
  // Identity and account events have none of these.
  action?: string;
  collection?: string;
  rkey?: string;
  rev?: string;
  record?: unknown;
}

interface Written {
  uri: string;
  action: string;
  record: unknown;
}

/** The repo's current commit rev: the replay is complete once it reaches this. */
async function headRev(dev: DevEnv): Promise<string> {
  const url = new URL("/xrpc/com.atproto.sync.getLatestCommit", dev.endpoints.pdsUrl);
  url.searchParams.set("did", dev.account.did);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`getLatestCommit failed: ${res.status} ${await res.text()}`);
  const commit: { rev: string } = await res.json();
  return commit.rev;
}

/** Replays the PDS firehose and collects creates/updates in our collections. */
async function replayWrites(dev: DevEnv): Promise<Written[]> {
  const head = await headRev(dev);
  const goat = spawn(
    "goat",
    [
      "--plc-host",
      dev.endpoints.plcUrl,
      "firehose",
      "--relay-host",
      dev.endpoints.pdsWsUrl,
      "--cursor",
      "0",
      "--ops",
    ],
    { stdio: ["ignore", "pipe", "inherit"] },
  );
  const written: Written[] = [];
  const done = new Promise<void>((res, rej) => {
    const timer = setTimeout(
      () => rej(new Error(`firehose replay didn't reach rev ${head} in ${REPLAY_TIMEOUT_MS} ms`)),
      REPLAY_TIMEOUT_MS,
    );
    goat.once("error", rej);
    goat.once("exit", (code) => rej(new Error(`goat firehose exited early (code ${code})`)));
    createInterface({ input: goat.stdout }).on("line", (line) => {
      const op: FirehoseOp = JSON.parse(line);
      if (
        (op.action === "create" || op.action === "update") &&
        OWN_PREFIXES.some((p) => op.collection?.startsWith(p))
      ) {
        written.push({
          uri: `at://${dev.account.did}/${op.collection}/${op.rkey}`,
          action: op.action,
          record: op.record,
        });
      }
      // Revs are TIDs, so they sort in commit order.
      if (op.rev !== undefined && op.rev >= head) {
        clearTimeout(timer);
        res();
      }
    });
  });
  try {
    await done;
  } finally {
    goat.removeAllListeners("exit");
    goat.kill();
  }
  return written;
}

/** Runs `goat lex validate`; resolves to its output on failure, null on success. */
function validate(file: string, catalog: string): Promise<string | null> {
  return new Promise((res, rej) => {
    const goat = spawn("goat", ["lex", "validate", "--catalog", catalog, file], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    goat.stdout.on("data", (d) => (out += d));
    goat.stderr.on("data", (d) => (out += d));
    goat.once("error", rej);
    goat.once("exit", (code) => res(code === 0 ? null : out.trim()));
  });
}

/**
 * Validates every record the run wrote. Returns false (after printing each
 * invalid record) if any fails, or if the run wrote none — the specs always
 * create an occurrence, so zero means the replay itself is broken.
 */
export async function validateWrittenRecords(dev: DevEnv, catalog: string): Promise<boolean> {
  const written = await replayWrites(dev);
  if (written.length === 0) {
    console.error("[validate-records] the run wrote no bio.lexicons.* / ing.observ.* records");
    return false;
  }
  const dir = mkdtempSync(join(tmpdir(), "observing-devenv-records-"));
  try {
    const results = await Promise.all(
      written.map((w, i) => {
        const file = join(dir, `${i}.json`);
        writeFileSync(file, JSON.stringify(w.record, null, 2));
        return validate(file, catalog);
      }),
    );
    const failures = written.flatMap((w, i) => {
      const err = results[i];
      return err === null ? [] : [{ ...w, err }];
    });
    for (const f of failures) {
      console.error(`[validate-records] INVALID ${f.action} ${f.uri}\n  ${f.err}`);
      console.error(`  record: ${JSON.stringify(f.record)}`);
    }
    console.log(
      `[validate-records] ${written.length - failures.length}/${written.length} records valid`,
    );
    return failures.length === 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
