# Authentication

Supabase Auth owns every session: it issues and rotates the tokens, sends the sign-in
mail, and stores the TOTP factors. This repo owns **authorization**: the Prisma `User`
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
3. **Email**: point Supabase's SMTP at Resend. This is *separate* from the app's own
   `MAIL_PROVIDER`/`RESEND_API_KEY`, which sends campaign and welcome mail through the API.
4. **Google**: enable the provider, add the Supabase callback
   `https://<project>.supabase.co/auth/v1/callback` to the Google console.
5. **Apple**: behind `AUTH_APPLE_ENABLED`; the site and mobile both call
   `signInWithOAuth({ provider: "apple" })` once enabled.
6. Move local → hosted is an env swap only; no code changes.

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
discover they need enrollment.

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

- [ ] Dashboard: email link → `/auth/callback` → `/dashboard`.
- [ ] Dashboard: promoter without TOTP is redirected to `/auth/mfa`, enrolls, lands on `/dashboard`.
- [ ] Dashboard: SIGN OUT returns to `/`, and `/dashboard` is no longer reachable.
- [ ] Site: password sign-in and Google sign-in both land on `/auth/callback`.
- [ ] Site: `/forgot-password` → email → `/reset-password` → new password works.
- [ ] Mobile: link opens `essentials://auth/callback`; after force-quit the session is still there.
- [ ] Mobile: staff account lands on `/auth/mfa`; guest never sees it.
- [ ] API: `GET /auth/me` without a token → 401; as a guest → 200 `guest`.
- [ ] Admin: `/dashboard/users` lists every sign-up; making one a DJ refreshes their role
      on the next request without re-issuing a token.
