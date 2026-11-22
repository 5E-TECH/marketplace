#!/bin/sh
# BE-40 (TZ 1-bo'lim 3-qaror: elchimarket.uz yopiladi, ma'lumot ko'chirilmaydi): eski prod bazasini arxivlab,
# YANGI BO'SH BAZA ochish. Eski baza o'chirilmaydi (orqaga qaytish yo'li) — saqlash muddati EQ-13 da.
#
#   sh scripts/launch-fresh-db.sh <yangi_baza_nomi>           # nima qilinishini ko'rsatadi (hech narsa o'zgarmaydi)
#   sh scripts/launch-fresh-db.sh <yangi_baza_nomi> --apply   # bajaradi
#
# Keyin (qo'lda, docs/BE-40-ISHGA-TUSHIRISH.md): .env.production da DB_NAME=<yangi_baza_nomi>, JWT sirlari
# almashtiriladi, deploy — servislar ishga tushishda migratsiyalarni o'zi yurgizadi (DB_AUTO_MIGRATE), identity
# SEED_ADMIN_* bilan SUPERADMIN yaratadi.
set -eu

new_db=${1:-}
apply=${2:-}
COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
ENV_FILE=${APP_ENV_FILE:-.env.production}

case "$new_db" in
  ''|*[!a-z0-9_]*) printf 'Yangi baza nomi kerak (kichik lotin harf, raqam, _): sh scripts/launch-fresh-db.sh elchi_marketplace_v2 [--apply]\n' >&2; exit 2 ;;
esac
test -f "$ENV_FILE"
case "$ENV_FILE" in /*|./*|../*) env_path=$ENV_FILE ;; *) env_path=./$ENV_FILE ;; esac
set -a
. "$env_path"
set +a
old_db=${DB_NAME:?DB_NAME kerak}
user=${DB_USERNAME:?DB_USERNAME kerak}
if [ "$new_db" = "$old_db" ]; then
  printf 'Yangi baza nomi hozirgisi bilan bir xil (%s) — boshqa nom bering\n' "$old_db" >&2
  exit 2
fi
# T8: arxiv boshqa serverga — tashqi zaxirasiz davom etilmaydi
if [ -z "${BACKUP_REMOTE:-}" ]; then
  printf 'BACKUP_REMOTE berilmagan: eski baza arxivi boshqa serverga yuborilishi shart (BE-26)\n' >&2
  exit 3
fi

psql_q() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$user" -d postgres -v ON_ERROR_STOP=1 -tAc "$1"
}

exists=$(psql_q "SELECT 1 FROM pg_database WHERE datname = '$new_db'")
printf 'Hozirgi baza: %s\nYangi baza:   %s (%s)\nArxiv:        %s\n' \
  "$old_db" "$new_db" "$( [ "$exists" = 1 ] && echo 'bor — bo‘sh bo‘lishi shart' || echo 'yaratiladi')" "$BACKUP_REMOTE"

if [ "$apply" != --apply ]; then
  printf '\nHech narsa o‘zgarmadi. Bajarish uchun: sh scripts/launch-fresh-db.sh %s --apply\n' "$new_db"
  exit 0
fi

# 1. Eski bazaning arxivi — boshqa serverga, checksum bilan (db-backup.sh, BE-26)
BACKUP_REMOTE_REQUIRED=on sh scripts/db-backup.sh

# 2. Yangi bo'sh baza
if [ "$exists" = 1 ]; then
  tables=$(docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
    psql -U "$user" -d "$new_db" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema')")
  if [ "$tables" != 0 ]; then
    printf 'XATO: %s bazasida %s ta jadval bor — bo‘sh emas, to‘xtatildi\n' "$new_db" "$tables" >&2
    exit 4
  fi
else
  psql_q "CREATE DATABASE \"$new_db\" OWNER \"$user\""
fi

printf '\nTayyor: eski baza arxivlandi, %s yaratildi (bo‘sh).\nKeyingi qadamlar — docs/BE-40-ISHGA-TUSHIRISH.md («3. Yangi bazaga o‘tish»).\n' "$new_db"
