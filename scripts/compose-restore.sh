#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
: "${DEPLOY_ENV:?Set protected deployment environment file}"
: "${BACKUP_DIR:?Set verified backup directory}"
compose=(docker compose --env-file "$DEPLOY_ENV" -f deploy/compose.yaml)
(cd "$BACKUP_DIR" && sha256sum -c SHA256SUMS)
# Start only PostgreSQL: do not run migrations or API before restoring.
"${compose[@]}" up -d --no-build --pull never postgres
for attempt in $(seq 1 60); do
 if "${compose[@]}" exec -T postgres pg_isready -U wiki -d wiki >/dev/null; then break; fi
 sleep 1
done
count=$("${compose[@]}" exec -T postgres psql -U wiki -d wiki -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")
[ "$count" = 0 ] || { echo 'Refusing to overwrite a non-empty database.' >&2; exit 1; }
"${compose[@]}" run --rm --no-deps -T api sh -c 'test -z "$(ls -A /data/attachments)"'
python3 - "$BACKUP_DIR/attachments.tar" <<'PY'
import pathlib,sys,tarfile
with tarfile.open(sys.argv[1]) as archive:
 for member in archive.getmembers():
  path=pathlib.PurePosixPath(member.name)
  if path.is_absolute() or '..' in path.parts or not(member.isfile() or member.isdir()):raise SystemExit('Unsafe attachment archive')
PY
"${compose[@]}" exec -T postgres pg_restore -U wiki -d wiki --exit-on-error --single-transaction --no-owner --no-privileges < "$BACKUP_DIR/database.dump"
"${compose[@]}" run --rm --no-deps -T api tar -C /data/attachments -xf - < "$BACKUP_DIR/attachments.tar"
echo 'Restored. Start services, verify data, then explicitly run maintenance off.'
