# Implementing the SONUS platform document

*Engineering plan. Companion to the vision document (November 2026). Nothing here
is committed to a date; the phases are ordered by dependency, not by promise.*

---

## 1. Read this first: what the code already does

The vision document describes three layers. Two of them are largely built. The
third — the one that turns SONUS into a sellable platform — has not been
started.

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
| Email engine with segments, consent, unsubscribe | Built as a **single-organisation** feature | `email-engine`, `Consent`, `EmailSegment` |
| Social posting + scheduling + AI captions | Built as a **single-organisation** feature | `social` module, `SocialPost` |
| Paid ticket tiers with stock and sale windows | Not built (RSVP only; tables were retired) | — |
| Reviews with photos | Not built | — |
| Hosts/hostesses/door staff profiles, availability, assignments | Not built (`door` is a role, not a marketplace) | — |
| Service directory for other event professionals | Not built | — |
| Bookkeeping, merch store | Not built | — |
| Attendance forecasting | Not built (analytics is descriptive only) | — |
| Subscriptions, allowances, billing, entitlement gates | **Not built at all** | — |
| Multi-organisation tenancy (SONUS hubs, white-label, licensing) | **Not built at all** | — |

Two corrections to the vision document's assumptions:

- **VIP table bookings no longer exist.** `20261107060000_drop_table_bookings`
  dropped `TableBooking` and `VenueTable` deliberately. Any roadmap that relies
  on table revenue needs a new ticket product, not a resurrection of that table.
- **"The app never handles money" is only true of DJ fees.** Subscription
  revenue means the platform *does* process payments, hold billing relationships
  and issue VAT invoices. The homepage pitch and FAQ must distinguish "no cut of
  the door or the DJ fee" from "paid software modules".

## 2. The real blocker: everything is one organisation

There is no `Organisation`, `Tenant`, `Workspace` or `Account` model, and no
`orgId` on any table. Every query is scoped by *role and user*, never by
customer. Consequences:

- `EmailSegment`, `Campaign`, `SocialPost`, `StreamTarget` and `PlatformSetting`
  are global. Two promoters would share one audience list and one social
  calendar.
- `Role` (admin/promoter/artist/venue_manager/door) is a global field on `User`.
  A person who promotes for two brands cannot hold two roles.
- Subscription allowances are meaningless without an owner to count against.

So the first engineering work is **tenancy**, not features. Selling modules before
that exists would mean retrofitting isolation into live customer data later.

## 3. Target model

Four concepts, added beneath the existing product:

**Hub** — an industry configuration (edm, wedding, convention, hospitality).
Holds terminology, genre/category taxonomy, enabled modules and role labels.
The current business is `hub.slug = "edm"`.

**Organisation** — the paying customer (venue, promoter, artist, supplier).
Everything a customer can see or spend belongs to one.

**Membership** — `(organisation, user, role)`. The dashboard stops reading
`User.role` for authorisation and reads the membership for the active org.

**Entitlement + usage** — what a plan allows, and what has been used this period.

### Schema additions (Prisma, `packages/db/prisma`)

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

Then `orgId` on the tables that must stop being global: `Campaign`,
`EmailSegment`, `SocialPost`, `StreamTarget`, `Promotion`, `Event`, `Venue`,
`ArtistBooking`, `Invoice`, `SiteContent` stays platform-level (SONUS brand).

### Code placement (NestJS)

```
apps/api/src/platform/     hubs, organisations, memberships, org switching
apps/api/src/billing/      plans, subscriptions, checkout, webhooks, dunning
apps/api/src/usage/        counters, period rollover, entitlement guard
apps/api/src/audience/     network consent (split out of email-engine)
```

- `EntitlementsService.check(orgId, metric, amount)` throws **402 Payment
  Required** with the metric and remaining allowance, so the dashboard can show
  an upgrade prompt instead of a generic error.
- `@RequiresEntitlement("email.sends")` on controller methods, resolved from the
  active org in a request-scoped guard.
- Billing reuses the existing provider abstraction
  (`payments/providers.ts`: Stripe, PayFast, sandbox) rather than adding a second
  payment path. Webhooks map provider events → `Subscription.status`; a BullMQ
  repeatable job rolls `UsageCounter` periods at period end.
- `EmailQuotaService` stays as the provider's *daily* pacing limit. It is not a
  subscriber allowance; the two must not be conflated. Add the org monthly check
  in `email.processor.ts` before the daily one.

## 4. Phases

Each phase is individually shippable. Do not start a phase before its
predecessor is in production, because every later phase assumes isolation.

### Phase 1 — Tenancy and entitlements, no charging (foundation)

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
other's events, segments, posts or streams; the same numbers appear on the usage
screen as in the job logs.

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
   sold as transparent blocks, priced only after provider cost is known.
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
4. POPIA review before any cross-promoter send. The `Consent` table's
   `source`/`policyVersion` pattern is the right shape — extend it rather than
   inventing a second consent system.

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

1. ~~**Brand hierarchy**~~ — **decided: the product is called SONUS.** Remaining
   follow-through is the domain, sender address, store listings and legal entity.
2. **VAT and pricing** — inclusive or exclusive; are the listed prices launch
   hypotheses only (the document says they are)?
3. **Music rights** — no public Viewing Room launch without performance,
   recording and broadcast licences. This is a hard gate, not a task.
4. **Consent model** — whether the shared audience exists at all. It is legally
   the riskiest item in the document.
5. **Unused sessions** — roll over or expire; must be stated at purchase.
6. **Existing accounts** — permanently free, or comped for a fixed window? The
   migration behaves differently and customers will notice.

## 6. Risks

| Risk | Why it matters | Mitigation |
| --- | --- | --- |
| Cross-tenant data leak | One missing `orgId` filter exposes another promoter's audience | Make `orgId` mandatory at the Prisma access layer; add isolation tests to `npm test` |
| Consent breach | Importing a list then marketing to it is the classic POPIA failure | Two separate opt-ins, enforced in the query, not the UI |
| Streaming cost blowout | Viewing Room is the only unbounded variable cost | Session/viewer/minute caps from day one; counters before launch |
| Contradictory public copy | Homepage promises "no commission" while selling subscriptions | Rewrite pitch: no cut of door or DJ fee; software modules are paid |
| Role regression | Moving from `User.role` to memberships touches every guard | Dual-read behind a flag, then remove the fallback in one commit |

## 7. Recommended first slice

**Phase 1, steps 1–5.** It is invisible to customers, unblocks every paid module,
and is the only phase where delay makes later work more expensive. Concretely:
the tenancy migration with backfill, the `platform` and `usage` modules, plan
seeding with a comped plan for existing accounts, and counters at the four choke
points. No charging, no pricing decisions, no public copy changes.

That is roughly one migration, three modules, one dashboard screen, and the
org-scoping pass over `email-engine`, `social`, `live`, `promotions` and
`events` — the last of which is the bulk of the work and needs an isolation test
per module.
