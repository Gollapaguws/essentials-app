# Implementing the SONUS platform document

*Engineering plan. Companion to the vision document (November 2026). Nothing here
is committed to a date; the phases are ordered by dependency, not by promise.*

---

## 1. Read this first: what the code already does

The vision document describes three layers. Two of them are largely built. Of the
third — the one that turns SONUS into a sellable platform — the tenancy
foundation is now in production (see §2); the commercial layer above it is not
started: no plans, no billing, no entitlements.

This status is checked against `packages/db/prisma/schema.prisma`, the migrations
and `apps/api/src` as of 25 November 2026, not against the phase plan below.

| Document feature | State in this repo | Where |
| --- | --- | --- |
| Public event discovery, city/genre browsing | Partial — listings exist, genre is free text, no city filter | `apps/site`, `Event.genres String[]` |
| RSVP + personal phone door pass | Built | `events.service.ts`, `GET /events/:id/door-pass` |
| Door check-in by name, live headcount | Built (no QR scanner, by design) | `door` page, `DoorLog` |
| Waitlist when full | Built, manual promotion | `events.service.ts` (`waitlisted`) |
| Loyalty, referrals | Built | `loyalty` module, `LoyaltyVisit`, `Referral` |
| DJ profiles, blackout dates, slot applications, budgets | Built | `EventSlot`, `ArtistBooking`, `apps/web/(dashboard)/gig-calendar` |
| Complete-then-invoice, travel, settlements | Built | `invoices.service.ts`, `settlements` page |
| Live streaming + simulcast + Live Viewing Room baseline | Built as a **free, single-account** feature | `live` module, `StreamTarget`, `LiveChatMessage` |
| Email engine with segments, consent, unsubscribe | **Removed from the platform.** `20261123120000_remove_email_systems` dropped `Campaign`, `EmailSegment`, `EmailJob`, `EmailEvent`, `Consent` and `WhatsNewBroadcast`; bulk mail now runs through the separate PHPList deploy, outside the product | `deploy/phplist` |
| Social posting + scheduling + AI captions | Built; posts belong to a workspace | `social` module, `SocialPost.orgId` |
| Paid ticket tiers with stock and sale windows | Not built (RSVP only; tables were retired) | — |
| Reviews with photos | Not built | — |
| Hosts/hostesses/door staff profiles, availability, assignments | Not built — `door` is a role, and door gigs exist, but there is no marketplace around them | `door-gigs` |
| Service directory for other event professionals | Not built | — |
| Bookkeeping, merch store | Not built | — |
| Attendance forecasting | Not built (analytics is descriptive only) | — |
| Subscriptions, allowances, billing, entitlement gates | **Skeleton built** — `Hub`, `Plan`, `Subscription` and `UsageCounter` with seeded plans and comped subscriptions, the admin "Plan & usage" screen, and a 402 entitlement gate on the one metered choke point (Social Hub publish). No checkout, no `QuotaOverride` | `billing` module, `/plan` |
| Multi-organisation tenancy (SONUS hubs, white-label, licensing) | **Foundation built**: `Organisation`, `Membership`, `orgId` on `Event`/`Venue`/`SocialPost`, `platform` module. No `Hub`, no licensing model | §2 |

Three corrections to the vision document's assumptions:

- **VIP table bookings no longer exist.** `20261107060000_drop_table_bookings`
  dropped `TableBooking` and `VenueTable` deliberately. Any roadmap that relies
  on table revenue needs a new ticket product, not a resurrection of that table.
- **"The app never handles money" is only true of DJ fees.** Subscription
  revenue means the platform *does* process payments, hold billing relationships
  and issue VAT invoices. The homepage pitch and FAQ must distinguish "no cut of
  the door or the DJ fee" from "paid software modules".
- **The revenue table in the vision document's §9 does not add up.** The blended
  subscriber is R249.00, not R249.40; §8 below carries the corrected table and
  names what the mix assumes that cannot currently be sold.

## 2. Tenancy: what exists, and what is still missing

`20261125120000_organisations` started Phase 1 and is in production. Tenancy is no
longer the blocker; the remaining gap is narrower than the phase plan assumed.

**Shipped**

- `Organisation` — `id`, `name`, unique `slug`, `kind` (`promoter | venue |
  artist | platform`) — and `Membership` (`orgId`, `userId`, `role`, unique per
  pair). The migration backfilled one promoter workspace per existing promoter,
  created `org-sonus` for administrators and unowned rows, and gave every account
  a membership.
- `orgId` on `Event`, `Venue` and `SocialPost` — nullable, `ON DELETE SET NULL`,
  backfilled from the owner and indexed.
- `apps/api/src/platform/`: `GET /platform/context` (active workspace plus every
  workspace the caller may use, honouring an `x-org-id` header from a member; an
  admin may inspect any), `GET /platform/onboarding`, and admin CRUD for
  organisations and members. `JwtUser.orgId` is resolved per request from the
  membership, so feature services receive it without their own lookup.
- Feature services read it. Events, venues, promotions, social, insights and
  analytics authorise on "owner **or** matching `orgId`", and list queries use
  `OR: [{ orgId: user.orgId }, { ownerId: user.sub }]`. Two people in one
  workspace can work on the same nights today.

**Still missing**

- **Per-organisation roles.** `Membership.role` is a mirror, not a source of
  truth: `addMember` refuses unless the account's platform role already matches,
  and `RolesGuard` authorises on `JwtUser.role`. A person who promotes for two
  brands still cannot hold two roles — the one thing the vision document asks
  tenancy to fix.
- **Charging and the rest of enforcement.** `Hub`, `Plan`, `Subscription` and
  `UsageCounter` exist, the six plans are seeded, every workspace carried over is
  comped onto `pro` for a year, and `EntitlementsService.check` refuses an
  over-limit request with **402** and the remaining allowance
  (`@RequiresEntitlement`). Still absent: `QuotaOverride`, checkout and provider
  webhooks, and any plan-change endpoint. Only Social Hub publish is both gated
  and metered; scheduled posts are neither, and email and the Viewing Room have
  nothing to count yet.
- **Full scoping.** `orgId` exists on three tables. `ArtistBooking`, `Invoice`,
  `Payment`, `Promotion`, `PromotionRedemption`, `DoorProfile`, `DoorBooking`,
  `DoorInvoice`, `ArtistProfile` and `StreamTarget` are still scoped by user or
  not at all. `StreamTarget` is global: one live channel platform-wide.
- **Fail-closed reads.** Scoping is a union, not a filter. A row with a null
  `orgId` stays visible to its owner instead of disappearing, which is right for
  the migration window and wrong as a permanent access rule. One missing `orgId`
  predicate currently degrades to legacy behaviour rather than denying access.
- **An audience to scope.** `Campaign`, `EmailSegment`, `EmailJob`, `EmailEvent`,
  `Consent` and `WhatsNewBroadcast` were dropped with the email system, so there
  is no consent record to build network marketing on (Phase 5).

## 3. Target model

Four concepts. `Organisation`, `Membership`, `Hub`, `Plan`, `Subscription` and
`UsageCounter` all exist; `QuotaOverride` and the entitlement gate do not. The
sketch below remains the target; §2 records where the built schema differs.

**Hub** — an industry configuration (edm, wedding, convention, hospitality).
Holds terminology, genre/category taxonomy, enabled modules and role labels.
The current business is `hub.slug = "edm"`.

**Organisation** — the paying customer (venue, promoter, artist, supplier).
Everything a customer can see or spend belongs to one.

**Membership** — `(organisation, user, role)`. The dashboard stops reading
`User.role` for authorisation and reads the membership for the active org.

**Entitlement + usage** — what a plan allows, and what has been used this period.

### Schema additions (Prisma, `packages/db/prisma`)

What shipped is a subset: `Organisation` with `kind` as a `String` rather than an
`OrgKind` enum, and **no** `hubId`, plus `Membership`. The rest is unbuilt.

```prisma
enum HubKind { edm wedding convention hospitality }
enum OrgKind { venue promoter artist supplier platform }

model Hub {
  id        String   @id @default(cuid())
  slug      String   @unique
  name      String              // "Cape Town EDM"
  brand     String   @default("SONUS")
  status    String   @default("pilot") // pilot | live | retired
  config    Json     @default("{}")    // genres, labels, modules
  organisations Organisation[]
}

model Organisation {
  id        String   @id @default(cuid())
  hubId     String
  kind      OrgKind
  name      String
  slug      String   @unique
  hub       Hub      @relation(fields: [hubId], references: [id])
  members   Membership[]
  createdAt DateTime @default(now())
  @@index([hubId, kind])
}

/// Role is per organisation. `User.role` stays only as a platform-level flag
/// (admin) and as a fallback during the migration window.
model Membership {
  id     String @id @default(cuid())
  orgId  String
  userId String
  role   Role
  @@unique([orgId, userId])
  @@index([userId])
}

model Plan {
  id           String @id @default(cuid())
  hubId        String
  key          String   // basic | email | database | social | viewing | pro
  name         String
  priceZar     Int      // cents; 0 for basic
  entitlements Json     @default("{}") // { "email.sends": 1000, "viewing.sessions": 4 }
  active       Boolean  @default(true)
  @@unique([hubId, key])
}

model Subscription {
  id                 String    @id @default(cuid())
  orgId              String    @unique
  planId             String
  status             String    // trialing | active | past_due | cancelled
  currentPeriodStart DateTime
  currentPeriodEnd   DateTime
  cancelAtPeriodEnd  Boolean   @default(false)
  provider           String?   // stripe | payfast | manual
  providerRef        String?
  @@index([status, currentPeriodEnd])
}

/// One row per metric per billing period. The only thing gates read.
model UsageCounter {
  id          String   @id @default(cuid())
  orgId       String
  metric      String   // email.sends | email.contacts | viewing.sessions | viewing.viewer_minutes | social.accounts | storage.mb
  periodStart DateTime
  used        Int      @default(0)
  @@unique([orgId, metric, periodStart])
}

/// Comps, pilots and negotiated deals: a limit that overrides the plan.
model QuotaOverride {
  id     String @id @default(cuid())
  orgId  String
  metric String
  limit  Int
  note   String?
  @@unique([orgId, metric])
}
```

Then `orgId` on the tables that still need it: `StreamTarget`, `Promotion`,
`ArtistBooking`, `Invoice`, `DoorProfile`, `ArtistProfile`. (`Event`, `Venue` and
`SocialPost` are done; `Campaign` and `EmailSegment` no longer exist.
`SiteContent` stays platform-level — it is the SONUS brand.)

### Code placement (NestJS)

```
apps/api/src/platform/     hubs, organisations, memberships, org switching
apps/api/src/billing/      plans, subscriptions, checkout, webhooks, dunning
apps/api/src/usage/        counters, period rollover, entitlement guard
apps/api/src/audience/     network consent (split out of email-engine)
```

- `EntitlementsService.check(orgId, metric, amount)` throws **402 Payment
  Required** with the metric and remaining allowance, so the dashboard can show
  an upgrade prompt instead of a generic error. Built: the body carries
  `metric`, `limit`, `used`, `remaining` and `requested`.
- `@RequiresEntitlement("social.publishes")` on controller methods, resolved from
  the active org by `EntitlementsGuard`. A metric the plan does not list is
  unmetered and always allowed, which keeps the free plan working without flags.
- Billing reuses the existing provider abstraction
  (`payments/providers.ts`: Stripe, PayFast, sandbox) rather than adding a second
  payment path. Webhooks map provider events → `Subscription.status`; a BullMQ
  repeatable job rolls `UsageCounter` periods at period end.
- If email returns, keep the provider's *daily* pacing limit separate from the
  subscriber's monthly allowance; the two must not be conflated. The removed
  `EmailQuotaService`/`email.processor.ts` pair is the pattern to rebuild, and
  decision 7 comes first.

## 4. Phases

Each phase is individually shippable. Do not start a phase before its
predecessor is in production, because every later phase assumes isolation.

### Phase 1 — Tenancy and entitlements, no charging (foundation)

**Shipped:** `Organisation`, `Membership`, `orgId` on `Event`/`Venue`/`SocialPost`,
the backfill, `platform`'s context/onboarding/admin CRUD, and the commercial
skeleton — `Hub` (backfilled onto every workspace), `Plan` (six seeded plans),
`Subscription` (comped `pro` for a year), `UsageCounter`, the `billing` module,
the admin "Plan & usage" screen, and the 402 entitlement gate on Social Hub
publish. **Still open:** `QuotaOverride`, per-organisation roles, gating and
metering scheduled posts, and metering at the remaining choke points. The old
"campaign send" choke point no longer exists — the email system was removed — so
the counters are social publish (wired), viewing-room session start and contact
import (both waiting on their features).

1. Migration: `Hub`, `Organisation`, `Membership`, `Plan`, `Subscription`,
   `UsageCounter`, `QuotaOverride`; backfill one `edm` hub and one `SONUS`
   platform org for existing rows; add `orgId` as nullable, backfill, then NOT
   NULL per table.
2. `platform` module: `GET /me/organisations`, `POST /organisations/:id/switch`,
   membership CRUD. Dashboard gains an org switcher only when a user has >1.
3. Roles: authorisation reads `Membership.role` for the active org; keep
   `User.role` for admins and as fallback.
4. Seed plans exactly as the vision document proposes (R99/R49/R149/R199/R399,
   basic free). Every existing account gets a **comped `pro` subscription** so
   nothing breaks and nothing is charged.
5. `usage` module + counters incremented at the four real choke points: campaign
   send, contact import, viewing-room session start, social publish.
6. Admin screen "Plan & usage" (read-only): plan, period, counters, overrides.

**Exit criteria:** two organisations can use the product without seeing each
other's events, guest lists, posts or streams; the same numbers appear on the
usage screen as in the job logs.

### Phase 2 — Billing

1. Plan checkout through Stripe (primary) with PayFast as the ZAR fallback.
2. Webhooks → subscription state; idempotency keyed on provider event id.
3. Past-due grace window, cancel-at-period-end, "start of next period" downgrade
   (never mid-period lockout).
4. VAT fields on receipts; price display decides inclusive vs exclusive **before
   any customer sees a number**.
5. Self-serve invoices list in `settings`.

**Depends on:** a tax decision (VAT registered? inclusive?), and a company entity
able to receive subscription payments. This is the phase that changes the
"SONUS handles no money" claim and needs the public copy updated with it.

### Phase 3 — Enforce the allowances that already have features behind them

1. Email: 1,000 sends/month, block on exhaustion with an upgrade path; overage
   sold as transparent blocks, priced only after provider cost is known. Blocked
   until decision 7 says whether email is rebuilt in-platform at all.
2. Database import add-on: gated behind its own entitlement, **separate from
   network marketing consent**.
3. Viewing Room: 4 sessions/month, 60-minute cap, viewer cap and recording
   retention enforced in the `live` module.
4. Social Hub: number of connected accounts per plan.

### Phase 4 — Viewing Room as a product

1. `ViewingRoomSession` (eventId, orgId, scheduled window, max viewers, status,
   recording URL, retention date) on top of the existing RTMP simulcast.
2. Only DJs confirmed on that event's lineup may perform
   (reuse `ArtistBooking.status = confirmed`).
3. Public branded session page: artist, event, ticket link, calendar entry.
4. Engagement reporting: peak viewers, watch minutes, click-through to tickets.
5. Stream keys scoped per org, not global `StreamTarget`.

### Phase 5 — Audience network (highest legal risk, last of the paid modules)

1. `AudienceContact` per org (owned list) and `AudienceNetworkMember` with its own
   purpose-specific opt-in — importing a contact must never imply network consent.
2. Segment builder over genre, city, attendance, engagement, restricted to
   contacts with a live grant plus no suppression.
3. Evidence, retention and export rules; per-org suppression lists.
4. POPIA review before any cross-promoter send. The old `Consent` table went with
   the rest of the email system (`20261123120000_remove_email_systems`), so the
   `source`/`policyVersion` pattern has to be rebuilt, not extended.

### Phase 6 — Ticketing, then staffing

Ticketing: `TicketTier` (price, stock, sales window), `Ticket` with a signed
code reusing the door-pass HMAC, `TicketOrder` for provider refs, scanner
endpoint, automated waitlist expiry. This is what makes paid tiers real, and it
is also what attendees expect before they will pay online.

Staffing: `StaffProfile` (host/hostess/door, city, rate, availability),
`StaffAssignment` tied to an event and authorised by the promoter. Door access
already exists as a role; this adds the marketplace around it.

### Phase 7 — Remaining surfaces

Service directory for other professionals, event reviews with moderation,
bookkeeping ledger, merch, attendance forecast. Each is independent and can be
reordered by commercial value; none blocks the others.

### Phase 8 — Second hub

Only after SONUS is profitable. Extracting wedding/convention config into
`Hub.config` is straightforward; the work is isolation auditing, licensing terms
and support, not code.

## 5. Decisions that must be made by the business, not by engineering

*One-page brief with recommendations and deadlines:
[sonus-decisions.md](sonus-decisions.md).*

1. ~~**Brand hierarchy**~~ — **decided: ESSENTIALS is the parent brand and SONUS
   is the product; the full mark is `ESSENTIALS × SONUS`.** This supersedes both
   the earlier SONUS-only ruling and the vision document's §15 ordering. Running
   copy still says SONUS; ESSENTIALS is the company (domain, addresses, npm
   scope, `edm` hub, legal entity). [sonus-decisions.md](sonus-decisions.md)
   records the reasoning. The guideline's noir/gold visual system is applied to
   the site, the dashboard and the deck, in Cinzel and Montserrat.
2. **VAT and pricing** — inclusive or exclusive; are the listed prices launch
   hypotheses only (the document says they are)?
3. **Music rights** — no public Viewing Room launch without performance,
   recording and broadcast licences. This is a hard gate, not a task.
4. **Consent model** — whether the shared audience exists at all. It is legally
   the riskiest item in the document.
5. **Unused sessions** — roll over or expire; must be stated at purchase.
6. **Existing accounts** — permanently free, or comped for a fixed window? The
   migration behaves differently and customers will notice.
7. **Email marketing** — reinstall it in-platform, or keep bulk mail on the
   separate PHPList deploy? The R99 module has no implementation since
   `20261123120000_remove_email_systems`, and the R399 bundle is defined as
   "all four modules". No plan, price or bundle copy can be final until this is
   answered.

## 6. Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Cross-tenant data leak | One missing `orgId` filter exposes another promoter's audience | Make `orgId` mandatory at the Prisma access layer; add isolation tests to `npm test` |
| Consent breach | Importing a list then marketing to it is the classic POPIA failure | Two separate opt-ins, enforced in the query, not the UI |
| Streaming cost blowout | Viewing Room is the only unbounded variable cost | Session/viewer/minute caps from day one; counters before launch |
| Contradictory public copy | Homepage promises "no commission" while selling subscriptions | Rewrite pitch: no cut of door or DJ fee; software modules are paid |
| Role regression | Moving from `User.role` to memberships touches every guard | Dual-read behind a flag, then remove the fallback in one commit |

## 7. Recommended first slice

**What is left of Phase 1.** The commercial skeleton, the admin screen and the
entitlement gate shipped (§2). What remains is per-organisation authorisation (so
`Membership.role` is the source of truth), `QuotaOverride`, and gating plus
metering at the Viewing Room session start and contact import when those features
exist. No charging, no pricing decisions, no public copy changes.

Plus the pass that turns union-scoped reads into fail-closed ones across
`events`, `venues`, `social`, `promotions`, `insights` and `analytics` — with an
isolation test per module. The `email-engine` half of that pass is gone with the
email system.

## 8. Revenue arithmetic: the blend is R249, not R249.40

The vision document's §9 mixes four products and states a blended R249.40 per
paying subscriber. The mix does not produce that number:

| Product | Share of subscribers | Price | Weighted |
| --- | --- | --- | --- |
| Complete package | 40% | R399 | R159.60 |
| Social Media Hub | 20% | R149 | R29.80 |
| Viewing Room | 20% | R199 | R39.80 |
| Email + database access | 20% | R99 | R19.80 |
| **Blended** | 100% | | **R249.00** |

Corrected forward table (gross, before VAT, payment fees and standalone database
add-ons):

| Paying subscribers | Gross monthly | Gross annual | Document says |
| --- | --- | --- | --- |
| 25 | R6,225 | R74,700 | R6,235 / R74,820 |
| 50 | R12,450 | R149,400 | R12,470 / R149,640 |
| 100 | R24,900 | R298,800 | R24,940 / R299,280 |
| 200 | R49,800 | R597,600 | R49,880 / R598,560 |
| 500 | R124,500 | R1,494,000 | R124,700 / R1,496,400 |

The document is R0.40 per subscriber per month high: R10 a month at 25
subscribers, R200 a month at 500. Recompute from the mix, never from the previous
total.

Two assumptions behind the mix that the product cannot currently meet:

- **The R99 email module has no implementation.** The in-platform email system
  was removed (`20261123120000_remove_email_systems`), and cross-promoter
  marketing is deferred by decision 4 in [sonus-decisions.md](sonus-decisions.md).
  Until one of those changes, the R399 bundle cannot honestly be sold as "all
  four modules", and the 40% / 20% split describes an intended product line, not
  the platform that exists.
- **The Viewing Room is free and single-channel today.** Its R199 line prices
  work still to come in Phase 4 (sessions, viewer caps, per-workspace stream
  keys), and music rights remain a hard gate (decision 3).

So read R249.00 as the arithmetic for the document's intended module set — not as
unit economics. A mix built only from what ships today has not been costed, and
should not be quoted to a customer or an investor until supplier costs for email
and streaming are in hand.
