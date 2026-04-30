#!/usr/bin/env bash
# Verify the latest migration runs cleanly in a topology that mirrors prod.
#
# The existing CI jobs (rust-test, e2e, backfill) run migrations as a real
# Postgres SUPERUSER, which bypasses every ownership and role-membership
# check. Prod runs them as `postgres` — a non-superuser admin in
# `cloudsqlsuperuser`, where the runtime roles have had their
# `cloudsqlsuperuser` membership revoked (#334). That divergence let the
# original `20260428000001_grant_runtime_roles` migration crashloop the
# migrate Job for ~10 days while CI stayed green.
#
# Strategy:
#   1. Bootstrap roles to mirror prod (`cloudsqlsuperuser`, `runtime_base`,
#      `appview_runtime`, `ingester_runtime`, and a non-superuser `postgres`
#      admin in `cloudsqlsuperuser`).
#   2. Run all migrations as `postgres` while it is temporarily SUPERUSER
#      so the historical ALTER OWNER / GRANT statements work the same way
#      they did in prod when `cloudsqlsuperuser` membership gave postgres
#      a path to every built-in user. This gets the schema into a current-
#      main state, the same as the other CI jobs.
#   3. Reproduce the prod ownership state by transferring
#      `ingester.community_ids` to `ingester_runtime`.
#   4. Strip `postgres` of SUPERUSER via the cluster's bootstrap superuser.
#   5. Forget the latest migration's `_sqlx_migrations` row and re-run
#      sqlx-migrate. A migration that quietly assumes superuser bypass
#      (schema-wide GRANT/REVOKE that touches a runtime-role-owned object,
#      ALTER OWNER without an ownership guard, etc.) fails here.
set -euo pipefail

# The cluster's bootstrap superuser. Distinct from `postgres` so we can
# NOSUPERUSER `postgres` later (PG14+ refuses to NOSUPERUSER the bootstrap
# user). The CI workflow sets `POSTGRES_USER=ci_bootstrap` on the service.
: "${BOOTSTRAP_USER:=ci_bootstrap}"
: "${BOOTSTRAP_PASSWORD:=ci_bootstrap}"
: "${PGHOST:=localhost}"
: "${PGPORT:=5432}"
: "${PGDATABASE:=observing}"
export PGHOST PGPORT PGDATABASE

ADMIN_USER=postgres
ADMIN_PASSWORD=postgres

run_as_bootstrap() {
    PGUSER="$BOOTSTRAP_USER" PGPASSWORD="$BOOTSTRAP_PASSWORD" \
        psql -v ON_ERROR_STOP=1 "$@"
}
run_as_admin() {
    PGUSER="$ADMIN_USER" PGPASSWORD="$ADMIN_PASSWORD" \
        psql -v ON_ERROR_STOP=1 "$@"
}

ADMIN_URL="postgresql://$ADMIN_USER:$ADMIN_PASSWORD@$PGHOST:$PGPORT/$PGDATABASE"

echo "::group::Bootstrap prod-like role topology"
run_as_bootstrap -d postgres <<SQL
CREATE ROLE cloudsqlsuperuser CREATEROLE CREATEDB;
CREATE ROLE runtime_base;
CREATE ROLE appview_runtime LOGIN PASSWORD 'unused' IN ROLE runtime_base;
CREATE ROLE ingester_runtime LOGIN PASSWORD 'unused' IN ROLE runtime_base;
-- The prod-equivalent admin. Temporarily SUPERUSER so the historical
-- ALTER OWNER / cross-role GRANT statements work during migration setup
-- — we strip it after, before replaying the migration under test.
CREATE ROLE $ADMIN_USER LOGIN PASSWORD '$ADMIN_PASSWORD' SUPERUSER
    IN ROLE cloudsqlsuperuser;
CREATE DATABASE $PGDATABASE OWNER $ADMIN_USER;
SQL
echo "::endgroup::"

echo "::group::Run all migrations as postgres (still SUPERUSER)"
sqlx migrate run \
    --source crates/observing-db/migrations \
    --database-url "$ADMIN_URL"
echo "::endgroup::"

echo "::group::Mirror prod state: transfer community_ids to ingester_runtime"
# Migration 20260421 transferred this in prod when postgres still had a path
# through cloudsqlsuperuser to ingester_writer. That migration no-ops in CI
# because ingester_writer never exists here, so set the ownership directly.
run_as_admin -c \
    "ALTER MATERIALIZED VIEW ingester.community_ids OWNER TO ingester_runtime"
echo "::endgroup::"

echo "::group::Strip postgres of SUPERUSER (mirror prod admin role)"
run_as_bootstrap -d postgres -c "ALTER ROLE $ADMIN_USER NOSUPERUSER"
echo "::endgroup::"

echo "::group::Replay latest migration in post-#334 state"
LATEST_VERSION=$(
    ls crates/observing-db/migrations/*.sql \
        | sort -V \
        | tail -1 \
        | xargs basename \
        | cut -d_ -f1
)
echo "Latest migration version: $LATEST_VERSION"
run_as_admin -c \
    "DELETE FROM _sqlx_migrations WHERE version = $LATEST_VERSION"
sqlx migrate run \
    --source crates/observing-db/migrations \
    --database-url "$ADMIN_URL"
echo "::endgroup::"

echo "migrations-prodlike: ok"
