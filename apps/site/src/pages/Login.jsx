import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { signInWithPassword, signInWithGoogle } from "@/lib/auth";
import { authCallbackUrl } from "@/lib/supabase";
import GoogleIcon from "@/components/GoogleIcon";

const input = {
  padding: 14,
  borderRadius: 8,
  border: "1px solid rgba(255,255,255,.2)",
  background: "transparent",
  color: "inherit",
};

export default function Login() {
  const [params] = useSearchParams();
  const inviteCode = params.get("invite") ?? "";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Carry the invite through the email round-trip.
      if (inviteCode) localStorage.setItem("essentials_invite", inviteCode);
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

        <button
          onClick={() => {
            if (inviteCode) localStorage.setItem("essentials_invite", inviteCode);
            signInWithGoogle(authCallbackUrl).catch(() => setError("Google sign-in failed."));
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
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={input}
          />
          <button
            disabled={busy}
            style={{ padding: 14, borderRadius: 8, border: 0, fontWeight: 800, letterSpacing: 2, cursor: "pointer" }}
          >
            {busy ? "WORKING…" : "SIGN IN"}
          </button>
          <a href="/forgot-password" style={{ opacity: 0.6, fontSize: 12, textAlign: "center" }}>
            Forgot password?
          </a>
        </form>

        {error && <p style={{ color: "#ff5b7f", marginTop: 12 }}>{error}</p>}
      </div>
    </div>
  );
}
