# Changelog

Notable changes to ESSENTIALS. Dates are UTC.

## 2026-11-08

### Security

- Closed a mass-assignment hole on event updates: clients can no longer write
  fields outside the whitelisted `UpdateEventDto` / `EventUpdateInput`.
- Escaped every user-supplied value interpolated into HTML — the invoice print
  view, email preferences/unsubscribe pages, mail templates and retention
  emails.
- Sandbox payment confirmation is now admin-only and refuses to run when
  `NODE_ENV=production`.
- Stripe and PayFast webhooks enforce a timestamp window, require non-empty
  secrets, verify the payload came from the matching provider, and return 400
  on malformed JSON.
- The Telegram webhook fails closed when its secret is unset and compares the
  header in constant time.
- CORS rejects non-allowlisted origins in production instead of reflecting
  them.
- Social publishing verifies the caller owns the post; venue decisions accept
  a strict boolean DTO.
- Media uploads are capped at 10 MB and must be a real image MIME type; mailbox
  passwords are validated before use.
- Removed the per-request session invalidation that turned every authenticated
  call into an extra database lookup.
- `.gitignore` now covers env files and backups, and the Google OAuth secret
  was removed from `supabase/config.toml.bak-smtp`.

### Changed

- Unsubscribe and email-preference links carry an HMAC-signed, expiring token.
  A bare `?email=` is rejected, so one person can no longer unsubscribe
  another. Links in mail that was already sent now read "invalid or has
  expired".
- The Google OAuth secret is stored in `.env` and referenced from
  `supabase/config.toml` as `env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)`.

### Added

- `npm run smoke` — post-deploy checks for health, the public lineup, auth,
  RBAC and door passes against a running stack, with `--read-only` for runs
  that must not write. It creates and removes a throwaway guest.
- The smoke run verifies the front page against the bookings table: every
  confirmed DJ is listed with their set time, and nothing cancelled appears.

### Fixed

- Front-page lineup no longer shows hand-curated entries whose event is gone,
  cancelled, or in the past, and no event can appear twice.
- Lineup cards link to the real event id instead of the curated entry's id.
- Confirmed DJs appear on the front-page lineup with their slot times, read at
  request time so a confirmation or cancellation shows up without re-saving the
  page.
