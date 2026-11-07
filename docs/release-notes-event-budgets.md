# Release notes — event slots, budgets and DJ pay

Released 7 November 2026.

## For promoters

- **Plan the night in slots.** When you create or edit an event you choose how many slots, how long each one is, and what time the first one starts. The night is cut into back-to-back slots from that start time, and each slot is published to DJs to apply for.
- **Set the DJ fee per hour.** Every event has one hourly rate. Each slot pays that rate for its length (a 90-minute slot at R400/h pays R600), and that is the amount the DJ invoices.
- **Set a budget.** The budget is your ceiling for DJ pay on the night, separate from the plan. Leave it at 0 for no ceiling.
- **Confirming a DJ now stops at the budget.** If confirming an application would take the night past its budget, the button is disabled and the app tells you how far over it would go. The API refuses it too, with the exact fee, the amount already committed and the budget in the message. Declining is never blocked.
- **You can still raise the budget.** Once DJs have applied you can no longer change the slot plan or the hourly fee, but the budget can be changed on its own — that is how you unblock a confirmation you actually want.
- **Two-step completion.** A gig is not finished when the set ends. You confirm the gig happened, and only then does the DJ's invoice become available. Completed gigs stay counted against the budget.

## For DJs

- **Apply for a slot, not a vague time of night.** The gig calendar lists each slot with its exact start and end and the fee it pays.
- **Invoice the venue once the promoter confirms the gig.** Invoicing opens only after the promoter's completion confirmation for a gig you played, and the invoice is for the agreed slot fee.
- **See your earnings.** A new Earnings view shows what you have earned from completed gigs, without travel, so it matches what venues are billed.
- **Travel is paid at the standard rate.** R4.95 per km, set by the platform. You cannot edit it and neither can promoters.

## For venues

- **DJ invoices arrive after the promoter confirms the gig happened**, for the fee agreed when the slot was confirmed — no invoicing for a night that has not been signed off.
- **Travel is reimbursed at the standard R4.95/km.** The rate is fixed by the platform and shown on your invoice lines.

## For admins

- **New Settings screen for the standard travel rate.** One place to see and change the per-km rate that applies across the platform. It cannot be set to zero, and it is not editable by DJs or promoters.
- The rate shown is the one most DJ profiles are on; if profiles disagree, the screen says so.

## Worth knowing

- Budget 0 means "no ceiling" everywhere.
- Completed gigs count against the budget, not just confirmed ones.
- A budget change never rebuilds slots DJs are holding.
