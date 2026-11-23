# SONUS — the remaining five decisions before the build moves

*One page for the people who own the business, not the code. Each item is
something engineering cannot decide, with a recommendation and what it blocks.*

| # | Decision | Blocks | Needed by |
| --- | --- | --- | --- |
| 1 | ~~Which name is public~~ — **DECIDED: SONUS** | Domain, sender addresses, contracts, legal entity | Settled |
| 2 | Are the listed prices VAT-inclusive | Billing checkout, receipts, plan data model | Phase 2 |
| 3 | Music rights for the Viewing Room | Any paid streaming, public broadcast, recording | Phase 4 |
| 4 | Does a shared audience network exist at all | Audience module, the R99/R49 products | Phase 5 |
| 5 | Do unused Viewing Room sessions roll over | Session sales copy, counter logic | Phase 3 |
| 6 | What existing accounts pay, and when | Migration behaviour, launch comms | Phase 2 |

---

**1. Brand hierarchy — DECIDED: the app is called SONUS.**
Done: the visible name in the public site, guest app, dashboard, emails and docs
now reads SONUS. Hubs stay configuration, so a second vertical later is a new hub,
not a new brand. Still open, and not engineering decisions: the domain, the
sender address (currently `hello@essentials...`), the app-store listings, and the
legal entity. Those follow the domain and store paperwork, so they are tracked
here rather than guessed at. *Nothing is blocked by this any more.*

**2. Prices: VAT included or added on top?**
*Recommendation: treat the published R99/R149/R199/R399 as the total a customer
pays, VAT included, and store a flag so the split can be shown once you are
VAT-registered.* South African consumer law expects an advertised price to be the
price paid; "R99 plus VAT" at checkout reads as a bait price. Registration is not
compulsory below the turnover threshold, and 100 subscribers is roughly R299k a
year, so the practical choice is to publish a gross price now and add the VAT
breakdown to invoices when registration happens. *Cost of delay:* billing code
bakes in an assumption that is expensive to reverse, and early receipts are wrong.

**3. Music rights — can we stream at all?**
*Recommendation: no paid or public Viewing Room until you hold written
performance and broadcast permissions, and no recording by default.* Streaming
DJ sets publicly engages performance and broadcast rights (SAMRO/SAMPRA territory)
and artist consent is separate from a platform licence. The cheap first version
is artists sharing their own pre-recorded mixes, no recording retained, no public
broadcast — enough to prove demand without selling something you cannot legally
deliver. *Cost of delay:* none while the room stays free and private; the danger
is selling R199 packages before the licences exist.

**4. The shared audience network — build it or not?**
*Recommendation: do not build cross-promoter marketing in the first year. Build
only organisation-owned lists, which tenancy already gives each customer.*
Sending to another promoter's contacts is the single largest legal exposure in
the whole document, it is what gets a sending domain blacklisted, and there is no
evidence yet that promoters will pay R99 for it. Keep the R49 add-on as
import/management of a customer's own contacts, and revisit the network only with
a POPIA opinion and fresh, purpose-specific opt-in from each person.
*Cost of delay:* none — this removes work, and the paid email product still
exists on owned lists.

**5. Unused Viewing Room sessions — roll over or expire?**
*Recommendation: expire at the end of each monthly period, with sessions already
booked honoured if the event is cancelled.* Rollover turns a predictable cost
into an unpredictable one, because streaming is the only variable cost that grows
with success. Expiry is standard for capped media products and is defensible as
long as remaining sessions are shown in the dashboard and stated at purchase.
*Cost of delay:* counter and billing logic get written the wrong way round.

**6. Existing accounts — free forever, or free for now?**
*Recommendation: a 12-month comped professional plan for every account that
exists when billing launches, then standard pricing with 60 days' notice.*
Permanent free accounts destroy the R399 tier and create a two-class customer
base; a hard cutover on day one punishes the people who proved the product. A
dated comp is clean in the data, generous in perception, and forces a real
conversation a year from now instead of never. *Cost of delay:* the migration
needs to know which of the two it is before it runs.

---

**If only three get decided this month:** 6 (free to decide, unblocks the
migration), 2 (needed before the first rand is charged) and 5 (a one-line
policy). Items 3 and 4 are scope reductions waiting to be accepted.
