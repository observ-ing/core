//! Reference model: the repos (source of truth), the Tap delivery queues
//! between them and the ingester, and the database state the ingester should
//! converge to once every queue drains.
//!
//! Deliberately tiny — three DIDs, three rkeys, three taxon names — so random
//! traces collide constantly: re-puts become edits, deletes hit live records,
//! and several people identify the same occurrence.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fmt;

use observing_collections::{IDENTIFICATION_COLLECTION, LIKE_COLLECTION, OCCURRENCE_COLLECTION};
use serde_json::{json, Value};
use tapped::RecordAction;

const DIDS: [&str; 3] = ["did:plc:alice", "did:plc:bob", "did:plc:carol"];
const RKEYS: [&str; 3] = ["r0", "r1", "r2"];
const NAMES: [&str; 3] = ["Acer rubrum", "Quercus alba", "Quercus rubra"];
const RANKS: [Option<&str>; 2] = [Some("species"), None];
const KINGDOMS: [Option<&str>; 2] = [Some("Plantae"), None];
const QUANTITIES: [Option<&str>; 3] = [Some("3"), Some("10-100"), None];
const EXTERNAL_RECORDS: [Option<&str>; 3] = [
    Some("https://www.inaturalist.org/observations/1"),
    Some("https://www.inaturalist.org/observations/2"),
    None,
];

/// The `accepted_taxon_key` the fake GBIF upstream resolves each name to.
pub fn fake_taxon_key(name: &str) -> i64 {
    1000 + NAMES.iter().position(|n| *n == name).expect("known name") as i64
}

/// Tiny deterministic PRNG (SplitMix64) so a seed fully determines a trace.
pub struct Rng(u64);

impl Rng {
    pub fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next_u64() % n as u64) as usize
    }

    fn pick<T: Copy>(&mut self, xs: &[T]) -> T {
        xs[self.below(xs.len())]
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct Key {
    pub did: &'static str,
    pub collection: &'static str,
    pub rkey: &'static str,
}

impl Key {
    pub fn uri(&self) -> String {
        format!("at://{}/{}/{}", self.did, self.collection, self.rkey)
    }
}

impl fmt::Display for Key {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}/{}/{}",
            short_did(self.did),
            short_collection(self.collection),
            self.rkey
        )
    }
}

fn short_did(did: &str) -> &str {
    did.trim_start_matches("did:plc:")
}

fn short_collection(collection: &str) -> &'static str {
    match collection {
        OCCURRENCE_COLLECTION => "occurrence",
        IDENTIFICATION_COLLECTION => "identification",
        LIKE_COLLECTION => "like",
        _ => "?",
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum Record {
    Occurrence {
        /// `organismQuantity`; `organismQuantityType` is "individuals" when set.
        quantity: Option<&'static str>,
        /// The single `externalRecords` entry's URI, if any.
        external_record: Option<&'static str>,
    },
    Identification {
        subject: Key,
        name: &'static str,
        rank: Option<&'static str>,
        kingdom: Option<&'static str>,
        /// Minutes past 2024-01-01; unique per create so "latest ID" is unambiguous.
        created_at: u32,
    },
    Like {
        subject: Key,
    },
}

impl Record {
    fn to_json(&self) -> Value {
        match self {
            Record::Occurrence {
                quantity,
                external_record,
            } => {
                let mut v = json!({
                    "$type": OCCURRENCE_COLLECTION,
                    "decimalLatitude": "37.7749",
                    "decimalLongitude": "-122.4194",
                    "coordinateUncertaintyInMeters": 10,
                    "eventDate": "2024-06-15T08:30:45Z",
                });
                if let Some(quantity) = quantity {
                    v["organismQuantity"] = json!(quantity);
                    v["organismQuantityType"] = json!("individuals");
                }
                if let Some(uri) = external_record {
                    v["externalRecords"] = json!([{ "uri": uri, "service": "inaturalist" }]);
                }
                v
            }
            Record::Identification {
                subject,
                name,
                rank,
                kingdom,
                created_at,
            } => {
                let mut v = json!({
                    "$type": IDENTIFICATION_COLLECTION,
                    "scientificName": name,
                    "occurrence": { "uri": subject.uri(), "cid": "bafyreioccurrence" },
                    "createdAt": timestamp(*created_at),
                });
                if let Some(rank) = rank {
                    v["taxonRank"] = json!(rank);
                }
                if let Some(kingdom) = kingdom {
                    v["kingdom"] = json!(kingdom);
                }
                v
            }
            Record::Like { subject } => json!({
                "$type": LIKE_COLLECTION,
                "subject": { "uri": subject.uri(), "cid": "bafyreioccurrence" },
                "createdAt": "2024-06-15T08:30:45Z",
            }),
        }
    }
}

fn timestamp(minutes: u32) -> String {
    let t = chrono::DateTime::parse_from_rfc3339("2024-01-01T00:00:00Z").unwrap()
        + chrono::Duration::minutes(minutes as i64);
    t.format("%Y-%m-%dT%H:%M:%SZ").to_string()
}

/// One step of a trace. Every action is total — if a shrunk trace makes one
/// inapplicable (delivering from an empty queue, deleting a missing record)
/// it's a no-op — so any subsequence of a trace is itself a valid trace.
#[derive(Clone, Debug)]
pub enum Action {
    /// An author creates or edits a record in their repo; the commit joins
    /// that repo's delivery queue.
    Put { key: Key, record: Record },
    /// An author deletes a record from their repo.
    Delete { key: Key },
    /// Tap delivers the next pending event for one repo. Tap preserves order
    /// within a repo but interleaves repos arbitrarily.
    Deliver { did: &'static str },
    /// Tap re-sends the last `n` events it delivered for a repo, in order:
    /// `n == 1` is at-least-once redelivery (the ingester wrote but died
    /// before acking), larger `n` is a cursor rewind after a reconnect.
    Rewind { did: &'static str, n: usize },
    /// One pass of the `observing-resolve-taxa` background worker.
    ResolveTaxa,
}

impl fmt::Display for Action {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Action::Put { key, record } => {
                write!(f, "{} puts {key}", short_did(key.did))?;
                match record {
                    Record::Occurrence {
                        quantity,
                        external_record,
                    } => write!(
                        f,
                        " {{ quantity: {quantity:?}, external record: {external_record:?} }}"
                    ),
                    Record::Identification {
                        subject,
                        name,
                        rank,
                        kingdom,
                        ..
                    } => write!(
                        f,
                        " {{ {name:?}, rank: {rank:?}, kingdom: {kingdom:?}, on {subject} }}"
                    ),
                    Record::Like { subject } => write!(f, " on {subject}"),
                }
            }
            Action::Delete { key } => write!(f, "{} deletes {key}", short_did(key.did)),
            Action::Deliver { did } => write!(f, "tap delivers next event from {}", short_did(did)),
            Action::Rewind { did, n: 1 } => {
                write!(f, "tap redelivers last event from {}", short_did(did))
            }
            Action::Rewind { did, n } => {
                write!(f, "tap rewinds {}'s cursor by {n} events", short_did(did))
            }
            Action::ResolveTaxa => write!(f, "resolve-taxa worker runs"),
        }
    }
}

/// A firehose record event as Tap hands it to the ingester.
#[derive(Clone, Debug)]
pub struct Event {
    pub did: &'static str,
    pub collection: &'static str,
    pub uri: String,
    pub action: RecordAction,
    pub cid: Option<String>,
    pub record: Option<Value>,
}

pub enum Effect {
    Ingest(Vec<Event>),
    ResolveTaxa,
}

#[derive(Default)]
pub struct World {
    /// Source of truth: every record currently in every repo.
    repos: BTreeMap<Key, Record>,
    /// Commits not yet delivered, per repo, in commit order.
    pending: BTreeMap<&'static str, VecDeque<Event>>,
    /// Everything delivered so far, per repo, for redelivery and rewinds.
    delivered: BTreeMap<&'static str, Vec<Event>>,
    commits: u64,
    clock: u32,
}

impl World {
    /// Generate a random trace. The generator consults a scratch world so it
    /// proposes mostly-meaningful actions (edits of live records, deliveries
    /// from non-empty queues), but replay never depends on that.
    pub fn generate(seed: u64, steps: usize) -> Vec<Action> {
        let mut rng = Rng::new(seed);
        let mut world = World::default();
        (0..steps)
            .map(|_| {
                let action = world.propose(&mut rng);
                world.step(&action);
                action
            })
            .collect()
    }

    fn propose(&mut self, rng: &mut Rng) -> Action {
        let with_pending: Vec<_> = DIDS
            .into_iter()
            .filter(|d| self.pending.get(d).is_some_and(|q| !q.is_empty()))
            .collect();
        let rewindable: Vec<_> = self.delivered.keys().copied().collect();
        let roll = rng.below(100);
        match roll {
            0..=34 => self.propose_put(rng),
            35..=42 if !self.repos.is_empty() => {
                let keys: Vec<_> = self.repos.keys().copied().collect();
                Action::Delete {
                    key: rng.pick(&keys),
                }
            }
            43..=87 if !with_pending.is_empty() => Action::Deliver {
                did: rng.pick(&with_pending),
            },
            88..=94 if !rewindable.is_empty() => Action::Rewind {
                did: rng.pick(&rewindable),
                n: rng.pick(&[1, 1, 1, 2, 3, 5]),
            },
            95..=99 => Action::ResolveTaxa,
            _ => self.propose_put(rng),
        }
    }

    fn propose_put(&mut self, rng: &mut Rng) -> Action {
        let did = rng.pick(&DIDS);
        let rkey = rng.pick(&RKEYS);
        let any_occurrence = Key {
            did: rng.pick(&DIDS),
            collection: OCCURRENCE_COLLECTION,
            rkey: rng.pick(&RKEYS),
        };
        let collection = rng.pick(&[
            OCCURRENCE_COLLECTION,
            IDENTIFICATION_COLLECTION,
            IDENTIFICATION_COLLECTION,
            LIKE_COLLECTION,
        ]);
        let key = Key {
            did,
            collection,
            rkey,
        };
        let record = match collection {
            OCCURRENCE_COLLECTION => Record::Occurrence {
                quantity: rng.pick(&QUANTITIES),
                external_record: rng.pick(&EXTERNAL_RECORDS),
            },
            IDENTIFICATION_COLLECTION => {
                // Editing an existing identification keeps its subject and
                // createdAt, like the app's edit flow; a new one gets fresh ones.
                let (subject, created_at) = match self.repos.get(&key) {
                    Some(Record::Identification {
                        subject,
                        created_at,
                        ..
                    }) => (*subject, *created_at),
                    _ => {
                        self.clock += 1;
                        (any_occurrence, self.clock)
                    }
                };
                Record::Identification {
                    subject,
                    name: rng.pick(&NAMES),
                    rank: rng.pick(&RANKS),
                    kingdom: rng.pick(&KINGDOMS),
                    created_at,
                }
            }
            // The app never edits a like, so a re-put keeps its subject.
            // (Changing it is legal atproto, but the ingester rejects that
            // outright on the likes_pkey conflict — worth its own fault knob.)
            _ => match self.repos.get(&key) {
                Some(Record::Like { subject }) => Record::Like { subject: *subject },
                _ => Record::Like {
                    subject: any_occurrence,
                },
            },
        };
        Action::Put { key, record }
    }

    pub fn step(&mut self, action: &Action) -> Effect {
        match action {
            Action::Put { key, record } => {
                // The app's edit rules live here rather than in the generator,
                // so a shrunk trace (which the generator never saw) still only
                // makes edits the app could make.
                let record = match (self.repos.get(key), record) {
                    // Likes are never edited.
                    (Some(Record::Like { .. }), _) => return Effect::Ingest(vec![]),
                    // Editing an identification keeps its subject and createdAt.
                    (
                        Some(Record::Identification {
                            subject,
                            created_at,
                            ..
                        }),
                        Record::Identification {
                            name,
                            rank,
                            kingdom,
                            ..
                        },
                    ) => Record::Identification {
                        subject: *subject,
                        name,
                        rank: *rank,
                        kingdom: *kingdom,
                        created_at: *created_at,
                    },
                    _ => record.clone(),
                };
                let action = if self.repos.contains_key(key) {
                    RecordAction::Update
                } else {
                    RecordAction::Create
                };
                self.commit(*key, action, Some(record.to_json()));
                self.repos.insert(*key, record);
                Effect::Ingest(vec![])
            }
            Action::Delete { key } => {
                if self.repos.remove(key).is_some() {
                    self.commit(*key, RecordAction::Delete, None);
                }
                Effect::Ingest(vec![])
            }
            Action::Deliver { did } => {
                let Some(event) = self.pending.get_mut(did).and_then(|q| q.pop_front()) else {
                    return Effect::Ingest(vec![]);
                };
                self.delivered.entry(did).or_default().push(event.clone());
                Effect::Ingest(vec![event])
            }
            Action::Rewind { did, n } => {
                let history = self.delivered.get(did).map(Vec::as_slice).unwrap_or(&[]);
                Effect::Ingest(history[history.len().saturating_sub(*n)..].to_vec())
            }
            Action::ResolveTaxa => Effect::ResolveTaxa,
        }
    }

    fn commit(&mut self, key: Key, action: RecordAction, record: Option<Value>) {
        self.commits += 1;
        let cid = record.as_ref().map(|_| format!("bafysim{}", self.commits));
        self.pending.entry(key.did).or_default().push_back(Event {
            did: key.did,
            collection: key.collection,
            uri: key.uri(),
            action,
            cid,
            record,
        });
    }

    /// Everything still queued, in the order Tap would eventually deliver it.
    pub fn drain(&mut self) -> Vec<Event> {
        self.pending
            .values_mut()
            .flat_map(|q| q.drain(..))
            .collect()
    }

    /// The database state the ingester should reach once every commit has
    /// been delivered and resolve-taxa has run.
    pub fn expected(&self) -> Snapshot {
        let mut s = Snapshot::default();
        for (key, record) in &self.repos {
            match record {
                Record::Occurrence {
                    quantity,
                    external_record,
                } => {
                    s.occurrences.insert(
                        key.uri(),
                        OccurrenceRow {
                            quantity: quantity.map(str::to_string),
                            quantity_type: quantity.map(|_| "individuals".to_string()),
                            external_record: external_record.map(str::to_string),
                        },
                    );
                }
                Record::Identification {
                    subject,
                    name,
                    rank,
                    kingdom,
                    ..
                } => {
                    s.identifications.insert(
                        key.uri(),
                        IdentificationRow {
                            subject: subject.uri(),
                            name: name.to_string(),
                            rank: rank.map(str::to_string),
                            kingdom: kingdom.map(str::to_string),
                        },
                    );
                    s.accepted_taxon_keys
                        .insert(key.uri(), Some(fake_taxon_key(name)));
                }
                Record::Like { subject } => {
                    s.likes.insert((key.did.to_string(), subject.uri()));
                }
            }
        }
        s.community_ids = self.expected_community_ids();
        s
    }

    /// Intent of the `community_ids` matview: each identifier's latest
    /// identification of an occurrence is one vote, votes group by taxon
    /// (name + kingdom), and the most votes wins with ties going to the
    /// alphabetically-first name.
    fn expected_community_ids(&self) -> BTreeMap<String, (String, i64)> {
        type Vote = (u32, &'static str, Option<&'static str>);
        let mut latest: BTreeMap<(&str, Key), Vote> = BTreeMap::new();
        for (key, record) in &self.repos {
            if let Record::Identification {
                subject,
                name,
                kingdom,
                created_at,
                ..
            } = record
            {
                let vote = (*created_at, *name, *kingdom);
                latest
                    .entry((key.did, *subject))
                    .and_modify(|v| {
                        if vote.0 > v.0 {
                            *v = vote
                        }
                    })
                    .or_insert(vote);
            }
        }

        type Taxon = (&'static str, Option<&'static str>);
        let mut votes: BTreeMap<Key, BTreeMap<Taxon, i64>> = BTreeMap::new();
        for ((_, subject), (_, name, kingdom)) in latest {
            if matches!(self.repos.get(&subject), Some(Record::Occurrence { .. })) {
                *votes
                    .entry(subject)
                    .or_default()
                    .entry((name, kingdom))
                    .or_default() += 1;
            }
        }

        votes
            .into_iter()
            .filter_map(|(subject, taxa)| {
                let ((name, _), count) = taxa
                    .into_iter()
                    .max_by(|(a, na), (b, nb)| na.cmp(nb).then(b.0.cmp(a.0)))?;
                Some((subject.uri(), (name.to_string(), count)))
            })
            .collect()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct OccurrenceRow {
    pub quantity: Option<String>,
    pub quantity_type: Option<String>,
    pub external_record: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct IdentificationRow {
    pub subject: String,
    pub name: String,
    pub rank: Option<String>,
    pub kingdom: Option<String>,
}

/// The abstract state the properties compare: the model's vocabulary, which
/// the driver maps real rows into.
#[derive(Debug, Default)]
pub struct Snapshot {
    pub occurrences: BTreeMap<String, OccurrenceRow>,
    pub identifications: BTreeMap<String, IdentificationRow>,
    pub accepted_taxon_keys: BTreeMap<String, Option<i64>>,
    /// `(liker did, subject uri)`
    pub likes: BTreeSet<(String, String)>,
    /// occurrence uri → (winning name, vote count)
    pub community_ids: BTreeMap<String, (String, i64)>,
    /// `(recipient, actor, kind, reference uri)` → count, only where count > 1.
    /// Keyed by recipient because a deleted record's rkey can be reused for a
    /// record about someone else's occurrence, which rightly notifies them.
    pub duplicate_notifications: BTreeMap<(String, String, String, Option<String>), i64>,
    pub ingest_errors: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    /// What an action does against the current world, for coverage counts.
    fn situation(world: &World, action: &Action) -> &'static str {
        match action {
            Action::Put { key, record } => match (world.repos.get(key), record) {
                (None, Record::Occurrence { .. }) => "create occurrence",
                (None, Record::Identification { .. }) => "create identification",
                (None, Record::Like { .. }) => "create like",
                (Some(Record::Occurrence { .. }), _) => "edit occurrence",
                (
                    Some(Record::Identification { name: old, .. }),
                    Record::Identification { name: new, .. },
                ) if old != new => "rename identification",
                (Some(Record::Identification { .. }), _) => "edit identification fields",
                (Some(Record::Like { .. }), _) => "re-put like (no-op)",
            },
            Action::Delete { key } => match world.repos.get(key) {
                None => "delete missing record (no-op)",
                Some(Record::Occurrence { .. }) => "delete occurrence",
                Some(Record::Identification { .. }) => "delete identification",
                Some(Record::Like { .. }) => "delete like",
            },
            Action::Deliver { did } => {
                if world.pending.get(did).is_some_and(|q| !q.is_empty()) {
                    "deliver"
                } else {
                    "deliver from empty queue (no-op)"
                }
            }
            Action::Rewind { n: 1, .. } => "redeliver",
            Action::Rewind { .. } => "rewind cursor",
            Action::ResolveTaxa => "resolve-taxa",
        }
    }

    /// Every situation the properties depend on, with a floor well below
    /// today's counts (all 177+ over the default seeds). If a generator change
    /// makes one rare, the sim quietly stops testing it; this fails first.
    #[test]
    fn generator_exercises_every_situation() {
        const FLOOR: usize = 50;
        let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
        for seed in 0..300 {
            let mut world = World::default();
            for action in World::generate(seed, 40) {
                *counts.entry(situation(&world, &action)).or_default() += 1;
                world.step(&action);
            }
        }
        for required in [
            "create occurrence",
            "create identification",
            "create like",
            "edit occurrence",
            "edit identification fields",
            "rename identification",
            "delete occurrence",
            "delete identification",
            "delete like",
            "deliver",
            "redeliver",
            "rewind cursor",
            "resolve-taxa",
        ] {
            let n = counts.get(required).copied().unwrap_or(0);
            assert!(
                n >= FLOOR,
                "generator produced {required:?} only {n} times (floor {FLOOR}): {counts:#?}"
            );
        }
    }

    #[test]
    fn same_seed_same_trace() {
        let render = |seed| {
            World::generate(seed, 40)
                .iter()
                .map(|a| format!("{a:?}"))
                .collect::<Vec<_>>()
        };
        assert_eq!(render(7), render(7));
        assert_ne!(render(7), render(8));
    }

    /// Shrinking relies on every action being total: any subsequence of a
    /// trace must replay without panicking.
    #[test]
    fn any_subsequence_replays() {
        for seed in 0..100 {
            let trace = World::generate(seed, 40);
            for stride in 2..5 {
                for offset in 0..stride {
                    let mut world = World::default();
                    for (i, action) in trace.iter().enumerate() {
                        if i % stride != offset {
                            world.step(action);
                        }
                    }
                    world.drain();
                    world.expected();
                }
            }
        }
    }

    // The community_ids expectation is the spec for consensus; pin it with
    // hand-built cases so a model refactor can't quietly change what "right"
    // means.

    fn occurrence_key() -> Key {
        Key {
            did: DIDS[0],
            collection: OCCURRENCE_COLLECTION,
            rkey: "r0",
        }
    }

    /// A world whose repos hold one occurrence plus identifications of it,
    /// each `(identifier index, rkey, name, kingdom, created_at)`.
    fn consensus(
        ids: &[(usize, &'static str, &'static str, Option<&'static str>, u32)],
    ) -> Option<(String, i64)> {
        let mut world = World::default();
        world.repos.insert(
            occurrence_key(),
            Record::Occurrence {
                quantity: None,
                external_record: None,
            },
        );
        for &(who, rkey, name, kingdom, created_at) in ids {
            world.repos.insert(
                Key {
                    did: DIDS[who],
                    collection: IDENTIFICATION_COLLECTION,
                    rkey,
                },
                Record::Identification {
                    subject: occurrence_key(),
                    name,
                    rank: None,
                    kingdom,
                    created_at,
                },
            );
        }
        world
            .expected()
            .community_ids
            .remove(&occurrence_key().uri())
    }

    #[test]
    fn consensus_majority_wins() {
        let result = consensus(&[
            (0, "r0", "Quercus alba", None, 1),
            (1, "r0", "Quercus alba", None, 2),
            (2, "r0", "Acer rubrum", None, 3),
        ]);
        assert_eq!(result, Some(("Quercus alba".into(), 2)));
    }

    #[test]
    fn consensus_tie_goes_to_first_name_alphabetically() {
        let result = consensus(&[
            (0, "r0", "Quercus alba", None, 1),
            (1, "r0", "Acer rubrum", None, 2),
        ]);
        assert_eq!(result, Some(("Acer rubrum".into(), 1)));
    }

    #[test]
    fn consensus_counts_only_each_identifiers_latest_id() {
        // alice changed her mind from Acer to Quercus; only the later counts.
        let result = consensus(&[
            (0, "r0", "Acer rubrum", None, 1),
            (0, "r1", "Quercus alba", None, 4),
            (1, "r0", "Acer rubrum", None, 2),
            (2, "r0", "Quercus alba", None, 3),
        ]);
        assert_eq!(result, Some(("Quercus alba".into(), 2)));
    }

    #[test]
    fn consensus_splits_votes_by_kingdom() {
        // Intended (if debatable): the same name with and without a kingdom
        // are separate taxa.
        let result = consensus(&[
            (0, "r0", "Quercus alba", Some("Plantae"), 1),
            (1, "r0", "Quercus alba", None, 2),
        ]);
        assert_eq!(result, Some(("Quercus alba".into(), 1)));
    }

    #[test]
    fn no_consensus_without_the_occurrence() {
        let mut world = World::default();
        world.repos.insert(
            Key {
                did: DIDS[1],
                collection: IDENTIFICATION_COLLECTION,
                rkey: "r0",
            },
            Record::Identification {
                subject: occurrence_key(),
                name: "Quercus alba",
                rank: None,
                kingdom: None,
                created_at: 1,
            },
        );
        assert!(world.expected().community_ids.is_empty());
    }
}
