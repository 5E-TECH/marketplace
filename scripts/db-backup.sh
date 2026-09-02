#!/bin/sh
set -eu

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
timestamp=$(date -u +%Y%m%dT%H%M%SZ)
target="$BACKUP_DIR/elchi-marketplace-$timestamp.dump"

docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" exec -T postgres \
  pg_dump -U "${DB_USERNAME:?DB_USERNAME is required}" -d "${DB_NAME:?DB_NAME is required}" \
  --format=custom --no-owner --no-acl > "$target"

test -s "$target"
sha256sum "$target" > "$target.sha256"
find "$BACKUP_DIR" -type f -name 'elchi-marketplace-*.dump*' -mtime "+$KEEP_DAYS" -delete
printf 'Backup tayyor: %s\n' "$target"
