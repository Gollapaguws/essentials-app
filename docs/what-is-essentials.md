# What is SONUS?

A plain-language explanation for people who do not work in tech. For the
technical picture, see the [README](../README.md); for per-role instructions,
see the [support manual](chatbot-manual.md).

## One-paragraph pitch (public homepage)

SONUS is Cape Town's home for warehouse parties, club nights and
open-format sessions — house, techno, amapiano and hip-hop in the same room on
the same night. Find a night, RSVP in seconds and walk in with your door pass
on your phone: no paper tickets, no queues at the list. Bring friends, earn free
entries, and catch the room live when you can't be there. Behind the scenes, the
same app lets the promoters, DJs, venues and door staff who make the night happen
organise the line-up, book the sets and settle the money — with no cut of the
door and no cut of a DJ's fee. The music gets the attention, not the admin.

## In one sentence

SONUS is a nightlife app for a Cape Town music-events company: partygoers
find nights, get on the guest list and enter with their phone, while the people
running the party use the same system to organise the night, book DJs and pay
everyone.

## For people going out

- Open the website or phone app and see upcoming nights — warehouse parties,
  club nights, amapiano, house, techno, hip-hop.
- **RSVP / get on the list.** Your phone gets a **door pass** — a personal QR
  code that door staff scan or look up at the entrance. It cannot be forged or
  passed around.
- See how full a night is getting ("180 of 250 going") and join a waitlist when
  it is full.
- **Loyalty:** go to 5 events, get a free entry. There is also a personal invite
  link — bring friends, earn rewards.
- On the website you can **watch the DJ live** and follow the room chat.
- There is a members' **What's new** page and a **privacy page** where you can
  download everything the company holds about you.

## For the people running the night

- **Promoters** create events, set how many DJ slots there are and what each
  pays, approve or decline DJ applications, watch budgets, email their guest
  list, run discount codes, and see how many people actually arrived versus how
  many said they would.
- **DJs** build a profile, apply for slots on a gig calendar, block dates they
  cannot play, go **live** from a laptop, and — once the promoter confirms they
  played — send the venue an **invoice**, including travel. They can see earned,
  invoiced, paid and still-owed money at a glance.
- **Venue managers** approve events booked at their rooms and see door numbers
  for their own venue.
- **Door staff** work the guest list at the entrance: search a name, tap
  check-in, and the app keeps count of who is inside and how full the room is.
  No scanner needed.
- **Admins** manage accounts and roles, see security logs, and control the
  public website, streaming and mail settings.

## How a DJ gets booked and paid, step by step

The short version: a promoter posts a night with a set number of **DJ slots**
(like 3 sets, each with a time and a fee). DJs **apply** for a slot. The
promoter **confirms one DJ per slot**. After the night, the promoter marks that
the DJ **actually played**. Only then can the DJ **send an invoice to the
venue** — and the venue pays the DJ directly. A DJ fee never passes through the
app: it keeps the record and the paper trail, but it is not a bank, and it takes
no cut. (The paid part of SONUS is the professional software — see
[What it costs](#what-it-costs).)

**1. The promoter plans the night.** In the dashboard they create the event and
choose how many slots there are, how long each lasts, when the first starts and
the fee per hour. The app works out each slot's fee. They can also set a
**budget** — a ceiling on DJ spending for the night. A slot's fee can be edited
until someone is confirmed for it, then it is locked.

**2. The night goes public.** Once the event is approved (by the venue manager,
or immediately if the promoter manages that venue), every DJ on the platform is
told by app notification, email and Telegram.

**3. A DJ applies for a slot.** From the website, the dashboard's Gig Calendar,
or the phone app. The app enforces the rules:

- They need a **DJ profile** first.
- They cannot apply for a date they marked as **unavailable**.
- They get **one application per event**; the promoter has to add them to a
  second set deliberately.
- A slot is a **queue**, not first-come-first-served: several DJs may apply for
  the same one.

**4. The promoter decides.** They see each application with the DJ's profile,
the slot and the fee, plus any private notes they have kept on that DJ. Then:

- **Confirm** — refused if it would push the night past its DJ budget. The fee
  is locked and the DJ appears on the public lineup with their set time.
- **Decline** — frees the slot, and anyone else waiting on it is told it is open
  again.

Only one DJ can hold a slot. The promoter can also **move** a booking to another
slot on the same night, or **extend** a confirmed DJ into an extra slot (which
becomes its own booking and invoice). An **admin** can force-cancel a confirmed
slot as an override.

**5. The DJ plays the gig.** A confirmed gig is not billable yet. This is
deliberate.

**6. The promoter marks the gig as played.** After the set has ended, the
promoter or venue manager presses "confirm played". The app refuses if the set
has not finished. The booking moves from **confirmed** to **completed**, which is
the invoice gate: nobody can bill a gig that has not happened.

**7. The DJ raises the invoice.** From Earnings, one gig at a time, billed to the
**venue**. The app refuses unless the gig is completed, has not already been
invoiced, is not a zero-fee gig, the DJ's **bank details** are filled in (account
holder, bank, account number, branch code), and their **home base** and the
venue's location are set so travel can be worked out.

**8. The invoice builds itself.** It contains the agreed performance fee, the
**return travel** (home base to venue and back at the platform-wide rate per
kilometre, set by an admin rather than the DJ), the DJ's bank details and an
invoice number. It starts out as **sent**.

**9. The venue pays.** Through a payment link (Stripe or PayFast) or by ordinary
bank transfer, quoting the invoice number. Only the payment provider moves an
invoice to **paid**; a failed card does not cancel anything.

**10. If it is slow, the DJ nudges them.** **REMIND VENUE** sends the venue
manager an in-app alert and an email, and refuses if the invoice is already
paid.

**11. Everyone can see the money.** The DJ sees earned, invoiced, paid and still
owed. The promoter sees **Settlements** per night: fees agreed, invoiced, paid
and outstanding, plus their margin. Both can export a spreadsheet.

Rules worth remembering:

- **Confirming promises money. Completing makes it billable.**
- **The promoter pays nothing through the app** — the DJ invoices the venue and
  the venue pays the DJ.
- **There is no commission line.** The fee is the fee.
- **Attendees are never charged by the platform.** No booking fee, no cut of the
  door price. Paid SONUS modules are software subscriptions for the
  professional side, and they buy tools, never a share of an event.
- **Travel is automatic**: return distance at the platform rate, not a figure the
  DJ types in.
- **A cancelled event keeps its bookings**, so a confirmed fee still stands; that
  is a human conversation, not an app decision.

## The simple way to picture it

Think of it as **three things joined into one**:

1. A **what's-on and guest-list app** for the public — like a ticketing app, but
   with free RSVP and a phone door pass.
2. A **booking and paperwork system** for the music side — DJ slots, fees,
   invoices and payments — replacing spreadsheets and group chats.
3. A **night-of-operations tool** — door check-in, live headcount and DJ
   streaming — so everyone running the room sees the same numbers in real time.

Money is in South African rand, the events are for over-18s, and the platform is
built to follow South African and European privacy law (POPIA/GDPR). The app
takes no commission: DJs invoice the venue directly. That stays true when the
paid modules launch — a subscription buys software, never a share of the door or
of a DJ's fee.

## What it costs

Two different things, often confused:

- **Going out is free.** Browsing, RSVP, the waitlist, the door pass, loyalty and
  referrals cost an attendee nothing, and SONUS takes no cut of a door price.
- **The professional side is the paid side.** Promoter, venue and DJ tools are
  sold as optional monthly modules, alongside a free basic account: month to
  month, cancellable, no fixed term. Nothing is charged today — the paid modules
  are still being built.
- **The DJ fee is untouched either way.** SONUS never takes a percentage of a
  DJ's fee, and the venue pays the DJ directly.

A SONUS subscription pays for software. It never buys a share of an event, a
guest list or a DJ's invoice.

## Common questions

**Do I need to download an app?** No. You can use the website, or install the
phone app if you want notifications. Both show the same nights and the same door
pass.

**Does it cost anything to get on the list?** No. RSVP is free. What you pay at
the door, if anything, is the promoter's entry price — the app takes no cut. The
paid part of SONUS is the professional software: optional monthly modules for the
people running nights, which never apply to attendees.

**What happens if a night is full?** You can join the waitlist, and you are told
when a place opens up.

**What is the door pass, and what if my phone dies?** It is a personal code on
your phone that door staff scan or look up at the entrance. If your battery dies,
give your name at the door — staff can search the list. The pass cannot be
forwarded to someone else.

**How do I get a free entry?** Attend 5 events and the next one is on the house.
Your referral link also earns rewards when friends come along.

**I'm a DJ. How do I get booked?** Create a DJ profile, then apply for slots on
the gig calendar (see the step-by-step flow above). A promoter has to confirm
you — applying is not a booking.

**When does a DJ get paid?** After the night, once the promoter marks that the
DJ played, the DJ invoices the venue. The venue pays the DJ directly; the app
never holds the money.

**Can I become a promoter or door staff?** Roles are granted by an SONUS
admin. Ask at `hello@essentialsedm.com`.

**Who can see my details?** Only what is needed to run the night. The privacy
page lets you download everything held about you; questions go to
`privacy@essentialsedm.com`.

**Something is broken, or I have a question.** Email
`hello@essentialsedm.com` — money, roles and bugs all go to the same place.
