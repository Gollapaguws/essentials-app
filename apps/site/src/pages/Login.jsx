import { useState } from "react";
import { Link } from "react-router-dom";
import { signInWithPassword, signInWithGoogle } from "@/lib/auth";
import { authCallbackUrl } from "@/lib/supabase";
import GoogleIcon from "@/components/GoogleIcon";
import Tip from "@/components/Tip";

const input = {
  padding: 14,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,.2)",
  background: "transparent",
  color: "inherit",
};

const labelRow = { display: "flex", alignItems: "center", gap: 8 };
const labelText = { fontSize: 10, letterSpacing: 2, opacity: 0.55 };
const marker = {
  width: 16,
  height: 16,
  padding: 0,
  borderRadius: "50%",
  border: "1px solid rgba(255,255,255,.25)",
  background: "transparent",
  color: "rgba(255,255,255,.55)",
  fontSize: 10,
  fontWeight: 700,
  lineHeight: 1,
  display: "grid",
  placeItems: "center",
  cursor: "help",
};

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
    } catch (err) {
      setError("Wrong email or password.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="noir" style={{ minHeight: "80vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 420, width: "100%" }}>
        <h1 style={{ letterSpacing: 4 }}>SIGN IN</h1>
        <p style={{ opacity: 0.7, marginTop: 8 }}>Welcome back.</p>

        <Tip
          style={{ width: "100%", marginTop: 20 }}
          label="Uses the Google account already in this browser. First time here? It creates your ESSENTIALS guest account, and an admin can upgrade it later."
        >
          <button
            onClick={() => {
              signInWithGoogle(authCallbackUrl).catch(() => setError("Google sign-in failed."));
            }}
            style={{
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
        </Tip>

        <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 16 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <div style={labelRow}>
              <span style={labelText}>EMAIL</span>
              <Tip label="The email your account uses. Guest sign-ups enter their own; staff are set up by an admin first.">
                <button type="button" aria-label="About the email field" style={marker}>
                  ?
                </button>
              </Tip>
            </div>
            <input
              type="email"
              required
              autoComplete="email"
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={input}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <div style={labelRow}>
              <span style={labelText}>PASSWORD</span>
              <Tip label="The password set when the account was created. If you never set one, use the Google button above or reset it below.">
                <button type="button" aria-label="About the password field" style={marker}>
                  ?
                </button>
              </Tip>
            </div>
            <input
              type="password"
              required
              autoComplete="current-password"
              placeholder="Password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={input}
            />
          </div>

          <Tip
            style={{ width: "100%" }}
            label="Signs you in with the email and password above. Promoter, venue and admin accounts then finish with a 6-digit authenticator code."
          >
            <button
              disabled={busy}
              style={{ width: "100%", padding: 14, borderRadius: 8, border: 0, fontWeight: 800, letterSpacing: 2, cursor: "pointer" }}
            >
              {busy ? "WORKING…" : "SIGN IN"}
            </button>
          </Tip>

          <div style={{ display: "flex", justifyContent: "center" }}>
            <Tip label="Emails a reset link to the address in the email box above.">
              <a href="/forgot-password" style={{ opacity: 0.6, fontSize: 12 }}>
                Forgot password?
              </a>
            </Tip>
          </div>

          <Link to="/register" style={{ marginTop: 4, textAlign: "center", fontSize: 12, letterSpacing: 1, color: "#FFD873" }}>
            New here? Create an account
          </Link>
        </form>

        {error && <p style={{ color: "#ff5b7f", marginTop: 12 }}>{error}</p>}
      </div>
    </div>
  );
}
