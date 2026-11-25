# Organisations (promoter workspaces)

The platform can now host more than one promoter. Each customer promoter has an
**organisation**; the people who work on it have **memberships**. Data that used
to belong only to the one operator — events, venues and social posts — carries an
`orgId`, so a second promoter's console cannot see the first's.

This is the tenancy foundation from `docs/sonus-platform-plan.md`. Billing, plans,
usage counters and white-label themes are deliberately not included yet.

## Data model

| Model | Purpose |
| --- | --- |
| `Organisation` | A workspace: `name`, unique `slug`, `kind` (`promoter` or `platform`). |
| `Membership` | `(orgId, userId, role)` — who may act in a workspace. |
| `Event.orgId`, `Venue.orgId`, `SocialPost.orgId` | Nullable owner workspace. Null means a legacy row, which stays visible to its original owner. |

The migration `20261125120000_organisations` backfills every existing promoter
into `promoter-<userId>`, creates the `sonus` platform workspace for admins and
staff, and copies memberships for existing `orgId`-less rows.

## How a request gets a workspace

`SupabaseAuthGuard` resolves the active workspace for every authenticated request:

1. An `x-org-id` header is accepted only when the signed-in account is a member
   (admins may inspect any workspace).
2. Otherwise the account's first membership is used.
3. A promoter with no membership gets a personal workspace created lazily
   (`promoter-<userId>`, named `"<email localpart> Presents"`).
4. An admin with no membership gets the `sonus` platform workspace.

The resolved id is available as `user.orgId`. Membership lists are cached for 60
seconds per process and invalidated when an admin changes membership. A failed
lookup logs a warning and leaves `orgId` null; feature services then fall back to
their original owner-based scoping, so a tenancy outage does not lock people out
of their own events.

## Scoping rules

Services use a **union** of workspace and original owner, not a replacement:

- promoter event and budget lists: `orgId = active` OR `promoterId = me`
- venue management: `orgId = active` OR `managerId = me`
- social posts: `orgId = active` OR `createdBy = me`
- analytics and insights: the same promoter/org union
- event and venue management checks accept a colleague in the same workspace
- the venue picker still lists every venue: rooms are shared physical places and
  the venue manager, not workspace membership, approves each night

## Admin API

All routes require an admin except `GET /platform/context`.

| Route | Use |
| --- | --- |
| `GET /platform/context` | Active workspace plus every workspace the caller may use. |
| `GET /platform/organisations` | Every workspace, with member and event counts. |
| `POST /platform/organisations` | Create a workspace by name (slug is derived, collisions get `-2`, `-3`…). |
| `GET /platform/organisations/:id/members` | Members and their workspace/platform roles. |
| `POST /platform/organisations/:id/members` | Add an existing account; its platform role must match. |
| `DELETE /platform/organisations/:id/members/:userId` | Remove a membership. |

Onboarding is part of account creation: `POST /users` accepts an optional
`organisationName` for a `promoter`, and the same field works with
`PATCH /users/:id/role`. Omitting it derives "<localpart> Presents". Promoted
admins, venue managers and door staff join the platform workspace. Guests and DJs
need no workspace.

## First-run checklist

A promoter whose workspace is not fully set up sees a **welcome checklist** at
the top of the dashboard. It has four steps — set up a venue, create the first
night, open the DJ slots, confirm the first DJ — each linking to the screen that
completes it. The progress is calculated from the workspace's live rows, not
stored separately: creating a night at an existing room ticks both the venue and
night steps, and the card disappears once a DJ is confirmed.
`GET /platform/onboarding` returns the state; it is promoter-only.

## Known limits (next steps)

- One promoter per workspace is the supported case. DJ applications, bookings and
  notes are still scoped to the individual promoter, not the workspace.
- `User.role` remains the authorization role and is mirrored on the membership.
  Per-organisation role enforcement is not wired yet.
- `orgId` is nullable for legacy rows. A follow-up can backfill and make it
  `NOT NULL` at the Prisma access layer.
- There is no workspace switcher in the dashboard yet; the API already accepts
  `x-org-id` and `GET /platform/context` returns the choices.
- Billing, plans, usage counters and white-label themes remain later phases in
  `docs/sonus-platform-plan.md`.
