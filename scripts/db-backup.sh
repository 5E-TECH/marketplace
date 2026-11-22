#!/bin/sh
set -eu
umask 077

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.prod.yml}
ENV_FILE=${APP_ENV_FILE:-.env.production}
BACKUP_DIR=${BACKUP_DIR:-backups}
KEEP_DAYS=${BACKUP_KEEP_DAYS:-14}

test -f "$ENV_FILE"
case "$ENV_FILE" in
  /*|./*|../*) env_path=$ENV_FILE ;;
  *) env_path=./$ENV_FILE ;;
esac
set -a
. "$env_path"
set +a
mkdir -p "$BACKUP_DIR"
timestamp=$(date -u +%Y%m%dT%H%M%SZ)-$$
target="$BACKUP_DIR/elchi-marketplace-$timestamp.dump"

partial="$target.partial"
cleanup() { rm -f "$partial"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${DB_USERNAME:?DB_USERNAME is required}" -d "${DB_NAME:?DB_NAME is required}" \
  --format=custom --no-owner --no-acl > "$partial"

test -s "$partial"
mv "$partial" "$target"
sha256sum "$target" > "$target.sha256"
find "$BACKUP_DIR" -type f -name 'elchi-marketplace-*.dump*' -mtime "+$KEEP_DAYS" -delete
printf 'Backup tayyor: %s\n' "$target"

# BE-26 (T8 «Zaxira nusxa»: kunlik, O'zbekiston ichidagi boshqa serverga). BACKUP_REMOTE=user@host:/katalog,
# BACKUP_SSH_KEY — shu serverga kirish kaliti (faqat shu foydalanuvchi o'qiy oladigan fayl). Server kaliti
# known_hosts da bo'lishi shart (StrictHostKeyChecking=yes). Yuborilmasa yoki u yerda checksum mos kelmasa —
# skript xato kodi bilan tugaydi (cron ogohlantiradi).
if [ -z "${BACKUP_REMOTE:-}" ]; then
  printf 'OGOHLANTIRISH: BACKUP_REMOTE berilmagan — zaxira faqat shu serverda (T8 talabi bajarilmadi)\n' >&2
  if [ "${BACKUP_REMOTE_REQUIRED:-off}" = on ]; then exit 3; fi
  exit 0
fi
remote_host=${BACKUP_REMOTE%%:*}
remote_dir=${BACKUP_REMOTE#*:}
case "$remote_dir" in
  ''|"$BACKUP_REMOTE") printf 'BACKUP_REMOTE user@host:/katalog formatida bo‘lishi kerak\n' >&2; exit 2 ;;
esac
ssh_opts="-o BatchMode=yes -o StrictHostKeyChecking=yes"
if [ -n "${BACKUP_SSH_KEY:-}" ]; then ssh_opts="$ssh_opts -i $BACKUP_SSH_KEY"; fi
name=$(basename "$target")
# shellcheck disable=SC2086
scp $ssh_opts -q "$target" "$target.sha256" "$remote_host:$remote_dir/"
# u yerda ham butunligi tekshiriladi (checksum fayldagi yo'l mahalliy — nom bo'yicha solishtiriladi)
# shellcheck disable=SC2086
ssh $ssh_opts "$remote_host" "cd '$remote_dir' && sha256sum '$name' | cut -d' ' -f1" > "$target.remote"
if [ "$(cut -d' ' -f1 "$target.sha256")" != "$(cat "$target.remote")" ]; then
  rm -f "$target.remote"
  printf 'XATO: zaxira serverdagi nusxa checksum ga mos emas: %s\n' "$remote_host:$remote_dir/$name" >&2
  exit 4
fi
rm -f "$target.remote"
printf 'Tashqi zaxira tayyor: %s\n' "$remote_host:$remote_dir/$name"
