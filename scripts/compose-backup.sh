#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEPLOY_ENV:?Set protected deployment environment file}"
: "${BACKUP_DIR:?Set a new directory outside repository data volumes}"
compose=(docker compose --env-file "$DEPLOY_ENV" -f deploy/compose.yaml)
mkdir -m 700 "$BACKUP_DIR"
previous=$("${compose[@]}" exec -T api maintenance on)
resume() { if [ "$previous" = off ]; then "${compose[@]}" exec -T api maintenance off >/dev/null; fi; }
trap resume EXIT
"${compose[@]}" exec -T postgres pg_dump -U wiki -d wiki -Fc --no-owner > "$BACKUP_DIR/database.dump"
"${compose[@]}" exec -T api tar -C /data/attachments -cf - . > "$BACKUP_DIR/attachments.tar"
(cd "$BACKUP_DIR" && sha256sum database.dump attachments.tar > SHA256SUMS)
echo 'Consistent backup complete; copy the protected directory to independent storage.'
