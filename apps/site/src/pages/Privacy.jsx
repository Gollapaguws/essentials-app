import { useState } from "react";
import { Link } from "react-router-dom";
import SiteNav from "@/components/SiteNav";
import SiteFooter from "@/components/SiteFooter";
import { api } from "@/lib/auth";
import { useAuth } from "@/lib/AuthContext";

const LAST_UPDATED = "23 November 2026";
const POLICY_VERSION = "2026-11-23";
const PRIVACY_EMAIL = "privacy@essentialsedm.com";

const requestMailto = (subject) =>
  `mailto:${PRIVACY_EMAIL}?subject=${encodeURIComponent(subject)}`;

function DataExport() {
  const { isAuthenticated, isLoadingAuth } = useAuth();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const download = async () => {
    setBusy(true);
    setMessage("");
    try {
      const data = await api("/site/my-data");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `essentials-my-data-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setMessage("Your export has been downloaded.");
    } catch {
      setMessage(`Could not prepare the export. Email ${PRIVACY_EMAIL} and we will help.`);
    } finally {
      setBusy(false);
    }
  };

  if (isLoadingAuth) return <p className="noir-legal-msg">Checking your session…</p>;

  return (
    <>
      <div className="noir-legal-actions">
        {isAuthenticated ? (
          <button type="button" onClick={download} disabled={busy} className="noir-btn">
            {busy ? "PREPARING…" : "DOWNLOAD MY DATA"}
          </button>
        ) : (
          <Link to="/login" className="noir-btn">
            SIGN IN TO DOWNLOAD
          </Link>
        )}
        <a href={requestMailto("Privacy request")} className="noir-btn">
          EMAIL A REQUEST
        </a>
      </div>
      {message && (
        <p aria-live="polite" className="noir-legal-msg">
          {message}
        </p>
      )}
    </>
  );
}

/** Public privacy notice. */
export default function Privacy() {
  return (
    <div className="noir">
      <SiteNav />
      <main>
        <section className="noir-sec">
          <div className="noir-sec-head">
            <span className="noir-micro">YOUR INFORMATION</span>
            <h1 className="noir-h2">PRIVACY NOTICE</h1>
            <p className="noir-legal-meta">
              Last updated {LAST_UPDATED} · Version {POLICY_VERSION}
            </p>
          </div>

          <div className="noir-legal">
            <section>
              <h2>Who is responsible</h2>
              <p>
                SONUS is the responsible party for the personal information described in this
                notice. Our Information Officer can be reached at{" "}
                <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
              </p>
              <p>
                This notice covers essentialsedm.com, guest accounts, event lists and door passes,
                the DJ, promoter and venue dashboards, live chat, and the notifications we send. It explains
                what we collect, why we collect it, who we share it with, how long we keep it, and
                the choices and rights you have.
              </p>
              <p>
                We process personal information under the Protection of Personal Information Act,
                4 of 2013 (POPIA). Where the General Data Protection Regulation (GDPR) or UK GDPR
                applies, we also honour the additional rights those laws give you.
              </p>
            </section>

            <section>
              <h2>What we collect</h2>
              <ul>
                <li>
                  <strong>Account details:</strong> your email address, name, profile photo and
                  sign-in identifiers. Passwords are handled by our authentication provider and are
                  never stored by SONUS in readable form.
                </li>
                <li>
                  <strong>Event activity:</strong> RSVPs, guest-list entries, door check-ins, event
                  attendance, loyalty visits and referral activity.
                </li>
                <li>
                  <strong>Preferences:</strong> the music tastes and vibe you choose, notification
                  settings, and your live-chat display name.
                </li>
                <li>
                  <strong>DJ, promoter and venue business records:</strong> stage and venue details,
                  bookings, fees, invoices, and the bank/payout details needed to pay a DJ. Bank
                  details are private to the payout workflow and are not shown to promoters.
                </li>
                <li>
                  <strong>Communications:</strong> messages you send us, support requests, and the
                  account, booking and event notifications associated with your account.
                </li>
                <li>
                  <strong>Mailbox content:</strong> if we provision an @essentialsedm.com mailbox for
                  you, the messages stored in it and mailbox usage data. The mailbox is separate
                  from your sign-in email address.
                </li>
                <li>
                  <strong>Technical and security data:</strong> IP address, device and browser
                  information, authentication and audit events, and error/security logs. These are
                  used to keep accounts and the service safe.
                </li>
                <li>
                  <strong>Site analytics:</strong> a cookie-less daily visitor hash and aggregate page
                  views. The hash is not used to build an advertising profile and is not linked to
                  your email address.
                </li>
              </ul>
              <p>
                We do not collect payment-card numbers on this site. Payments are handled by the
                relevant payment provider. We do not buy personal information, and we do not sell or
                rent it.
              </p>
            </section>

            <section>
              <h2>Why we process it, and our lawful basis</h2>
              <h3>To provide the service you asked for</h3>
              <p>
                We use your account and event information to create your account, put your name on
                the door, run guest lists and check-ins, calculate loyalty and referrals, and give
                DJs, promoters and venues the tools they use. This is necessary to perform our
                agreement with you.
              </p>
              <h3>To run and secure the platform</h3>
              <p>
                We use technical, security and audit data to authenticate users, prevent fraud and
                abuse, investigate incidents, maintain backups, and improve reliability. This is
                based on our legitimate interest in operating a safe service, and on legal
                obligations where they apply.
              </p>
              <h3>To meet legal and accounting duties</h3>
              <p>
                We keep invoice, payment and tax records where the law requires it, and we may
                process information to respond to a lawful request from a court, regulator or law
                enforcement agency.
              </p>
              <h3>To send you service notifications</h3>
              <p>
                We send account notices, door passes, booking updates and security messages through
                the dashboard and, if you connect it, Telegram. Security notices — a new account, a
                change of access, a sign-in reset or a change to two-step verification — are also
                emailed to the address on your account. These are service messages, never marketing.
                You can disconnect Telegram at any time in your settings.
              </p>
            </section>

            <section>
              <h2>Notifications and your choices</h2>
              <p>
                SONUS does not send promotional messages or run mailing lists. Creating an account,
                RSVPing or signing in does not add you to any list.
              </p>
              <p>
                Account notices, door passes, booking updates and security messages are service
                messages. They appear in the dashboard and, if you connect Telegram in settings, may
                be delivered there; security notices are also emailed to the address on your account.
                You can disconnect Telegram at any time; service messages about your account,
                bookings, invoices or security remain available in the dashboard.
              </p>
            </section>

            <section>
              <h2>Cookies and local storage</h2>
              <p>
                We use only storage that is necessary to run the service: session cookies for
                sign-in and the dashboard, a dashboard layout preference, and your live-chat display
                name. We do not use advertising cookies, cross-site trackers or behavioural
                advertising pixels on this site. Our site-visit counter is cookie-less and uses a
                daily hash rather than a persistent identifier.
              </p>
              <p>
                Because we do not use non-essential tracking cookies, there is no advertising-cookie
                consent banner to dismiss. If that changes, we will ask for consent before setting
                non-essential cookies.
              </p>
            </section>

            <section>
              <h2>Who we share it with</h2>
              <p>
                We share personal information only where needed to run SONUS:
              </p>
              <ul>
                <li>
                  <strong>Service providers:</strong> authentication and database hosting, website
                  and media hosting, notification delivery, and payment providers. They process
                  information on our instructions.
                </li>
                <li>
                  <strong>Event participants:</strong> a promoter or venue sees the guest-list details
                  needed to run the event you booked for. A DJ sees the booking details needed to
                  perform. Bank details are restricted to the payout workflow.
                </li>
                <li>
                  <strong>Professional advisers and authorities:</strong> auditors, lawyers, insurers,
                  courts or regulators where the law requires or permits it.
                </li>
                <li>
                  <strong>A successor organisation:</strong> if the business is sold or reorganised,
                  information may transfer as part of that transaction, subject to this notice.
                </li>
              </ul>
              <p>
                Some providers may process information outside South Africa. Where that happens, we
                rely on appropriate safeguards for cross-border transfers under POPIA section 72
                and, where GDPR applies, on lawful transfer mechanisms such as standard contractual
                clauses. You can ask us for more detail about the safeguards used.
              </p>
            </section>

            <section>
              <h2>How long we keep it</h2>
              <p>
                We keep personal information only for the purpose we collected it and for as long as
                the law requires or permits. In practice:
              </p>
              <ul>
                <li>
                  Account and event records are kept while your account is active and for a
                  reasonable period afterwards, then deleted or de-identified.
                </li>
                <li>
                  Notification preferences and delivery records are kept while your account is
                  active and for a reasonable period afterwards, so we can honour your settings and
                  show what was sent.
                </li>
                <li>
                  Invoice, payment and tax records are kept for the period required by tax and
                  accounting law, even if you later close your account.
                </li>
                <li>
                  Security and audit logs are kept for a limited period and access-controlled.
                </li>
                <li>
                  Site analytics are stored as daily aggregates; the visitor hash is not linked to
                  your account.
                </li>
              </ul>
              <p>
                When retention ends, we delete the information or turn it into information that can
                no longer identify you.
              </p>
            </section>

            <section>
              <h2>How we protect it</h2>
              <p>
                We use encryption in transit, access controls, hashed authentication credentials
                through our auth provider, two-step verification for privileged accounts,
                httpOnly dashboard sessions, encrypted stored session tokens, audit trails and
                least-privilege access. No system is perfect, but we take reasonable and appropriate
                technical and organisational measures to protect personal information.
              </p>
              <p>
                If a security compromise affects your personal information, we will notify you and
                the Information Regulator where POPIA requires it, and any other regulator where
                GDPR or another applicable law requires it.
              </p>
            </section>

            <section>
              <h2>Your rights</h2>
              <p>Subject to the law, you have the right to:</p>
              <ul>
                <li>ask whether we hold personal information about you and receive a copy;</li>
                <li>ask us to correct information that is inaccurate, incomplete or out of date;</li>
                <li>ask us to delete information that we no longer have a lawful reason to keep;</li>
                <li>object to processing based on legitimate interests;</li>
                <li>ask us to restrict processing while a request is being resolved;</li>
                <li>
                  receive your information in a portable format where GDPR/UK GDPR applies; and
                </li>
                <li>complain to a supervisory authority.</li>
              </ul>
              <p>
                To make a request, use the export button below, email{" "}
                <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>. We may need to verify your
                identity before acting. We aim to
                respond within 30 days, or within one month where GDPR/UK GDPR applies. If we need
                more time, we will tell you why.
              </p>
              <DataExport />
              <p>
                You can also request deletion or correction by emailing{" "}
                <a href={requestMailto("Data deletion request")}>a deletion request</a> or{" "}
                <a href={requestMailto("Data correction request")}>a correction request</a>. Some
                records may be kept where the law requires it, for example tax records or a legal
                claim.
              </p>
            </section>

            <section>
              <h2>PAIA and regulator complaints</h2>
              <p>
                The Promotion of Access to Information Act, 2 of 2000 (PAIA) also gives you a right
                of access to records. PAIA requests can be sent to{" "}
                <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
              </p>
              <p>
                If you are not satisfied with how we handled your information, please contact us
                first so we can try to resolve it. You may also complain to the Information
                Regulator (South Africa) at{" "}
                <a href="https://inforegulator.org.za" target="_blank" rel="noreferrer">
                  inforegulator.org.za
                </a>
                . If GDPR/UK GDPR applies, you may complain to your local supervisory authority.
              </p>
            </section>

            <section>
              <h2>Children</h2>
              <p>
                SONUS events and accounts are for people aged 18 and over. We do not knowingly
                collect personal information from children. If you believe a child has given us
                personal information, contact <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>{" "}
                and we will delete it.
              </p>
            </section>

            <section>
              <h2>Changes to this notice</h2>
              <p>
                We may update this notice when the service or the law changes. The version and date
                at the top tell you which notice applies. If a change materially affects how we use
                your information, we will make that clear before it takes effect.
              </p>
              <p>
                Questions about this notice or a privacy request:{" "}
                <a href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</a>.
              </p>
            </section>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
