# Supabase Auth Overhaul — M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homegrown magic-link + HS256 JWT auth with Supabase Auth end-to-end (NestJS JWKS verification, PKCE clients, lazy-linked Prisma users, MFA for privileged roles, Redis rate limits, audit trail) across `apps/api`, `apps/web`, `apps/site`, `apps/mobile` — and fix the ten auth bugs found in review.

**Architecture:** Supabase issues and refreshes sessions; the API verifies the bearer token with `jose` against Supabase's JWKS and resolves the canonical role from the Prisma `User` row (claim first, 60 s cached DB fallback). No database move, no RLS, no cookies, no shared secret. Two additive schema changes only: `User.authUid` and the `AuthEvent` audit table.

**Tech Stack:** NestJS 10 + `jose` + `@supabase/supabase-js` (admin API only, server-side) + `@nestjs/throttler` v6 with an `ioredis` storage; Next.js 14 (App Router), Vite + React 18, Expo 51 (expo-router); Jest + ts-jest (new, `apps/api`), Vitest (new, `packages/api-client`); local Supabase CLI.

**Spec:** `supabase-auth-overhaul-spec.md` is canonical. `ai-agent-expansion-spec.md` §7 is the summary; §14 defines M1–M10 (M1 = this plan).

**Review focus — where five plausible inputs still produce the wrong output:**

1. **Bootstrap circularity — MFA gate vs. identity endpoint.** If `/auth/me` is MFA-gated, an aal1 promoter can never learn their role, so no client can route them to enrollment. Mitigation (pinned in Task 2/3): `@SkipMfa()` on `/auth/me`, `session-established`, and `invite/redeem`; every data endpoint still returns `401 MFA_REQUIRED` for aal1 privileged tokens. Task 2 tests both halves.
2. **Role cache poisoning.** Caching a `null` role for 60 s means a freshly redeemed invite still reports `INVITE_REQUIRED`. Mitigation: never cache `null`, and `redeemInvite` explicitly invalidates the sub's cache entry (Task 3/4 tests).
3. **Invite redemptions racing `maxUses`.** Any read-then-increment sequence overshoots under concurrency. Mitigation: one conditional `updateMany({ where: { uses: { lt: maxUses } } })` and treat `count === 0` as "fully used"; email comes from the verified session, never the body (Task 4 test fires two concurrent redemptions).
4. **API-client retry loops / unauthenticated first load.** A naive 401 retry can recurse, and a provider evaluated before the session restores sends no header. Mitigation: exactly one retry with a re-read token, no provider → no header and no retry, provider errors swallowed (Task 6 tests).
5. **PKCE exchange in the wrong place.** Supabase's PKCE verifier lives in browser storage; a server route handler cannot read it without cookie-based `@supabase/ssr` (which the bearer-only decision excludes). Mitigation: the callback is a **client page** in web and site, and a deep-link screen on mobile (Tasks 7–9); tests/checks assert a missing `code` shows the rejection state rather than a silent hang.

---

## Global constraints (exact values — apply in every task)

- Roles: `guest | artist | promoter | venue_manager | admin` (Prisma `Role` enum, unchanged).
- MFA-required roles: **`promoter`, `venue_manager`, `admin`**. aal1 on those roles → `401 { "code": "MFA_REQUIRED", "role": "<role>" }` on every non-`@SkipMfa` endpoint.
- Claims used: `sub`, `email`, `aal`, `app_metadata.role` — **never the top-level `role` claim** (Supabase puts `"authenticated"` there).
- Token verification: `iss = ${SUPABASE_URL}/auth/v1`, `aud = "authenticated"`, RS256 via remote JWKS `${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, `cooldownDuration: 300_000`.
- Role resolution: claim first → DB fallback only when the claim is absent → in-process cache TTL **60 000 ms**, `null` never cached.
- Rate limits: global throttler stays **120/min** (now Redis-backed); `invite/redeem` **5/hour per IP+verified email**; `/auth/me` **30/min**; `/auth/session-established` **10/min**.
- Env added (server): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. Env removed: `JWT_SECRET`, `JWT_EXPIRES_IN`, `MAGIC_LINK_TTL_MINUTES`.
- Env added (clients): `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (web), `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` (site), `EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY` (mobile).
- Bearer only. No `credentials: "include"`, no cookies, no service-role key in any client bundle. Boot fails fast when `SUPABASE_SERVICE_ROLE_KEY` is missing and `NODE_ENV === "production"`.
- `@Auth(...roles)` and `RolesGuard` keep their exact call signatures — all ~20 existing controllers compile untouched.
- Only additive DB changes (`User.authUid String? @unique`, `AuthEvent`). No destructive migration.
- Existing sessions die once (lazy-link). Tasks 2–4 are **one atomic deploy unit** — intermediate commits are build+test green but the old token flow is dead between them, so do not deploy mid-M1.

---

## M1 file map

| Area | New | Modified | Deleted |
|---|---|---|---|
| DB | migration for `authUid` + `AuthEvent` | `packages/db/prisma/schema.prisma`, seed | — |
| API auth | `auth/supabase-token.service.ts`, `auth/supabase-auth.guard.ts`, `auth/auth-user.service.ts`, `auth/auth-events.service.ts`, `auth/supabase-admin.service.ts`, `auth/auth.dto.ts`, `common/skip-mfa.decorator.ts`, `common/redis-throttler.storage.ts`, `common/redis.provider.ts`, `common/auth-rate.guard.ts` + 4 spec files | `auth/auth.controller.ts`, `auth/auth.service.ts`, `auth/auth.module.ts`, `common/auth.decorator.ts`, `app.module.ts`, `main.ts`, `package.json`, `jest.config.js` | `auth/jwt.strategy.ts` |
| Shared | `packages/auth/{package.json,index.ts,tsconfig.json}` | `packages/api-client/index.ts` + `index.spec.ts`, `package.json` | — |
| web | `app/auth/callback/page.tsx`, `app/auth/mfa/page.tsx`, `app/dashboard/layout.tsx`, `src/lib/supabase.ts`, `src/components/AuthProvider.tsx` | `app/layout.tsx`, `app/page.tsx`, `src/components/TopNav.tsx`, `package.json`, `tsconfig.json` | `app/auth/verify/page.tsx`, `app/auth/verify/verify-inner.tsx` |
| site | `src/lib/supabase.js`, `src/pages/AuthCallback.jsx`, `src/pages/Join.jsx` | `src/App.jsx`, `src/lib/AuthContext.jsx`, `src/lib/auth.js`, `src/pages/Login.jsx`, `Register.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `src/components/ProtectedRoute.jsx`, `jsconfig.json`, `AGENTS.md`, `package.json` | `src/pages/AuthVerify.jsx`, `src/api/base44Client.js`, `src/lib/app-params.js`, `src/components/UserNotRegisteredError.jsx`, `src/pages/OAuthConsent.jsx` |
| mobile | `lib/supabase.ts`, `app/auth/callback.tsx`, `app/auth/mfa.tsx` | `app.json`, `app/_layout.tsx`, `app/index.tsx`, `app/auth/invite.tsx`, `app/auth/profile.tsx`, `package.json`, `tsconfig.json` | `app/auth/verify.tsx` |
| docs | `docs/auth.md` | `.env.example`, `README.md` | — |

---

## Task 1: Schema — `User.authUid` + `AuthEvent`

**Files:** modify `packages/db/prisma/schema.prisma`; create `packages/db/prisma/migrations/<ts>_supabase_auth_overhaul/migration.sql` (via CLI); modify the seed at `packages/db/prisma/seed.ts` (confirm the path first with `ls packages/db/prisma`).

**Interfaces produced:** `prisma.user.findUnique({ where: { authUid } })`, `prisma.authEvent.create({ data: { kind, userId?, email?, meta, ip } })`.

- [ ] **Step 1:** Add to `User`: `authUid String? @unique` (place next to `email`). Add the model:

```prisma
model AuthEvent {
  id        String   @id @default(cuid())
  kind      String   // sign_in | lazy_link | invite_redeemed | role_change | mfa_enrolled | mfa_escalated
  userId    String?
  email     String?
  meta      Json     @default("{}")
  ip        String?
  createdAt DateTime @default(now())

  @@index([kind, createdAt])
  @@index([userId])
  @@index([email])
}
```

- [ ] **Step 2:** Run `npm run db:up` then `cd packages/db && npx prisma migrate dev --name supabase_auth_overhaul`. Expected: one new migration folder, no destructive warnings, `prisma generate` succeeds.

- [ ] **Step 3:** Typecheck: `cd packages/db && npx tsc --noEmit`. Expected: exit 0.

- [ ] **Step 4:** Commit: `feat(db): add supabase authUid link and AuthEvent audit table`.

---

## Task 2: Jest harness + `SupabaseTokenService` + `SupabaseAuthGuard`

**Files:** create `apps/api/jest.config.js`, `apps/api/src/auth/supabase-token.service.ts`, `apps/api/src/auth/supabase-auth.guard.ts`, `apps/api/src/common/skip-mfa.decorator.ts`, `apps/api/src/auth/supabase-token.service.spec.ts`, `apps/api/src/auth/supabase-auth.guard.spec.ts`; modify `apps/api/package.json`.

**Interfaces produced:**
```ts
export interface VerifiedSession { sub: string; email: string; role: Role | null; aal: "aal1" | "aal2"; }

// supabase-token.service.ts
export const SUPABASE_JWKS = Symbol("SUPABASE_JWKS");
export class SupabaseTokenService {
  constructor(config: ConfigService, @Optional() @Inject(SUPABASE_JWKS) keySet?: JWTVerifyGetKey);
  verify(token: string): Promise<VerifiedSession>;   // throws UnauthorizedException
}

// supabase-auth.guard.ts
export class SupabaseAuthGuard implements CanActivate {} // sets req.user = VerifiedSession

// skip-mfa.decorator.ts
export const SKIP_MFA_KEY = "skip_mfa";
export const SkipMfa = () => SetMetadata(SKIP_MFA_KEY, true);

// auth-user.service.ts (stub in this task, completed in Task 3)
@Injectable() export class AuthUserService { resolveRole(sub: string, email: string): Promise<Role | null>; }
```

- [ ] **Step 1:** Add dev deps and script to `apps/api/package.json`: `"test": "jest"`, devDeps `jest@^29`, `ts-jest@^29`, `@types/jest@^29`. Create `apps/api/jest.config.js`:

```js
module.exports = {
  preset: "ts-jest",
  rootDir: "src",
  testRegex: ".*\\.spec\\.ts$",
  testEnvironment: "node",
  moduleNameMapper: { "^@essentials/db$": "<rootDir>/../../../packages/db/index.ts" },
  setupFiles: ["<rootDir>/../jest.setup.js"],
};
```
`apps/api/jest.setup.js`: `process.env.SUPABASE_URL = "http://test.local"; process.env.SUPABASE_ANON_KEY = "anon"; process.env.SUPABASE_SERVICE_ROLE_KEY = "service";`

- [ ] **Step 2 (failing tests):** `supabase-token.service.spec.ts` — generate a local keypair once:

```ts
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { SupabaseTokenService } from "./supabase-token.service";

const BASE = "http://test.local";
let privateKey: CryptoKey, keySet: ReturnType<typeof createLocalJWKSet>;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: "k1", alg: "RS256", use: "sig" };
  keySet = createLocalJWKSet({ keys: [jwk] });
});

const sign = (claims: Record<string, unknown> = {}, opts: { exp?: string; kid?: string; aud?: string } = {}) =>
  new SignJWT({ email: "a@b.co", aal: "aal1", app_metadata: { role: "promoter" }, ...claims })
    .setProtectedHeader({ alg: "RS256", kid: opts.kid ?? "k1" })
    .setSubject("sub-1").setIssuer(`${BASE}/auth/v1`).setAudience(opts.aud ?? "authenticated")
    .setIssuedAt().setExpirationTime(opts.exp ?? "5m").sign(privateKey);

const cfg = { getOrThrow: () => BASE, get: () => BASE } as any;
const svc = () => new SupabaseTokenService(cfg, keySet);
```

Cases: valid token → `{ sub: "sub-1", email: "a@b.co", role: "promoter", aal: "aal1" }`; expired (`exp: "-1s"`) → rejects; wrong key (sign with a second keypair, same `kid`) → rejects; missing `sub` → rejects; `aud: "other"` → rejects; token with no `app_metadata.role` → `role: null`; top-level `role: "authenticated"` is **ignored** (returns `null`, not `"authenticated"`).

`supabase-auth.guard.spec.ts` — build an `ExecutionContext` stub from `{ headers: { authorization }, body: {}, user: undefined }`, a `Reflector` stub whose `getAllAndOverride` returns `undefined` (or `true` for the skip case), and `AuthUserService` stubs:

| Case | Expectation |
|---|---|
| no `Authorization` | throws 401 |
| `Basic xyz` | throws 401 |
| valid aal2 promoter | `true`, `req.user.role === "promoter"` |
| valid aal1 guest | `true` |
| valid aal1 promoter, no skip | throws with response `code: "MFA_REQUIRED"`, `role: "promoter"` |
| valid aal1 promoter, `@SkipMfa` | `true` |
| no role claim, `resolveRole` → `venue_manager`, aal1 | throws `MFA_REQUIRED` |
| no role claim, `resolveRole` → `null` | `true`, `req.user.role === null` |

- [ ] **Step 3:** Run `npm test -w @essentials/api`. Expected: all cases fail (`Cannot find module`). 

- [ ] **Step 4:** Implement. `SupabaseTokenService`:

```ts
constructor(config: ConfigService, @Optional() @Inject(SUPABASE_JWKS) keySet?: JWTVerifyGetKey) {
  this.issuer = `${config.getOrThrow("SUPABASE_URL")}/auth/v1`;
  this.keySet = keySet ?? createRemoteJWKSet(new URL(`${this.issuer}/.well-known/jwks.json`), {
    cooldownDuration: 300_000, cacheMaxAge: 600_000,
  });
}

async verify(token: string): Promise<VerifiedSession> {
  try {
    const { payload } = await jwtVerify(token, this.keySet, { issuer: this.issuer, audience: "authenticated" });
    if (!payload.sub || typeof payload.email !== "string") throw new Error("missing sub/email");
    const rawRole = (payload.app_metadata as any)?.role;
    return {
      sub: payload.sub, email: payload.email,
      role: ["guest","artist","promoter","venue_manager","admin"].includes(rawRole) ? rawRole : null,
      aal: payload.aal === "aal2" ? "aal2" : "aal1",
    };
  } catch { throw new UnauthorizedException("Invalid or expired token"); }
}
```
`SupabaseAuthGuard.canActivate` follows the pinned order: header parse → `verify` → `skipMfa` from reflector → `role = session.role ?? await users.resolveRole(session.sub, session.email)` → MFA gate → `req.user = { ...session, role }` → `true`. Throw `new UnauthorizedException({ code: "MFA_REQUIRED", role })`.

- [ ] **Step 5:** Run `npm test -w @essentials/api`. Expected: all pass. Run `npm run build -w @essentials/api` (exit 0).

- [ ] **Step 6:** Commit: `feat(api): verify supabase JWTs with jwks and enforce MFA for privileged roles`.

---

## Task 3: `AuthUserService` (lazy-link + role cache) + `/auth/me` + `session-established` + audit

**Files:** create `apps/api/src/auth/auth-events.service.ts`, `apps/api/src/auth/auth-user.service.spec.ts`; modify `apps/api/src/auth/auth-user.service.ts` (the Task 2 stub), `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`.

**Interfaces produced:**
```ts
// auth-user.service.ts
export class AuthUserService {
  resolveRole(sub: string, email: string): Promise<Role | null>;   // claim path handled by guard; DB fallback + 60s cache
  ensureUser(session: VerifiedSession): Promise<{ user: User; created: boolean } | null>; // null ⇒ INVITE_REQUIRED
  invalidate(sub: string): void;
}
// auth-events.service.ts
export class AuthEventsService { record(kind: AuthEventKind, data: { userId?: string; email?: string; ip?: string; meta?: object }): Promise<void>; }
```

Response contracts (pinned — clients are written against these):
```jsonc
// GET /api/auth/me  (200, @Auth() @SkipMfa @Throttle 30/min)
{ "user": { "sub": "...", "email": "...", "role": "promoter", "aal": "aal1" }, "mfaRequired": true }
{ "inviteRequired": true, "email": "..." }            // no Prisma user and no role claim
// POST /api/auth/session-established  body { surface?: "web"|"site"|"mobile" } → { "ok": true }
```

- [ ] **Step 1 (failing tests):** `auth-user.service.spec.ts` with `jest.mock("@essentials/db", () => ({ prisma: { user: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() } } }))`:

| Case | Expectation |
|---|---|
| `findUnique({ where: { authUid } })` hits | returns user, `created: false`, **no** second query |
| authUid miss, email hit | `update({ where: { id }, data: { authUid: sub } })` called, returns bound user |
| both miss, `session.role = "guest"` (admin-provisioned token) | `create({ data: { email, role, authUid, referralCode } })`, `created: true`, `AuthEvents.record("lazy_link")` |
| both miss, `session.role = null` | returns `null`, no create, no event |
| `resolveRole` called twice in 60 s | one `findUnique` total (cache) |
| `resolveRole` returns null, then `invalidate(sub)`, then resolves | second DB read happens (null is not cached / is cleared) |
| `ensureUser` second call for the same user | no `sign_in`/`lazy_link` event the second time (verify only on created/bound) |

- [ ] **Step 2:** Run `npm test -w @essentials/api -- auth-user`. Expected: failures.

- [ ] **Step 3:** Implement `AuthUserService`:

```ts
private cache = new Map<string, { role: Role; exp: number }>();

async resolveRole(sub: string, email: string): Promise<Role | null> {
  const hit = this.cache.get(sub);
  if (hit && hit.exp > Date.now()) return hit.role;
  const user = await prisma.user.findUnique({ where: { authUid: sub } })
    ?? await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return null;                       // deliberately NOT cached
  this.cache.set(sub, { role: user.role, exp: Date.now() + 60_000 });
  return user.role;
}
invalidate(sub: string) { this.cache.delete(sub); }
```
`ensureUser` implements the pinned order (authUid → email-bind → create only when `session.role !== null` → else `null`), records `lazy_link` only when a bind/create happened, and seeds the cache.

- [ ] **Step 4:** Rewrite `AuthController.me` to `@Auth() @SkipMfa() @Throttle({ default: { limit: 30, ttl: 60_000 } })`, returning the pinned contract; add `session-established` with `@Auth() @SkipMfa() @Throttle({ default: { limit: 10, ttl: 60_000 } })`, `@HttpCode(200)`, writing a `sign_in` event with `{ surface }` and `req.ip`. Keep `RedeemInviteDto` for Task 4. Add `AuthUserService`/`AuthEventsService` to `AuthModule` providers and make `AuthModule` `@Global()` exporting `SupabaseTokenService`, `SupabaseAuthGuard`, `AuthUserService`, `AuthEventsService`.

- [ ] **Step 5:** `npm test -w @essentials/api` and `npm run build -w @essentials/api`. Expected: green.

- [ ] **Step 6:** Commit: `feat(api): lazy-link supabase users with cached role resolution and auth audit`.

---

## Task 4: Cutover — delete magic link, rework invite redeem, Redis throttler, auth rate limit

**Files:** modify `apps/api/src/common/auth.decorator.ts`, `apps/api/src/auth/auth.service.ts`, `apps/api/src/auth/auth.controller.ts`, `apps/api/src/auth/auth.module.ts`, `apps/api/src/app.module.ts`, `apps/api/src/main.ts`, `apps/api/package.json`, `packages/db/prisma/seed.ts`; create `apps/api/src/auth/supabase-admin.service.ts`, `apps/api/src/common/redis.provider.ts`, `apps/api/src/common/redis-throttler.storage.ts`, `apps/api/src/common/auth-rate.guard.ts`, `apps/api/src/auth/invite-redeem.spec.ts`, `apps/api/src/common/redis-throttler.storage.spec.ts`; delete `apps/api/src/auth/jwt.strategy.ts`.

**Interfaces produced:**
```ts
// supabase-admin.service.ts
export class SupabaseAdminService {
  updateRole(userAuthUid: string, role: Role): Promise<void>;  // best-effort; logs a warning on failure
}
// auth.service.ts
redeemInvite(session: VerifiedSession, code: string, ip?: string): Promise<{ user: { id: string; email: string; role: Role } }>;
// common/auth-rate.guard.ts
export class AuthRateGuard implements CanActivate {}  // 5/hr keyed by `${ip}:${user.email}`
```

- [ ] **Step 1 (failing tests):** `invite-redeem.spec.ts` with mocked `prisma` (invite/user/consent/referral), `MailService`, `SupabaseAdminService`, `AuthEventsService`, `AuthUserService`:

| Case | Expectation |
|---|---|
| linked user already exists (`authUid`) | returns it, no invite lookup (idempotent) |
| existing Prisma user by email, no authUid | binds `authUid` from session, keeps existing role, no new user |
| valid invite, 1 use left | `updateMany` called with `{ uses: { lt: maxUses } }`; user created with invite role and `authUid = session.sub`; `SupabaseAdminService.updateRole(session.sub, grantedRole)` called; `invite_redeemed` event written; role cache invalidated |
| `updateMany` returns `{ count: 0 }` | `400 BadRequestException`, **no** user created |
| two concurrent calls, `updateMany` returns 1 then 0 | exactly one create, second rejects |
| revoked / expired invite | 400 before any increment |
| referral code (invite miss, `referralCode` hit) | role `guest`, `referredById` set |
| unknown code | 400 `Invalid invite code` |
| `updateRole` rejects | redeem still succeeds (best-effort), warning logged |
| code from body with an `email` field present | ignored — `ValidationPipe` whitelist strips it (dto has only `code`) |

`redis-throttler.storage.spec.ts` (mocked ioredis): `increment` returns monotonically growing `totalHits` and a positive `timeToExpire`; TTL is set only on the first hit (`PEXPIRE … NX` path); `reset` clears the key; `increment` after reset starts at 1.

`auth-rate.guard.spec.ts`: 6th call for the same `ip + email` → `TooManyRequestsException` (429); different email → independent counter; different IP → independent counter.

- [ ] **Step 2:** Run `npm test -w @essentials/api`. Expected: new failures.

- [ ] **Step 3:** Implement the cutover.
  - `auth.decorator.ts`: `UseGuards(SupabaseAuthGuard, RolesGuard)` — signature and `Roles()` behaviour unchanged.
  - Delete `jwt.strategy.ts`; remove `PassportModule`, `JwtModule` from `AuthModule`; drop `@nestjs/jwt`, `@nestjs/passport`, `passport`, `passport-jwt`, `@types/passport-jwt` from `apps/api/package.json` and run `npm install`. Deleting `requestMagicLink`/`verifyMagicLink` also removes **bugs #2 (replayable HMAC nonce) and #3 (token in query string)** with their endpoints.
  - Create `apps/api/src/auth/auth.dto.ts` with `RedeemInviteDto` (`code` only).
  - `auth.service.ts`: delete `requestMagicLink`, `verifyMagicLink`, `signToken`, `secret`, `issueTokens`, `magicLinkEmail`. `redeemInvite(session, code, ip)` per the pinned order; create with `authUid`; keep consent + referral + welcome-mail (non-fatal) blocks; call `SupabaseAdminService.updateRole(session.sub, grantedRole)` in a try/catch (best-effort); write `invite_redeemed`; `authUsers.invalidate(session.sub)`.
  - `auth.controller.ts`: delete `magic-link`, `verify` (POST), `verify` (GET), `RequestMagicDto`, `VerifyDto`; `redeem` becomes `@UseGuards(SupabaseAuthGuard, AuthRateGuard) @SkipMfa() @HttpCode(200)` reading `@CurrentUser()` and `@Ip()`; `RedeemInviteDto` = `{ @IsString() @MinLength(4) code: string }`.
  - `app.module.ts`: declare the shared client provider `{ provide: REDIS, useFactory: …, inject: [ConfigService] }` (one `ioredis` connection from `REDIS_URL`, `lazyConnect: false`, error logged) and `ThrottlerModule.forRootAsync({ inject: [REDIS], useFactory: (redis) => ({ throttlers: [{ ttl: 60_000, limit: 120 }], storage: new RedisThrottlerStorage(redis) }) })`; keep `APP_GUARD` `ThrottlerGuard`. `RedisThrottlerStorage` implements `ThrottlerStorage` from `@nestjs/throttler` using `INCR` + `PEXPIRE … NX` + `PTTL` on that client (confirm the exact `increment`/`decrement`/`reset` signatures against the installed `@nestjs/throttler@6` types). Add `ioredis` as a direct dependency.
  - `main.ts`: before `listen`, if `NODE_ENV === "production"` assert `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` are present → throw with a clear message otherwise.
  - Seed: after upserting demo users, when `SUPABASE_SERVICE_ROLE_KEY` is set, best-effort `updateRole` for each seeded user that has an `authUid`; otherwise log one line explaining that Supabase users are created on first sign-in (lazy-link).

- [ ] **Step 4:** `npm test -w @essentials/api`, `npm run build -w @essentials/api`. Then a manual boot check: `npm run dev:api` with only `.env` lacking `JWT_SECRET` → starts; hit `POST /api/auth/magic-link` → 404.

- [ ] **Step 5:** Commit: `refactor(api): cut over to supabase auth and harden invite redemption`.

---

## Task 5: `packages/auth` shared client factory

**Files:** create `packages/auth/package.json`, `packages/auth/index.ts`, `packages/auth/tsconfig.json`; modify `apps/web/package.json`, `apps/site/package.json`, `apps/mobile/package.json`.

**Interfaces produced:**
```ts
export interface AuthStorage { getItem(key: string): string | null | Promise<string | null>; setItem(k: string, v: string): void | Promise<void>; removeItem(key: string): void | Promise<void>; }
export interface CreateSupabaseClientOptions { url: string; anonKey: string; storage?: AuthStorage; flowType?: "pkce" | "implicit"; detectSessionInUrl?: boolean; }
export function createSupabaseClient(o: CreateSupabaseClientOptions): SupabaseClient;
export type AuthRole = "guest" | "artist" | "promoter" | "venue_manager" | "admin";
export interface AuthUser { sub: string; email: string; role: AuthRole | null; aal: "aal1" | "aal2"; }
```

- [ ] **Step 1:** Create the package (`name: "@essentials/auth"`, `main: "index.ts"`, dependency `@supabase/supabase-js@^2`). Factory default: `flowType: "pkce"`, `detectSessionInUrl: false`, `autoRefreshToken: true`, `persistSession: true`, `storage` passed through when provided. `detectSessionInUrl` is **false on purpose**: every app exchanges the PKCE code explicitly on its callback screen, and leaving auto-detection on would consume the verifier first and make the explicit exchange fail. Add `"@essentials/auth": "*"` + `"@supabase/supabase-js": "^2"` to web/site/mobile.
- [ ] **Step 2:** `npm install` at the root; `npx tsc --noEmit -p packages/auth`. Expected: exit 0.
- [ ] **Step 3:** Commit: `feat(auth): share one supabase client factory across apps`.

---

## Task 6: Session plumbing — `api-client` token provider + 401 retry; per-app clients

**Files:** modify `packages/api-client/index.ts`, `packages/api-client/package.json`; create `packages/api-client/index.spec.ts`, `apps/web/src/lib/supabase.ts`, `apps/web/src/components/AuthProvider.tsx`, `apps/mobile/lib/supabase.ts`; modify `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx` (imports only — Task 7 rewrites it), `apps/mobile/app/_layout.tsx`.

**Interfaces produced:**
```ts
export type AccessTokenProvider = () => string | null | Promise<string | null>;
export function setAccessTokenProvider(p: AccessTokenProvider | null): void;
export class ApiError extends Error { status: number; code?: string; }
```
`setToken` / `getToken` are **removed**; the import-time `localStorage` read is deleted.

- [ ] **Step 1 (failing tests, Vitest):** add `"test": "vitest run"`, devDep `vitest` to `packages/api-client`. Stub `globalThis.fetch` with `jest`-style spies (`vi.fn()`). Cases:
  1. provider returns `"t1"` → request sends `Authorization: Bearer t1`.
  2. provider returns `null` → **no** `Authorization` header.
  3. provider throws → request proceeds without header, no retry.
  4. first response 401, provider second call returns `"t2"` → exactly **one** retry, second request carries `Bearer t2`; result resolves.
  5. both responses 401 → `ApiError` with `status: 401`, provider called exactly twice (no loop).
  6. 403 with body `{"code":"MFA_REQUIRED","role":"promoter"}` → `ApiError.code === "MFA_REQUIRED"`.
  7. non-401 error (500) → no retry.
- [ ] **Step 2:** `npm test -w @essentials/api-client`. Expected: failures.
- [ ] **Step 3:** Implement `request()` with `let retried = false` and an async token resolution; parse `application/json` error bodies into `code`/`message`, fall back to text. Then create the app clients:

```ts
// apps/web/src/lib/supabase.ts
"use client";
import { createSupabaseClient } from "@essentials/auth";
export const supabase = createSupabaseClient({
  url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
  anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
});
```
```ts
// apps/mobile/lib/supabase.ts
import * as SecureStore from "expo-secure-store";
import { createSupabaseClient } from "@essentials/auth";
export const supabase = createSupabaseClient({
  url: process.env.EXPO_PUBLIC_SUPABASE_URL!,
  anonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
  storage: {
    getItem: (k) => SecureStore.getItemAsync(k),
    setItem: (k, v) => SecureStore.setItemAsync(k, v),
    removeItem: (k) => SecureStore.deleteItemAsync(k),
  },
  detectSessionInUrl: false,
});
```
Wire the provider at both roots: `setAccessTokenProvider(async () => (await supabase.auth.getSession()).data.session?.access_token ?? null)` inside a `"use client"` `AuthProvider` mounted in `apps/web/src/app/layout.tsx`, and in `apps/mobile/app/_layout.tsx` before the Stack renders (with a restore `useEffect` awaiting `getSession`). Remove the now-invalid `setToken`/`getToken` imports from every importer (`apps/web/src/app/page.tsx`, `apps/mobile/app/index.tsx`, `apps/mobile/app/auth/verify.tsx`, `apps/mobile/app/auth/invite.tsx`): where the screen belongs to a later task, delete the dead call so the workspace compiles rather than leaving a TODO.
- [ ] **Step 4:** `npm test -w @essentials/api-client` (green); `npm run build -w @essentials/api` (importers in api untouched); `npm run build -w @essentials/web` — expected to fail only if a removed export is still imported; fix those imports.
- [ ] **Step 5:** Commit: `refactor(api-client): inject supabase access tokens and retry once on 401`.

---

## Task 7: Dashboard (`apps/web`) — callback, SessionProvider, MFA, sign-out, route guard

**Files:** create `apps/web/src/app/auth/callback/page.tsx`, `apps/web/src/app/auth/mfa/page.tsx`, `apps/web/src/app/dashboard/layout.tsx`; modify `apps/web/src/app/page.tsx`, `apps/web/src/app/layout.tsx`, `apps/web/src/components/TopNav.tsx`, `apps/web/src/components/AuthProvider.tsx`, `apps/web/package.json`; delete `apps/web/src/app/auth/verify/page.tsx`, `apps/web/src/app/auth/verify/verify-inner.tsx`.

**Behaviour pinned:** dashboard roles = `promoter`, `venue_manager`, `admin` (unchanged). `/auth/callback` (client page) reads `?code`, calls `supabase.auth.exchangeCodeForSession(code)` → `GET /auth/me` → route: `inviteRequired` → message "ask an admin for an invite" (dashboard never onboards); role not allowed → sign out + message; `mfaRequired` → `/auth/mfa`; else `/dashboard`. `/auth/mfa` calls `supabase.auth.mfa.enroll({ factorType: "totp" })`, renders the `otpauth` URI as a QR (`qrcode` package → data URL) plus the manual secret, then `mfa.challengeAndVerify({ factorId, challengeId, code })` → refresh session → `/dashboard`.

- [ ] **Step 1:** Rewrite `app/page.tsx`: two forms — "email me a link" (`supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/auth/callback` } })`) and password (`supabase.auth.signInWithPassword`); on mount, if `getSession()` returns a session, `GET /auth/me` and redirect by the same rules. Delete the paste-token box and the `verify()` handler — **bug #1 (`setToken` shadowing) disappears with the code path**.
- [ ] **Step 2:** Add the callback page (client), `/auth/mfa`, and `app/dashboard/layout.tsx`. The layout is **guard only** (loading skeleton → `mfaRequired` redirect → role check → `{children}`); every dashboard page already renders its own `<TopNav />`, so adding it to the layout would duplicate it. `AuthProvider` supplies `{ user, role, aal, loading, refresh }` and signs out on `authError`.
- [ ] **Step 3:** `TopNav` (a client component): show the signed-in email and add a `SIGN OUT` button — `await supabase.auth.signOut()` → `router.replace("/")`. The token provider stays registered; it simply resolves to `null`. **Bug #5 fixed.**
- [ ] **Step 4:** Delete the old verify pages; add `qrcode` (and `@types/qrcode`) to `apps/web/package.json`.
- [ ] **Step 5:** Verify: `npm run build -w @essentials/web` (Next typechecks during build) — expected exit 0. Manual: with `supabase start` running, request a link, click it, land on `/dashboard`; sign out; a promoter without MFA lands on `/auth/mfa`.
- [ ] **Step 6:** Commit: `feat(web): supabase sign-in, MFA enrollment, route guard and sign-out`.

---

## Task 8: Public site (`apps/site`) — unify auth on Supabase, kill Base44 auth

**Files:** create `src/lib/supabase.js`, `src/pages/AuthCallback.jsx`, `src/pages/Join.jsx`; modify `src/App.jsx`, `src/lib/AuthContext.jsx`, `src/lib/auth.js`, `src/pages/Login.jsx`, `src/pages/Register.jsx`, `src/pages/ForgotPassword.jsx`, `src/pages/ResetPassword.jsx`, `src/components/ProtectedRoute.jsx`, `jsconfig.json`, `AGENTS.md`, `package.json`; delete `src/pages/AuthVerify.jsx`, `src/api/base44Client.js`, `src/lib/app-params.js`, `src/components/UserNotRegisteredError.jsx`, `src/pages/OAuthConsent.jsx`.

**Behaviour pinned:** `AuthContext` keeps the existing consumer shape (`user`, `isAuthenticated`, `isLoadingAuth`, `authChecked`, `authError`, `checkUserAuth`, `logout`, `navigateToLogin`) plus `role`, `aal`, `mfaRequired`; it subscribes to `supabase.auth.onAuthStateChange` and calls `GET /auth/me` for the canonical role (never trusts the claim for display). Site routes: `/`, `/login`, `/auth/callback`, `/join`, `/reset-password`, `*` → `Home`. Guests arriving with `?invite=CODE` in the Login URL keep the `essentials_invite` localStorage handoff and are sent to `/join` after sign-in.

- [ ] **Step 1:** Rewrite `lib/auth.js`: `api()` reads the token from `supabase.auth.getSession()` per call (no localStorage token), `fetchMe()` returns the pinned `/auth/me` body, `redeemInvite(code)` posts `{ code }` with the bearer token, `signOut()` calls `supabase.auth.signOut()`. Delete `requestMagicLink` / `verifyMagicLink` / `setToken` / `getToken`.
- [ ] **Step 2:** Rewrite `AuthContext.jsx` per the pinned shape and delete every `base44.auth.*` / `appParams` reference (grep `base44` afterwards — only `base44/config.jsonc` and content tooling may remain).
- [ ] **Step 3:** `AuthCallback.jsx`: `exchangeCodeForSession(code)` → `fetchMe()` → `inviteRequired` ? `/join` : privileged aal1 ? render the "finish two-step setup in the dashboard" handoff : `navigate("/")`. Missing/expired code → error state with a "send a new link" link. `Join.jsx`: code-only form (email comes from the session), auto-redeems a stored invite, shows `EXPIRED`/`revoked`/`already used` messages distinctly.
- [ ] **Step 4:** `Login.jsx`: magic link (`emailRedirectTo: `${window.location.origin}/auth/callback``) + Google (`signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } })`) + password form; a wrong password shows "use a link instead". `Register.jsx` → invite-code signup (requires a session; otherwise CTA to `/login?invite=…`). `ForgotPassword.jsx` → `resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/auth/callback?type=recovery` })`. `ResetPassword.jsx` → `updateUser({ password })`. In `AuthCallback.jsx`, when the URL carries `type=recovery`, exchange the code and route to `/reset-password` instead of the normal landing logic.
- [ ] **Step 5:** Update `App.jsx` routes + wrap `<AuthProvider>`; update `ProtectedRoute.jsx` to redirect to `/login` when unauthenticated and to `/join` when `/auth/me` reports `inviteRequired` (drop `UserNotRegisteredError`). Update `jsconfig.json` `include` to cover `src/lib/**/*.js` and `src/App.jsx`; add the auth note to `AGENTS.md`.
- [ ] **Step 6:** Verify: `npm run build -w base44-app` (Vite) and `npm run typecheck -w base44-app` — expected exit 0. Grep proof: `rg -i "base44\\.auth|appParams|essentials_token" apps/site/src` → no matches.
- [ ] **Step 7:** Commit: `feat(site): move public site to supabase auth and remove base44 auth`.

---

## Task 9: Mobile (`apps/mobile`) — deep-link PKCE, SecureStore, MFA screen

**Files:** create `lib/supabase.ts` (Task 6 created it — extend), `app/auth/callback.tsx`, `app/auth/mfa.tsx`; modify `app.json`, `app/_layout.tsx`, `app/index.tsx`, `app/auth/invite.tsx`, `app/auth/profile.tsx`, `package.json` (add `expo-web-browser`), `tsconfig.json`; delete `app/auth/verify.tsx`.

**Behaviour pinned:** scheme `essentials`; magic link `emailRedirectTo: "essentials://auth/callback"` (dev: Expo's `exp://` URL); callback screen exchanges the `code`, calls `/auth/me`, routes `inviteRequired` → `/auth/invite`, privileged aal1 → `/auth/mfa`, else `/(tabs)/events`. Invite redeem posts `{ code }` with the session bearer. Guest users never see the assistant or MFA UI.

- [ ] **Step 1:** `app.json` already declares `"scheme": "essentials"` — confirm it stays. Update `_layout.tsx`: register `auth/callback` and `auth/mfa` screens, remove `auth/verify`; restore the session before first render and `setAccessTokenProvider` (Task 6 wiring).
- [ ] **Step 2:** `index.tsx`: replace `api.post("/auth/magic-link")` with `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: "essentials://auth/callback" } })`; show a "check your email" state (no token paste). Delete `auth/verify.tsx`. Add the OAuth path for the same screen: `signInWithOAuth({ provider: "google", options: { redirectTo: "essentials://auth/callback", skipBrowserRedirect: true } })` → `WebBrowser.openAuthSessionAsync(url, "essentials://auth/callback")` (add `expo-web-browser`) → the returned URL is handled by `auth/callback.tsx`.
- [ ] **Step 3:** `auth/callback.tsx`: parse `code` from params/deep link, `exchangeCodeForSession`, then `/auth/me` routing as pinned; error state offers "send a new link".
- [ ] **Step 4:** `auth/invite.tsx`: post `{ code }` via the api-client (now bearer-injected); on success `router.replace("/(tabs)/events")`; on 401 `MFA_REQUIRED` → `/auth/mfa`. `auth/profile.tsx`: read `/auth/me` (drop any stored-token assumption).
- [ ] **Step 5:** `auth/mfa.tsx`: `mfa.enroll({ factorType: "totp" })` → render with `react-native-qrcode-svg` (already a dependency) → `challengeAndVerify` → refresh → continue.
- [ ] **Step 6:** Add `"typecheck": "tsc --noEmit"` to `apps/mobile/package.json`; run it — expected exit 0. (No simulator run required for this task; the deep-link flow is covered by the manual checklist in Task 10.)
- [ ] **Step 7:** Commit: `feat(mobile): supabase deep-link sign-in with secure session persistence`.

---

## Task 10: Live HTTP proof, env template, docs

**Files:** create `scripts/auth-proof.mjs`, `docs/auth.md`; modify `.env.example`, `README.md`, root `package.json` (script `proof:auth`).

- [ ] **Step 1:** `.env.example`: remove `JWT_SECRET`, `JWT_EXPIRES_IN`, `MAGIC_LINK_TTL_MINUTES`; `MOBILE_URL="essentials://"`; add

```
SUPABASE_URL="http://127.0.0.1:54321"
SUPABASE_ANON_KEY=""
SUPABASE_SERVICE_ROLE_KEY=""
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
NEXT_PUBLIC_SUPABASE_ANON_KEY=""
VITE_SUPABASE_URL="http://127.0.0.1:54321"
VITE_SUPABASE_ANON_KEY=""
EXPO_PUBLIC_SUPABASE_URL="http://127.0.0.1:54321"
EXPO_PUBLIC_SUPABASE_ANON_KEY=""
```

- [ ] **Step 2:** Write `scripts/auth-proof.mjs` (Node 20 `fetch` + `prisma` from `@essentials/db` for setup/assertions). It prints **actual** status + body for each check and exits non-zero on failure:
  1. Setup: `POST {SUPABASE_URL}/auth/v1/admin/users` (service key, `email_confirm: true`) for `proof-guest@example.test` **and the seeded `promoter@essentials.example`** (so the guard's DB fallback finds a real promoter row); `prisma.invite.create({ code: "PROOF-INVITE", role: "guest", maxUses: 5 })` (delete it first if it exists).
  2. `POST {SUPABASE_URL}/auth/v1/token?grant_type=password` for each → access tokens.
  3. `GET /api/auth/me` as guest → `200`; second call → still `200` (and no second `lazy_link` event — assert via Prisma count).
  4. `GET /api/analytics/overview` (or any `@Auth("promoter","admin")` route) as guest → `403`.
  5. `GET` the same route as `promoter@essentials.example` (aal1) → `401` with `code: "MFA_REQUIRED"` (proves claim-absent DB fallback + MFA gate).
  6. `POST /api/auth/invite/redeem` with `PROOF-INVITE` as `proof-guest@example.test` → `200`, `prisma.invite.uses === 1`, and `/auth/me` afterwards reports role `guest` (cache invalidation worked). Then five more attempts in the same hour with intentionally invalid codes → the 6th request for that IP+email returns `429`.
  7. `POST /api/auth/magic-link` → `404` (deleted contract).
- [ ] **Step 3:** Run it: `supabase start`, `npm run db:migrate`, `npm run db:seed`, `npm run dev:api`, `node scripts/auth-proof.mjs`. Paste the real output into the task notes — a passing build is **not** evidence.
- [ ] **Step 4:** Write `docs/auth.md`: hosted project creation, redirect URL allow-list (`https://<dashboard>/auth/callback`, `https://<site>/auth/callback`, `essentials://auth/callback`), Resend SMTP for Supabase auth mail (distinct from the app's `MAIL_PROVIDER`), Google OAuth setup, Apple behind `AUTH_APPLE_ENABLED`, TOTP policy + enforcement roles, rate-limit table, circuit: lazy-link ordering, ghost Base44 users, why no cookies / no RLS, local-CLI → hosted is a `.env` swap.
- [ ] **Step 5:** Update `README.md` quickstart (Supabase CLI step, env names, `npm test`, `npm run proof:auth`).
- [ ] **Step 6:** Commit: `docs(auth): document supabase cutover and add live auth proof script`.

**M1 done when:** `npm test -w @essentials/api`, `npm test -w @essentials/api-client`, `npm run build -w @essentials/api`, `npm run build -w @essentials/web`, `npm run build -w base44-app`, `npm run typecheck -w base44-app`, `npx tsc --noEmit -p apps/mobile` all pass, and `scripts/auth-proof.mjs` prints the pinned statuses against a local stack. Manual E2E (dashboard link → MFA → sign-out; site invite join; mobile deep link surviving restart) recorded as a checklist in `docs/auth.md` — run it before deploying M2.

---

# Sequenced milestones after M1

Streams after M1 (M1 is the gate for everything):

```
M1 ──► M2 (VPS stack + deploy) ──► M2b (RTMP live player)
    └─► M3 (assistant core) ──► M4 (dashboard panel) ──► M9 (social pipeline)
                            └─► M5 (site widget)  ──► M10 (mobile staff + content)
    └─► M6 (Phase 2) ──► M7 (Phase 3) ──► M8 (Phase 4)
```

Expansion (M6–M8) only needs M1's stable auth/API contract, not the assistant. M2 can start the moment M1's proof passes.

## M2 — VPS foundation (whole stack)

1. **Inventory over SSH** → `docs/vps-inventory.md`: OS, CPU/RAM/disk, open ports, current containers, the existing agent's stack, which model runtime is present.
2. **Production compose** (`docker-compose.prod.yml`): `postgres`, `redis`, `api`, `web`, `site` (built static), `caddy`, model runtime; healthchecks; restart policies; no host-mapped DB port.
3. **Dockerfiles**: multi-stage for `api` and `web`; `site` build served from Caddy `file_server`.
4. **Caddyfile**: hostnames from `.env` (site / dashboard / api), automatic TLS, security headers, `/api/*` reverse proxy, gzip/zstd.
5. **GitHub Actions** `.github/workflows/deploy.yml`: on push to `main` → build → SSH → `docker compose pull/up -d` → health gate (`/api/health`) → previous-image rollback on failure.
6. **Secrets**: `.env` on the VPS only; add the production hostnames to Supabase redirect URLs (docs/auth.md checklist).
7. **Backups**: nightly `pg_dump` sidecar/cron, dated archives, 14-day retention.
8. **Smoke**: certs issued, one real sign-in, one API call, one page load.

**Owner inputs:** SSH host/user/port + key, DNS records, final hostnames.

## M2b — Live RTMP player (site front page)

1. `mediamtx` service + `mediamtx.yml`: RTMP ingest with publish key from env, HLS output on :8888.
2. Caddy: `https://<site>/hls/*` → `mediamtx:8888` (CORS + short cache headers).
3. Site: `hls.js` dependency; `LiveNow.jsx` mounted directly below `HeroCinema` in `Home.jsx`; probe manifest every 60 s; render nothing when offline; muted autoplay + unmute control; teardown `hls.destroy()` on unmount.
4. Local dev: section hidden when no manifest (no fake player).
5. Prove with `ffmpeg -re -i sample.mp4 -c copy -f flv rtmp://127.0.0.1:1935/live/<key>` and document OBS settings in `docs/live.md`.

## M3 — Assistant core (API)

1. Read the VPS agent over SSH → `docs/agent-inventory.md` (prompts, tool list, UI features worth porting).
2. Prisma models: `Conversation`, `AssistantMessage`, `Draft`, `ScheduledPost`, `ChannelCredential`, `AssistantUsage`.
3. `assistant` module: `LlmProvider` interface + OpenAI-compatible client (`LLM_BASE_URL`, `LLM_MODEL`, `LLM_MAX_TOKENS`), one instance, server-side only.
4. Tool registry: read-only tools from spec §5.3, schema-validated args, role-scoped through existing services.
5. Conversations + SSE message stream; persistence with token accounting; per-role throttles and monthly budget cap with degraded reply.
6. Drafts: create/list, approve/reject with role scoping, audit rows.
7. Public chat endpoint: unauthenticated, 10 req/10 min/IP, public event data only (explicit test: response never contains `email`/guest-list/analytics fields).
8. Port prompts; record a 10-question golden eval baseline.

## M4 — Dashboard assistant UI

1. Slide-over assistant panel (SSE consumer, conversation resume, surface-aware context).
2. Approvals page (queue, diff/preview, approve/reject/schedule).
3. Copywriting actions on event/campaign forms (draft → approve).
4. Co-pilot chat responses with cited numbers; mobile-responsive layout.
5. Build + manual pass on every dashboard route.

## M5 — Site assistant

1. Dismissible chat widget (public + signed-in variants).
2. "Plan my night" flow: taste/vibe/loyalty inputs → grounded event picks; signed-out shows public-only.
3. Rate-limit UX (429 state, no retry storm); build + manual pass.

## M6 — Phase 2 (venue portal, matching, group chats, segments)

1. Event status transitions + `submit-for-approval` / `venue-decision` endpoints.
2. Venue-side approval UI (dashboard venue portal) + promoter status UI.
3. Matches endpoint (shared taste score, event-scoped, no DMs) + audience view + site "plan my night" hook.
4. Group chat API + UI (mobile event chat exists — add site + polling).
5. Segment builder UI wired to the email engine + AI suggestions tab.

## M7 — Phase 3 (artist portal, collisions, invoices)

1. Artist profile edit (consumption L/100km, rate/km).
2. Booking create/update with setup/teardown buffers and fees.
3. Collision detection endpoint from `BookingRouteLeg.isConflict` + dashboard alert.
4. Invoice generation + existing PDF script + payment-link status tracking.

## M8 — Phase 4 (payments, white-label, profitability)

1. Payment capture behind `PAYMENT_PROVIDER` (sandbox default) + webhook verification.
2. Profitability endpoints (`venueRevenuePct`, `revenueSplitPromoterPct`) + charts.
3. White-label config (tenant name/logo/theme) — single tenant.

## M9 — Social pipeline

1. Draft kinds per channel; format-aware prompts (IG/FB caption+hashtags, X ≤280/thread, TikTok caption+tags).
2. BullMQ repeatable scheduler + state machine (`queued → publishing → published | failed`, 3 retries, backoff).
3. Publishers per channel with a sandbox/no-credential mode that never 500s.
4. Credential vault UI (`ChannelCredential`, encrypted payload) + dashboard Social calendar.

## M10 — Mobile staff assistant, night-of ops, site content

1. Role-gated assistant screen (staff only; guests never see it) reusing M3 endpoints.
2. Night-of ops view (door/headcount/no-show nudges, drafts only).
3. Site content expansion (lineups, venues, editorial/FAQ, past events) on `SiteContent` + editor wiring.

## Cross-cutting for M2–M10

- Every new API route uses the existing `@Auth(...roles)`; assistant tools reuse the same service layer (no parallel auth path).
- Tests grow with each milestone: assistant authz matrix (M3), approval state machines (M3/M6), scheduler idempotency (M9).
- Each milestone ends with `npm run build --workspaces` + the live VPS smoke test from §12 of the expansion spec.
