# Privacy and direct-marketing compliance

This is the engineering and operations map for the privacy notice. It is not
legal advice and it is not a claim of certification. A lawyer or the Information
Officer should review the notice, the operator contracts and the open items below
before ESSENTIALS describes itself as fully compliant.

Current notice version: **2026-11-14**

Public notice: `/privacy` (`apps/site/src/pages/Privacy.jsx`)

Consent version constant: `apps/api/src/common/privacy.ts`

Privacy contact: `privacy@essentialsedm.com`

## Laws covered

- **POPIA** (Protection of Personal Information Act, 4 of 2013): lawful
  processing, purpose limitation, openness, security safeguards, data-subject
  participation, direct marketing and cross-border transfers.
- **GDPR / UK GDPR** where an EU or UK data subject is involved: additional
  rights (portability, restriction, objection), one-month response target and
  supervisory-authority complaints.
- **CPA** (Consumer Protection Act, 68 of 2008): opt-in for electronic direct
  marketing and the right to restrict unwanted direct marketing.
- **ECTA** (Electronic Communications and Transactions Act, 25 of 2002):
  electronic communications and unsubscribe handling.
- **PAIA** (Promotion of Access to Information Act, 2 of 2000): access to records.
- **Tax Administration Act / accounting law**: retention of invoice and payment
  records after an account is closed.

## Implemented controls

| Control | Where it lives | What it does |
| --- | --- | --- |
| Public privacy notice | `apps/site/src/pages/Privacy.jsx` | Names the responsible party and Information Officer contact, lists data categories, purposes, lawful bases, sharing, cross-border safeguards, retention, security, children, rights, complaints and PAIA. |
| Separate marketing opt-in | `apps/site/src/components/SiteFooter.jsx` | Newsletter consent is an unticked checkbox linked to the notice. The submit button stays disabled until it is ticked. |
| Server-side consent enforcement | `apps/api/src/site/site.controller.ts`, `site.service.ts` | `POST /api/site/subscribe` rejects a missing or false `consent` flag; the address alone is never treated as consent. |
| Consent evidence | `packages/db/prisma/schema.prisma` (`Consent`) | Stores source, policy version, grant creation time, last update and revocation time. |
| Withdrawal evidence | `apps/api/src/email-engine/email-engine.service.ts` | Preference-centre unsubscribe and mailing-list unsubscribe set `revokedAt`, the current policy version and a source. |
| Import attestation | `apps/api/src/email-engine/email-engine.controller.ts`, `email-engine.service.ts`, `apps/web/src/app/(dashboard)/email/page.tsx` | A promoter must confirm every imported contact opted in. The attestation and policy version are stored on the segment and on each newly created consent row. Importing never re-opts an address that already revoked consent. |
| One-click unsubscribe | `apps/api/src/mail/unsubscribe.ts`, mail providers | Signed, expiring tokens and RFC 8058 headers on bulk mail. |
| Account/transactional separation | Registration and account flows | Creating an account does not grant marketing consent. Account, door-pass, booking, invoice and security mail remains transactional. |
| Self-service access/portability | `apps/api/src/site/site-stats.service.ts`, `Privacy.jsx` | Signed-in people can download a JSON export of their account, event, consent, referral, artist, booking and invoice data. |
| Correction/deletion/objection channel | `Privacy.jsx` | Email links for deletion and correction; the notice explains the legal exceptions (for example tax records and legal claims). |
| Cookie-less analytics | `apps/api/src/site/site-stats.service.ts` | Page views use a daily visitor hash and aggregate counts, not an advertising identifier. |
| Security controls | auth/session/MFA code and audit models | TLS, httpOnly dashboard sessions, encrypted refresh tokens, hashed recovery codes, privileged-account MFA, audit events and least-privilege API guards. |
| Children | `Privacy.jsx` | Service is stated as 18+ and a deletion route is given if a child's data is discovered. |
| Changelog/version control | `CHANGELOG.md`, `Privacy.jsx` | Material notice changes get a new version and date. |

## Data map

| Data | Purpose | Basis | Typical recipients | Retention |
| --- | --- | --- | --- | --- |
| Email, name, avatar, auth IDs | Account, door pass, sign-in | Contract | Auth/database host, event promoter/venue where needed | Account lifetime plus a reasonable wind-down period |
| RSVP, guest list, check-in, loyalty, referrals | Run events and guest experience | Contract / legitimate interest | Promoter and venue for that event | Event operations period, then delete/de-identify |
| Music tastes, vibe, live-chat name | Personalisation and live chat | Consent / contract | Internal platform | Until changed or account deletion |
| Email consent, source, policy version, revocation | Prove and honour marketing choice | Legal obligation / accountability | Internal platform, mail provider | While active plus a reasonable evidence period |
| DJ/venue bookings, fees, invoices, bank details | Bookings, invoicing and payouts | Contract / legal obligation | Relevant promoter/venue (not bank details), payment provider | Contract period plus tax/accounting period |
| Security logs, auth events, IP | Security, fraud, incident response | Legitimate interest / legal obligation | Hosting and security providers | Short operational period |
| Daily visitor hash and page counts | Aggregate traffic measurement | Legitimate interest | Internal platform | Short-lived aggregate period |
| Marketing email events | Delivery, unsubscribe, attribution | Consent / legitimate interest | Mail provider | Consent evidence period |

## Data-subject request procedure

1. Receive the request at `privacy@essentialsedm.com` or through the export
   button.
2. Verify the requester's identity without collecting more data than necessary.
3. Search all stores that can hold the person's data: `User`, `Consent`,
   `EmailEvent`, `GuestList`, `AuthEvent`, `DashboardSession`, `ArtistProfile`,
   `ArtistBooking`, `Invoice`, `Payment` and mail-provider suppression lists.
4. For access/portability, provide the JSON export and explain any redactions
   needed to protect another person's information.
5. For correction, update the source record and any downstream copies that
   matter.
6. For deletion, delete or de-identify what can be deleted; retain tax,
   accounting, fraud-prevention or legal-claim records and explain the exception.
7. Record the request, decision and date. Respond within 30 days, or one month
   under GDPR/UK GDPR, and tell the person if an extension is needed.
8. If refused, give the legal reason and the complaint route (Information
   Regulator or the relevant supervisory authority).

## Open items before claiming full compliance

- **Operator agreements:** sign data-processing terms with Supabase, the hosting
  provider, the SMTP/Listmonk operator and payment providers; keep a vendor
  register with processing locations.
- **PAIA manual:** publish the PAIA manual and Information Officer details as
  required; the privacy page currently provides the request channel, not the
  statutory manual.
- **Information Officer registration:** confirm the Information Officer is
  registered with the Information Regulator and that the details match the
  notice.
- **Retention automation:** the notice describes retention, but `SiteVisit`,
  `AuthEvent`, `EmailEvent` and old guest records do not yet have automated
  expiry. Add scheduled deletion/anonymisation and a documented retention
  schedule.
- **Deletion workflow:** there is no self-service account deletion or admin
  deletion queue yet. Deletion is handled manually through `privacy@`, and the
  related foreign keys need a tested anonymisation path.
- **DPIA:** complete a data-protection impact assessment for DJ bank details,
  live streaming, location data and any profiling/matching.
- **Breach runbook:** document containment, assessment, regulator notification
  and data-subject notification, including the POPIA and GDPR clocks.
- **Age assurance:** the notice says 18+, but registration has no age
  confirmation. Add an age gate or a documented risk decision.
- **EU/UK representative:** if the service deliberately targets EU/UK data
  subjects, confirm whether an Article 27 representative is required.
- **Cookie review:** re-run the storage inventory before adding analytics,
  advertising pixels or embedded third-party media that sets cookies.
- **Records of processing:** keep a maintained record of processing activities,
  including purposes, categories, recipients, transfers and retention.
- **Legal review:** have the notice, terms, refund policy and direct-marketing
  flows reviewed by a South African privacy lawyer.

## Change control

When the notice changes materially:

1. Update `PRIVACY_POLICY_VERSION` in `apps/api/src/common/privacy.ts`.
2. Update the version and date in `apps/site/src/pages/Privacy.jsx`.
3. Add a changelog entry.
4. Check every consent write still records the new version.
5. Do not silently re-opt-in anyone who previously revoked consent.
