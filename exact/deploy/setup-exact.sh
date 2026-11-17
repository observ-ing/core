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
# package.json names the @exact packages by a path from the main author's
# checkout; where that path doesn't exist (CI), name them in $EXACT instead.
EXACT="$EXACT" bun -e '
const file = "package.json";
const pkg = await Bun.file(file).json();
let moved = false;
for (const [name, spec] of Object.entries(pkg.dependencies ?? {})) {
  if (!name.startsWith("@exact/") || !spec.startsWith("file:")) continue;
  if (await Bun.file(`${spec.slice(5)}/package.json`).exists()) continue;
  pkg.dependencies[name] = `file:${process.env.EXACT}/packages/${name.slice(7)}`;
  moved = true;
}
if (moved) await Bun.write(file, JSON.stringify(pkg, null, 2) + "\n");
'
bun install
