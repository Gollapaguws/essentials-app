# Email Deliverability — ESSENTIALS

Phase 1 sends via **Resend** behind the swappable `MailProvider` interface
(`apps/api/src/mail/mail-provider.interface.ts`). Phase 2 migrates to self-hosted
**listmonk** (campaigns/segments) + **Postal** (MTA) — implement a new
`MailProvider` (e.g. `ListmonkProvider`) and flip `MAIL_PROVIDER`.

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
  `unsubscribeUrl`; `GET /api/email/unsubscribe?email=…` revokes consent and logs an
  `unsubscribe` EmailEvent. Preference center at `GET /api/email/preferences`.
- **Suppression**: consent is checked at enqueue time *and* again inside the send worker.

## Flows
| Flow | Trigger |
|---|---|
| `welcome_series` | invite redemption (AuthService) |
| `weekly_drop` | "ESSENTIALS this week" — manual or scheduled sweep |
| `reminder_24h` / `reminder_1h` | `RemindersService` 10-min sweep before approved events |
| `winback` | segment of guests whose last visit > N weeks (create via Segments UI) |
