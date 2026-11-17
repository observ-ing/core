#!/bin/sh
# Check out the Exact this app builds against (EXACT_REV), apply the fixes that
# haven't landed upstream yet (deploy/exact-patches), install what a web build
# needs, and point the app's generated files and packages at that checkout.
#   [EXACT=<checkout, default ~/src/exact>] exact/deploy/setup-exact.sh
# CI runs it before every build. Locally it moves your checkout to EXACT_REV.
set -eu
app=$(cd "$(dirname "$0")/.." && pwd)
EXACT=${EXACT:-$HOME/src/exact}
rev=$(cat "$app/EXACT_REV")

if [ ! -d "$EXACT/.git" ]; then
  git clone --filter=blob:none https://github.com/expo/exact "$EXACT"
fi
git -C "$EXACT" fetch --quiet origin "$rev"
git -C "$EXACT" checkout --quiet --detach "$rev"
for patch in "$app"/deploy/exact-patches/*.patch; do
  [ -e "$patch" ] || continue
  # Already applied (a rerun, or a local checkout that carries it): skip.
  if git -C "$EXACT" apply --reverse --check "$patch" 2>/dev/null; then continue; fi
  git -C "$EXACT" apply "$patch"
done

bun "$EXACT/scripts/exact.mjs" setup --platform web
cd "$app"
EXACT="$EXACT" bun exact.mjs update
bun install
