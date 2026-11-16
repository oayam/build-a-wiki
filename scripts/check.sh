#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/.cargo/bin:$PATH"
: "${TEST_DATABASE_URL:?Set an isolated TEST_DATABASE_URL}"
(cd frontend && npm run lint && npm run format:check && npm run test && npm run build)
(cd backend && cargo fmt --check && cargo clippy --locked --all-targets -- -D warnings && cargo test --locked)
bash scripts/contracts.sh
