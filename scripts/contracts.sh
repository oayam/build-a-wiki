#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cargo run --quiet --locked --manifest-path backend/Cargo.toml --bin openapi > "$tmp/openapi.json"
if [ "${1:-}" = '--write' ]; then
  cp "$tmp/openapi.json" docs/openapi.json
  (cd frontend && npm run generate && npx prettier --write src/api.generated.ts)
else
  cmp "$tmp/openapi.json" docs/openapi.json
  (cd frontend && npx openapi-typescript ../docs/openapi.json -o "$tmp/api.generated.ts" && npx prettier --write "$tmp/api.generated.ts")
  cmp "$tmp/api.generated.ts" frontend/src/api.generated.ts
fi
