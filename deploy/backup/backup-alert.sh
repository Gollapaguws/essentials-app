#!/usr/bin/env bash
# Emails the administrator when essentials-backup.service fails. Wired through
# OnFailure= on the backup unit, so it also fires when systemd stops the job
# (timeout, OOM, missing passphrase) rather than only on a script error.
set -uo pipefail

CONF=${BACKUP_CONF:-/etc/essentials-backup.conf}
# shellcheck disable=SC1090
[ -f "$CONF" ] && . "$CONF"

TO=${ALERT_EMAIL:-admin@essentialsedm.com}
FROM=${ALERT_FROM:-root@essentialsedm.com}
HOST=$(hostname -f 2>/dev/null || hostname)
SUBJECT="ALERT: ESSENTIALS backup failed on $HOST"
LOG=$(journalctl -u essentials-backup.service -n 40 --no-pager 2>/dev/null || true)

if ! command -v sendmail >/dev/null; then
  logger -t essentials-backup-alert "sendmail missing; cannot alert $TO about the failed backup"
  exit 1
fi

{
  printf 'To: %s\n' "$TO"
  printf 'From: ESSENTIALS backups <%s>\n' "$FROM"
  printf 'Subject: %s\n' "$SUBJECT"
  printf 'Auto-Submitted: auto-generated\n'
  printf 'Content-Type: text/plain; charset=utf-8\n'
  printf '\n'
  printf 'The nightly IDrive backup did not finish successfully.\n\n'
  printf 'Host: %s\n' "$HOST"
  printf 'Time: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'Unit: essentials-backup.service\n\n'
  printf 'Last log lines:\n\n%s\n' "$LOG"
} | sendmail -i -f "$FROM" "$TO"

logger -t essentials-backup-alert "failure notice sent to $TO"
