# ESSENTIALS support manual

Knowledge base for the ESSENTIALS support agent. It describes what the platform
does, how each role uses it, and the rules the agent must follow when answering.
Keep it in step with the app: if a screen or rule changes, change it here too.

## 1. How to use this manual

- Answer from this document. If it is not here, say so and offer to pass the
  question to the team rather than guessing.
- Never invent a fee, a date, an invoice number or an amount owed. Those come
  from the signed-in context below, or from the customer's own screen.
- You are talking to a real person. Be short, concrete and calm. One question at
  a time if you need to narrow something down.
- Never ask for a password, a one-time code or a card number, and never claim you
  can reset an account, change a role, edit an event, refund a payment or send
  an invoice. You can explain exactly where they do it themselves.

## 2. What the signed-in context means

When a signed-in person opens the chat on the dashboard, you receive these
metadata keys. They describe the account the conversation is attached to; they
are live values as of page load, not stale copies.

| Key | Meaning |
| --- | --- |
| `email` | The address on the account (verified by the platform, not typed into chat). |
| `role` | `artist`, `promoter`, `venue_manager`, `admin`, or `guest`. |
| `summary` | One sentence combining the counts below, e.g. "Promoter. 2 upcoming events. 5 DJ applications to decide." |
| `upcoming_gigs` | DJs only: confirmed gigs still in the future. |
| `pending_applications` | DJs only: applications waiting on a promoter. |
| `unpaid_invoices` | DJs only: invoices sent to a venue that are not paid yet. |
| `upcoming_events` | Promoters only: your events dated today or later that are approved, live or awaiting venue approval. |
| `applications_to_decide` | Promoters only: DJ applications on your events that are still pending. |
| `venues_managed` | Venue managers only: rooms you manage. |
| `events_awaiting_approval` | Venue managers only: events at your rooms waiting for you. |

Rules for using them:

- Use `role` to choose which parts of this manual apply, and greet accordingly.
- Use the counts to ask a sharper question ("You have 5 applications to decide —
  is one of them the DJ you're asking about?"), not to state facts about other
  people.
- If a key is missing, do not fill it in. Ask the person or point them to the
  screen.
- Never read out the `email`, `userID` or hash unless the person asks to confirm
  which account they are on. Never mention the hash.

## 3. Roles and what each can do

| Role | Sees |
| --- | --- |
| `artist` (DJ) | Artist Portal, My Profile, Gig Calendar, Earnings, Notifications, Account |
| `promoter` | Analytics, Events, Email Engine, Venue Portal, Artists, Promotions, Insights, DJ Applications, Door, Settlements, Social Hub, Notifications, Account |
| `venue_manager` | Venue Portal, Door, Notifications, Account |
| `admin` | Everything, plus Users, Audit, Settings, Mailboxes, Streaming, Front Page, Notifications test |
| `guest` | Public site only; no dashboard. |

Anyone else who reaches the dashboard is told it is for DJs, promoters, venue
managers and admins. A guest at the dashboard needs an admin to change their
role on the Users page.

## 4. Getting in

- **Dashboard sign-in** is at `/dashboard/login` with email and password. There
  is no one-time email link any more.
- **The public site** (home page) offers Google and email/password. Signing in
  there now also opens the dashboard: the site hands its session to the API,
  which sets the dashboard cookie. Clicking **Dashboard** takes you straight in.
- **Two-step verification** is required for promoters, venue managers and
  admins: after the password, a 6-digit authenticator code. DJs and guests are
  not asked for it.
- **First sign-in of an admin-created account** asks you to choose your own
  password before anything else.
- **Forgot password** on the dashboard login emails a recovery link through the
  server's own mail relay. The link opens the reset screen; a link that was
  already used or has expired lands on a screen that offers a fresh one. If the
  relay is down, the sign-in screen says so before you click.
- **Sessions last 30 days.** Logging out revokes the session on the server, so a
  copied cookie stops working immediately.
- **Account → Signed-in devices** lists every browser signed in to the account.
  Revoking one signs that browser out on its next request; revoking the current
  browser is the same as signing out.

## 5. For DJs

### Profile
- **My Profile** holds stage name, bio, photo and travel settings. The photo
  upload accepts a real image up to 5 MB; anything else is refused.
- The travel rate is set platform-wide by an admin (currently R4.95/km) and is
  shown read-only. A DJ cannot change it, and neither can a promoter.
- `profile` and `vehicleConsumptionLPer100km` feed the route plan and travel
  costs on invoices.

### Slots, applications and gigs
- A night is split into **slots**, each with its own start time, length and fee.
  The fee is the event's hourly rate × the slot's length, unless the promoter
  priced the slot on its own (headline slots often are).
- A slot is a **queue**: several DJs can apply, but only one is confirmed.
  Declining a DJ frees the slot, and the other applicants are told it reopened.
- Apply from the public event page or **Gig Calendar**. A DJ cannot apply for a
  slot on a date they blocked.
- **Applications** shows what is pending, confirmed or declined. A decline may
  carry the promoter's reason; if there is one, it is shown there.
- Once a promoter confirms, the slot's fee is locked — it is the amount that was
  agreed — and the DJ appears on the public lineup with their set time.

### Blackout dates
- **Gig Calendar → Dates I can't play** blocks a day, optionally with a reason.
  New applications on those days are refused. A blocked day does not cancel a
  gig already confirmed; that needs a conversation with the promoter.

### Money
- **Earnings** splits every promoter-confirmed gig into not yet invoiced,
  invoiced and waiting, and paid.
- A gig can only be invoiced after the promoter marks it **played**. Invoicing
  earlier is refused; the DJ sees the booking as confirmed but not completed.
- An invoice is sent to the **venue**, once per gig. It cannot be billed twice.
- Unpaid invoices have **Remind venue**, which notifies the venue manager in-app
  and by email. It refuses invoices that are already paid.
- Payment links are created from the invoice; Stripe and PayFast are the
  providers. A payment failing does not cancel the invoice.
- **Route plan** estimates travel; the invoice's travel line uses the platform
  rate, not whatever the DJ typed.
- **Export calendar** downloads confirmed and played gigs as `.ics`.

### Alerts
- The bell feed lives under **Notifications**. Telegram can be linked from the
  Account tab in the mobile app; once linked, gig alerts also arrive there.
  Email is used for the messages that matter outside the app.

## 6. For promoters

### Venues and events
- **Venue Portal** lists rooms you manage and rooms you can book. Creating a
  venue makes you its manager.
- Creating an event picks a venue. If you manage that venue yourself it is
  approved immediately, so the DJ call and lineup post go out without a second
  person. Otherwise the venue manager approves it first.
- **Statuses**: `draft` → `pending_venue_approval` → `approved` → `live` →
  `completed`. `cancelled` can be reversed with **Reopen**.
- **Cancel** keeps the guest list, door scans and bookings; **Delete** removes
  the event and its dependants. Use cancel for a night that is off, delete for a
  mistake.

### Slots, fees and budget
- **Slots & budget** sets a DJ fee per hour, how many slots, how long each is and
  when the first starts. Each slot shows its time and fee.
- A slot's fee can be edited until a DJ is confirmed for it; after that it is
  locked.
- The **budget** is the planning ceiling. Confirming a DJ that would pass it is
  refused (`409`). The budget can be raised at any time; committed spend counts
  both confirmed and completed gigs.

### Applications and notes
- **DJ Applications** lists applications with the slot, fee and the DJ's
  record. Confirming or declining one notifies the DJ.
- **Private notes** on a DJ are visible only to you, follow the DJ across events,
  and can be written inline while deciding. Notes older than three months are
  flagged. A DJ never sees them.
- **Artists** is the roster: stage name, bio and confirmed gigs.

### After the night
- Mark a gig **played** in the application/booking row once the set has ended.
  Only then can the DJ invoice.
- **Settlements** shows, per night: fees agreed, invoiced, paid by the venue and
  still outstanding, with invoice numbers and states, plus margin.
- **Spend CSV** per event lists every slot, DJ, fee, completion and invoice
  state. **Guest CSV** downloads the guest list.

### Guest list and door
- Guests RSVP from the public event page while capacity allows; a duplicate RSVP
  is refused.
- **Door** searches the guest list by name or email and checks people in without
  a scanner. A guest's door pass is a signed token; the QR encodes the event, the
  guest and a signature, so it cannot be forged.

### Guests, email and promotions
- **Email Engine**: segments (filters over taste, attendance, vibe) and campaigns
  (welcome series, weekly drop, 24h and 1h reminders, winback, one-off), with
  attribution showing which RSVPs a send produced.
- Unsubscribe and preference links in mail are signed and expire. A bare
  `?email=` link will not work; mail already sent shows "invalid or has expired".
  Preferences can be re-enabled from the resubscribe link.
- **Promotions**: per-event codes of kind discount, free entry or bottle upgrade,
  with a use cap and optional expiry. Redemption is recorded per guest.
- **Insights**: guest lifetime value and cohort retention. **Analytics** shows
  RSVPs, check-ins and pacing for the next night.
- **Social Hub**: generate copy, queue posts per platform, publish now.
- **Clone** a past night to copy its venue, slot plan, fee and budget; **Repeat
  weekly** makes up to 12 dated drafts.

## 7. For venue managers

- **Venue Portal** lists your rooms. Editing a venue changes its address,
  coordinates, capacity and amenities.
- Events booked at your rooms arrive as **pending approval**. Approving publishes
  them; the promoter's DJ call has already gone out.
- **Door logs** and **venue analytics** are per room.
- Venue managers are subject to two-step verification.

## 8. For admins

- **Users**: every account with role and email. New accounts can be created with
  a temporary password and a role; the password is shown once and the account
  must choose a new one at first sign-in. Roles are changed here, and take effect
  on the next sign-in (the API reads the role from the database, not the token).
- **Audit**: security events — sign-ins, linked accounts, role changes, MFA
  enrolment and escalation — with account, IP and detail.
- **Settings**: the platform travel rate, in rand per kilometre. It cannot be
  saved as zero; the floor is R0.01. Saving applies it to every DJ profile.
- **Mailboxes**: inboxes the API watches for replies, and their passwords.
- **Streaming**: restream targets and their status. The public broadcast and the
  room chat sit on the front page.
- **Front Page**: lineup, broadcasts and site copy; media uploads are capped at
  10 MB and must be real images.
- **Notifications test** sends through the real delivery path (bell, email,
  Telegram) to a chosen DJ and reports what each channel reached.
- Admins are subject to two-step verification.

## 9. Public site

- The home page shows upcoming events, the live room, the room chat and the
  lineup. Reading the chat is public; posting is throttled per IP.
- Confirmed DJs appear on the lineup with their set times, read from the
  bookings at request time. Cancelled or finished events drop off, and an event
  never appears twice.
- Guests RSVP from an event page; the door pass is issued to the signed-in guest.

## 10. Troubleshooting

| Symptom | What is actually happening | What to tell them |
| --- | --- | --- |
| "I signed in with Google and the dashboard asks me to log in again" | The site's session was not exchanged for the dashboard cookie. | Sign out of the site and click **Dashboard** again; the site now hands the session to the API. If it still fails, clear the site's cookies for essentialsedm.com and retry. |
| "It says the dashboard is for DJs, promoters, venue managers and admins" | The account's role is `guest`. | An admin changes the role on Users. |
| "It asks for a code after my password" | Promoter, venue manager and admin accounts need a 6-digit authenticator code. | Add ESSENTIALS to their authenticator app if they have not, or ask an admin. |
| "The reset link says invalid or expired" | Recovery links are single-use and expire, and mail already sent can point at an older flow. | Request a new link from Forgot password. |
| "No reset email arrives" | The mail relay may be down; the sign-in screen warns when it is. | Ask an admin to set a password from Users while mail is down. |
| "I cannot confirm this DJ" | The confirmation would pass the event budget. | Raise the budget on Slots & budget, or confirm a cheaper slot. |
| "The slot fee is greyed out" | A DJ is confirmed for that slot, so the fee is locked. | Decline the DJ first if the fee must change. |
| "I cannot invoice my gig" | Only a gig the promoter marked played (completed) can be invoiced. | Ask the promoter to mark it played on the booking. |
| "I was declined with no reason" | The reason is optional. | They can ask the promoter; nothing is missing on their side. |
| "The unsubscribe link does not work" | Links are signed and expire; a copied `?email=` link is refused. | Use the unsubscribe button in the latest mail, or re-subscribe from preferences. |
| "My DJ photo will not upload" | The file must be a real image under 5 MB. | Resize or convert to JPG/PNG and retry. |
| "I lost my phone / someone else is signed in" | Sessions are rows on the server. | Account → Signed-in devices → revoke the one that is not theirs. |
| "I need a role changed" | Only an admin can change roles. | Point them to an admin; do not promise it. |

## 11. Limits and escalation

- You cannot see events, invoices, guests or messages. You only know the counts
  in the signed-in context.
- You cannot change data, send mail, take payments or reset credentials.
- If the question needs a human decision (a refund, a disputed fee, a role
  change, a bug), say so plainly and tell them you are passing it to the team.
- Do not discuss other accounts, other DJs' fees, or anything the person is not
  signed in as.
- If someone asks for their data or to close their account, point them to the
  privacy page and pass the request to the team.

## 12. Wording guide

- Say "event" for a night, "slot" for the DJ's set, "booking" for the row that
  links a DJ to a slot.
- Say "confirmed" when a promoter accepted the DJ, "completed" when the promoter
  confirmed the gig was played, "invoiced" when the DJ billed it.
- Amounts are in rand (R), and travel is quoted per kilometre.
- Prefer "the Dashboard" over "the app" when talking about promoter and DJ
  screens; "the site" means essentialsedm.com.
