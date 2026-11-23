#!/usr/bin/env bash
# Off-site backup of the data that belongs in object storage:
#   - the ESSENTIALS Postgres database (pg_dump custom format)
#   - the phpList MariaDB database (newsletter subscribers)
#   - uploaded media (/var/www/essentialsedm/media)
#   - phpList campaign images (/opt/phplist/data/uploadimages)
#
# Everything is encrypted with a local passphrase before it leaves the host, then
# uploaded to IDrive e2 (S3-compatible) with rclone. Config lives in
# /etc/essentials-backup.conf; see deploy/backup/README.md.
set -euo pipefail
umask 077

APP_DIR=${APP_DIR:-/opt/essentials/app}
ENV_FILE=${ENV_FILE:-$APP_DIR/.env}
CONF=${BACKUP_CONF:-/etc/essentials-backup.conf}
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"

REMOTE=${IDRIVE_REMOTE:-idrive:essentials-backups}
RETENTION_DAYS=${RETENTION_DAYS:-30}
KEEP_LOCAL_DAYS=${KEEP_LOCAL_DAYS:-7}
WORK=${WORK_DIR:-/var/backups/essentials}
PASSFILE=${BACKUP_PASSPHRASE_FILE:-/root/.config/essentials/backup.passphrase}
PG_CONTAINER=${POSTGRES_CONTAINER:-essentials-postgres-1}
MEDIA_DIR=${MEDIA_DIR:-/var/www/essentialsedm/media}
PHPLIST_DIR=${PHPLIST_DIR:-/opt/phplist}

STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DIR="$WORK/$STAMP"
log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

[ -s "$PASSFILE" ] || {
  log "ERROR: missing backup passphrase at $PASSFILE (see deploy/backup/README.md)"
  exit 2
}

command -v rclone >/dev/null || { log "ERROR: rclone is not installed"; exit 2; }
command -v gpg >/dev/null || { log "ERROR: gpg is not installed"; exit 2; }

mkdir -p "$DIR"
log "backup $STAMP -> $REMOTE"

# --- databases ---------------------------------------------------------------
DB_URL=$(grep -m1 '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | sed 's/?.*$//')
if [ -n "$DB_URL" ]; then
  rest=${DB_URL#*://}
  creds=${rest%%@*}
  hostpart=${rest#*@}
  DB_USER=${creds%%:*}
  DB_PASS=${creds#*:}
  DB_NAME=${hostpart#*/}
  if docker inspect "$PG_CONTAINER" >/dev/null 2>&1; then
    docker exec -e PGPASSWORD="$DB_PASS" "$PG_CONTAINER" \
      pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner \
      > "$DIR/app-db.dump"
  else
    log "WARN: Postgres container $PG_CONTAINER not found; trying host pg_dump"
    PGPASSWORD="$DB_PASS" pg_dump -U "$DB_USER" -d "$DB_NAME" --format=custom --no-owner \
      > "$DIR/app-db.dump"
  fi
  log "app database: $(du -h "$DIR/app-db.dump" | cut -f1)"
else
  log "WARN: DATABASE_URL missing in $ENV_FILE; skipping app database"
fi

if [ -f "$PHPLIST_DIR/.env" ]; then
  PHP_PASS=$(grep -m1 '^PHPLIST_DATABASE_PASSWORD=' "$PHPLIST_DIR/.env" | cut -d= -f2-)
  if (cd "$PHPLIST_DIR" && docker compose exec -T db mariadb-dump -uphplist -p"$PHP_PASS" \
      --single-transaction phplist 2>/dev/null | gzip > "$DIR/phplist-db.sql.gz"); then
    log "phpList database: $(du -h "$DIR/phplist-db.sql.gz" | cut -f1)"
  else
    log "WARN: phpList database dump failed; continuing"
    rm -f "$DIR/phplist-db.sql.gz"
  fi
fi

# --- files -------------------------------------------------------------------
if [ -d "$MEDIA_DIR" ]; then
  tar -C "$(dirname "$MEDIA_DIR")" -czf "$DIR/media.tar.gz" "$(basename "$MEDIA_DIR")"
  log "media: $(du -h "$DIR/media.tar.gz" | cut -f1)"
fi

if [ -d "$PHPLIST_DIR/data/uploadimages" ]; then
  tar -C "$PHPLIST_DIR" -czf "$DIR/phplist-images.tar.gz" data/uploadimages
  log "phpList images: $(du -h "$DIR/phplist-images.tar.gz" | cut -f1)"
fi

# --- encrypt before upload ---------------------------------------------------
for file in "$DIR"/*; do
  gpg --batch --yes --symmetric --cipher-algo AES256 \
    --passphrase-file "$PASSFILE" --output "$file.gpg" "$file"
  rm -f "$file"
done
log "encrypted $(find "$DIR" -maxdepth 1 -name '*.gpg' | wc -l) files"

# --- upload ------------------------------------------------------------------
rclone mkdir "$REMOTE/$STAMP" --config "${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"
rclone copy "$DIR" "$REMOTE/$STAMP" --include '*.gpg' --stats-one-line \
  --config "${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"
rclone check "$DIR" "$REMOTE/$STAMP" --include '*.gpg' \
  --config "${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}"
log "uploaded to $REMOTE/$STAMP"

# --- retention ---------------------------------------------------------------
rclone delete "$REMOTE" --min-age "${RETENTION_DAYS}d" --rmdirs \
  --config "${RCLONE_CONFIG:-$HOME/.config/rclone/rclone.conf}" || log "WARN: remote retention failed"
find "$WORK" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_LOCAL_DAYS" -exec rm -rf {} + 2>/dev/null || true

log "backup complete"
