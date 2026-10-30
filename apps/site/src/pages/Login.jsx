import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { requestMagicLink } from "@/lib/auth";

export default function Login() {
  const [params] = useSearchParams();
  const inviteCode = params.get("invite") ?? "";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (inviteCode) localStorage.setItem("essentials_invite", inviteCode);
      await requestMagicLink(email);
      setSent(true);
    } catch {
      setError("Couldn't send the link. Try again.");
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
            ? "Link sent. Check your inbox — it expires in 15 minutes."
            : "One email, one tap. No passwords."}
        </p>
        {!sent ? (
          <form onSubmit={submit} style={{ display: "grid", gap: 12, marginTop: 24 }}>
            <input
              type="email"
              required
              placeholder="you@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ padding: 14, borderRadius: 8, border: "1px solid rgba(255,255,255,.2)", background: "transparent", color: "inherit" }}
            />
            <button
              disabled={busy}
              style={{ padding: 14, borderRadius: 8, border: 0, fontWeight: 800, letterSpacing: 2, cursor: "pointer" }}
            >
              {busy ? "SENDING…" : "SEND MAGIC LINK"}
            </button>
          </form>
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
