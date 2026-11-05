# Authentication

Supabase Auth owns every session: it issues and rotates the tokens, sends the confirmation
and recovery mail, and stores the TOTP factors. This repo owns **authorization**: the Prisma `User`
row is the single source of truth for a role.

```
browser / app ──sign in──► Supabase Auth ──access token (RS256)──► NestJS API
                                  │                                     │
                                  │                              verify JWKS
                                  │                                     │
                             session in                          User.authUid -> Role
                             local/SecureStore                   (Prisma, 60 s cache)
```

No shared HMAC secret, no cookies, no RLS, and no user import: the API is bearer-only and
verifies tokens against `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`.

## Pieces

| Where | File | Role |
|---|---|---|
| shared | `packages/auth/index.ts` | one `createSupabaseClient` factory (PKCE, `detectSessionInUrl: false`) |
| shared | `packages/api-client/index.ts` | bearer token injected per request, exactly one 401 retry |
| api | `apps/api/src/auth/supabase-token.service.ts` | JWKS verification → `{ sub, email, role, aal }` |
| api | `apps/api/src/auth/supabase-auth.guard.ts` | MFA gate, DB role resolution, `req.user` |
| api | `apps/api/src/auth/auth-user.service.ts` | lazy-link `User.authUid` + 60 s role cache |
| api | `apps/api/src/auth/auth.controller.ts` | `/auth/me` |
| api | `apps/api/src/users/users.controller.ts` | admin-only account list + role change |
| web | `src/app/auth/callback`, `src/app/auth/mfa`, `src/app/dashboard/layout.tsx` | PKCE exchange, TOTP, guard |
| web | `src/app/dashboard/users` | admin: make a member a DJ, venue or promoter |
| site | `src/lib/{supabase,auth,AuthContext}.js`, `src/pages/AuthCallback.jsx` | same flow for visitors |
| mobile | `lib/supabase.ts`, `app/auth/{callback,mfa}.tsx` | deep link + SecureStore |

## Setup

### Local

```bash
supabase start                     # prints URL + anon + service_role keys
cp .env.example .env               # paste the keys
npm run db:migrate && npm run db:seed
npm run dev:api
npm run proof:auth                 # live check, see below
```

### Hosted

1. Create the project, then copy `Project URL`, `anon key` and `service_role key` into
   the server `.env` (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
   and the matching `NEXT_PUBLIC_*` / `VITE_*` / `EXPO_PUBLIC_*` variables into each app.
2. **Redirect URL allow-list** (Authentication → URL Configuration):
   - `https://<dashboard-host>/auth/callback`
   - `https://<site-host>/auth/callback`
   - `essentials://auth/callback`
   - `http://localhost:3000/auth/callback`, `http://localhost:5173/auth/callback` (dev)
3. **Email**: auth mail leaves through the VPS's own Postfix, the same MTA the API uses
   (`MAIL_PROVIDER=smtp`, `127.0.0.1:25`), with the DKIM key and PTR already in place for
   the domain. GoTrue runs in Docker, so set `[auth.email.smtp]` in the server-only
   `supabase/config.toml` to `host.docker.internal`, port 25, no user/password, sender
   `hello@essentialsedm.com`; Postfix permits the supabase bridge to relay
   (`mynetworks`) and skips STARTTLS for that CIDR only, because its certificate does not
   cover the docker hostname. Recovery links come from `GOTRUE_MAILER_URLPATHS_*`, which
   must be the public auth URL (`https://<site>/supabase/auth/v1/verify`) rather than
   `127.0.0.1:54321` — otherwise every emailed link redirects to the site root. This is
   *separate* from the app's own `MAIL_PROVIDER`/`RESEND_API_KEY`, which sends campaign and
   welcome mail through the API.
4. **Google**: enable the provider, add the Supabase callback
   `https://<project>.supabase.co/auth/v1/callback` to the Google console.
5. **Apple**: behind `AUTH_APPLE_ENABLED`; the site and mobile both call
   `signInWithOAuth({ provider: "apple" })` once enabled.
6. Move local → hosted is an env swap only; no code changes.

## Walkthrough: a stranger becomes a DJ

One account, end to end. The names are placeholders; every call shown is the real one, in
the order it happens.

### 1. Nandi signs herself up

There is no invite, no approval queue and no invite table: the doors create a Supabase
identity and stop there.

- **Site** — `/register` for email + password (linked from `/login`), or `/login` →
  CONTINUE WITH GOOGLE.
- **Mobile** — the welcome screen's email + password form or Google button (`signInWithPassword` /
  `signInWithOAuth`, both back to `essentials://auth/callback`).
- **Dashboard** — `/` takes an email and password, and nothing else: there is no one-time
  sign-in link. **Forgot password?** mails a Supabase recovery link that returns to
  `/auth/callback?type=recovery`, exchanges the code, and lands on
  `/auth/password?recovery=1` to choose a new one. Someone who never chose a password has it
  set by an admin instead, and `mustResetPassword` sends them to the same screen. The door is
  meant for staff, but nothing stops a stranger from signing in.

Supabase writes `auth.users`, sends the confirmation, and returns her to the app's
`/auth/callback`, where the **client** exchanges the PKCE code
(`supabase.auth.exchangeCodeForSession`) and the site drops her on `/`. That is the whole
of the "registered" state: a session, `role: "guest"`, no profile, no data.

### 2. Her first API call creates the Prisma row

Sign-up never touches the app database. The first authenticated request does, in
`SupabaseAuthGuard` → `AuthUserService.ensureUser`:

1. lookup by `User.authUid = sub` — hit, use that row;
2. otherwise lookup by lower-cased email — hit, bind `authUid` to it and **keep its role**
   (this is how seeded accounts and pre-Supabase users survive the cutover);
3. otherwise create `{ authUid, email, role: "guest" }`.

`GET /api/auth/me` is the cheapest trigger and the only endpoint she needs; it answers
`guest`. From this moment an admin can see her, even if she never opens the dashboard and
never sets a password.

### 3. Ayo, an admin, opens the Users page

`/dashboard/users` → `GET /api/users` (admin only). Every Prisma user is listed newest
first with email, name, role, whether they have signed in (`linked`), and any DJ stage name
or venue already attached. A `q` query filters on email or name — that is the search box.

Nandi's row reads **Guest**, `signed in · joined <date>`, and offers four buttons:
**DJ**, **VENUE**, **PROMOTER**, **GUEST**.

### 4. He makes her a DJ, with a stage name

He clicks **DJ**. Because a DJ needs a name, the button opens an inline field rather than
posting immediately (an existing stage name is pre-filled, so the same form doubles as the
fix-it form). He types `Nandi B` and hits SAVE:

```http
PATCH /api/users/<nandi>/role
{ "role": "artist", "stageName": "Nandi B" }
```

The service validates everything first, then writes in a fixed order:

1. `ArtistProfile.stageName` is upserted for her user id;
2. `User.role` becomes `artist` — only if it actually changed;
3. the guard's 60 s cache entry for her Supabase uid is dropped and an `AuthEvent`
   (`kind: "role_change"`, `from`/`to`) is recorded.

Profile-before-role is deliberate: a rejected name cannot leave a promoted user with no
profile. Nothing is re-issued to her — the old token is fine, because the role comes from
the database on every request.

### 5. What Nandi sees on her next tap

Her next API call resolves `artist`, which unlocks the artist surface: `/api/artists/profile`,
my-gigs, the day planner, the gig calendar, per-slot applications and invoice generation.
`artist` is *not* in the MFA set, so her existing `aal1` session keeps working — no TOTP
prompt, no sign-out.

If she was on `/dashboard` when the change happened, the role shown in the nav is stale only
until the next `/auth/me` (a page load or refresh).

### 6. The venue-manager variant

**VENUE** asks for a name and a capacity (required when the venue is created) plus an
optional address; the dashboard sends the same `PATCH /users/<id>/role` with
`role: "venue_manager"`, `venueName`, `venueCapacity`, `venueAddress`. The service creates a
`Venue` owned by that user (`managerId`), or updates the one they already own.

Coordinates can be left out here — the manager fills them in later in the venue portal, along
with **USE MY LOCATION**. Either way a coordinate change rebuilds the saved DJ route legs for
that venue, so distances between gigs stop being stale.

This role *is* MFA-gated. Her `aal1` token now gets `401 { "code": "MFA_REQUIRED" }` on every
data endpoint, and `/auth/me` answers `mfaRequired: true`, so the next sign-in (or the
`/auth/callback` exchange) drops her on `/auth/mfa` by itself: enroll TOTP, scan the QR,
verify once, refresh to `aal2`.

### 7. Correcting a mistake

Wrong stage name, wrong venue name, or a venue that turns out to belong to someone else:
**EDIT** on the row (or the role button again) reopens the form and posts

```http
PATCH /api/users/<id>/profile
{ "stageName": "Nandi B2" }
// or
{ "clearStageName": true }
// or
{ "venueName": "Basement", "venueCapacity": 220 }
// or
{ "clearVenue": true }
```

Clearing is explicit and never destructive by surprise: `clearStageName` deletes only the
`ArtistProfile`, and `clearVenue` detaches the venue (`managerId = null`) so its events,
tables and revenue history stay put. Demoting her with **GUEST** or **PROMOTER** leaves the
profile in place too, so a later re-promotion finds her stage name or venue already filled in.

### What the story pins down

- A role change needs no new login and no token exchange — Prisma is asked per request.
- The token's claim is never the answer; only the `User` row (or its 60 s cache) is.
- A failed profile write means no role change, and a role change means at most one
  `AuthEvent`.
- Admin actions add or detach; they never delete a venue or its history.

## Behaviour contract

### `GET /api/auth/me`

Clients route on this and never on the token claims: Supabase puts `authenticated` in the
top-level `role` claim, so the app role is read from the Prisma `User` row (60 s cache,
`null` never cached) with the `app_metadata.role` claim only as a fallback. The row is
created or linked on first call, so every account that signs in appears in the admin list.

### Roles

`guest | artist | promoter | venue_manager | admin`. Only an `admin` may change a role:
`PATCH /api/users/:id/role` with `{ "role": "artist" | "venue_manager" | "promoter" | "guest" }`.
The change is written to Prisma, the guard's cache entry for that identity is dropped, and
an `AuthEvent` (`kind: "role_change"`) is recorded. No client-supplied role is ever trusted.

The same request can carry the profile the role needs: `stageName` creates or updates the
`ArtistProfile` for a DJ, and `venueName` + `venueCapacity` (+ optional `venueAddress`,
`venueLat`, `venueLng`) creates a `Venue` owned by that manager. Both are optional, so a
plain role change still works, and the profile is written before the role so a rejected
request changes nothing.

### Identity mapping

`req.user.sub` is the Prisma `User.id` — the key every ownership check and foreign-key
write uses (`Event.promoterId`, `Venue.managerId`, `GuestList.userId`, `ArtistProfile.userId`).
The Supabase `auth.users.id` stays available as `req.user.authUid`, and is matched against
`User.authUid` on each request to resolve the row.

In the dashboard the three assignments read as **DJ** (`artist`), **Venue**
(`venue_manager`) and **Promoter** (`promoter`).

### MFA

`promoter`, `venue_manager` and `admin` must present an `aal2` session on every data
endpoint. An `aal1` token gets `401 { "code": "MFA_REQUIRED", "role": "<role>" }`.
`/auth/me` is the exception (`@SkipMfa`), otherwise a new privileged user could never
discover they need enrollment; it reports `mfaRequired: true` for exactly those roles while
the session is still `aal1`, which is what routes clients to `/auth/mfa`.

| Endpoint | Limit |
|---|---|
| all routes (throttler) | 120/min per client, Redis-backed |
| `GET /auth/me` | 30/min |

## Operational notes

- **Lazy-link ordering** — `authUid` → email match (binds `authUid`, keeps the existing
  role) → create as `guest`. Existing sessions therefore survive the cutover instead of
  being duplicated, and seeded demo accounts keep their roles on first sign-in.
- **Ghost Base44 users** — nothing imported accounts from Base44. Anyone without a Prisma
  row appears there on first sign-in.
- **Door passes** are signed with `QR_SECRET`, deliberately separate from any auth secret.

## Manual E2E checklist (run before deploying)

- [ ] Dashboard: email + password → `/auth/me` role gate → `/dashboard` (no email link offered).
- [ ] Dashboard: Forgot password? → recovery email → `/auth/password` → new password → `/dashboard`.
- [ ] Dashboard: promoter without TOTP is redirected to `/auth/mfa`, enrolls, lands on `/dashboard`.
- [ ] Dashboard: SIGN OUT returns to `/`, and `/dashboard` is no longer reachable.
- [ ] Site: password sign-in and Google sign-in both land on `/auth/callback`.
- [ ] Site: `/forgot-password` → email → `/reset-password` → new password works.
- [ ] Mobile: email + password signs in; Google opens `essentials://auth/callback`; after
      force-quit the session is still there.
- [ ] Mobile: staff account lands on `/auth/mfa`; guest never sees it.
- [ ] API: `GET /auth/me` without a token → 401; as a guest → 200 `guest`.
- [ ] Admin: `/dashboard/users` lists every sign-up; making one a DJ refreshes their role
      on the next request without re-issuing a token.
