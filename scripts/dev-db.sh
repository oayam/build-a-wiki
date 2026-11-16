#!/usr/bin/env bash
set -euo pipefail
cd /tmp
# 本机开发专用：只创建明确命名的角色和数据库，不删除已有数据。
pg_ctlcluster 14 main start || pg_isready -q
if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='wiki'" | grep -q 1; then
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE wiki LOGIN PASSWORD 'wiki_dev'"
fi
for db in wiki_dev wiki_test; do
  if ! runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='$db'" | grep -q 1; then
    runuser -u postgres -- createdb -O wiki "$db"
  fi
done
