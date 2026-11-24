# Email Deliverability — ESSENTIALS

Phase 1 sends via **Resend** behind the swappable `MailProvider` interface
(`apps/api/src/mail/mail-provider.interface.ts`). Phase 2 migrates to self-hosted
**listmonk** (campaigns/segments) + **Postal** (MTA) — implement a new
`MailProvider` (e.g. `ListmonkProvider`) and flip `MAIL_PROVIDER`.

## Personal mail via Bluehost

Bluehost cPanel mail is a **mailbox host, not a bulk sender**. Use it for
person-to-person and low-volume transactional mail, and keep newsletter/weekly
campaigns on Resend (or listmonk) — Bluehost applies per-mailbox sending limits and
an acceptable-use policy that bulk flows will trip.

Mailbox creation, passwords and forwarding stay in Bluehost's control panel; there
is no API for that. The dashboard's `/mailboxes` page manages the VPS's own
Dovecot mailboxes and is unrelated to Bluehost.

### SMTP settings

| | Bluehost cPanel mail | Bluehost Professional Email (Titan) |
|---|---|---|
| Host | `mail.<your-domain>` (or `<your-domain>`) | `smtp.titan.email` |
| Port | 465 SSL/TLS (or 587 STARTTLS) | 465 SSL/TLS |
| Username | full address, e.g. `hello@essentialsedm.com` | same |
| Password | that mailbox's password | same |
| Note | — | enable third-party app access first |

Point the app at it in `.env`:

```dotenv
MAIL_PROVIDER="smtp"
SMTP_HOST="mail.essentialsedm.com"
SMTP_PORT="465"
SMTP_SECURE="true"
SMTP_USER="hello@essentialsedm.com"
SMTP_PASS="…"
MAIL_FROM="ESSENTIALS <hello@essentialsedm.com>"
```

`MAIL_FROM` must be a mailbox Bluehost owns for the domain, otherwise the send is
rejected. `MAIL_PROVIDER` is global, so this routes **all** API mail through
Bluehost; if campaigns must stay on Resend, send them through a second deployment
or add per-flow provider routing before switching. The health check at
`GET /api/mail/status` follows `SMTP_HOST`/`SMTP_PORT` and probes 465 over TLS.

### DNS

If Bluehost also handles inbound personal mail, move the domain's **MX** records to
Bluehost and copy the **SPF** and **DKIM** values cPanel shows under *Email
Deliverability*. Keep a single SPF TXT record (no second `v=spf1`); if the domain's
MX stays elsewhere, add Bluehost's sending IPs to the existing SPF instead and
publish the DKIM keys cPanel provides. Stay within SPF's 10-DNS-lookup limit when
Resend is still in the record.

## DNS records (set at your DNS provider for `essentials.example`)

| Record | Host | Value |
|---|---|---|
| SPF (TXT) | `@` | `v=spf1 include:resend.dev ~all` (swap to your Postal SPF when migrating, e.g. `include:postal.essentials.example`) |
| DKIM (CNAME ×3) | per Resend domain setup | Provided in Resend dashboard → Domains → verify |
| DMARC (TXT) | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@essentials.example; adkim=s; aspf=s` |

After migration to Postal, regenerate DKIM keys in the Postal admin and update SPF.

## Compliance built into v1
- **Consent records**: `Consent` table (email channel, granted/revoked, source).
- **One-click unsubscribe**: every bulk email carries `List-Unsubscribe` headers via
  `unsubscribeUrl`; `GET /api/email/unsubscribe?token=…` revokes consent and logs an
  `unsubscribe` EmailEvent. Preference center at `GET /api/email/preferences?token=…`.
  The token is an HMAC (`base64url(email).expiry.signature`, 90 days) so a public
  link cannot unsubscribe an address it was not issued for. `EMAIL_UNSUBSCRIBE_SECRET`
  sets the key; when unset, a purpose-specific key is derived from `QR_SECRET`.
- **Suppression**: consent is checked at enqueue time *and* again inside the send worker.

## DNS records this server currently needs

Read this before changing anything: the VPS runs its own Postfix + Dovecot for the
platform mailboxes (`/home/<localpart>/Maildir`), but the domain's DNS still points
at the old Bluehost hosting. Two of those records block mail:

1. **Outbound is unauthenticated.** Gmail answers
   `550 5.7.26 … requires all senders to authenticate with either SPF or DKIM`
   because the host's IP is not in SPF and the DKIM key it signs with is not the
   one published in DNS.
2. **Inbound does not arrive.** MX points at Bluehost, which has no mailbox for
   these addresses, so external mail bounces before reaching Dovecot.

Until the records below are applied (DNS is managed at Bluehost — `ns1/ns2.bluehost.com`,
no API), outbound user and notification mail is relayed through **Resend**
(`RESEND_API_KEY` in `.env`), whose `essentialsedm.com` domain is verified.

### 1. DKIM — replace the stale record

Host `default._domainkey` (TXT). The current record holds a key that no longer
matches `/etc/opendkim/keys/essentialsedm.com/default.private`, so every signature
fails. Replace the value with this single string (it is the two quoted chunks of
`/etc/opendkim/keys/essentialsedm.com/default.txt`, concatenated):

```
v=DKIM1; h=sha256; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtD5rd3hd5Gtg2uZ23Kr7mHBcM1AxlLXY7Hgp/IhoSOjLCSeTEndFiWC2GPXZDnad9q8lGfBQWsYKPigFRu45ug+o/tfIbWlGp8xl8xirkESrQAViMyj/d7i96zGSo72g0q13z/jHn6FatjXRq8bed+N4WiWjWZ0VYzt2BqLcbtzK0in06VElvx2iFlHcBqb8O6FPYY/VFiXB2emeefpFcpi5OKbLUnuezVudWCFjZXEnfN9/9dqeRfw6aBsFXEWJSsbo7GwN99dTzTNU7q3l9/C0ofZbmido7PSyDw/chbzwo2JpL+Y9l0iYMMb5EyLhz+/0G92WTPFutmCxoq196wIDAQAB
```

Note `opendkim-testkey` reports `key OK` against the *local* key even when DNS is
stale; compare with `dig` before trusting it.

### 2. SPF — add this host's IP

Host `@` (TXT), current value `v=spf1 a mx include:websitewelcome.com ~all`. Keep
one SPF record and add the VPS:

```
v=spf1 a mx include:websitewelcome.com ip4:72.62.211.31 ~all
```

### 3. MX — point the domain at Dovecot (only if mailboxes live here)

| Host | Type | Current | Required |
|---|---|---|---|
| `mail.essentialsedm.com` | A | `162.241.218.139` (Bluehost) | `72.62.211.31` |
| `@` | MX | `0 mail.essentialsedm.com`, `10 essentialsedm.com` | `10 mail.essentialsedm.com` and drop the apex MX |

Also set the PTR (rDNS) for `72.62.211.31` to `mail.essentialsedm.com` at the hosting
provider, and keep `mail.essentialsedm.com` as Postfix's `myhostname`.

### DMARC

`_dmarc` is `v=DMARC1; p=none`, which is safe while records settle. Once DKIM and
SPF pass, move to `v=DMARC1; p=quarantine; rua=mailto:dmarc@essentialsedm.com`.

### Verifying

```bash
dig +short TXT default._domainkey.essentialsedm.com   # must equal the record above
dig +short TXT essentialsedm.com                      # must contain ip4:72.62.211.31
dig +short MX essentialsedm.com                       # must point at mail.essentialsedm.com
opendkim-testkey -d essentialsedm.com -s default -vvv # local key vs DNS
journalctl -u opendkim -n 20 --no-pager               # "DKIM-Signature field added"
tail -f /var/log/mail.log                             # delivery and rejections
```

For inbound, send from an outside account and then check
`doveadm search -u <localpart> mailbox INBOX ALL`.

## Flows
| Flow | Trigger |
|---|---|
| `welcome_series` | invite redemption (AuthService) |
| `weekly_drop` | "ESSENTIALS this week" — manual or scheduled sweep |
| `reminder_24h` / `reminder_1h` | `RemindersService` 10-min sweep before approved events |
| `winback` | segment of guests whose last visit > N weeks (create via Segments UI) |
