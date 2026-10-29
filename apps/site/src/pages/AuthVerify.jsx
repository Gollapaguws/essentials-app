import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { verifyMagicLink, redeemInvite } from "@/lib/auth";

/** Magic-link callback: verifies the token; falls back to invite-code onboarding for new accounts. */
export default function AuthVerify() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get("token");
  const [state, setState] = useState({ status: "verifying" });
  const [code, setCode] = useState("");
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (!token) return setState({ status: "invalid" });
    verifyMagicLink(token).then((r) =>
      setState(r.ok ? { status: "done", user: r.user } : { status: r.reason }),
    );
  }, [token]);

  useEffect(() => {
    if (state.status === "done") {
      setTimeout(() => navigate("/", { replace: true }), 800);
    }
  }, [state.status, navigate]);

  const join = async (e) => {
    e.preventDefault();
    try {
      await redeemInvite(code, email);
      navigate("/", { replace: true });
    } catch {
      setState({ status: "NO_ACCOUNT", error: "Invalid code or email already registered." });
    }
  };

  return (
    <div className="noir" style={{ minHeight: "80vh", display: "grid", placeItems: "center", padding: 24 }}>
      {state.status === "verifying" && <p style={{ letterSpacing: 2 }}>VERIFYING…</p>}
      {state.status === "done" && <p style={{ letterSpacing: 2 }}>WELCOME. TAKING YOU IN →</p>}
      {state.status === "EXPIRED" && <p>Link expired. <a href="/login" style={{ textDecoration: "underline" }}>Request a new one</a>.</p>}
      {state.status === "invalid" && <p>Missing token. <a href="/login" style={{ textDecoration: "underline" }}>Back to sign in</a>.</p>}
      {state.status === "NO_ACCOUNT" && (
        <form onSubmit={join} style={{ maxWidth: 400, width: "100%", display: "grid", gap: 12 }}>
          <h1 style={{ letterSpacing: 3 }}>NEW HERE?</h1>
          <p style={{ opacity: 0.7 }}>No account for that email yet — enter your invite code to join ESSENTIALS.</p>
          <input placeholder="Invite code" required value={code} onChange={(e) => setCode(e.target.value)}
            style={{ padding: 14, borderRadius: 8, border: "1px solid rgba(255,255,255,.2)", background: "transparent", color: "inherit" }} />
          <input placeholder="you@email.com" type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            style={{ padding: 14, borderRadius: 8, border: "1px solid rgba(255,255,255,.2)", background: "transparent", color: "inherit" }} />
          <button style={{ padding: 14, borderRadius: 8, border: 0, fontWeight: 800, letterSpacing: 2, cursor: "pointer" }}>JOIN ESSENTIALS</button>
          {state.error && <p style={{ color: "#ff5b7f" }}>{state.error}</p>}
        </form>
      )}
    </div>
  );
}
