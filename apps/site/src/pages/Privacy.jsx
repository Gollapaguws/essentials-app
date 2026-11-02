export default function Privacy() {
  return (
    <div className="noir" style={{ minHeight: "100vh", padding: "80px 24px", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ letterSpacing: 3 }}>PRIVACY</h1>
      <p style={{ opacity: 0.8, marginTop: 16 }}>
        ESSENTIALS stores only what we need to run the list: your email, name if you give it,
        your RSVP history and your stated music tastes. No advertising trackers, no cookies
        beyond your own session, no data sales — ever.
      </p>
      <p style={{ opacity: 0.8, marginTop: 12 }}>
        Every email we send carries a one-click unsubscribe. You can request a copy of everything
        we hold about you (or deletion) at any time: privacy@essentialsedm.com.
      </p>
      <p style={{ opacity: 0.5, marginTop: 12 }}>POPIA-aligned. Consent records are kept per email address.</p>
    </div>
  );
}
