//! State simulation of `PUT /api/user/preferences`, the regression test for
//! #999: a save changes the preferences it names and leaves the rest alone.
//! The pattern is the one in `docs/system-tests.md`.
//!
//! Generates random traces of saves from clients of different releases (an
//! older one predates the basemap preference, so it never sends it), some of
//! them racing each other, and sends each as the JSON body a client would
//! through the real request parsing, validation and write ([`apply_update`])
//! against a scratch database. After every step it reads each user's
//! preferences back the way GET does and checks them against a model of what
//! the users chose. On a violation it shrinks the trace to a minimal
//! reproduction. [`MUTANTS`] checks the sim itself.
//!
//! Opt-in, like the `observing-db` regression tests, because it needs Postgres
//! (with PostGIS) and creates a throwaway database on it:
//!
//! ```sh
//! TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres \
//!   cargo test -p observing-appview preferences::sim -- --nocapture
//! ```
//!
//! Knobs: `PREFS_SIM_CASES` (default 200), `PREFS_SIM_STEPS` (default 30),
//! `PREFS_SIM_BASE_SEED` (default 0; CI stays deterministic), `PREFS_SIM_SEED`
//! (replay one seed).

use std::collections::BTreeMap;
use std::fmt;
use std::str::FromStr;

use serde_json::{json, Map, Value};
use sqlx::postgres::{PgConnectOptions, PgConnection, PgPool};
use sqlx::{AssertSqlSafe, Connection};

use super::{apply_update, response_for, UpdatePreferencesRequest};

const USERS: [&str; 2] = ["did:plc:alice", "did:plc:bob"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Field {
    DefaultLicense,
    Basemap,
}

impl Field {
    const ALL: [Field; 2] = [Field::DefaultLicense, Field::Basemap];

    fn json_name(self) -> &'static str {
        match self {
            Field::DefaultLicense => "defaultLicense",
            Field::Basemap => "basemap",
        }
    }

    /// Values a client may send, each with what should be stored for it, or
    /// `None` when the server must reject the save.
    fn inputs(self) -> &'static [(&'static str, Option<&'static str>)] {
        const CC0: &str = "https://creativecommons.org/publicdomain/zero/1.0/";
        const CC_BY: &str = "https://creativecommons.org/licenses/by/4.0/";
        const CC_BY_SA: &str = "https://creativecommons.org/licenses/by-sa/4.0/";
        match self {
            Field::DefaultLicense => &[
                (CC0, Some(CC0)),
                (CC_BY, Some(CC_BY)),
                // A stale bundle's SPDX id is accepted and stored canonically.
                ("CC-BY-SA-4.0", Some(CC_BY_SA)),
                ("MIT", None),
            ],
            Field::Basemap => &[
                ("topo", Some("topo")),
                ("satellite", Some("satellite")),
                ("lava", None),
            ],
        }
    }

    fn stored(self, input: &str) -> Option<&'static str> {
        self.inputs()
            .iter()
            .find(|(i, _)| *i == input)
            .and_then(|(_, stored)| *stored)
    }
}

/// A client release, by the preferences it knows about.
#[derive(Clone, Copy, Debug)]
enum Client {
    /// An installed Android build or a stale tab from before basemaps.
    PredatesBasemap,
    Current,
}

impl Client {
    fn knows(self) -> &'static [Field] {
        match self {
            Client::PredatesBasemap => &[Field::DefaultLicense],
            Client::Current => &Field::ALL,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum Change {
    Set(&'static str),
    Clear,
}

#[derive(Clone, Debug)]
struct Save {
    user: &'static str,
    client: Client,
    /// The fields this save changes; every other field is omitted.
    changes: Vec<(Field, Change)>,
}

impl Save {
    /// The request body a client sends: only the fields it changes, `null` to
    /// clear one.
    fn body(&self) -> String {
        let mut body = Map::new();
        for (field, change) in &self.changes {
            let value = match change {
                Change::Set(v) => json!(v),
                Change::Clear => Value::Null,
            };
            body.insert(field.json_name().to_string(), value);
        }
        Value::Object(body).to_string()
    }

    /// Whether the server should accept it: every value it sets is known.
    fn valid(&self) -> bool {
        self.changes.iter().all(|(field, change)| match change {
            Change::Set(v) => field.stored(v).is_some(),
            Change::Clear => true,
        })
    }
}

impl fmt::Display for Save {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let who = self.user.trim_start_matches("did:plc:");
        write!(
            f,
            "{who} saves {} from a {:?} client",
            self.body(),
            self.client
        )
    }
}

/// One step of a trace. Both kinds always apply, so any subsequence of a
/// trace is itself a valid trace.
#[derive(Clone, Debug)]
enum Action {
    Save(Save),
    /// Two saves in flight at once (two tabs, or phone and web).
    Race(Save, Save),
}

impl fmt::Display for Action {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Action::Save(save) => write!(f, "{save}"),
            Action::Race(a, b) => write!(f, "at once: {a}  |  {b}"),
        }
    }
}

/// Tiny deterministic PRNG (SplitMix64) so a seed fully determines a trace.
struct Rng(u64);

impl Rng {
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

fn generate(seed: u64, steps: usize) -> Vec<Action> {
    let mut rng = Rng(seed);
    (0..steps)
        .map(|_| {
            if rng.below(5) == 0 {
                Action::Race(propose_save(&mut rng), propose_save(&mut rng))
            } else {
                Action::Save(propose_save(&mut rng))
            }
        })
        .collect()
}

fn propose_save(rng: &mut Rng) -> Save {
    let client = rng.pick(&[Client::PredatesBasemap, Client::Current, Client::Current]);
    let mut fields: Vec<Field> = client
        .knows()
        .iter()
        .copied()
        .filter(|_| rng.below(2) == 0)
        .collect();
    if fields.is_empty() {
        fields.push(rng.pick(client.knows()));
    }
    let changes = fields
        .into_iter()
        .map(|field| {
            let change = if rng.below(4) == 0 {
                Change::Clear
            } else {
                Change::Set(rng.pick(field.inputs()).0)
            };
            (field, change)
        })
        .collect();
    Save {
        user: rng.pick(&USERS),
        client,
        changes,
    }
}

/// What the users chose: each user's set preferences, as stored.
#[derive(Clone, Debug, Default, PartialEq, Eq, PartialOrd, Ord)]
struct Model(BTreeMap<&'static str, BTreeMap<Field, &'static str>>);

impl Model {
    /// A valid save changes exactly the fields it names; an invalid one
    /// changes nothing.
    fn apply(&mut self, save: &Save) {
        if !save.valid() {
            return;
        }
        let prefs = self.0.entry(save.user).or_default();
        for (field, change) in &save.changes {
            match change {
                Change::Set(v) => {
                    prefs.insert(*field, field.stored(v).expect("valid"));
                }
                Change::Clear => {
                    prefs.remove(field);
                }
            }
        }
    }

    fn view(&self, user: &str) -> View {
        let prefs = self.0.get(user);
        Field::ALL
            .into_iter()
            .map(|f| (f, prefs.and_then(|p| p.get(&f)).map(|v| v.to_string())))
            .collect()
    }
}

/// One user's preferences as GET returns them.
type View = BTreeMap<Field, Option<String>>;

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
enum Property {
    /// A save is accepted exactly when every value in it is known.
    AcceptedIffValid,
    /// After every step, each user's preferences are what the model says
    /// (for a race, as if the two saves ran one after the other, either way).
    PreferencesMatchModel,
}

impl Property {
    const ALL: [Property; 2] = [Property::AcceptedIffValid, Property::PreferencesMatchModel];

    fn name(self) -> &'static str {
        match self {
            Property::AcceptedIffValid => "accepted_iff_valid",
            Property::PreferencesMatchModel => "preferences_match_model",
        }
    }
}

struct Violation {
    property: Property,
    step: usize,
    detail: String,
}

/// A bug re-injected between parsing a request and applying it, so no
/// production code is touched. The sim must catch each one.
#[derive(Clone, Copy, Debug)]
enum Mutant {
    /// #999's bug: an omitted preference is cleared, as when PUT replaced
    /// every column.
    OmittedClears,
    /// A preference added without `#[serde(with = "present")]`: `null`
    /// deserializes to "omitted", so it can't be cleared.
    NullIgnoredForBasemap,
    /// The legacy SPDX license ids stop being accepted.
    LegacyLicenseRejected,
}

const MUTANTS: &[(Mutant, &[Property])] = &[
    (Mutant::OmittedClears, &[Property::PreferencesMatchModel]),
    (
        Mutant::NullIgnoredForBasemap,
        &[Property::PreferencesMatchModel],
    ),
    (Mutant::LegacyLicenseRejected, &[Property::AcceptedIffValid]),
];

impl Mutant {
    fn rewrite(self, request: &mut UpdatePreferencesRequest) {
        match self {
            Mutant::OmittedClears => {
                request.default_license.get_or_insert(None);
                request.basemap.get_or_insert(None);
            }
            Mutant::NullIgnoredForBasemap => {
                if request.basemap == Some(None) {
                    request.basemap = None;
                }
            }
            Mutant::LegacyLicenseRejected => {
                if let Some(Some(license)) = &request.default_license {
                    if !license.starts_with("https://") {
                        request.default_license = Some(Some("MIT".into()));
                    }
                }
            }
        }
    }
}

struct Driver {
    pool: PgPool,
    server: PgPool,
    name: String,
    mutant: Option<Mutant>,
}

/// Advisory-lock key serializing scratch-database migrations; the same one
/// the `observing-db` regression tests take, since they share a server.
const MIGRATE_LOCK_KEY: i64 = 0x6f62_7365_7276;

impl Driver {
    /// A driver on a fresh scratch database, or `None` (and a note) when
    /// `TEST_DATABASE_URL` isn't set, so plain `cargo test` skips it.
    async fn create() -> Option<Self> {
        let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
            eprintln!("skipping preferences sim: set TEST_DATABASE_URL to run it");
            return None;
        };
        let server_opts = PgConnectOptions::from_str(&url).expect("parse TEST_DATABASE_URL");
        let server = PgPool::connect_with(server_opts.clone())
            .await
            .expect("connect");
        // The two DB tests here run at once in one process.
        static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let name = format!("observing_prefs_sim_{}_{n}", std::process::id());
        sqlx::query(AssertSqlSafe(format!("CREATE DATABASE \"{name}\"")))
            .execute(&server)
            .await
            .expect("create scratch database");
        // Roles are server-wide, so concurrent migrations race on them.
        let mut lock = PgConnection::connect_with(&server_opts)
            .await
            .expect("connect");
        sqlx::query("SELECT pg_advisory_lock($1)")
            .bind(MIGRATE_LOCK_KEY)
            .execute(&mut lock)
            .await
            .expect("take migration lock");
        let opts = server_opts.database(&name);
        // Migrate on a separate pool: the migrations set the database-level
        // search_path, which only applies to connections opened afterwards.
        let migrate_pool = PgPool::connect_with(opts.clone()).await.expect("connect");
        observing_db::migrate::migrate(&migrate_pool)
            .await
            .expect("migrate scratch database");
        migrate_pool.close().await;
        lock.close().await.expect("release migration lock");
        let pool = PgPool::connect_with(opts).await.expect("connect");
        Some(Self {
            pool,
            server,
            name,
            mutant: None,
        })
    }

    async fn destroy(self) {
        self.pool.close().await;
        sqlx::query(AssertSqlSafe(format!(
            "DROP DATABASE \"{}\" WITH (FORCE)",
            self.name
        )))
        .execute(&self.server)
        .await
        .expect("drop scratch database");
    }

    async fn reset(&self) {
        sqlx::query("TRUNCATE user_preferences")
            .execute(&self.pool)
            .await
            .expect("reset");
    }

    /// Send one save as its JSON body; `true` when the server accepted it.
    async fn send(&self, save: &Save) -> bool {
        let mut request: UpdatePreferencesRequest =
            serde_json::from_str(&save.body()).expect("a client's body parses");
        if let Some(mutant) = self.mutant {
            mutant.rewrite(&mut request);
        }
        apply_update(&self.pool, save.user, &request).await.is_ok()
    }

    /// A user's preferences as GET returns them, read by their JSON names.
    async fn view(&self, user: &str) -> View {
        let row = observing_db::user_preferences::get(&self.pool, user)
            .await
            .expect("get");
        let response = serde_json::to_value(response_for(row.as_ref())).expect("serialize");
        Field::ALL
            .into_iter()
            .map(|f| (f, response[f.json_name()].as_str().map(str::to_string)))
            .collect()
    }
}

/// Replay a trace from empty, checking every property after every step.
async fn run(driver: &Driver, trace: &[Action]) -> Result<(), Violation> {
    driver.reset().await;
    // The states the model allows: one, or two right after a race.
    let mut worlds = vec![Model::default()];
    for (step, action) in trace.iter().enumerate() {
        let sent: Vec<(&Save, bool)> = match action {
            Action::Save(save) => vec![(save, driver.send(save).await)],
            Action::Race(a, b) => {
                let (ra, rb) = tokio::join!(driver.send(a), driver.send(b));
                vec![(a, ra), (b, rb)]
            }
        };
        for (save, accepted) in &sent {
            if *accepted != save.valid() {
                return Err(Violation {
                    property: Property::AcceptedIffValid,
                    step,
                    detail: format!(
                        "    {}\n      model: {}\n      server: {}",
                        save.body(),
                        if save.valid() { "accept" } else { "reject" },
                        if *accepted { "accepted" } else { "rejected" },
                    ),
                });
            }
        }

        worlds = match action {
            Action::Save(save) => worlds
                .into_iter()
                .map(|mut w| {
                    w.apply(save);
                    w
                })
                .collect(),
            Action::Race(a, b) => worlds
                .into_iter()
                .flat_map(|w| {
                    let (mut ab, mut ba) = (w.clone(), w);
                    ab.apply(a);
                    ab.apply(b);
                    ba.apply(b);
                    ba.apply(a);
                    [ab, ba]
                })
                .collect(),
        };
        worlds.sort();
        worlds.dedup();

        let mut actual = BTreeMap::new();
        for user in USERS {
            actual.insert(user, driver.view(user).await);
        }
        let matches = |w: &Model| USERS.iter().all(|u| w.view(u) == actual[u]);
        if !worlds.iter().any(matches) {
            let lines: Vec<String> = USERS
                .iter()
                .map(|u| {
                    let allowed: Vec<View> = worlds.iter().map(|w| w.view(u)).collect();
                    format!(
                        "    {u}\n      model: {}\n      db:    {:?}",
                        allowed
                            .iter()
                            .map(|v| format!("{v:?}"))
                            .collect::<Vec<_>>()
                            .join("  or  "),
                        actual[u]
                    )
                })
                .collect();
            return Err(Violation {
                property: Property::PreferencesMatchModel,
                step,
                detail: lines.join("\n"),
            });
        }
        // Later steps only have to agree with the order that happened.
        worlds.retain(matches);
    }
    Ok(())
}

async fn violates(driver: &Driver, trace: &[Action], property: Property) -> bool {
    matches!(run(driver, trace).await, Err(v) if v.property == property)
}

/// Delta-debugging shrink: drop chunks of the trace (halving the chunk size
/// when nothing more can go) while the property still fails, then turn each
/// race that doesn't need to be one into a single save.
async fn shrink(driver: &Driver, mut trace: Vec<Action>, property: Property) -> Vec<Action> {
    let mut chunk = trace.len().div_ceil(2);
    while chunk > 0 {
        let mut progressed = false;
        let mut i = 0;
        while i < trace.len() {
            let mut candidate = trace[..i].to_vec();
            candidate.extend_from_slice(&trace[(i + chunk).min(trace.len())..]);
            if violates(driver, &candidate, property).await {
                trace = candidate;
                progressed = true;
            } else {
                i += chunk;
            }
        }
        if !progressed {
            chunk /= 2;
        }
    }
    for i in 0..trace.len() {
        let Action::Race(a, b) = &trace[i] else {
            continue;
        };
        for save in [a.clone(), b.clone()] {
            let mut candidate = trace.clone();
            candidate[i] = Action::Save(save);
            if violates(driver, &candidate, property).await {
                trace = candidate;
                break;
            }
        }
    }
    trace
}

struct Finding {
    seed: u64,
    trace: Vec<Action>,
    detail: String,
}

/// Run each seed's trace, shrinking the first violation of each property in
/// `targets`, until all of `targets` are found or the seeds run out.
async fn explore(
    driver: &Driver,
    seeds: &[u64],
    steps: usize,
    targets: &[Property],
) -> BTreeMap<Property, Finding> {
    let mut found = BTreeMap::new();
    for &seed in seeds {
        let trace = generate(seed, steps);
        let Err(violation) = run(driver, &trace).await else {
            continue;
        };
        let property = violation.property;
        if !targets.contains(&property) || found.contains_key(&property) {
            continue;
        }
        let trace = shrink(driver, trace[..=violation.step].to_vec(), property).await;
        let detail = match run(driver, &trace).await {
            Err(v) => v.detail,
            Ok(()) => violation.detail,
        };
        found.insert(
            property,
            Finding {
                seed,
                trace,
                detail,
            },
        );
        if targets.iter().all(|p| found.contains_key(p)) {
            break;
        }
    }
    found
}

fn print_finding(property: Property, finding: &Finding) {
    eprintln!(
        "\n✗ {}  (seed {}, shrunk to {} steps)",
        property.name(),
        finding.seed,
        finding.trace.len()
    );
    for (i, action) in finding.trace.iter().enumerate() {
        eprintln!("    {:>2}. {action}", i + 1);
    }
    eprintln!("{}", finding.detail);
}

const DEFAULT_CASES: u64 = 200;
const DEFAULT_STEPS: usize = 30;
/// A shrunk reproduction longer than this means shrinking has regressed.
const MAX_SHRUNK_STEPS: usize = 6;

fn env_num(name: &str, default: u64) -> u64 {
    std::env::var(name)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

#[tokio::test]
async fn preferences_match_what_users_chose() {
    let Some(driver) = Driver::create().await else {
        return;
    };
    let steps = env_num("PREFS_SIM_STEPS", DEFAULT_STEPS as u64) as usize;
    let seeds: Vec<u64> = match std::env::var("PREFS_SIM_SEED")
        .ok()
        .and_then(|s| s.parse().ok())
    {
        Some(seed) => vec![seed],
        None => {
            let base = env_num("PREFS_SIM_BASE_SEED", 0);
            (base..base + env_num("PREFS_SIM_CASES", DEFAULT_CASES)).collect()
        }
    };
    let found = explore(&driver, &seeds, steps, &Property::ALL).await;
    eprintln!(
        "\npreferences sim: {} trace(s) x {steps} steps, {} property violation(s)",
        seeds.len(),
        found.len()
    );
    for (&property, finding) in &found {
        print_finding(property, finding);
    }
    driver.destroy().await;
    assert!(found.is_empty(), "property violations (details above)");
}

/// The ratchet in the test above can't tell "fixed" from "the sim can no
/// longer see it", so each mutant must still be caught, quickly and shrunk.
#[tokio::test]
async fn sim_catches_every_mutant() {
    let Some(mut driver) = Driver::create().await else {
        return;
    };
    let seeds: Vec<u64> = (0..DEFAULT_CASES).collect();
    let mut problems = Vec::new();
    for &(mutant, catches) in MUTANTS {
        driver.mutant = Some(mutant);
        let found = explore(&driver, &seeds, DEFAULT_STEPS, catches).await;
        for property in catches {
            match found.get(property) {
                Some(finding) => {
                    eprintln!(
                        "✓ {:<24} caught by {:<24} seed {:>3}, {} steps",
                        format!("{mutant:?}"),
                        property.name(),
                        finding.seed,
                        finding.trace.len()
                    );
                    if finding.trace.len() > MAX_SHRUNK_STEPS {
                        print_finding(*property, finding);
                        problems.push(format!(
                            "{mutant:?} / {}: shrunk only to {} steps",
                            property.name(),
                            finding.trace.len()
                        ));
                    }
                }
                None => problems.push(format!("{mutant:?} not caught by {}", property.name())),
            }
        }
    }
    driver.mutant = None;
    driver.destroy().await;
    assert!(
        problems.is_empty(),
        "the sim has lost the ability to find bugs:\n  {}",
        problems.join("\n  ")
    );
}

#[test]
fn every_property_has_a_mutant() {
    for property in Property::ALL {
        assert!(
            MUTANTS
                .iter()
                .any(|(_, catches)| catches.contains(&property)),
            "no mutant exercises {}",
            property.name()
        );
    }
}

/// A preference the sim doesn't know about is one it never tests. GET's
/// response names every preference, so a new one fails here until it's
/// added to [`Field`] (and, if older clients predate it, to a [`Client`]).
#[test]
fn sim_knows_every_preference() {
    let response = serde_json::to_value(response_for(None)).expect("serialize");
    let mut served: Vec<&str> = response
        .as_object()
        .expect("object")
        .keys()
        .map(String::as_str)
        .collect();
    let mut modeled: Vec<&str> = Field::ALL.iter().map(|f| f.json_name()).collect();
    served.sort();
    modeled.sort();
    assert_eq!(
        served, modeled,
        "GET serves preferences the sim doesn't model"
    );
}

/// Every situation the properties depend on comes up often enough over the
/// default seeds. If a generator change makes one rare, the sim quietly stops
/// testing it; this fails first.
#[test]
fn generator_exercises_every_situation() {
    const FLOOR: usize = 30;
    let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
    for seed in 0..DEFAULT_CASES {
        let mut model = Model::default();
        for action in generate(seed, DEFAULT_STEPS) {
            let saves: Vec<&Save> = match &action {
                Action::Save(s) => vec![s],
                Action::Race(a, b) => {
                    let shared = a.user == b.user
                        && a.changes
                            .iter()
                            .any(|(f, _)| b.changes.iter().any(|(g, _)| f == g));
                    *counts
                        .entry(if shared {
                            "race on the same preference"
                        } else if a.user == b.user {
                            "race on different preferences"
                        } else {
                            "race between users"
                        })
                        .or_default() += 1;
                    vec![a, b]
                }
            };
            for save in saves {
                let before = model.view(save.user);
                let mut tally =
                    |situation: &'static str| *counts.entry(situation).or_default() += 1;
                if !save.valid() {
                    tally("rejected save");
                }
                for (field, change) in &save.changes {
                    match change {
                        Change::Clear if before[field].is_some() => tally("clear a set preference"),
                        Change::Set(v)
                            if *field == Field::DefaultLicense
                                && !v.starts_with("https://")
                                && field.stored(v).is_some() =>
                        {
                            tally("legacy license id")
                        }
                        _ => {}
                    }
                }
                if Field::ALL
                    .iter()
                    .any(|f| before[f].is_some() && save.changes.iter().all(|(g, _)| g != f))
                {
                    tally("omit a set preference");
                }
                if matches!(save.client, Client::PredatesBasemap)
                    && before[&Field::Basemap].is_some()
                {
                    tally("older client saves after basemap is set");
                }
                model.apply(save);
            }
        }
    }
    for required in [
        "rejected save",
        "clear a set preference",
        "legacy license id",
        "omit a set preference",
        "older client saves after basemap is set",
        "race on the same preference",
        "race on different preferences",
        "race between users",
    ] {
        let n = counts.get(required).copied().unwrap_or(0);
        assert!(
            n >= FLOOR,
            "generator produced {required:?} only {n} times (floor {FLOOR}): {counts:#?}"
        );
    }
}
