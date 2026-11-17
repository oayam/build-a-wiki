#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${RELEASE_DIR:?Set new output directory}"
: "${WIKI_VERSION:=0.1.0-rc1}"
mkdir "$RELEASE_DIR"
docker image inspect "build-a-wiki-api:$WIKI_VERSION" "build-a-wiki-gateway:$WIKI_VERSION" postgres:14.24-bookworm > "$RELEASE_DIR/images.json"
docker save "build-a-wiki-api:$WIKI_VERSION" "build-a-wiki-gateway:$WIKI_VERSION" postgres:14.24-bookworm | gzip > "$RELEASE_DIR/images.tar.gz"
cp -r deploy docs scripts "$RELEASE_DIR/"
cp dependency.txt "$RELEASE_DIR/"
git archive --format=tar.gz HEAD > "$RELEASE_DIR/source.tar.gz"
git rev-parse HEAD > "$RELEASE_DIR/SOURCE_COMMIT"
find "$RELEASE_DIR/scripts" -type d -name __pycache__ -exec rm -rf {} +
(cd "$RELEASE_DIR" && find . -type f ! -name SHA256SUMS -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS)
