import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { redeemInvite, fetchMe } from "@/lib/auth";
import { useAuth } from "@/lib/AuthContext";

const input = {
  padding: 14,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,.2)",
  background: "transparent",
  color: "inherit",
};

const storedInvite = () => localStorage.getItem("essentials_invite") ?? "";

/** Invite onboarding: the signed-in email is the account email, only the code is typed. */
export default function Join() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const [code, setCode] = useState(storedInvite);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // Already onboarded? Nothing to do here.
  useEffect(() => {
    if (isLoadingAuth || !isAuthenticated) return;
    fetchMe().then((me) => {
      if (me && !me.inviteRequired) navigate("/", { replace: true });
    });
  }, [isAuthenticated, isLoadingAuth, navigate]);

  const redeem = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await redeemInvite(code.trim().toUpperCase());
      localStorage.removeItem("essentials_invite");
      navigate("/", { replace: true });
    } catch (err) {
      const message = String(err?.message ?? "");
      if (/expired/i.test(message)) setError("That invite has expired — ask for a fresh one.");
      else if (/revoked/i.test(message)) setError("That invite was revoked.");
      else if (/fully used/i.test(message)) setError("That invite has already been used up.");
      else if (/invalid/i.test(message)) setError("That code isn't valid.");
      else setError("We couldn't redeem that code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (isLoadingAuth) {
    return (
      <div className="noir" style={{ minHeight: "80vh", display: "grid", placeItems: "center" }}>
        <p style={{ letterSpacing: 2 }}>LOADING…</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="noir" style={{ minHeight: "80vh", display: "grid", placeItems: "center", padding: 24 }}>
        <div style={{ maxWidth: 420, display: "grid", gap: 12, textAlign: "center" }}>
          <h1 style={{ letterSpacing: 3 }}>ONE STEP FIRST</h1>
          <p style={{ opacity: 0.7 }}>Sign in with your email, then come back to enter your invite code.</p>
          <a href="/login" style={{ textDecoration: "underline" }}>Sign in</a>
        </div>
      </div>
    );
  }

  return (
    <div className="noir" style={{ minHeight: "80vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form onSubmit={redeem} style={{ maxWidth: 400, width: "100%", display: "grid", gap: 12 }}>
        <h1 style={{ letterSpacing: 3 }}>JOIN ESSENTIALS</h1>
        <p style={{ opacity: 0.7 }}>
          You're signed in as {user?.email}. Enter your invite code to finish.
        </p>
        <input
          placeholder="Invite code"
          required
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          style={{ ...input, letterSpacing: 2 }}
        />
        <button
          disabled={busy || code.trim().length < 4}
          style={{ padding: 14, borderRadius: 8, border: 0, fontWeight: 800, letterSpacing: 2, cursor: "pointer" }}
        >
          {busy ? "JOINING…" : "JOIN ESSENTIALS"}
        </button>
        {error && <p style={{ color: "#ff5b7f" }}>{error}</p>}
      </form>
    </div>
  );
}
