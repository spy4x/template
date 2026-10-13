#!/usr/bin/env bash
# Proves a backup can be restored: backs a database up with backup.sh, restores it into an empty
# one and compares what is there.
#
# It needs `psql`, `pg_dump`, `pg_restore` and `restic` on PATH and a Postgres server where PGUSER
# may create databases (PGHOST, PGUSER, PGPASSWORD). `deno task test:backup` gives it both: the
# backup image and a throwaway server (test-local.sh). CI runs it in the Postgres image against
# its `postgres` service (.woodpecker/ci.yml, `backup-restore`). The repository is a directory
# that is removed at the end, and so are the databases it creates.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
BACKUP=${BACKUP_CMD:-$here/backup.sh}
SCHEMA=${SCHEMA_FILE:-$here/../../libs/server/db/schema.sql}
: "${PGHOST:?PGHOST is not set}" "${PGUSER:?PGUSER is not set}" "${PGPASSWORD:?PGPASSWORD is not set}"
for tool in psql pg_dump pg_restore pg_isready restic; do
  command -v "$tool" >/dev/null || { echo "FAILED: $tool is not on PATH"; exit 1; }
done
[ -r "$SCHEMA" ] || { echo "FAILED: cannot read the schema at $SCHEMA"; exit 1; }

suffix="$(date +%s)_$$"
SOURCE="backup_test_source_$suffix"
RESTORED="backup_test_restored_$suffix"
BY_ID="backup_test_by_id_$suffix"
OCCUPIED="backup_test_occupied_$suffix"
work=$(mktemp -d)
cleanup() {
  for database in "$SOURCE" "$RESTORED" "$BY_ID" "$OCCUPIED"; do
    dropdb --if-exists --force --maintenance-db=postgres "$database" >/dev/null 2>&1 || true
  done
  find "$work" -delete
}
trap cleanup EXIT
# A directory here, not a real repository; the password protects nothing.
export RESTIC_REPOSITORY="$work/repository" RESTIC_PASSWORD=test-only

sql() { psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 --dbname "$1" --command "$2"; }
tables() { sql "$1" "select count(*) from pg_tables where schemaname = 'public'"; }
notes() { sql "$1" "select string_agg(id || '=' || note, ',' order by id) from backup_probe"; }
check() {
  if [ "$2" = "$3" ]; then echo "ok: $1"; else
    echo "FAILED: $1"
    echo "  expected: $2"
    echo "  found:    $3"
    exit 1
  fi
}

# Over TCP: while a new server sets itself up it answers on its socket only (docs/handoff.md).
for attempt in $(seq 1 60); do
  pg_isready --quiet --dbname=postgres && break
  [ "$attempt" != 60 ] || { echo "FAILED: no Postgres at $PGHOST after 60 s"; exit 1; }
  sleep 1
done

# The product's own schema, and rows to find again: a quote and a letter outside ASCII included.
createdb --maintenance-db=postgres "$SOURCE"
psql --no-psqlrc --quiet --set ON_ERROR_STOP=1 --dbname "$SOURCE" --file "$SCHEMA" >/dev/null
sql "$SOURCE" "create table backup_probe (id integer primary key, note text not null);
  insert into backup_probe values (1, 'first'), (2, 'it''s'), (3, 'żółw')"
PGDATABASE=$SOURCE "$BACKUP" once
first_snapshot=$(restic snapshots --json | grep -o '"short_id":"[0-9a-f]*"' | cut -d'"' -f4)

# A later backup holds a change the first one does not.
sql "$SOURCE" "insert into backup_probe values (4, 'later')"
PGDATABASE=$SOURCE "$BACKUP" once

createdb --maintenance-db=postgres "$RESTORED"
PGDATABASE=$RESTORED "$BACKUP" restore
check "a restore into an empty database brings back every table" "$(tables "$SOURCE")" "$(tables "$RESTORED")"
check "a restore into an empty database brings back the rows of the latest backup" \
  "1=first,2=it's,3=żółw,4=later" "$(notes "$RESTORED")"

createdb --maintenance-db=postgres "$BY_ID"
PGDATABASE=$BY_ID "$BACKUP" restore "$first_snapshot"
check "a restore of a named snapshot brings back the rows of that backup" \
  "1=first,2=it's,3=żółw" "$(notes "$BY_ID")"

# One table the backup does not hold: nothing in the dump collides with it, so only the restore's
# own check can stop this one.
createdb --maintenance-db=postgres "$OCCUPIED"
sql "$OCCUPIED" "create table kept_data (id integer)"
if PGDATABASE=$OCCUPIED "$BACKUP" restore; then refused="not refused"; else refused=refused; fi
check "a restore into a database that holds a table is refused and adds nothing" \
  "refused, 1 table" "$refused, $(tables "$OCCUPIED") table"

echo "Backup and restore: all checks passed."
