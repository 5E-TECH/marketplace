#!/bin/sh
set -eu

backup=${1:-}
if [ -z "$backup" ]; then
  backup=$(find "${BACKUP_DIR:-backups}" -type f -name 'elchi-marketplace-*.dump' | sort | tail -n 1)
fi
test -n "$backup"
test -s "$backup"
test -f "$backup.sha256"
sha256sum -c "$backup.sha256"

container="marketplace-restore-test-$$"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM

docker run -d --name "$container" -e POSTGRES_PASSWORD=restore_test -e POSTGRES_DB=restore_test postgres:16-alpine >/dev/null
until docker exec "$container" pg_isready -U postgres -d restore_test >/dev/null 2>&1; do sleep 1; done
docker cp "$backup" "$container:/tmp/backup.dump"
docker exec "$container" pg_restore -U postgres -d restore_test --no-owner --no-acl /tmp/backup.dump
docker exec "$container" psql -U postgres -d restore_test -Atqc "SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'" | grep -Eq '^[1-9][0-9]*$'
printf 'Restore testi muvaffaqiyatli: %s\n' "$backup"
