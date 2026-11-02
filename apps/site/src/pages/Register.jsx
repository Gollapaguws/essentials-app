import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signUpWithPassword, signInWithGoogle } from "@/lib/auth";
import { authCallbackUrl } from "@/lib/supabase";
import GoogleIcon from "@/components/GoogleIcon";

const input = {
  padding: 14,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,.2)",
  background: "transparent",
  color: "inherit",
};

/** Public sign-up. The role starts as guest; an admin assigns DJ/venue/promoter. */
export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await signUpWithPassword(email, password);
      if (session) navigate("/", { replace: true });
      else setSent(true);
    } catch (err) {
      setError(err.message || "Could not create the account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="noir" style={{ minHeight: "80vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 420, width: "100%" }}>
        <h1 style={{ letterSpacing: 4 }}>JOIN THE LIST</h1>
        <p style={{ opacity: 0.7, marginTop: 8 }}>Create an account to get on the guest list.</p>

        {sent ? (
          <>
            <p style={{ marginTop: 24 }}>Check {email} to confirm your account, then sign in.</p>
            <Link to="/login" style={{ display: "inline-block", marginTop: 16, opacity: 0.7, fontSize: 13 }}>
              Back to sign in
            </Link>
          </>
        ) : (
          <>
            <button
              onClick={() => {
                signInWithGoogle(authCallbackUrl).catch(() => setError("Google sign-up failed."));
              }}
              style={{
                marginTop: 20,
                width: "100%",
                padding: 14,
                borderRadius: 8,
                border: "1px solid rgba(255,255,255,.3)",
                background: "transparent",
                color: "inherit",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                cursor: "pointer",
              }}
            >
              <GoogleIcon className="w-5 h-5" />
              CONTINUE WITH GOOGLE
            </button>

            <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
              <input
                type="email"
                required
                placeholder="you@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={input}
              />
              <input
                type="password"
                required
                minLength={8}
                placeholder="Password (8+ characters)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                style={input}
              />
              <button
                disabled={busy}
                style={{ padding: 14, borderRadius: 8, border: 0, fontWeight: 800, letterSpacing: 2, cursor: "pointer" }}
              >
                {busy ? "WORKING…" : "CREATE ACCOUNT"}
              </button>
              <Link to="/login" style={{ opacity: 0.6, fontSize: 12, textAlign: "center" }}>
                Already have an account? Sign in
              </Link>
            </form>
          </>
        )}

        {error && <p style={{ color: "#ff5b7f", marginTop: 12 }}>{error}</p>}
      </div>
    </div>
  );
}
