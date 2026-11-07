# Release notes — settlements, slot queues and DJ tools

Released 7 November 2026. Follows *Release notes — event slots, budgets and DJ pay*.

## For promoters

- **Settlements page.** One view of every night: DJ fees agreed, what has been invoiced, what the venue has actually paid, and what is still outstanding, with each gig's invoice number and state. Totals at the top.
- **A slot is a queue, not a claim.** Several DJs can apply for the same slot. You confirm one; confirming a second DJ for it is refused. Declining a DJ frees the slot and tells the others who applied that it is open again.
- **Tell a DJ why.** The applications row has an optional reason field; it is stored on the application and included in the decline notice the DJ receives.
- **Heads and headline fees.** Each slot can now be priced on its own, separate from the event's hourly rate — R700 for the headline set, R495 for the rest. Once a DJ is confirmed for that slot the fee is locked, because it is the amount they agreed to.
- **The budget has a floor.** You cannot set the budget below fees already committed to confirmed DJs. Lower it further and the night would be permanently over budget with no confirmations possible.
- **Clone and repeat.** Cloning a night now carries its slot plan, hourly fee and budget instead of making you retype them. **Repeat weekly** turns one night into a run of up to 12 weekly drafts with the same plan.
- **Exports.** A **Spend CSV** per event lists every slot, the DJ, the fee, the completion and the invoice state. **Guest CSV** downloads now work — the old link pointed at a route that required a sign-in.

## For DJs

- **No more single-applicant slots.** You can apply for a slot that other DJs have also applied for, and the slot shows how many have.
- **You always know why.** A declined application carries the promoter's reason, if they gave one.
- **Block dates you cannot play.** The Gig Calendar has a "Dates I can't play" section. Applications for a slot on a blocked day are refused, with the day and reason.
- **Calendar export.** Download your confirmed and played gigs as an `.ics` file for any calendar app.
- **Remind the venue.** On the Earnings page, an unpaid invoice gets a **Remind venue** button that notifies the venue's manager (in-app and email). It refuses invoices that are already paid.
- **Mobile Gigs tab.** Open slots with their fees and applicant counts, apply from the phone, and see each gig's invoice state and what you are still owed.
- **Profile photo.** Choose a photo from your phone's library; it is checked against the 5 MB limit and uploaded to your profile.

## For venues

- **Invoice reminders arrive through the platform** from the DJ who played the night, with the invoice number and amount, instead of relying on a phone call.

## For promoters on mobile

- **Staff tab.** Your nights, upcoming count and list fill at a glance. Only promoter and admin accounts see it.

## For admins

- **Audit trail.** A new Audit page shows the security events the platform already records: sign-ins, linked accounts, role changes, MFA enrollment and escalation, with account, IP and detail. Admin-only.

## Worth knowing

- A slot's fee cannot change once a DJ is confirmed for it; decline them first.
- The budget cannot be set below committed fees, but it can still be raised at any time.
- Clone and repeat create **draft** nights — they do not go live or call DJs until you publish them.
- Blocked days refuse new applications; existing confirmations are unaffected, so talk to the promoter if a gig changes.
- Invoices still come only from a gig the promoter has confirmed was played.
