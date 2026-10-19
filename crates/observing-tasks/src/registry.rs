//! Every background task, and where it runs.
//!
//! Every task runs in one service, [`WORKER_SERVICE`]: the appview with its
//! `/tasks/*` routes on, deployed privately. Adding a task: add a variant and
//! fill in each method, add it to [`Task::ALL`], add its route to the
//! appview's `routes::tasks`, and create its queue
//! (docs/deployment.md#cloud-tasks).

use std::time::Duration;

/// The Cloud Run service that runs every task.
pub const WORKER_SERVICE: &str = "observing-worker";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Task {
    /// Fill in `accepted_taxon_key` on identifications.
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
        WORKER_SERVICE
    }

    /// The path a run is POSTed to.
    pub const fn path(self) -> &'static str {
        match self {
            Task::ResolveTaxa => "/tasks/resolve-taxa",
        }
    }

    /// The worker's port in local development, where the dev appview serves
    /// the task routes, unless [`Self::port_env`] says otherwise.
    pub const fn local_port(self) -> u16 {
        3000
    }

    /// The environment variable that moves [`Self::local_port`], as
    /// `scripts/dev.sh` does for every service.
    pub const fn port_env(self) -> &'static str {
        "APPVIEW_PORT"
    }

    /// How long Cloud Tasks waits on a run before retrying it. The worker's
    /// `--timeout` should be at least the longest of these.
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
    fn names_and_paths_are_unique() {
        let count = Task::ALL.len();
        let names: HashSet<_> = Task::ALL.iter().map(|t| t.name()).collect();
        let paths: HashSet<_> = Task::ALL.iter().map(|t| t.path()).collect();
        assert_eq!(names.len(), count);
        assert_eq!(paths.len(), count);
    }

    #[test]
    fn paths_follow_the_name() {
        for task in Task::ALL {
            assert_eq!(task.path(), format!("/tasks/{}", task.name()));
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
