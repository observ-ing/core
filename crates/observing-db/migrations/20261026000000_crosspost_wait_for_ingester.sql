-- Cross-posts queued as their occurrence is created wait for the ingester (#998).

-- Records the ingester must have indexed before the crosspost may run: what
-- the request that created the occurrence wrote, which the ingester hasn't
-- seen yet when it queues the crosspost. Cleared once they are all in.
ALTER TABLE appview.crossposts
    ADD COLUMN awaits_uris TEXT[] NOT NULL DEFAULT '{}';

-- How many times the crosspost has found the ingester not done yet. Waiting
-- doesn't count against `attempts`, which are for the other platform's errors,
-- so it has a limit of its own.
ALTER TABLE appview.crossposts
    ADD COLUMN waits INTEGER NOT NULL DEFAULT 0;

-- The crosspost isn't claimed before this: a new one gives the ingester a
-- head start, and one that is waiting on it checks again later.
ALTER TABLE appview.crossposts
    ADD COLUMN not_before TIMESTAMPTZ;
