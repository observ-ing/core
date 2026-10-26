# hydrant-ingester (spike)

tap-ingester's Postgres write path, fed by an embedded
[hydrant](https://hydrant.klbr.net) instead of Tap. It exists to answer
"would hydrant be a better sync layer than Tap?" with numbers, not to ship.

hydrant runs in-process as a Rust library: no Go binary, no subprocess, no
loopback WebSocket. It consumes the relay firehose, discovers repos that
write any of our six collections, backfills them from their PDSes, and keeps
the matching records in a local [fjall](https://github.com/fjall-rs/fjall)
database with an ordered, replayable event log. This binary reads that log
from a cursor it keeps in the same database and hands each record to
`tap_ingester::records::process_record`, the same function the Tap consumer
calls.

## Running it

Dry run (no Postgres; counts records, everything else is real):

```sh
DRY_RUN=1 PORT=8091 cargo run --release -p hydrant-ingester
```

Against the local dev database, the same way process-compose runs tap-ingester:

```sh
DATABASE_URL=postgresql://postgres:mysecretpassword@localhost:5432/observing \
  PORT=8091 cargo run --release -p hydrant-ingester
```

Don't run it beside a tap-ingester that writes the same database; they'd both
write every record. (Harmless, since every write is an idempotent upsert, but
it muddies any comparison.)

State lives in `./.hydrant-ingester/` (gitignored). Delete it to start over;
the stream cursor lives inside it, so the two can't drift apart.

Useful endpoints:

- `GET :8091/api/stats`: ingester counters, same shape as tap-ingester's.
- `GET :8091/api/hydrant-stats`: hydrant's record/repo counts and per-relay
  firehose stats (`last_seq`, frames, bytes).
- `:2480`: hydrant's own API, loopback only since it has no auth (`/repos`,
  `/stats`, `/xrpc/com.atproto.repo.listRecords`, ...).

Every 60s it logs an `ingester heartbeat` with the same `cursor_advance` and
`lag_seconds` fields tap-ingester logs, so the existing log-based metrics
chart either one.

## Configuration

Any `HYDRANT_*` variable from hydrant's
[configuration docs](https://hydrant.klbr.net/configuration/) works. These
default to observ.ing values instead of hydrant's:

| Setting | Default here | hydrant's default |
| --- | --- | --- |
| `HYDRANT_DATABASE_PATH` | `./.hydrant-ingester/hydrant.db` | `./hydrant.db` |
| `HYDRANT_FILTER_SIGNALS` | all six observ.ing collections | none |
| `HYDRANT_FILTER_COLLECTIONS` | all six observ.ing collections | everything |
| `HYDRANT_RELAY_HOSTS` | `wss://relay1.us-east.bsky.network` (Tap's) | `wss://relay.fire.hose.cam` |
| `HYDRANT_CRAWLER_URLS` | `https://relay1.us-east.bsky.network` | `https://lightrail.microcosm.blue` |
| `HYDRANT_PLC_URL` | `https://plc.directory` | `https://plc.wtf` |

The signals differ from Tap's on purpose. Tap's `--signal-collection` takes a
single NSID, so tap-ingester discovers repos by occurrences alone. Someone who
only identifies or likes other people's observations is never followed (see
findings below).

## How it differs from the Tap consumer

- **Cursor.** Tap tracks delivery with acks. hydrant's stream is
  broadcast with a client-held cursor, which this binary keeps in a fjall
  keyspace (`user:observing`) inside hydrant's database. Event ids only mean
  something to the database that issued them.
- **Records whose subject hasn't arrived.** Tap-ingester withholds the ack
  so Tap redelivers later. Here the record is parked in memory, keyed by the
  occurrence URI it points at, and retried when that occurrence is written. If
  it's still waiting after 10 minutes it goes to `ingester.failed_records`.
  This also covers the same-repo case that fills `failed_records` during Tap
  backfills: identifications sort before occurrences in a repo's MST, so a
  backfill delivers them first.
- **Replay.** hydrant keeps every record, so rebuilding the appview's
  tables means resubscribing from cursor 0. No PDS round trips.

## Findings

From dry runs against the live network on 2026-10-24, run locally (not on
Cloud Run).

- **Records match the PDSes exactly.** hydrant held 2,558 records across 18
  repos. Every repo and collection matched a `listRecords` walk of its PDS.
  Backfilling the first 15 repos took about 3 seconds.
- **The relay's collection index is stale.** `listReposByCollection` for
  occurrences lists 18 repos, but 3 of them no longer have any occurrences.
  hydrant re-checks each with `describeRepo` and drops those. Tap tracks all
  18, which is the only reason it follows one of them: an account that has
  identifications but no occurrences.
- **Tap misses users who never post an occurrence.** tommi.space has 2
  likes on observ.ing occurrences and no occurrences of its own. Tap never
  tracks it, so production shows `likeCount: 0` on both liked occurrences. A
  local Tap with tap-ingester's config held 2,556 records, exactly those 2
  likes short. Signaling on all six collections fixes it. With Tap, the
  workaround would be adding those repos by hand (`/repos/add`), since
  `--signal-collection` takes a single NSID.
- **Keeps up with the live firehose.** About 305 to 340 events/s with
  `lag_seconds` at 0, even on a debug build.
- **Restarts resume cleanly.** On restart it continues from both the
  saved stream cursor and its own saved relay cursor, and SIGTERM closes the
  database before exit.
- **Catch-up throughput is the same as Tap's when both have local
  storage.** Both were stopped at the same relay seq, left for 10 minutes,
  then restarted one at a time, sampling the relay seq every 5 seconds.
  Release build, M4 Pro, same relay, same filters:

  | | Backlog drain rate | Caught up after | Live CPU / RSS |
  | --- | --- | --- | --- |
  | hydrant (fjall) | ~6,800 events/s | ~30 s (208k events) | 3% / 34 MB |
  | Tap (SQLite) | ~6,450 events/s | ~37 s (235k events) | 7% / 56 MB |

  Both top out around what the relay delivers to one connection (a
  do-nothing reader measured ~6,700/s in June), so neither hits its own
  limit here. Production Tap's ~560 events/s ceiling therefore isn't
  Tap's: it comes from where Tap runs. Most likely that's its state on Cloud
  SQL (a db-f1-micro reached over the network, one round trip per event;
  CPU sat near 10% and raising `TAP_MAX_DB_CONNS` from 5 to 10 raised
  throughput by 39%). So hydrant's speed is really the speed of local storage,
  and Tap on a local disk would likely get the same.

## What's missing before it could replace tap-ingester

1. **Somewhere to run.** fjall needs a persistent local disk, and Cloud Run
   has none. That means a GCE VM with a persistent disk (or GKE with a PVC),
   plus a deploy path and monitoring to go with it.
2. **Parked records are in memory.** One still parked when the process
   stops is lost, because the cursor is already past it. A durable version
   would park in Postgres, or hold the cursor back while anything is parked.
3. **Dashboard and admin views.** tap-ingester's HTML dashboard,
   `/api/tap-stats`, `/api/repos` and `/api/failed-records` aren't ported,
   and the appview's admin ingester tables read the last two.
4. **dev-env e2e.** Needs `HYDRANT_RELAY_HOSTS` and `HYDRANT_PLC_URL` pointed
   at the dev-env PDS and PLC, plus `HYDRANT_ALLOW_PRIVATE_NETWORKS=true`. Not
   wired into `process-compose.devenv.yaml`.
5. **Account events.** hydrant emits account status (deactivated, takendown).
   Both consumers ignore them today.
6. **Dependency risk.** hydrant is v0.1.0 with no tagged releases and isn't
   on crates.io (pinned by git rev). It's effectively one maintainer, and it
   depends on that maintainer's forks of fjall, lsm-tree and rmp-serde. Some
   database settings are fixed at creation (`HYDRANT_DATA_COMPRESSION`,
   memtable sizes, `HYDRANT_EPHEMERAL`), so changing them means a fresh
   database.
