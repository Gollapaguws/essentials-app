import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { requestMagicLink, signInWithPassword, signInWithGoogle } from "@/lib/auth";
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
  const [usePassword, setUsePassword] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // Carry the invite through the email round-trip.
      if (inviteCode) localStorage.setItem("essentials_invite", inviteCode);
      if (usePassword) await signInWithPassword(email, password);
      else await requestMagicLink(email, authCallbackUrl);
      setSent(true);
    } catch (err) {
      setError(
        usePassword
          ? "Wrong email or password — or use a sign-in link instead."
          : "Couldn't send the link. Try a password instead.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="noir" style={{ minHeight: "80vh", display: "grid", placeItems: "center", padding: 24 }}>
      <div style={{ maxWidth: 420, width: "100%" }}>
        <h1 style={{ letterSpacing: 4 }}>SIGN IN</h1>
        <p style={{ opacity: 0.7, marginTop: 8 }}>
          {sent
            ? "Check your inbox — the link signs you in on this device."
            : "One email, one tap. No passwords needed."}
        </p>

        {!sent ? (
          <>
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
              {usePassword && (
                <input
                  type="password"
                  required
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={input}
                />
              )}
              <button
                disabled={busy}
                style={{ padding: 14, borderRadius: 8, border: 0, fontWeight: 800, letterSpacing: 2, cursor: "pointer" }}
              >
                {busy ? "WORKING…" : usePassword ? "SIGN IN" : "SEND MAGIC LINK"}
              </button>
              <button
                type="button"
                onClick={() => setUsePassword(!usePassword)}
                style={{ background: "none", border: 0, color: "inherit", opacity: 0.6, cursor: "pointer", fontSize: 12 }}
              >
                {usePassword ? "Email me a link instead" : "Sign in with a password instead"}
              </button>
              <a href="/forgot-password" style={{ opacity: 0.6, fontSize: 12, textAlign: "center" }}>
                Forgot password?
              </a>
            </form>
          </>
        ) : (
          <button
            onClick={() => setSent(false)}
            style={{ marginTop: 24, padding: 12, borderRadius: 8, border: "1px solid rgba(255,255,255,.3)", background: "transparent", color: "inherit", cursor: "pointer" }}
          >
            USE A DIFFERENT EMAIL
          </button>
        )}

        {error && <p style={{ color: "#ff5b7f", marginTop: 12 }}>{error}</p>}
      </div>
    </div>
  );
}
