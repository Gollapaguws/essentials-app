# phpList deployment — newsletters.essentialsedm.com

phpList 3.7.0 is the newsletter engine for the app. It owns signup (double
opt-in), lists, unsubscribe handling and campaign sending; the app links to its
subscribe page instead of keeping a copy of the audience.

## Layout on the VPS

| What | Where |
| --- | --- |
| Compose stack, `.env`, data | `/opt/phplist` |
| phpList admin | `https://newsletters.essentialsedm.com/lists/admin/` |
| Public subscribe page | `https://newsletters.essentialsedm.com/lists/?p=subscribe` |
| Container | `phplist-phplist-1` on `127.0.0.1:8092` (loopback only) |
| Database | `phplist-db-1` (MariaDB 11, volume `./data/db`) |
| nginx vhost | `nginx-newsletters.conf` (listens 8443; 443 is the stream TLS router) |
| Mail relay | `postfix-relay.cf` (host Postfix, network `172.16.9.0/24`) |
| Bounce mailbox | `bounce@essentialsedm.com` (Dovecot account, `/home/bounce/Maildir`) |

## First install

```bash
install -d /opt/phplist/data
cp deploy/phplist/{docker-compose.yml,config.php} /opt/phplist/
cp deploy/phplist/.env.example /opt/phplist/.env
# Fill in the five secrets, then:
cd /opt/phplist
openssl rand -hex 32   # PHPLIST_SECRET
openssl rand -hex 16   # PHPLIST_DATABASE_PASSWORD
openssl rand -hex 16   # PHPLIST_DATABASE_ROOT_PASSWORD
openssl rand -base64 18 # ADMIN_PASSWORD (never commit this one)
docker compose up -d
docker compose logs -f phplist   # wait for "phpList ... READY"
```

The initial admin is login `admin` with `ADMIN_PASSWORD`; the address in
`ADMIN_EMAIL` becomes the campaign From address. Those env vars are only read on
the first boot, when the schema and admin row are created.

## Mail

Copy the block from `postfix-relay.cf` into `/etc/postfix/master.cf`, then:

```bash
postfix check && systemctl reload postfix
```

phpList's own cron (inside the container) runs `-pprocessqueue` every minute, so
a campaign starts sending as soon as it is submitted. Its second cron entry runs
`-pprocessbounces` daily at 03:00.

### Bounce mailbox

Bounces go to the envelope address `bounce@essentialsedm.com`, which must be a
real mailbox — not an alias — because phpList logs in over IMAPS to read it.
Create it once on the mail host:

```bash
useradd -m -U -s /usr/sbin/nologin -c "phpList bounce mailbox" bounce
echo "bounce:$PW" | chpasswd
install -d -o bounce -g bounce -m 700 /home/bounce/Maildir{,/{cur,new,tmp}}
sed -i '/^bounce:/d' /etc/aliases && newaliases
doveadm auth test bounce@essentialsedm.com "$PW"
```

Put `$PW` in `/opt/phplist/.env` as `PHPLIST_BOUNCE_IMAP_PASSWORD` and recreate
the container. `config.php` polls `mail.essentialsedm.com:993/imap/ssl` and
purges messages after processing. Compose pins that hostname to `172.16.9.1`
(`extra_hosts`) because the VPS's `/etc/hosts` resolves it to `127.0.1.1`; the
certificate still validates against the real name. Run it by hand with:

```bash
docker compose exec phplist phplist -pprocessbounces
```

Bounces are stored under **System → View bounces** and increase each user's
`bouncecount`; `$bounce_unsubscribe_threshold` (default 5) marks repeat
offenders unconfirmed.

## Public hostname and TLS

1. Add a DNS `A` record for `newsletters.essentialsedm.com` → `72.62.211.31` at
   the domain's DNS provider (Bluehost). **This is the one step that cannot be
   done from the VPS** — the Cloudflare token on this host has no access to the
   `essentialsedm.com` zone.
2. Port 443 on this host is a stream-level TLS router
   (`/etc/nginx/stream-conf.d/essentials.conf`) that forwards to
   `127.0.0.1:8443`, so the vhost listens on **8443**, like every other HTTPS
   site here.
3. Issue the certificate with a temporary HTTP block, then install the vhost:

```bash
mkdir -p /var/www/letsencrypt
# HTTP-only server_name block serving /.well-known/acme-challenge from that root
certbot certonly --webroot -w /var/www/letsencrypt \
  -d newsletters.essentialsedm.com
ln -sf /etc/nginx/sites-available/newsletters.essentialsedm.com \
  /etc/nginx/sites-enabled/newsletters.essentialsedm.com
nginx -t && systemctl reload nginx
```

Until the certificate exists the TLS block will not load (nginx rejects missing
certificate files), so install `nginx-newsletters.conf` only after `certbot
certonly` succeeds. Certbot's renewal task renews this certificate automatically.

## Verify

```bash
curl -sI http://127.0.0.1:8092/lists/ | head -1             # 200 from phpList
curl -sI https://newsletters.essentialsedm.com/lists/ | head -1  # 200 via nginx
curl -sI http://newsletters.essentialsedm.com/lists/ | head -1   # 301 to https
docker compose exec phplist phplist -pprocessbounces         # no connection errors
```

Then in the admin: **Config → Settings** should show `newsletters@essentialsedm.com`
as the From address and **System → Send a test message** should arrive signed by
the domain's DKIM key.

## Upgrades

```bash
cd /opt/phplist
docker compose pull
docker compose up -d
```

The schema upgrade pages are at `/lists/admin/?page=upgrade` after a pull; the
data volume keeps subscribers, lists and campaigns across container recreation.
