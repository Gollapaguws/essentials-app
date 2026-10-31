# Authentication

Supabase Auth owns every session: it issues and rotates the tokens, sends the sign-in
mail, and stores the TOTP factors. This repo owns **authorization**: the Prisma `User`
row is the single source of truth for a role.

```
browser / app ──sign in──► Supabase Auth ──access token (RS256)──► NestJS API
                                  │                                     │
                                  │                              verify JWKS
                                  │                                     │
                             session in                          User.authUid → Role
                             local/SecureStore                    (claim first, DB fallback)
```

No shared HMAC secret, no cookies, no RLS, and no user import: the API is bearer-only and
verifies tokens against `{SUPABASE_URL}/auth/v1/.well-known/jwks.json`.

## Pieces

| Where | File | Role |
|---|---|---|
| shared | `packages/auth/index.ts` | one `createSupabaseClient` factory (PKCE, `detectSessionInUrl: false`) |
| shared | `packages/api-client/index.ts` | bearer token injected per request, exactly one 401 retry |
| api | `apps/api/src/auth/supabase-token.service.ts` | JWKS verification → `{ sub, email, role, aal }` |
| api | `apps/api/src/auth/supabase-auth.guard.ts` | MFA gate, role resolution, `req.user` |
| api | `apps/api/src/auth/auth-user.service.ts` | lazy-link + 60 s role cache |
| api | `apps/api/src/auth/auth.controller.ts` | `/auth/me`, `/auth/session-established`, `/auth/invite/redeem` |
| web | `src/app/auth/callback`, `src/app/auth/mfa`, `src/app/dashboard/layout.tsx` | PKCE exchange, TOTP, guard |
| site | `src/lib/{supabase,auth,AuthContext}.js`, `src/pages/AuthCallback.jsx`, `Join.jsx` | same flow for visitors |
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

```jsonc
{ "user": { "sub": "...", "email": "...", "role": "promoter", "aal": "aal1" }, "mfaRequired": true }
{ "inviteRequired": true, "email": "..." }   // signed in, no Prisma user yet
```

Clients route on this and never on the token claims: Supabase puts `authenticated` in the
top-level `role` claim, so the app role is read from `app_metadata.role` and, if that is
absent, from the database (60 s cache, `null` never cached).

### MFA

`promoter`, `venue_manager` and `admin` must present an `aal2` session on every data
endpoint. An `aal1` token gets `401 { "code": "MFA_REQUIRED", "role": "<role>" }`.
`/auth/me`, `/auth/session-established` and `/auth/invite/redeem` are the exceptions
(`@SkipMfa`), otherwise a new privileged user could never discover they need enrollment.

### Rate limits

| Endpoint | Limit |
|---|---|
| all routes (throttler) | 120/min per client, Redis-backed |
| `GET /auth/me` | 30/min |
| `POST /auth/session-established` | 10/min |
| `POST /auth/invite/redeem` | 5/hour per IP + verified email |

### Invites

Accounts are invite-only. `POST /auth/invite/redeem` takes **only** `{ code }` — the email
comes from the verified session. The claim is a single conditional `updateMany`, so two
concurrent redemptions can never exceed `maxUses`. A referral code also works and grants
`guest`.

## Operational notes

- **Lazy-link ordering** — `authUid` → email match (binds `authUid`, keeps the existing
  role) → create when the token carries a role. Existing sessions therefore survive the
  cutover instead of being duplicated.
- **Ghost Base44 users** — nothing imported accounts from Base44. Anyone without a Prisma
  row lands on `/join`; an admin-issued invite is the only way in.
- **Role mirroring** — `redeemInvite` (and the seed, when the service key is present)
  copies the Prisma role into `app_metadata.role` on a best-effort basis. A failure is
  logged, never fatal: the guard falls back to the database.
- **Why no cookies / no RLS** — three clients (web, site, native) share one API. Bearer
  tokens work identically everywhere and keep the Prisma role model authoritative.
- **Door passes** are signed with `QR_SECRET`, deliberately separate from any auth secret.

## Manual E2E checklist (run before deploying M2)

- [ ] Dashboard: email link → `/auth/callback` → `/dashboard`.
- [ ] Dashboard: promoter without TOTP is redirected to `/auth/mfa`, enrolls, lands on `/dashboard`.
- [ ] Dashboard: SIGN OUT returns to `/`, and `/dashboard` is no longer reachable.
- [ ] Site: `/login?invite=CODE` → link → `/auth/callback` → `/join` → role visible on `/`.
- [ ] Site: password sign-in and Google sign-in both land on `/auth/callback`.
- [ ] Site: `/forgot-password` → email → `/reset-password` → new password works.
- [ ] Mobile: link opens `essentials://auth/callback`; after force-quit the session is still there.
- [ ] Mobile: staff account lands on `/auth/mfa`; guest never sees it.
- [ ] API: `GET /auth/me` without a token → 401; as a guest → 200 `guest`.
