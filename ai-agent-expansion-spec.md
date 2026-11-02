# ESSENTIALS — AI Assistant + Platform Expansion Spec

**Status:** Draft for review (no code changes made yet)
**Date:** 2026-10-30
**Source:** 6 rounds of clarifying interview with the owner, plus codebase review of `github.com/Gollapaguws/essentials-app` @ `origin/main` (`e495dce`)

---

## 1. Goal

Two equally-prioritized tracks (owner's explicit choice — neither blocks the other):

1. **Add an in-app AI assistant** to ESSENTIALS: a conversational agent with tool access to live platform data, running on a **single free/local inference endpoint on the owner's VPS**, surfaced in the promoter dashboard, the public site, and the mobile app (staff), with a **draft → human approval → scheduled action** model — including **AI-native features** (copywriting, co-pilot chat, segmentation, night-of ops, social posting).
2. **Expand the app across the whole platform**: ship Phase 2, Phase 3 and Phase 4 roadmap features, add beyond-roadmap (AI-native) features, and expand the public site's content.

Plus two dependencies the owner folded in during the interview:

3. **Supabase authentication overhaul** — the previously approved design (Approach A, Supabase end-to-end) is **folded into this spec** and must be implemented as part of this work.
4. **Migration of the entire stack to the owner's VPS**, Docker Compose + Caddy + Let's Encrypt + git-push deployment. SSH details to be provided after spec approval.

---

## 2. Current state (context from code review)

### 2.1 Monorepo layout
| Path | What it is |
|---|---|
| `apps/api` | NestJS 10 API (prefix `/api`), Prisma via `@essentials/db`, BullMQ jobs, `@nestjs/throttler` (global, 120/min, in-memory), helmet, CORS from `CORS_ORIGINS`, Resend/console mail |
| `apps/web` | Next.js 14 promoter dashboard (:3001) — analytics, events, email engine, venue, promotions, artist, insights, front-page editor, invites |
| `apps/site` | Vite + React public site (essentialsedm.com) — **dual auth legacy**: half talks to NestJS (`lib/auth.js` magic link), half still calls the **Base44 SDK** (`Register.jsx`, `ForgotPassword.jsx`, `ResetPassword.jsx`, `AuthContext.jsx`, `ProtectedRoute.jsx`, `PageNotFound.jsx`); ships a Base44 MCP OAuth consent page; content/CDN images still hosted on `media.base44.com` |
| `apps/mobile` | Expo (expo-router) guest app — tabs: events, passes, loyalty; magic-link + invite onboarding |
| `packages/db` | Prisma schema (27 models) + migrations + seed |
| `packages/api-client` | shared typed fetch client (web + mobile) |

### 2.2 Auth today (to be replaced — see §7)
Homegrown: HS256 JWT (`JWT_SECRET`, 7d, no refresh/revocation), HMAC magic-link tokens, invite-code signup, roles `guest|artist|promoter|venue_manager|admin` stored in Prisma `User` and embedded in the JWT, enforced by `RolesGuard` behind the `@Auth(...roles)` decorator. Known bugs are listed in §7.4.

### 2.3 Roadmap already in the schema, with no UI
- **P2:** `DoorLog`, venue approval workflow (`EventStatus.pending_venue_approval`), `Match`, `EventGroupChat` + `GroupMessage.isIcebreaker`, `EmailSegment`
- **P3:** `ArtistProfile`, `ArtistBooking`, `BookingRouteLeg.isConflict` (schedule collision alert), `Invoice`/`InvoiceItem`/`Payment`
- **P4:** `venueRevenuePct` / `revenueSplitPromoterPct` profitability reporting

### 2.4 Repo facts that shaped the plan
- Local clone was 24 commits behind; fast-forwarded to `origin/main` during context gathering. Working tree otherwise untouched.
- The only open PRs (#1, #2) are dependabot dependency bumps — **no existing agent code exists in this repo**.
- **There is no test infrastructure at all** (no test files, no jest/vitest config, no test scripts).
- Existing agent = "a chat assistant with its own UI" **running on the owner's VPS** (SSH details to follow); it must be ported/integrated, and the platform moves to that VPS too.
- `apps/site/AGENTS.md` still frames the site as "a Base44 app repository".

---

## 3. Requirements gathered (interview decision log)

### Round 1 — what the agent is
| Question | Decision |
|---|---|
| Agent type | **In-app AI assistant** (not an MCP server, not background-only) |
| Surfaces | **Dashboard + mobile + site + API/background** (all four; external MCP clients are out of scope) |
| Model/provider | **Free / local only** — no API spend |
| Existing work | **Yes — owner has existing agent code to build on** (later revealed: on the VPS) |

### Round 2 — expansion scope
| Question | Decision |
|---|---|
| Existing agent location | "ON MY vps" |
| Which app to expand | **The whole platform** |
| What "expanded" means | **Phase 2 + Phase 3 + Phase 4 + beyond-roadmap features + more site content** (everything except a pure scale/hardening pass) |
| Priority | **Equal — spec covers both tracks** |

### Round 3 — VPS and inference
| Question | Decision |
|---|---|
| VPS relationship | **SSH access; the app must also move to the VPS** |
| Existing agent functionally | **A chat assistant with its own UI** |
| Inference location | **One endpoint on the VPS** (model served there; API proxies it; clients never hold keys) |
| "Beyond roadmap" features | **AI-native features** |

### Round 4 — deployment and behavior
| Question | Decision |
|---|---|
| Deploy shape | **Docker Compose, whole stack** (extend the existing compose file) |
| VPS access for me | **SSH details to follow** (after spec approval) |
| Domains/CI | **Caddy + Let's Encrypt, git-push deploy** (GitHub Actions on push to main) |
| Assistant autonomy | **Read + draft, human approves** before anything ships |
| AI features | Copywriting · promoter co-pilot chat · guest "plan my night" · smart segmentation & send-time · night-of ops assistant · **social media posting from the platform** (owner's addition) |

### Round 5 — audience
| Question | Decision |
|---|---|
| Who uses it | **Admin + promoter (dashboard)**, **venue managers + artists**, **public visitors on the site** |

### Round 6 — gap-filling
| Question | Decision |
|---|---|
| Mobile assistant audience | **Staff on mobile too** (guests get *nothing* in the mobile app) |
| Social posting depth | **Draft → approval queue → scheduled post** |
| Social channels | **Instagram, Facebook, X (Twitter), TikTok** (all selected) |
| Conversation/draft storage | **Prisma Postgres** |
| Relationship to Supabase auth design | **Fold Supabase auth into this spec** (one combined spec) |

### Resolved ambiguity (stated explicitly)
Round 4 chose the "Guest 'plan my night' assistant" feature, while Rounds 5–6 restricted the assistant to staff on mobile. **Resolution:** the guest-facing "plan my night" experience lives on the **public site** (the surface where public visitors are an audience); the **mobile assistant is staff-only**; guests in the mobile app keep the existing feed/passes/loyalty experience. Signed-out site visitors get public-event recommendations only; signed-in guests on the site get taste/loyalty personalization.

---

## 4. In scope / out of scope

**In scope**
1. Supabase Auth overhaul across all four apps (§7).
2. Assistant core: conversation loop, tool use, role-scoped data access, approval queue, audit (§5).
3. AI-native features incl. social posting pipeline (§6).
4. Platform expansion: Phases 2, 3, 4 + site content expansion (§8).
5. VPS migration: Compose stack, Caddy TLS, CI deploy, backups (§9).
6. Prisma schema additions, tests, verification (§10, §11).

**Out of scope**
- External AI clients / MCP server integration (the site's legacy Base44 MCP consent page is removed with the Base44 auth code, not rebuilt).
- 1-on-1 DMs and ads platform (explicitly excluded by the product).
- Guest-facing assistant **inside the mobile app** (site only, per §3 resolution).
- Session-management UI (declined during auth interview).
- Bulk-importing users to Supabase (lazy-link instead).
- Filling in social-platform API credentials, Apple/Google OAuth credentials, and Supabase hosted setup — spec documents *where* they go; owner supplies them later.
- Base44 CDN content migration (images/fonts stay where they are unless separately requested).

---

## 5. Assistant architecture (core)

### 5.1 Placement decision
The agent backend lives **inside `apps/api` as a NestJS module** (`apps/api/src/assistant/`) rather than as a fifth deployable:
- it needs the same role-scoped Prisma queries the API already guards,
- it reuses BullMQ (already wired) for scheduled posts and background drafting,
- one compose stack, one deploy, no inter-service auth to invent.

The VPS chat assistant's prompts/tools are **ported into this module** (source to be read over SSH after spec approval); its UI is replaced by the in-app panels below.

**Model access:** one OpenAI-compatible endpoint on the VPS (Ollama or equivalent), configured by env:
`LLM_BASE_URL` (e.g. `http://ollama:11434/v1`), `LLM_MODEL`, `LLM_MAX_TOKENS`, `LLM_MONTHLY_TOKEN_BUDGET`.
A thin provider interface (`generate`, `stream`, `toolCall`) keeps the app free of provider lock-in; **clients never call the model directly** — all inference is proxied server-side.

### 5.2 Request flow
```
client panel → POST /api/assistant/... (Bearer JWT, role-gated or public-throttled)
  → AssistantService assembles context (role-scoped Prisma reads + tool allowlist)
  → LLM call (streamed back as SSE where interactive)
  → tool calls executed against existing services (never raw SQL, never service-role keys)
  → response / draft persisted (Prisma) → audit row written
```

### 5.3 Tools the assistant may call (v1, read + draft only)
`events.read`, `rsvp.read`, `analytics.read`, `loyalty.read`, `segments.read`, `campaigns.read/write(draft)`, `venues.read`, `invoices.read`, `promotions.read`, `siteContent.write(draft)`, `social.write(draft)`.
**No tool in v1 mutates live data directly** — anything that changes state becomes a `Draft` awaiting approval (§5.5). Tool results are role-filtered by the same guards as the equivalent REST endpoints; the assistant never widens access beyond the signed-in user's role.

### 5.4 Guardrails & cost control
- Per-role rate limits (throttler moved to Redis): public site assistant 10 req/10 min/IP; staff 30 req/min.
- Monthly token budget counter per role with a hard cap and a degraded mode (assistant answers "budget reached").
- Prompt-injection rules: user content is always delimited; tool arguments are schema-validated (class-validator) — the model cannot inject arbitrary queries.
- PII: the **public/anonymous assistant sees only public event content** (no emails, no guest lists, no analytics). Staff tools are scoped exactly like today's `@Auth()` endpoints.
- Every turn stored with model, token usage, tool calls, latency (→ `AssistantMessage` + `AuthEvent`-style audit).

### 5.5 The approval queue (heart of "read + draft, human approves")
New Prisma models:
```
Draft        id, kind (event_copy|campaign|segment|social_post|site_content|schedule),
             status (pending|approved|rejected|published|failed), payload Json,
             targetId?, createdById, reviewedById?, reviewNote?, createdAt, reviewedAt
ScheduledPost id, draftId, channel (instagram|facebook|x|tiktok),
             scheduledFor, status (queued|publishing|published|failed),
             externalId?, attempts, lastError
ChannelCredential id, channel, encryptedPayload, createdBy  // added later by owner
```
Endpoints: `GET /api/assistant/drafts`, `POST /api/assistant/drafts/:id/approve|reject`.
Approval is role-gated (promoter/admin/venue_manager may approve their own scope; admins may approve all). Publishing runs on a BullMQ repeatable job every minute; failures retry 3× with backoff, then park as `failed` with the reason visible in the dashboard.

### 5.6 Conversation persistence
Prisma Postgres: `Conversation (id, userId, surface, title, createdAt)` + `AssistantMessage (id, conversationId, role, content, toolCalls Json, tokensIn, tokensOut, createdAt)`. Role-scoped reads like every other query (`userId` match, admin override). History powers resume-on-reload and quality review.

---

## 6. Assistant features & surfaces

### 6.1 Feature specs
| Feature | Behavior | Primary surface |
|---|---|---|
| **Event & campaign copywriting** | Input: date/venue/lineup/vibe → generates event description, email subject/body variants, social captions per channel. Produces a `Draft`. | dashboard, mobile (staff) |
| **Promoter co-pilot chat** | Conversational analytics: "how did last weekend compare", "who didn't show", "what should I run next" — answers grounded in role-scoped queries with cited numbers. Read-only + draft proposals. | dashboard, mobile (staff) |
| **Guest "plan my night"** | Event recommendations by taste (`musicTastes`, `vibeTag`), loyalty status, group plans. Public subset when signed out; personalized when signed in. | **site** |
| **Smart segmentation & send-time** | Proposes `EmailSegment` definitions + send windows from historical `EmailEvent` engagement; human approves, then feeds the existing campaign engine. | dashboard |
| **Night-of ops assistant** | Live door/headcount, no-show risk, capacity nudges during an event window; alert drafts, never auto-actions. | dashboard + mobile (staff) |
| **Social posting** | Draft per channel (format-aware: IG/FB caption+hashtags, X ≤280 w/ threads, TikTok caption+tags) → approval queue → scheduled publish (§5.5). | dashboard |

### 6.2 UI per surface
- **Dashboard:** a persistent assistant panel (slide-over) on analytics/events/email pages + a new **Approvals** page (queue, preview, approve/reject, schedule) and a **Social** page (calendar of `ScheduledPost`).
- **Site:** a dismissible chat widget; public visitors get "plan my night"; signed-in guests get personalization. Hard rate limits (§5.4).
- **Mobile (staff):** a new "Assistant" screen reachable only for `promoter|admin|venue_manager|artist` roles (route guard + role chip); guests never see it (§3 resolution).

---

## 7. Supabase authentication overhaul (folded in — approved design)

> Canonical document: **`supabase-auth-overhaul-spec.md`**. This section is the summary; where the two differ, that file wins.

### 7.1 Approach (approved: "A — Supabase end-to-end")
Supabase Auth only; existing Postgres/Prisma stays the system of record; NestJS verifies Supabase JWTs. All clients use `@supabase/supabase-js` (PKCE on web/site, `expo-secure-store` persistence + `WebBrowser` OAuth on mobile) through a new shared `packages/auth` factory.

### 7.2 API side
- `SupabaseAuthGuard` replaces the Passport JWT strategy: Bearer → `jose` remote JWKS (cached, 5-min cooldown, unknown-`kid` refresh) → `{ sub, email, role, aal }`. **`@Auth(...roles)` and `RolesGuard` keep their exact signatures** across ~20 controllers.
- `ensureUser(sub, email)` lazy link: match `User.authUid` (new unique column) → else match email and bind → else create. In-process 60s cache ⇒ **no DB read per request on the hot path**.
- Roles stay canonical in Prisma, mirrored to Supabase `app_metadata.role` on invite redeem / role change / seed via the service-role key; guard reads the claim first, DB fallback if absent.
- **MFA (TOTP) required for `promoter`, `venue_manager`, `admin`:** aal1 tokens on those roles → `401 MFA_REQUIRED`; dashboard owns enrollment; site shows a "finish setup in dashboard" handoff. Artists/guests stay aal1.
- Password fallback (`signInWithPassword`) alongside magic link; Supabase recovery replaces Base44 reset pages.
- Rate limiting: throttler moves to Redis storage; invite redeem 5/hr/IP+email, `/auth/me` 30/min, assistant limits per §5.4.
- `AuthEvent` audit table: invite redeemed, role change, MFA enrollment/escalation, lazy-link `sign_in`.
- Deleted: `POST/GET /auth/magic-link`, `POST/GET /auth/verify`, HMAC token code, Passport strategy, `JWT_SECRET` / `JWT_EXPIRES_IN` / `MAGIC_LINK_TTL_MINUTES`. Kept: `POST /auth/invite/redeem` (reworked: validates code, then sets `app_metadata.role` server-side), `GET /auth/me` (lazy-link endpoint returning canonical role + `INVITE_REQUIRED`).
- Env added: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-only, boot fails fast in prod if missing).

### 7.3 Per-app changes
- **web:** `/auth/callback` PKCE route; login sends the link (paste-token box deleted); `SessionProvider` exposing `{user, role, aal}`; **TopNav gains sign-out** (today there is none); `/auth/mfa` enrollment page; client route guards on `/dashboard/*`.
- **site:** `AuthContext` rewritten on `supabase.auth.onAuthStateChange` (same shape `ProtectedRoute` consumes); Login gains Google + password; `Register.jsx` becomes invite-code signup; Forgot/Reset → Supabase recovery. **Deleted:** `api/base44Client.js`, `lib/app-params.js`, `UserNotRegisteredError.jsx`, all `base44.auth.*` calls, the MCP consent page. **Kept:** `base44/` config, CDN content, `base44 dev` workflow (content/tooling, not auth).
- **mobile:** `essentials://` deep-link scheme, SecureStore adapter (fixes token-lost-on-restart), session restore in `app/_layout.tsx`, invite/profile repoint, MFA screen for staff.
- **packages/api-client:** injected `getAccessToken()` + single refresh-and-retry on 401; module-level `localStorage` read removed.

### 7.4 Bugs fixed by this work (the "check bugs" list)
1. `apps/web/src/app/page.tsx` — local `const [token, setToken] = useState()` **shadows the imported `setToken`** ⇒ client token never set in memory ⇒ unauthenticated calls until full reload.
2. Magic-link tokens are **replayable for the full TTL** — `nonce` never stored/checked despite "single-use" copy.
3. `GET /auth/verify?token=` leaks tokens into logs/Referer.
4. Mobile token never persisted (comment claims SecureStore; nothing wires it).
5. No sign-out anywhere in the dashboard.
6. Invite over-use race: `uses >= maxUses` checked, then unconditional increment ⇒ conditional `updateMany({ where: { uses: { lt: maxUses } } })`.
7. `api-client` reads `localStorage` at import time (first-load race).
8. `RequestMagicDto.mobile?: boolean` validated with `@IsString()`; unused `role` param on `redeemInvite`.
9. Site runs **two parallel auth systems** (NestJS + Base44) — unified.
10. **Data caveat:** anyone who registered via Base44's `Register.jsx` exists only in Base44, never in Prisma — lazy-link cannot find them; they need a one-time invite email if any are real users.

### 7.5 Verification for auth
Jest (new to the repo): guard accepts valid / rejects expired, bad-signature, missing-claim; aal1 blocked on privileged roles with `MFA_REQUIRED`; role DB fallback; invite race cannot exceed `maxUses`; `ensureUser` links by `authUid` then email then creates. Live HTTP proof against local Supabase: token → `GET /api/auth/me` lazy-link → role-gated 403 for guest → MFA 401 → rate-limit 429. Documented hosted setup (redirect URLs, Resend SMTP, Google/Apple OAuth) in `docs/auth.md`.

---

## 8. Platform expansion

### 8.1 Phase 2 — venue portal, matching, group chats
- **Venue approval workflow:** promoter submits event → `pending_venue_approval` → venue_manager approves/rejects with note → status transitions enforced server-side + dashboard/site UI for both sides.
- **Matching:** `Match` model → preference-based suggestions ("people going to the same nights"), surfaced in the site assistant's "plan my night" and a dashboard audience view. Respects the no-DMs rule: matches produce **group/event context only**, never 1-on-1 messaging.
- **Group chats:** `EventGroupChat` + `GroupMessage.isIcebreaker` → event chat UI in mobile + site; icebreaker prompts optionally drafted by the assistant (draft → approve). Polling-based delivery in v1 (no new realtime infra); WebSocket noted as a later option.
- **Segments:** `EmailSegment` UI wired to the existing engine, plus the AI segment suggestions (§6.1).

### 8.2 Phase 3 — artist portal depth
- Artist profile editing (vehicle L/100km, rate/km) in `dashboard/artist`.
- Booking flow with setup/teardown buffers and fees; **schedule collision alert** from `BookingRouteLeg.isConflict`, surfaced in the assistant's night-of/ops answers.
- Invoices: generate `Invoice`/`InvoiceItem`, PDF via existing `scripts/invoice-pdf.mjs`, payment links (PayFast/Stripe per existing env), status tracking.

### 8.3 Phase 4 — payments, white-label, advanced analytics
- Payment capture behind the existing `PAYMENT_PROVIDER` abstraction (sandbox default), webhook verification, `Payment` records tied to invoices/tables.
- Profitability reporting using `venueRevenuePct` / `revenueSplitPromoterPct` (per-event, per-venue, per-promoter margins) — a prime target for the co-pilot's "what should I run next" answers.
- White-label: tenant name/logo/theme via config (single-tenant first; no multi-tenant refactor).

### 8.4 Site content expansion
More public pages (lineups, venues, editorial/FAQ, past-events archive) driven by the existing `SiteContent` model + the dashboard front-page editor, so non-developers can update them. Content authored with the copywriting assistant (draft → approve). Migration of `media.base44.com` assets is **not** part of this spec.

### 8.5 Live RTMP player (front page) — added 2026-10-31, post-spec interview
The public site's home page gets a **live video section directly below `HeroCinema`** on `apps/site`'s `Home.jsx`, rendered **only while a stream is active**.

- **Ingest:** self-hosted RTMP on the VPS — a **MediaMTX** container in the root `docker-compose.yml` accepts `rtmp://<host>/live/<stream-key>` (publish credentials from env), converts to HLS, served through Caddy at `https://<site-host>/hls/*`.
- **Playback:** browsers cannot play RTMP natively, so the section embeds the HLS stream via **`hls.js`** in a `<video>` element. The front end probes the HLS manifest every 60 s; the section renders only on a 200 (otherwise it is absent — no dead player).
- **Local dev:** no stream running → section hidden; **no API changes required** for v1.
- Owner decisions: placement = below hero on site home; timing = its own milestone **after** the VPS migration lands (M2b in §14).

### 8.6 Out-of-roadmap note
"New features beyond the roadmap" was defined by the owner as **AI-native features** — fully covered in §6; no additional unnamed features are implied.

---

## 9. VPS migration & deployment

### 9.1 Target state
- **Docker Compose, whole stack** — extend root `docker-compose.yml`:
  `postgres`, `redis`, `api` (NestJS), `web` (Next.js, production build), `site` (static build served by Caddy), `caddy`, `ollama` (or the owner's existing model service), and the existing services kept as-is.
- **Caddy + Let's Encrypt** terminates TLS for each hostname and reverse-proxies to `api`/`web`/`site`; automatic renewals.
- **GitHub Actions deploys on push to `main`:** build → `docker compose up -d` on the VPS over SSH → health-check gate → rollback on failure.
- **Secrets:** one `.env` on the VPS (never committed), including `SUPABASE_SERVICE_ROLE_KEY`, `LLM_BASE_URL`, social credentials, mail keys.
- **Backups:** nightly `pg_dump` to a dated archive with 14-day retention (cron in compose or host).
- **Mobile:** not served from the VPS — built locally/EAS with `EXPO_PUBLIC_API_URL` pointing at the VPS API; the VPS hosts only the API it talks to.
- **Existing site domain** (`essentialsedm.com`) keeps its DNS; spec assumes subdomains for dashboard/api (exact hostnames confirmed when SSH/DNS details arrive).

### 9.2 Open items requiring owner input (post-approval)
SSH host/user/port + key; which model is already running on the VPS (size must fit RAM/CPU — spec assumes a 7–14B class model); current VPS OS/resources; DNS zone details; social API developer app approvals (Meta business verification, TikTok developer review, X API tier).

---

## 10. Data model summary (new)

| Model | Purpose |
|---|---|
| `User.authUid` (column) | lazy link to Supabase `auth.users.id` |
| `AuthEvent` | auth audit trail |
| `Conversation`, `AssistantMessage` | assistant history, usage, tool-call audit |
| `Draft` | approval queue for every state-changing AI output |
| `ScheduledPost` | social scheduler state machine |
| `ChannelCredential` | per-channel API credentials (encrypted at rest) |
| Phase 2/3/4 models | already exist in schema — **no new columns required** for §8.1–8.3 beyond what's present |

---

## 11. API surface additions

```
# assistant
POST   /api/assistant/conversations                GET /api/assistant/conversations
POST   /api/assistant/conversations/:id/messages   (SSE stream)
POST   /api/assistant/public/chat                  (no auth, hard-throttled, public data only)
POST   /api/assistant/copy/event | /campaign
POST   /api/assistant/segments/suggest
GET    /api/assistant/drafts                       POST /api/assistant/drafts/:id/approve|reject
GET    /api/social/scheduled                       POST /api/social/scheduled
# expansion (P2/P3/P4)
POST   /api/events/:id/submit-for-approval         POST /api/events/:id/venue-decision
GET    /api/matches                                GET/POST /api/events/:id/chat
POST   /api/artists/bookings                       GET /api/artists/bookings/collisions
GET/POST /api/invoices[/ :id/pay]
GET    /api/analytics/profitability
# auth (reworked, see §7.2)
POST   /api/auth/invite/redeem   GET /api/auth/me   POST /api/auth/session-established
```

---

## 12. Verification plan (no test infra exists today — this creates the minimum)

1. **Jest for `apps/api`** (`npm test`): auth guard matrix (§7.5) + assistant authorization (public route never returns PII; staff tool calls respect role scope; draft approval rejects cross-role), social scheduler state machine (retry/backoff/idempotency), invite race, phase-2 approval state machine.
2. **Typecheck/build every workspace:** `tsc --noEmit` per app + `npm run build --workspaces` (the site once shipped blank from a JSX/TS annotation bug — this catches that class of failure).
3. **Live HTTP proof:** local `supabase start` + compose stack + seeded DB → real requests: magic-link → `/auth/me` lazy-link → role 403 → MFA 401 → assistant stream → draft approve → scheduled post row → profitability endpoint. Actual responses reported, not "build passed".
4. **Prompt evals:** a small golden set (10 questions: analytics answers, copywriting tone, "plan my night") run against the local model, recorded as a baseline before/after prompt changes.
5. **Deployment smoke test on the VPS:** compose up, Caddy issues certs, health endpoints green, one real sign-in through Supabase, one assistant turn, one scheduled-post dry run.

---

## 13. Risks & constraints (honest list)

- **Free/local models are weaker** than hosted frontier models: copywriting and multi-step tool use will need prompt tuning and the eval set; the provider interface keeps a later swap cheap.
- **VPS inference latency** may make streaming feel slow under concurrent users — mitigated by token budgets, queueing background drafting as BullMQ jobs, and keeping interactive turns short.
- **Social APIs require platform approval** (Meta business verification, TikTok review, X tier) — credentials arrive after code; scheduler must ship with a sandbox/no-credential mode.
- **Base44-registered users** don't exist in Prisma (§7.4 #10).
- **Supabase hosted setup is deferred** (local CLI now, documented cutover later).
- **Scope is deliberately large** (two equal tracks + auth + migration); §14 sequences it so each milestone is independently shippable.

---

## 14. Milestones (both tracks in parallel streams)

| # | Deliverable | Track |
|---|---|---|
| M1 | Test/typecheck harness + Supabase auth across API/web/site/mobile + bug fixes (§7) | foundation |
| M2 | VPS: Compose stack, Caddy TLS, CI deploy, backups; platform live on VPS | foundation |
| M2b | Live RTMP player: MediaMTX ingest → HLS via Caddy → hls.js section on site home (§8.5) | site |
| M3 | Assistant core in API: model endpoint, tools, conversations, approval queue, audit | agent |
| M4 | Dashboard: assistant panel, Approvals page, copywriting + co-pilot chat | agent |
| M5 | Site assistant ("plan my night", public + signed-in) + site auth unification | agent |
| M6 | Phase 2 expansion (venue approval, matching, group chats, segments UI) | expansion |
| M7 | Phase 3 expansion (artist portal, collisions, invoices, payment links) | expansion |
| M8 | Phase 4 expansion (payments, white-label, profitability) | expansion |
| M9 | Social pipeline: drafts per channel → approval → scheduler → publishers | agent |
| M10 | Mobile staff assistant + night-of ops; site content expansion | both |

**Assumptions** (flag if wrong): SSH details and credentials arrive after spec approval; social/Supabase-hosted/OAuth credentials arrive later but don't block M1–M8; the existing VPS assistant's code will be read before M3 and folded in rather than rewritten blind.
