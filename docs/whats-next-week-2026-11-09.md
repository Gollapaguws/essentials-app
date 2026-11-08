# What's next — week of 9 November 2026

Internal. Follows *Release notes — week of 2 November 2026*; the items below are
the loose ends that note left open, in the order we should take them.

| What | Why now | Done when |
| --- | --- | --- |
| **1. Run the smoke script from the deploy script** | The release notes say deploys check themselves, but `scripts/deploy-vps.sh` still ends with three `curl`s and never calls `npm run smoke`. Today the checks pass only because someone remembers to run them. | `deploy-vps.sh` runs `npm run smoke` after the restart and exits non-zero when it fails; proven once by breaking a check on purpose, watching the deploy stop, then restoring it. |
| **2. Prune expired dashboard sessions on a schedule** | `DashboardSession` rows are only deleted on logout or when a stale cookie is presented. An abandoned session keeps an encrypted Supabase access and refresh token in the table indefinitely, and `ScheduleModule` is already imported with nothing registered in it. | A nightly job deletes rows whose `refreshUntil` has passed, logs how many, and a test pins the cutoff so a live session is never swept. |
| **3. Confirm a real recovery email on production** | The one step of the new auth flow that is not automated: this host has no test inbox, and mail leaves through Postfix to real addresses. Everything around the click is covered by tests and smoke. | A promoter raises a reset on the live dashboard, opens the mail, sets a new password and signs in. Note anything unexpected about the link, the expired state or the mail's landing host, then close the caveat in the notes. |
| **4. Run the API test suite in CI** | 33 suites and 229 tests exist, but `.github/workflows/typecheck.yml` only typechecks, lints and builds. A regression can merge green and only surface on the next deploy. | A CI job generates the Prisma client and runs `npx jest`; a deliberately failing test blocks a pull request. |
| **5. Signed-in devices in settings** | Sessions are rows now, so this is mostly a screen: date created, last seen, and which are aal2. Revoking another device is the difference between "logout protects me" and "I can kick out a session I no longer control". | Settings lists the caller's sessions and revoking one deletes its row and signs that device out on its next request. |

## Not this week

- **Rotating `SESSION_SECRET`.** Every session would have to be re-encrypted or
  dropped; worth designing once there are real users to disrupt, and item 2 makes
  the cleanup half of that easier.
- **Mobile session parity.** Phones sign in with a bearer token and are not
  affected by the cookie change; nothing is broken there, only different.
- **More lineup polish.** Confirmed DJs and their times are on the front page and
  the smoke run checks them against the bookings table; leave it alone until
  something is actually reported.

## If we only land one thing

Item 1. Every other item is a gap someone has to remember; that one turns the
gaps we already have into something the deploy notices by itself.
