//! Every background task, and where it runs.
//!
//! Adding a task: add a variant and fill in each method, add it to
//! [`Task::ALL`], give it a Cloud Run service that serves [`Task::path`], and
//! create its queue (docs/deployment.md#cloud-tasks).

use std::time::Duration;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Task {
    /// Fill in `accepted_taxon_key` on identifications
    /// (`observing-resolve-taxa`).
    ResolveTaxa,
}

impl Task {
    pub const ALL: &'static [Task] = &[Task::ResolveTaxa];

    /// The task's Cloud Tasks queue, and the prefix of its task IDs.
    pub const fn name(self) -> &'static str {
        match self {
            Task::ResolveTaxa => "resolve-taxa",
        }
    }

    /// The Cloud Run service that runs it.
    pub const fn service(self) -> &'static str {
        match self {
            Task::ResolveTaxa => "observing-resolve-taxa",
        }
    }

    /// The path a run is POSTed to.
    pub const fn path(self) -> &'static str {
        match self {
            Task::ResolveTaxa => "/run",
        }
    }

    /// The service's port in local development, unless [`Self::port_env`]
    /// says otherwise.
    pub const fn local_port(self) -> u16 {
        match self {
            Task::ResolveTaxa => 3007,
        }
    }

    /// The environment variable that moves [`Self::local_port`], as
    /// `scripts/dev.sh` does for every service.
    pub const fn port_env(self) -> &'static str {
        match self {
            Task::ResolveTaxa => "RESOLVE_TAXA_PORT",
        }
    }

    /// How long Cloud Tasks waits on a run before retrying it. The service's
    /// `--timeout` should match.
    pub const fn dispatch_deadline(self) -> Duration {
        match self {
            Task::ResolveTaxa => Duration::from_secs(15 * 60),
        }
    }

    /// Requests from [`crate::Trigger::request`] within one window share a
    /// run at the end of it.
    pub const fn window(self) -> Duration {
        match self {
            Task::ResolveTaxa => Duration::from_secs(60),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn names_services_and_ports_are_unique() {
        let count = Task::ALL.len();
        let names: HashSet<_> = Task::ALL.iter().map(|t| t.name()).collect();
        let services: HashSet<_> = Task::ALL.iter().map(|t| t.service()).collect();
        let ports: HashSet<_> = Task::ALL.iter().map(|t| t.local_port()).collect();
        assert_eq!(names.len(), count);
        assert_eq!(services.len(), count);
        assert_eq!(ports.len(), count);
    }

    #[test]
    fn port_env_follows_the_name() {
        for task in Task::ALL {
            let expected = format!("{}_PORT", task.name().to_uppercase().replace('-', "_"));
            assert_eq!(task.port_env(), expected);
        }
    }

    #[test]
    fn deadlines_are_within_cloud_tasks_limits() {
        for task in Task::ALL {
            let deadline = task.dispatch_deadline();
            assert!(deadline >= Duration::from_secs(15) && deadline <= Duration::from_secs(1800));
            assert!(task.window().as_secs() >= 1);
        }
    }
}
