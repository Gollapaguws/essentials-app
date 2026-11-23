# Off-site backups on IDrive e2

`idrive-backup.sh` encrypts and uploads the data that suits object storage:

| Data | Why |
| --- | --- |
| Postgres custom-format dump | accounts, events, bookings, invoices |
| phpList MariaDB dump | newsletter subscribers and campaign history |
| `/var/www/essentialsedm/media` | profile and site images |
| phpList `uploadimages` | campaign artwork |

Each file is encrypted with `gpg --symmetric` (AES-256) before upload, so the
bucket never holds readable personal data. Backups land under
`idrive:essentials-backups/<UTC timestamp>/` and are removed after 30 days.

## One-time setup

1. In IDrive e2, create a bucket (for example `essentials-backups`) and an
   access key pair scoped to it.
2. Configure rclone (already installed):

```bash
rclone config
# n) new remote
# name) idrive
# storage) s3 → provider IDrive → endpoint s3.eu-west-4.idrivee2.com
# region) eu-west-4
# access_key_id / secret_access_key from IDrive
# edit advanced config) n
```

Verify with `rclone lsd idrive:` and `rclone mkdir idrive:essentials-backups`.

3. Create the encryption passphrase **once** and keep a copy off this server:

```bash
install -d -m 700 /root/.config/essentials
openssl rand -base64 32 > /root/.config/essentials/backup.passphrase
chmod 600 /root/.config/essentials/backup.passphrase
```

Without that passphrase the backups are unrecoverable — store it in the team
password manager, not only on the VPS.

4. Install the job:

```bash
install -m 755 deploy/backup/idrive-backup.sh /usr/local/sbin/essentials-idrive-backup
install -m 644 deploy/backup/essentials-backup.service /etc/systemd/system/
install -m 644 deploy/backup/essentials-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now essentials-backup.timer
```

Configuration overrides (`IDRIVE_REMOTE`, `RETENTION_DAYS`, …) go in
`/etc/essentials-backup.conf`; it is optional and read on every run.

## Verify and restore

```bash
systemctl start essentials-backup.service
journalctl -u essentials-backup.service -n 40
rclone lsf idrive:essentials-backups --recursive | tail
```

Restore the database into a scratch database first, then swap:

```bash
rclone copy idrive:essentials-backups/<stamp> /tmp/restore
gpg --decrypt --passphrase-file /root/.config/essentials/backup.passphrase \
  /tmp/restore/app-db.dump.gpg > /tmp/app-db.dump
docker exec -i essentials-postgres-1 pg_restore -U essentials -d essentials_restore \
  --no-owner < /tmp/app-db.dump
```

Media restores with `tar -xzf media.tar.gz -C /var/www/essentialsedm`.
