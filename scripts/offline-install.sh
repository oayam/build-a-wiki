#!/usr/bin/env bash
set -euo pipefail
: "${RELEASE_DIR:?Set package directory}"
: "${DEPLOY_ENV:?Set absolute path of protected deployment env file}"
cd "$RELEASE_DIR"
sha256sum -c SHA256SUMS
gzip -dc images.tar.gz | docker load
docker compose --env-file "$DEPLOY_ENV" -f deploy/compose.yaml up -d --no-build --pull never
