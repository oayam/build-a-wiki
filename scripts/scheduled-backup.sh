#!/usr/bin/env bash
set -euo pipefail
: "${BACKUP_ROOT:?Set backup root on independent mounted storage}"
: "${DEPLOY_ENV:?Set protected deployment env file}"
: "${BACKUP_MOUNT:?Set independent storage mount point}"
backup_mount_path=$(realpath -m -- "$BACKUP_MOUNT")
backup_root_path=$(realpath -m -- "$BACKUP_ROOT")
[ "$backup_mount_path" != / ] && mountpoint -q "$backup_mount_path" || { echo 'Backup storage is not mounted; refusing local fallback.' >&2; exit 1; }
case "$backup_root_path" in "$backup_mount_path"|"$backup_mount_path"/*) ;; *) echo 'Backup root is outside the configured storage mount.' >&2; exit 1 ;; esac
mkdir -p "$BACKUP_ROOT"
export BACKUP_DIR="$BACKUP_ROOT/wiki-$(date -u +%Y%m%dT%H%M%SZ)-$$"
bash "$(dirname "$0")/compose-backup.sh"
