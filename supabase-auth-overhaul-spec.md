# ESSENTIALS — Supabase Authentication Overhaul Spec

**Status:** Approved design, written standalone. Canonical for all auth work; supersedes the summary in §7 of `ai-agent-expansion-spec.md`.
**Date:** 2026-10-30
**Classification:** Architectural — restructures how all four apps authenticate and changes interfaces everything else depends on.
**Source:** Design interview with the owner (scope questions + three presented sections, each individually approved) plus codebase review of `origin/main` (`e495dce`).

---

## 1. Goal

Replace the homegrown magic-link + HS256 JWT system with **Supabase Auth** across the NestJS API, the Next.js dashboard, the Vite public site, and the Expo mobile app — adopting current best practices (PKCE, rotating refresh sessions, secure storage, MFA, rate limiting, audit), adding the extra features the owner selected, keeping the implementation efficient, and fixing the auth bugs found during review.

**Explicitly not in scope:** moving the database (Prisma/Postgres stays the system of record), row-level security, a session-management UI, and hosted-Supabase cutover steps beyond documentation (local CLI now, hosted setup documented for later).

---

## 2. Decision log (from the design interview)

| Question | Owner's decision |
|---|---|
| How deep does Supabase go? | **Supabase Auth only** — own Postgres + Prisma + NestJS untouched as the data layer; API verifies Supabase JWTs |
| Supabase environment | **Design against env-var interfaces now, implement against local (Supabase CLI), give exact hosted setup steps later** — swapping local → hosted is a `.env` change |
| Extra features | **OAuth (Google/Apple) · MFA for privileged roles · password fallback · rate limiting + auth audit log · one-click link flow + recovery emails** — session-management UI declined |
| Existing users | **Lazy-link on first sign-in** — no bulk import; profiles/roles/loyalty/referrals untouched; everyone re-authenticates once; live sessions die |
| Session architecture | **Approach A — Supabase sessions end-to-end** (chosen over "IdP + own short JWT" and "httpOnly cookies + Bearer mobile") |
| Section 1 (architecture & data flow) | Approved |
| Section 2 (roles, MFA, per-app changes) | Approved |
| Section 3 (hardening, bugs, efficiency, verification, rollout) | Approved |

---

## 3. Current state (what is being replaced)

- **API (`apps/api/src/auth/`)**: HS256 JWT signed with `JWT_SECRET`, 7-day expiry, no refresh or revocation; HMAC magic-link tokens (`{email, exp, nonce}` base64url + signature); invite-code account creation; roles `guest|artist|promoter|venue_manager|admin` on the Prisma `User` row and embedded in the JWT payload; `RolesGuard` behind the `@Auth(...roles)` decorator (~20 controllers).
- **Clients:** dashboard and site both persist the token in `localStorage` under `essentials_token`; mobile keeps it **in memory only** (nothing persists it despite a comment claiming SecureStore); `packages/api-client` reads `localStorage` once at import time.
- **Site runs two parallel auth systems:** `Login.jsx`/`AuthVerify.jsx` → NestJS magic link, while `Register.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `AuthContext.jsx`, `ProtectedRoute.jsx`, `PageNotFound.jsx` → **Base44 SDK** (Base44-hosted users, unrelated to Prisma). The site also ships a Base44 MCP consent page.
- **Dashboard UX gaps:** sign-in requires pasting the token from the email; there is **no sign-out at all**.
- Rate limiting: `@nestjs/throttler` installed and global (120/min, in-memory storage). `helmet` and CORS-from-env already present.

---

## 4. Architecture & data flow

### 4.1 New pieces
- **`packages/auth`** (new workspace package) — one shared factory: `createSupabaseClient({ storage })` used by web/site (browser storage) and mobile (`expo-secure-store` adapter), plus the shared `AuthUser` type. One pattern, four apps.
- **`SupabaseAuthGuard`** (replaces the Passport JWT strategy) — extracts the Bearer token, verifies it with `jose` against Supabase's JWKS (remote key set, cached, auto-refresh on unknown `kid`), and produces `{ sub, email, role, aal }`. **`@Auth(...roles)` and `RolesGuard` keep their exact signatures** — ~20 controllers do not churn.
- **`ensureUser(sub, email)`** lazy-link resolver — match `User.authUid` (new unique column) → else match by email and bind `authUid` → else create. Cached in-process 60 s, so role checks cost ~1 DB read per user per minute, not per request.

### 4.2 Role source of truth
Prisma `User.role` stays canonical and is mirrored into Supabase **`app_metadata.role`** whenever it changes (invite redeem, admin role change, seed) using the service-role key. The guard reads the claim first and only falls back to the DB when the claim is absent — hot paths stay off the database. The `aal` claim reports whether MFA was satisfied.

### 4.3 Sign-in flows
- **Dashboard (Next.js):** `signInWithOtp` with `emailRedirectTo: APP_URL/auth/callback` → one click in the email → PKCE code exchange at `/auth/callback` → session → role gate → `/dashboard`. The paste-the-token box is deleted.
- **Site (Vite):** same PKCE callback route, plus Google OAuth and email+password sign-in replacing the Base44 pages; `SITE_URL/auth/callback` allow-listed.
- **Mobile (Expo):** `emailRedirectTo: essentials://auth/callback` deep link (Expo dev URL in dev), OAuth via `WebBrowser.openAuthSessionAsync`, session persisted to **expo-secure-store** (fixes the token-lost-on-restart bug).
- **Invite onboarding (preserved):** after first Supabase sign-in with no matching Prisma user, the API returns `INVITE_REQUIRED` → invite screen → `POST /api/auth/invite/redeem` validates the code **and then** sets `app_metadata.role` server-side before creating the user. Role is never trusted from the client — the same invariant as today.

### 4.4 Schema (Prisma, same database)
- `User.authUid String? @unique` — link to Supabase `auth.users.id`.
- New `AuthEvent` audit table — `kind`, `userId?`, `email?`, `meta Json`, `ip`, `createdAt`.

### 4.5 Environment
```
SUPABASE_URL=                 # http://127.0.0.1:54321 locally; project URL when hosted
SUPABASE_ANON_KEY=            # public by design
SUPABASE_SERVICE_ROLE_KEY=    # SERVER ONLY — boot fails fast in prod if missing
```
Removed: `JWT_SECRET`, `JWT_EXPIRES_IN`, `MAGIC_LINK_TTL_MINUTES`. `MOBILE_URL` becomes the `essentials://` deep-link target. JWT verification is JWKS-based — no shared secret to manage.

---

## 5. Roles & MFA

- Roles unchanged: `guest | artist | promoter | venue_manager | admin`.
- `syncRoleToSupabase(user)` writes `app_metadata.role` on invite redeem, admin role change, and seed, so the claim the guard reads is never stale beyond the change itself (a stale/missing claim falls back to the DB).
- **MFA (TOTP) required for `promoter`, `venue_manager`, `admin`:** the guard rejects aal1 tokens on those roles with `401 MFA_REQUIRED`. Clients catch it and route to a TOTP enrollment screen (`supabase.auth.enroll` → QR → `challengeAndVerify` → session refreshes to aal2).
  - The **dashboard owns enrollment** (`/auth/mfa`).
  - The **site** shows a "finish two-step setup in dashboard" handoff for privileged users.
  - Artists and guests stay aal1; guests never see MFA UI.
- **Password fallback:** `signInWithPassword` offered on dashboard and site alongside magic link; a wrong/absent password falls back to "email me a link". Supabase recovery emails replace the Base44 reset pages.

---

## 6. Per-app changes

### 6.1 `packages/api-client` (web + mobile)
Token plumbing becomes one injected `getAccessToken()` hook wired to the Supabase session, with a single refresh-and-retry on 401. The module-level `localStorage` read at import time (the first-load race) is removed.

### 6.2 `apps/web` (dashboard)
- `app/auth/callback/route.ts` performs the PKCE exchange; the login page sends the link.
- `SessionProvider` exposes `{ user, role, aal }` to client components.
- **`TopNav` gains a sign-out button** (today there is none).
- `/auth/mfa` enrollment page; client-side route guard on `/dashboard/*` (session + role).
- Old `/auth/verify` token-paste page removed; the shadowed-`setToken` code path deleted.

### 6.3 `apps/site` (Vite)
- `AuthContext` rewritten on `supabase.auth.onAuthStateChange`, keeping the same shape (`user`, `isAuthenticated`, `logout`) so `ProtectedRoute` and consumers keep working.
- Routes: `/auth/callback` (PKCE); Login gains magic link + Google + password; `Register.jsx` becomes the invite-code signup path; Forgot/Reset → Supabase recovery.
- **Deleted:** `src/api/base44Client.js`, `src/lib/app-params.js`, `src/components/UserNotRegisteredError.jsx`, the Base44 MCP consent page, and all `base44.auth.*` calls.
- **Kept untouched:** `base44/` folder, CDN-hosted images/fonts, the `base44 dev` workflow (content and tooling, not auth).
- `AGENTS.md` gains a short auth note; its "Base44 app" framing remains accurate for content/tooling.

### 6.4 `apps/mobile` (Expo)
- `essentials://` deep-link scheme in `app.json` for magic-link and OAuth return; `expo-auth-session`/`WebBrowser` for OAuth.
- SecureStore storage adapter + session restore in `app/_layout.tsx`.
- Invite and profile screens repoint to the new endpoints; a compact MFA screen for privileged logins.

### 6.5 `apps/api` (NestJS)
- New `SupabaseAuthGuard` + `ensureUser` service; Passport strategy, `@nestjs/jwt` usage and HMAC token code removed.
- Auth module keeps `POST /auth/invite/redeem` (reworked) and `GET /auth/me` (lazy-link: returns canonical role + `INVITE_REQUIRED`).
- New `POST /auth/session-established` records a `sign_in` audit row on first contact after sign-in.

---

## 7. API surface changes

**Deleted:** `POST /auth/magic-link` · `GET /auth/magic-link` (none) · `POST /auth/verify` · `GET /auth/verify` · HMAC token issuance/verification code · `JwtStrategy`.

**Kept & reworked:** `POST /auth/invite/redeem` (validates code → sets `app_metadata.role` → creates/links user; conditional `updateMany` guard against the `maxUses` race) · `GET /auth/me` (lazy-link, canonical role).

**Added:** `POST /auth/session-established` (audit, throttled).

**Unchanged contract:** every other controller continues to use `@Auth(...roles)` and `@CurrentUser()` exactly as before.

---

## 8. Hardening

- **Rate limiting:** keep `@nestjs/throttler`, move its storage to **Redis** (already in compose), and add tight per-route limits — invite redeem **5/hour per IP+email**, `/auth/me` **30/min**, `session-established` **10/min**. Supabase's built-in abuse limits cover sign-in endpoints (documented, not duplicated).
- **Audit log:** `AuthEvent` written on invite redeem, role change, MFA enrollment/escalation, and lazy-link `sign_in`. Full sign-in visibility lives in Supabase's auth logs — documented honestly rather than faked.
- **Secrets:** service-role key server-only with boot-time validation in production; anon key public by design; redirect URLs allow-listed in Supabase; no `credentials: 'include'` anywhere (bearer-only ⇒ no cookie surface); `helmet` + `CORS_ORIGINS` retained.
- **Email:** Supabase's auth mail (magic link, recovery, OAuth) is configured against the owner's **Resend SMTP** when hosted; console/inbucket locally. The existing `MAIL_PROVIDER` switch keeps handling marketing/transactional mail from the app itself.

---

## 9. Bug fixes included (the review list)

1. `apps/web/src/app/page.tsx` — local `const [token, setToken] = useState()` **shadows the imported `setToken`** ⇒ the API client never receives the token ⇒ unauthenticated requests until a full page reload. The code path is deleted.
2. Magic-link tokens are **replayable for the full TTL** — `nonce` is never stored or checked despite "single-use" copy. Supabase links are single-use.
3. `GET /auth/verify?token=` leaks tokens into server logs and `Referer`. Replaced by PKCE code exchange (single-use, ~5-minute life).
4. Mobile token never persisted — SecureStore adapter + session restore.
5. **No sign-out exists** in the dashboard — added.
6. Invite over-use race: `uses >= maxUses` checked, then an unconditional increment ⇒ conditional `updateMany({ where: { id, uses: { lt: maxUses } } })` so concurrent redemptions cannot overshoot.
7. `packages/api-client` reads `localStorage` at import time (first-load race) — session injection instead.
8. `RequestMagicDto.mobile?: boolean` validated with `@IsString()`; unused `role` parameter on `redeemInvite` — both removed with the endpoints.
9. Site runs two parallel auth systems (NestJS + Base44) — unified on Supabase.
10. **Data caveat (flagged, not hidden):** anyone who registered through the site's Base44 `Register.jsx` exists only in Base44, never in Prisma — lazy-link cannot find them. Pre-launch these are demo accounts; any real ones need a one-time invite email.

---

## 10. Efficiency

- JWKS cached via `jose` (5-minute cooldown, unknown-`kid` refresh) ⇒ zero key fetches on the hot path.
- Role read from the verified JWT claim ⇒ **no DB read per request**; `ensureUser` cached 60 s per process; DB fallback only when the claim is missing.
- One Supabase client per app; sessions read from memory; no per-request introspection calls.
- Dependencies **removed:** `@nestjs/jwt`, `passport`, `passport-jwt` (and their types).
- No new infrastructure: same docker-compose Postgres/Redis, no database migration beyond two additive schema changes.

---

## 11. Verification plan

The repo has **no test infrastructure at all** today; this work creates the minimum.

1. **Jest for `apps/api`** (`jest` + `ts-jest`, `npm test`):
   - guard accepts a valid token; rejects expired, bad-signature and missing-`sub` tokens;
   - aal1 blocked on privileged roles with `MFA_REQUIRED`, aal2 allowed;
   - role falls back to the DB when the claim is absent;
   - `ensureUser` links by `authUid`, then by email, then creates;
   - invite redeem rejects revoked/expired/exhausted codes and **cannot exceed `maxUses` under concurrent calls**;
   - rate limit returns 429 at the configured boundary.
2. **Typecheck/build every workspace:** `tsc --noEmit` per app + `npm run build --workspaces` (the site once shipped blank from a JSX/TS annotation issue — this class of failure must be caught mechanically).
3. **Live HTTP proof** against local `supabase start`: obtain a real token → `GET /api/auth/me` lazy-link → role-gated endpoint returns 403 for a guest → MFA path returns 401 → invite redeem returns 429 at the limit. Actual responses reported, not "the build passed".
4. **Manual E2E checklist:** dashboard one-click sign-in, sign-out, MFA enrollment; site sign-in (magic link, Google, password) and invite onboarding; mobile deep-link sign-in surviving an app restart.

---

## 12. Rollout

**Work order:** schema (`authUid`, `AuthEvent`) → API guard + endpoints + throttler/audit → `packages/auth` → web → site → mobile → tests → docs.

**Docs:** update `README.md` and add `docs/auth.md` containing the **hosted Supabase setup** run later: project creation, redirect URLs per environment (dashboard, site, mobile deep link), Resend SMTP configuration, Google OAuth setup (Apple OAuth stays behind an env flag until an Apple Developer account exists), MFA policy, rate limits, and the local-CLI → hosted swap (pure `.env` change).

**Cutover effects:** existing live sessions die once (expected under lazy-link); old tokens are never accepted; seed script updated to work through the new flow (demo logins remain valid).

---

## 13. Interaction with the other spec

`ai-agent-expansion-spec.md` covers the AI assistant, platform expansion and the VPS migration. Auth touches it in three places, and this file remains canonical for all three:
- the assistant's staff endpoints use the **same `@Auth(...roles)` guard** — no separate auth path for AI tools;
- the **public site assistant** route stays unauthenticated but is hard-throttled (§8 limits) and must never receive PII — the same rule as every public route;
- VPS deployment must carry the `SUPABASE_*` env vars and register the Caddy hostnames as Supabase redirect URLs (documented in `docs/auth.md`).

---

## 14. Risks & open items

| Item | Status |
|---|---|
| Supabase hosted project + keys | Deferred by owner; local CLI now, documented cutover later |
| Google OAuth credentials | Owner supplies; magic-link flow works without them |
| Apple OAuth credentials | Behind an env flag until an Apple Developer account exists |
| Base44-registered ghost users | §9 #10 — one-time invite email if any are real |
| Multi-instance role-cache staleness | Acceptable: role changes are rare, cache is 60 s, DB fallback on missing claim |
| Redirect URL allow-list for VPS hostnames | Confirmed when DNS/Caddy hostnames are finalized (§13) |
