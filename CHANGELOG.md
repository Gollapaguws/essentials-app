# Changelog

Notable changes to ESSENTIALS. Dates are UTC.

## 2026-11-23

### Email systems removed

- **The API no longer sends marketing email or manages mailboxes.**
  Campaigns, segments, delivery jobs, consent records, newsletter signup,
  mailboxes, unsubscribe handling and the dashboard email screens are gone.
  Mailboxes and mail routing remain on the cPanel host, outside this app. One
  transactional path (security notices) is allowed — see below.
- A Prisma migration drops the email tables and campaign attribution, and a CI
  guard fails if other email providers, modules or endpoints are reintroduced.

### Newsletter engine

- **Newsletters run on phpList 3.7 at `newsletters.essentialsedm.com`.** Signup
  is double opt-in, and unsubscribe, bounce and campaign handling stay in
  phpList; the public site footer links to its subscribe page. The app keeps no
  copy of the audience.
- phpList relays through the host Postfix (SPF and DKIM apply), and bounces are
  read from the dedicated `bounce@essentialsedm.com` mailbox over IMAPS.

### User mailboxes

- **Admins can provision real `@essentialsedm.com` mailboxes from the Users
  page.** Each mailbox is separate from the sign-in email, gets a one-time
  password, and can be reset, disabled (IMAP/POP/SMTP AUTH locked) or deleted
  with its stored mail. The dashboard shows the mailbox address and its current
  disk usage.
- Provisioning runs validated system commands on the mail host and is gated by
  `MAILBOX_PROVISIONING=1`; a `UserMailbox` migration tracks ownership and every
  action writes an audit event. See `docs/mailbox-provisioning.md`.
- **Aliases and a domain catch-all.** A mailbox can carry up to five extra local
  parts, and one catch-all can route unknown `@essentialsedm.com` mail to a
  chosen mailbox. Both are generated into `/etc/postfix/virtual-mailboxes` and
  reloaded; the catch-all is off by default so unknown recipients still bounce.

### Transactional account mail

- **Security notices are emailed from `no-reply@essentialsedm.com`.** A new
  account, a role change, a sign-in reset and a two-step verification change
  now notify the address on the account through the local Postfix relay. This is
  separate from phpList: no campaigns, no audience and no unsubscribe link.
- Delivery is best-effort — a relay failure is logged and never fails the admin
  action. The CI guard permits `nodemailer` only in
  `apps/api/src/account-mail`.

### Privacy notice

- **`/privacy` no longer describes marketing email, newsletters or
  unsubscribe links.** It explains that SONUS sends service notifications
  through the dashboard and Telegram, keeps the POPIA/GDPR rights, and is now
  version `2026-11-23`. The registration copy was updated to match.

## 2026-11-16

### Door staff

- **A new `door` role for door ticket staff.** An admin can create or re-role an
  account to **Door staff** on the Users page. Door staff land on `/door` after
  signing in, see only Door, Notifications and Account in the nav, and are not
  subject to two-step verification.
- Door staff can read the guest list and check guests in by list entry — no QR
  scanner needed — and the check-in is written to the door log against their
  account. They cannot create events, change fees, or open promoter pages.
- The Night selector shows every approved, live or completed event rather than
  one promoter's catalogue, so a door team can work any night they are on.
- **Door shows the night at a glance:** On list, Inside (party sizes added up),
  Today's check-ins and Capacity, plus a Recent entries list of the last five
  guests in. The counters cover the whole night, not the current search.
- The Help section gains a door staff manual, and the support manual in
  `docs/chatbot-manual.md` documents the role.

### Webmail

- **Roundcube is now upstream 1.6.21**, which supports PHP 8.5 natively, so the
  local polyfill patch is gone. The tree lives at `/var/www/roundcube`, keeps the
  existing Debian SQLite database and `/webmail/` URL, and the nginx alias points
  at the new tree.
- **Dovecot 2.4 config fixes:** the username format uses 2.4 variable syntax and
  the inbox path is pinned to `%{home}/Maildir`, so per-user inbox autocreation
  no longer fails with a permission error.
- Webmail sign-in and inbox loading are verified end to end through nginx, IMAP
  and Postfix delivery.

## 2026-11-14

### Booking desk

- **An admin can cancel a confirmed slot.** DJ Applications now shows
  `CANCEL SLOT` on pending and confirmed rows for admin accounts. Cancelling
  frees the slot, reopens it to the other applicants, and tells the DJ, the
  promoter and anyone still waiting on that slot. A completed gig is refused
  because it is already payable, and cancelling twice sends no duplicate
  notices.
- The DJ still withdraws their own pending application, and the promoter still
  declines, moves or extends bookings. The admin cancel is the override for the
  case neither side can resolve after a slot is confirmed.

### Email

- **Bulk mail now includes a plain-text alternative and one-click unsubscribe
  headers.** Campaigns, taste-match and post-event retention mail, and the
  What's new announcement all go through the same bulk-mail preparation: one
  HTML wrapper, a readable `text/plain` version generated from the final HTML,
  and RFC 8058 `List-Unsubscribe` / `List-Unsubscribe-Post` headers. SMTP and
  Resend send both parts; Listmonk receives the text body as well.
- **The mail server now identifies itself as `mail.essentialsedm.com`.** Postfix
  previously advertised a Tailscale hostname that did not match the public
  sending IP. The HELO now matches the existing PTR record; the missing
  `mail.essentialsedm.com` A record is still required for forward-confirmed
  reverse DNS.

### Privacy and marketing

- **The public privacy notice is now a full POPIA/GDPR notice.** `/privacy`
  names the responsible party and Information Officer contact, explains what is
  collected and why, the lawful bases, sharing and cross-border safeguards,
  retention, security, children, PAIA requests and the Information Regulator
  complaint route. It also covers the CPA/ECTA opt-in rule for electronic
  marketing and the additional GDPR/UK GDPR rights where they apply.
- **Newsletter consent is separate and explicit.** The footer now has an
  unticked consent box linked to the notice, and `POST /api/site/subscribe`
  refuses an address without `consent: true`. Consent rows record the policy
  version, source and grant/revocation times; later notice changes do not
  silently re-opt anyone in.
- **Mailing-list imports require an opt-in attestation.** A promoter must
  confirm every contact opted in before uploading a list. The attestation, policy
  version and import time are stored with the segment and new consent rows;
  addresses that already unsubscribed stay unsubscribed.
- **Signed-in people can download their own data.** The privacy page calls the
  existing `GET /api/site/my-data` export and downloads a JSON file with account,
  event, consent, referral, artist, booking and invoice records. Correction,
  deletion and objection requests remain available at
  `privacy@essentialsedm.com`.
- The compliance map and the remaining operational gaps (operator agreements,
  PAIA manual, retention automation, deletion queue, DPIA and breach runbook)
  are in `docs/privacy-compliance.md`.

### Control room

- **The console has a permanent control-room rail.** The old top tab strip is
  gone. Analytics, events, applications, the gig calendar, artists and
  settlements sit under Night Ops; campaigns and guest tools under Audience; DJ
  tools under Stage; account and platform tools in their own groups. The rail
  keeps the active page in view, carries search and the signed-in role, and
  becomes a drawer on small screens.
- **The core screens share one page language.** DJ Applications, Analytics,
  Events, Artists, Settlements, Gig Calendar and Email now use the same page
  frame, headings, panels, badges and empty states. Tables and headings across
  the rest of the console inherit the same treatment, so a screen no longer
  looks like a separate product.

## 2026-11-12

### Front page

- **A confirmed event puts itself on the lineup.** `GET /api/site/content` now
  merges every `approved`/`live` event with a future date into the curated
  lineup, so confirming a night in the dashboard is enough for it to appear on
  essentialsedm.com — no front-page edit. Curated entries keep their wording
  and order; dates, doors, status and city (the venue address tail, postal code
  dropped) come from the event, in `Africa/Johannesburg` time. The scheduled
  drop still hides the whole lineup until its publish time, and an event listed
  twice is shown once.
- **Confirmed DJs appear on the card.** The front-page lineup card and the
  `/events` page now list each `confirmed` booking with the artist's stage name
  and slot label. Both read bookings at request time, so a confirmation or
  cancellation shows on the next page load.
- Public events now carry an `artists` array alongside the planned `lineup`
  JSON, so a guest sees who is actually confirmed, not who was proposed.

### What's new page

- `/whats-new` on the public site shows the release notes themselves. The page
  has no copy of its own to keep up to date: `GET /api/site/changelog` parses
  `CHANGELOG.md` on request — dated `##` headings become releases, `###` become
  sections, bullets become items — and re-reads the file whenever it changes, so
  a deploy of the changelog is enough. The three newest releases are shown.
- The page is members only: signed-out visitors are sent to `/login`, and a
  `guest` account sees a members-only notice instead of the notes. The menu
  entry is hidden for both; the guard reads the canonical role from
  `/api/auth/me`.
- **A new release is mailed to members once.** Every role except `guest` gets
  the notes, minus anyone whose email consent is revoked, with the usual signed
  unsubscribe link. `WhatsNewBroadcast` records the release date, so a restart,
  a redeploy or a second instance cannot send the same notes twice; editing an
  existing release sends nothing. The 2026-11-12 release shipped with this
  feature and is recorded as already announced.
- The Help manuals (DJ, promoter, venue manager, admin) and
  `docs/chatbot-manual.md` gained a What's new section, plus the fact that an
  approved future event now adds itself to the front-page lineup.

### Live stream

- Ingest lowered to 640×360 at 25 fps and 600 kbps video (max 750k), with 1 s
  keyframes so MediaMTX cuts 1 s HLS segments instead of 2 s ones.
- Browser capture uploads at 800 kbps instead of 2 Mbps, which leaves headroom
  on a phone uplink.
- **Playback was the choppiness, not the bitrate.** The player sat 6 segments
  (12 s) behind live on a 7-segment window and chased the edge at 1.2× speed.
  It now sits 3 segments behind at 1×, with a 6-segment ceiling. Measured on the
  live front page: 0 dropped frames and 0 stalls over 60 s, buffer steady at
  2.7–3.9 s.

### Fixes

- **A promoter could not see their DJ applications.** A promoter account that
  support had exempted from two-step verification was told by `/api/auth/me`
  that no second factor was needed, so the dashboard let them in — but every
  route written `@Auth("promoter", "admin")` counted as an *admin* route and
  answered `401 MFA_REQUIRED`, because the exemption was skipped whenever
  `admin` appeared in the role list. That silently emptied DJ Applications (and
  the promoter's events, venues and analytics). Only an admin-**only** route now
  overrides the exemption, which is what it was meant to protect: account
  administration.
- **Sign-in loop.** The site's auth callback depended on the object returned by
  `useSearchParams()`, which is new on every render, so the code exchange and
  `/api/auth/me` re-ran after each error state — 4 requests a second until the
  API rate-limited the browser, which the page then reported as "your account
  could not be loaded". The effect now keys on the parsed strings and runs once
  per link; the dashboard callback had the same defect and the same guard.
- **Blank `/dashboard`.** The legacy `/dashboard/dashboard/*` redirect matched
  the bare `/dashboard` URL and answered with an empty `Location`, so the
  browser looped between `/dashboard` and `/dashboard/` with no HTML. The rule
  now requires at least one segment, and old doubled links still redirect to
  their flattened URL.

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
- The support agent is told who it is helping: on the dashboard the API returns
  the account's role and live counts (a DJ's upcoming gigs, applications and
  unpaid invoices; a promoter's events and applications to decide; a venue
  manager's rooms and pending approvals). `docs/chatbot-manual.md` is the
  knowledge base it answers from.
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
- Signing in on the public site — with Google or with a password — now opens the
  dashboard instead of asking for a second sign-in. The site hands its Supabase
  session to the API, which verifies the token and sets the dashboard's own
  HttpOnly cookie; before this, only the dashboard login ever created one.
- Password recovery no longer fails with `400 Origin not allowed` when requested
  from the dashboard. The redirect allowlist trusted only `CORS_ORIGINS`, which
  lists the origins that call the API from elsewhere; the dashboard is served
  from `SITE_URL` and calls `/api` same-origin, so it never appeared there. Both
  are trusted now, and an unknown origin is still rejected.
