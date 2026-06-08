#!/usr/bin/env bash

set -euo pipefail

VERSION="${1:-dev}"
DESTINATION="dist/build/chessnaltics"

rm -rf "$DESTINATION"
mkdir -p "$DESTINATION"

cp -R src/. "$DESTINATION/"

(
  cd dist/build
  zip -rq "chessnaltics_${VERSION}.chrome.zip" "chessnaltics"
)
