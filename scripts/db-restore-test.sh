#!/bin/sh
set -eu

ready_attempts=${RESTORE_READY_ATTEMPTS:-60}
case "$ready_attempts" in
  ''|*[!0-9]*|0) printf 'RESTORE_READY_ATTEMPTS musbat butun son bo‘lishi kerak\n' >&2; exit 1 ;;
esac

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
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker run -d --name "$container" -e POSTGRES_PASSWORD=restore_test -e POSTGRES_DB=restore_test postgres:16-alpine >/dev/null
attempt=0
until docker exec "$container" pg_isready -U postgres -d restore_test >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge "$ready_attempts" ]; then
    printf 'Restore PostgreSQL tayyor bo‘lmadi\n' >&2
    exit 1
  fi
  sleep 1
done
docker cp "$backup" "$container:/tmp/backup.dump"
docker exec "$container" pg_restore --exit-on-error -U postgres -d restore_test --no-owner --no-acl /tmp/backup.dump
# A blank database already has the public schema; count(*) on schemas is not proof.
docker exec "$container" psql -U postgres -d restore_test -v ON_ERROR_STOP=1 -Atqc '
  SELECT count(*) FROM identity.users;
  SELECT count(*) FROM catalog.shop;
  SELECT count(*) FROM catalog.product;
  SELECT count(*) FROM checkout.sales_order;
  SELECT count(*) FROM payment.payment;
  SELECT count(*) FROM finance.payout;
' >/dev/null
printf 'Restore testi muvaffaqiyatli: %s\n' "$backup"
