#!/usr/bin/env bash
# Copies our custom Java sources and AndroidManifest.xml into the Capacitor-
# generated android/ directory. Run this after `npx cap add android` and any
# time you want to make sure the tree matches what's tracked in git.
#
# Why this exists: android/ is gitignored (the Capacitor-generated tree is
# regenerable and large). But we maintain a small set of customizations:
# the OriginalPhotoPicker plugin source, the MainActivity that registers it,
# and the AndroidManifest.xml additions. Those live in capacitor-android-extras/
# and are copied in here.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")/.." && pwd)/capacitor-android-extras"
DST_DIR="$(cd "$(dirname "$0")/.." && pwd)/android"

if [ ! -d "$DST_DIR" ]; then
    echo "android/ does not exist — run 'npx cap add android' first." >&2
    exit 1
fi

echo "Copying Java sources..."
mkdir -p "$DST_DIR/app/src/main/java/ing/observ/app"
cp "$SRC_DIR/java/ing/observ/app/MainActivity.java" \
   "$DST_DIR/app/src/main/java/ing/observ/app/MainActivity.java"
cp "$SRC_DIR/java/ing/observ/app/OriginalPhotoPickerPlugin.java" \
   "$DST_DIR/app/src/main/java/ing/observ/app/OriginalPhotoPickerPlugin.java"

echo "Copying AndroidManifest.xml..."
cp "$SRC_DIR/manifest/AndroidManifest.xml" \
   "$DST_DIR/app/src/main/AndroidManifest.xml"

echo "Done."
