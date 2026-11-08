# Release notes — week of 2 November 2026

Shipped 2–8 November 2026 (119 commits). Follows *Release notes — settlements,
slot queues and DJ tools*; anything from that note is not repeated here.

## The three things to know

1. **The dashboard no longer keeps tokens in the browser.** Signing in, two-step
   verification, password changes and recovery links all go through the API,
   which hands the browser a single opaque cookie.
2. **The API had a security pass.** Mass assignment, HTML injection, webhook
   verification and a session-fixation path are closed.
3. **Deployments now check themselves.** `npm run smoke` runs 22 checks against
   the live stack, and the front-page lineup is one of them.

## Dashboard sessions

- Supabase tokens moved out of `localStorage` into a `DashboardSession` row,
  encrypted with AES-256-GCM using `SESSION_SECRET`. The browser holds one
  `ess_dash` cookie: opaque, httpOnly, Secure in production, SameSite=Lax, 30
  days. Only its SHA-256 is stored, so the table alone cannot be replayed.
- **Logout revokes.** The row is deleted, so a copied cookie stops working
  immediately instead of living until the Supabase token expires.
- Access tokens are refreshed in the background by the API — one refresh even if
  several requests arrive at once — so a long session does not fall over
  mid-action.
- **Roles and MFA come from our database, not the token.** Promoters, venue
  managers and admins need an aal2 session; a stale token cannot grant a role
  the account no longer has.
- **Recovery links are PKCE and never expose a token to the browser.** The
  verifier sits in an httpOnly cookie scoped to `/api/auth` for one hour,
  Supabase receives only its hash, and the code is exchanged server-side.

## For DJs

- **Phone sign-in** with email + password (Google still works); the one-time
  email link is gone from both web and mobile, so there is one predictable door.
- **DJ tab on mobile**: open slots with fees and applicant counts, your gigs and
  their invoice state, what you are still owed.
- **Telegram from the app**: link the account from the account tab and gig
  alerts arrive there instead of only in a browser.
- **Earnings page**: every promoter-confirmed gig split into not yet invoiced,
  invoiced and waiting, and paid, with totals and a **Remind venue** button on
  anything unpaid.
- **Calendar export**: confirmed and played gigs as `.ics`, for any calendar app.
- **Blackout dates**: days you cannot play; applications for those slots are
  refused with the day and reason.
- **Profile**: bio, and a photo uploaded from your device (5 MB limit,
  real-image check).
- **Set times on the front page**: when a promoter confirms you, your name and
  slot time appear on the public lineup without anyone re-saving the page.

## For promoters

- **Venues are yours to create.** Adding a venue makes you its manager; a venue
  you manage approves your own events, so the DJ call and lineup post still go
  out without a second person clicking.
- **Private notes on DJs** — only you see them, they follow the DJ to every
  future application, they can be written inline while deciding, and they are
  flagged once older than three months.
- **Decide against a record, not an email**: an applicant's name opens their
  profile and full booking history, cancelled gigs included.
- **Slots, fees and budget**: a fee per hour, a slot count and length, per-slot
  headline fees, and a budget that now *refuses* a confirmation that would pass
  it (409) instead of only warning.
- **Settlements**: fees agreed, invoiced, paid and outstanding per night, with
  each gig's invoice number and state, plus per-night margin.
- **Exports**: spend CSV per event and guest CSV downloads, which were broken
  before.
- **Clone and repeat**: cloning carries the slot plan, hourly fee and budget;
  repeat weekly turns a night into up to 12 drafts.
- **Cancel vs delete**: cancel keeps the guest list, door scans and bookings and
  can be reopened; delete removes a mistaken event and its dependants.
- **Door mode**: check guests in by name at the door.

## For admins

- **Audit page**: sign-ins, linked accounts, role changes, MFA enrolment and
  escalation, with account, IP and detail.
- **Travel rate setting**: R4.95/km platform-wide, editable on a Settings page;
  it will not accept R0.00, which used to zero every DJ's travel pay.
- **Test notification**: pick any DJ and send through the real delivery path
  (bell, email, Telegram), with a report of what each channel reached.
- **Provision accounts**: create a Supabase identity with a temporary password
  and a role, returned once, with the must-reset flag set.

## Security

- **Mass assignment** on event updates closed: clients cannot write fields
  outside the whitelisted DTO.
- **HTML injection** closed across the invoice print view, email preferences and
  unsubscribe pages, mail templates and retention emails.
- **Webhooks**: Stripe and PayFast enforce a timestamp window, refuse missing
  secrets, check the payload came from the matching provider and reject
  malformed JSON; the Telegram webhook fails closed when its secret is unset and
  compares it in constant time.
- **Unsubscribe links are signed and expiring.** A bare `?email=` is refused, so
  nobody can unsubscribe someone else. Links in mail that was already sent now
  read "invalid or has expired".
- **Session fixation**: the auth guard invalidates any cached session for a user
  when a new token arrives, so a victim cannot be pinned to an attacker's
  session.
- **Sandbox payments** are admin-only and refuse to run in production; social
  publishing checks the caller owns the post; uploads are capped at 10 MB and
  must be a real image type.
- The Google OAuth secret now comes from `.env` via `env()` instead of sitting
  in a `config.toml` backup.

## Platform and operations

- **`npm run smoke`** — 22 checks against a running stack: health, the public
  lineup compared with the bookings table, the cookie session end to end, the
  recovery link's origin, RBAC and door passes. `--read-only` skips the writes.
- **Smoke is a deploy gate for recovery.** A reset request from the dashboard's
  own origin must be accepted (it calls `/api` same-origin, so it is not in
  `CORS_ORIGINS`), a foreign origin must be refused, and the callback page must
  be served. This is the bug that shipped quietly: every reset from the
  dashboard was answered `400 Origin not allowed`.
- **Dashboard URLs flattened**: pages serve at `/dashboard/venue` instead of
  `/dashboard/dashboard/venue`; old doubled URLs redirect, so bookmarks and
  notification links already sent still work.
- **Mail relay warning**: the sign-in screen probes the local SMTP relay (real
  handshake, 30s cache) and warns staff when it is down, instead of failing
  after someone clicks Forgot password.
- **Auth mail** now relays through the host's own Postfix; the docs previously
  described a Resend setup that was not what production runs.
- **Deploy script** exports the build-time Supabase values that `next build`
  inlines, and builds the shared API client before web so typecheck is not done
  against a stale copy.
- Changelog entries now live in `CHANGELOG.md` at the repo root.

## Worth knowing

- **Table bookings are gone** from the product.
- **Email + password is the only staff door**; the one-time email link was
  removed from the dashboard and the mobile welcome screen.
- **Recovery mail goes to real addresses** through Postfix. A used or expired
  link lands on the reset screen's expired state with a fresh-link route rather
  than a dead end.
- **Database**: one migration this week, `20261108090000_dashboard_sessions`,
  which adds the `DashboardSession` table. Deploys run `prisma migrate deploy`.
- **Not verified:** the click-through of a live recovery email. There is no test
  inbox on this host, so everything around that click is covered — link target,
  verifier cookie, exchange, expiry and error paths — but the click itself was
  checked by hand and not automated.
- **Test coverage**: the API suite is 33 suites / 229 tests, with new specs for
  dashboard sessions (opaque hashed id, encrypted tokens, cookie flags, refresh
  single-flight, PKCE binding, aal2) and the cookie-aware guard (bearer
  preferred, Prisma role wins, MFA gate).
