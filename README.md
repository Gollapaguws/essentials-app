# ESSENTIALS — Nightlife Promoter Platform

Mobile (Expo) + promoter dashboard (Next.js) + API (NestJS/Prisma/Postgres/Redis-BullMQ).
**Phase 1 shipped.** Phase 2 (venue portal, matching, group chats), Phase 3 (artist portal,
routing/invoices/payments) and Phase 4 (payments, white-label, advanced analytics) have
schema hooks already in place — see `packages/db/prisma/schema.prisma`.

## Stack
- `apps/mobile` — Expo guest app: onboarding (magic link → invite code → profile), events
  feed with live headcount, RSVP/waitlist, QR door pass, VIP table booking, loyalty counter
  ("3/5 events — 2 to free entry") + referral link.
- `apps/web` — Next.js 14 promoter dashboard: Recharts analytics (RSVPs, door vs list,
  no-show rate, table revenue per event, revenue per venue), event manager, email engine
  v1 with campaign attribution.
- `apps/api` — NestJS: magic-link auth, JWT roles (guest|artist|promoter|venue_manager|admin),
  role-scoped queries everywhere, BullMQ email jobs, reminder scheduler, QR door check-in
  (signed HMAC tokens + DoorLog).
- `packages/db` — Prisma schema + seed (demo event "ESSENTIALS: Amapiano Sunrise" @ The
  Warehouse, 250 cap, 3 VIP tables, 12 guests).
- `packages/api-client` — shared typed fetch client.
- Excluded by design: 1-on-1 DMs, ads platform.

## Setup
```bash
npm install
cp .env.example .env          # set JWT_SECRET, RESEND_API_KEY (or keep console provider)
npm run db:up                 # docker compose: postgres + redis
npm run db:migrate            # prisma migrate dev
npm run db:seed               # demo event + users
npm run dev:api               # NestJS on :4000
npm run dev:web               # dashboard on :3001
npm run dev:mobile            # Expo (set EXPO_PUBLIC_API_URL to your LAN IP)
```

### Demo logins (magic link — console provider prints the link to API logs)
| Role | Email |
|---|---|
| admin | admin@essentials.example |
| promoter | promoter@essentials.example |
| venue manager | venue@essentials.example |
| guests | guest1@essentials.example … guest12@essentials.example |

## API surface (Phase 1)
`POST /api/auth/magic-link` · `POST /api/auth/verify` · `POST /api/auth/invite/redeem` ·
`GET /api/events` · `GET /api/events/:id` · `POST/DELETE /api/events/:id/rsvp` ·
`GET /api/events/:id/door-pass` · `POST /api/events/check-in` ·
`GET /api/tables/inventory/:eventId` · `POST /api/tables/book` ·
`GET /api/loyalty` · `GET /api/loyalty/referral` ·
`POST/GET /api/email/segments` · `POST/GET /api/email/campaigns` ·
`GET /api/email/campaigns/:id/attribution` · `GET /api/email/unsubscribe` (public) ·
`GET /api/analytics/overview`

Email deliverability (SPF/DKIM/DMARC, unsubscribe, consent): `docs/email-deliverability.md`.

## Phase roadmap hooks (already in schema, no UI yet)
- **P2**: `DoorLog`, venue approval workflow (`EventStatus.pending_venue_approval`),
  `Match`, `EventGroupChat`+`GroupMessage.isIcebreaker`, `EmailSegment` for listmonk.
- **P3**: `ArtistProfile` (vehicle L/100km, rate/km), `ArtistBooking` (setup/teardown
  buffers, fees), `BookingRouteLeg.isConflict` (Schedule Collision Alert), `Invoice`/
  `InvoiceItem`/`Payment` (PayFast/Stripe links).
- **P4**: `venueRevenuePct` / `revenueSplitPromoterPct` power profitability reporting.
