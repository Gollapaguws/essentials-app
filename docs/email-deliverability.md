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

## Flows
| Flow | Trigger |
|---|---|
| `welcome_series` | invite redemption (AuthService) |
| `weekly_drop` | "ESSENTIALS this week" — manual or scheduled sweep |
| `reminder_24h` / `reminder_1h` | `RemindersService` 10-min sweep before approved events |
| `winback` | segment of guests whose last visit > N weeks (create via Segments UI) |
