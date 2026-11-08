Subject: This week in ESSENTIALS — dashboard sessions, a security pass, a deploy that checks itself

Hi team,

Four things changed this week. The full list is in `docs/release-notes-2026-11-08.md`.

**The dashboard no longer stores tokens in the browser.** Sign-in, two-step verification, password changes and recovery all go through the API now. The browser holds one opaque httpOnly cookie; the tokens live in a database row encrypted with `SESSION_SECRET`. Logout deletes the row, so a copied cookie stops working straight away. Recovery uses PKCE, so the browser is never handed a token to finish a reset.

**Security pass.** Event updates can no longer write fields we don't whitelist. Every user-supplied value in the invoice print view, mail templates and unsubscribe pages is escaped. Stripe and PayFast webhooks now check a timestamp window, require secrets and confirm the payload came from the right provider. An old `?email=` unsubscribe link no longer works — links are signed and expire, so links in mail already sent will read "invalid or has expired". Roles and MFA are read from our database, not the token.

**Confirmed DJs are on the front-page lineup with their set times**, read from the bookings when the page loads, so confirming or cancelling a DJ updates the lineup without anyone re-saving it.

**Deploys check themselves.** `npm run smoke` runs 22 checks against the live stack, including the front-page lineup against the bookings table and a real guest RSVP with a door pass. It now also guards the recovery link: a reset from the dashboard's own origin must be accepted and a foreign origin refused. That check exists because every reset from the dashboard was being answered `400 Origin not allowed` and nothing noticed until it was curled by hand.

**One thing to try, two minutes:** sign in as a promoter, click Forgot password on the dashboard, and open the link in the mail. It should land on the reset screen. That click is the only part of the new auth flow I could not automate — this host has no test inbox, so the mail goes out through Postfix to real addresses. Everything around it is covered.

API suite: 33 suites, 229 tests. Smoke: 22/22.

— The ESSENTIALS team
