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
- Recovery links use PKCE end to end: the verifier sits in an httpOnly cookie
  scoped to `/api/auth` for one hour, Supabase receives only its SHA-256 hash,
  and the code is exchanged server-side. The browser is never handed a token to
  complete a reset.

### Changed

- The dashboard no longer stores Supabase tokens in `localStorage`. Sign-in,
  two-step verification, password changes and recovery links now go through the
  API, which keeps the tokens in a `DashboardSession` row (encrypted with
  `SESSION_SECRET`) and hands the browser a single httpOnly, Secure,
  SameSite=Lax cookie. Logout deletes the row, so a stolen cookie is revocable.
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
- Smoke also checks the dashboard session end to end: login returns an httpOnly
  cookie, `/auth/me` answers with it, and logout revokes it.
- Support chat (Jotform agent) on the public site and across the dashboard.
  On the dashboard the API signs the signed-in account's id with
  `JOTFORM_AGENT_SECRET` and returns only the HMAC, so the secret never reaches
  the browser or the bundle; signing out resets the widget to anonymous.
- **Account → Signed-in devices** lists every browser session on the account
  with when it signed in and whether it is two-step, and can revoke one without
  disturbing the others. Revoking the browser you are using signs it out.
- Expired dashboard sessions are pruned every night at 03:00. Until now a row
  was only removed when its cookie came back or the account signed in again, so
  an abandoned session kept encrypted tokens in the table indefinitely.
- `scripts/deploy-vps.sh` now runs `npm run smoke` as its last step and exits
  non-zero when any check fails, instead of ending on three `curl`s that only
  prove the pages respond.
- CI runs the API test suite (`npx jest`) on pull requests, alongside the
  existing typecheck, lint and web build.
- Smoke guards the recovery flow, in read-only runs too: a reset request from
  the dashboard's own origin must be accepted and must set the verifier cookie,
  a foreign origin must be refused, and the callback page must be served. It
  waits out the endpoint's 5/min throttle instead of reporting a false failure.

### Fixed

- Front-page lineup no longer shows hand-curated entries whose event is gone,
  cancelled, or in the past, and no event can appear twice.
- Lineup cards link to the real event id instead of the curated entry's id.
- Confirmed DJs appear on the front-page lineup with their slot times, read at
  request time so a confirmation or cancellation shows up without re-saving the
  page.
- Password recovery no longer fails with `400 Origin not allowed` when requested
  from the dashboard. The redirect allowlist trusted only `CORS_ORIGINS`, which
  lists the origins that call the API from elsewhere; the dashboard is served
  from `SITE_URL` and calls `/api` same-origin, so it never appeared there. Both
  are trusted now, and an unknown origin is still rejected.
