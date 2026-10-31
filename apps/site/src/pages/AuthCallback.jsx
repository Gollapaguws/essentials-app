import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { fetchMe } from "@/lib/auth";

/** @type {import('react').CSSProperties} */
const style = { minHeight: "80vh", display: "grid", placeItems: "center", padding: 24, textAlign: "center" };

/**
 * PKCE landing page for every Supabase redirect (sign-in link, OAuth, recovery).
 * The verifier lives in this browser, so the exchange has to happen here, not on a server.
 */
export default function AuthCallback() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [error, setError] = useState(null);

  useEffect(() => {
    const code = params.get("code");
    const type = params.get("type");
    const providerError = params.get("error_description");

    if (providerError) {
      setError(providerError);
      return;
    }
    if (!code) {
      setError("This link is incomplete or has expired.");
      return;
    }

    (async () => {
      const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
      if (exchangeError) {
        setError("This link has expired. Request a new one.");
        return;
      }

      if (type === "recovery") {
        navigate("/reset-password?recovery=1", { replace: true });
        return;
      }

      const me = await fetchMe();
      if (!me) {
        setError("Signed in, but your account could not be loaded.");
        return;
      }
      // Privileged roles finish two-step setup in the dashboard, not here.
      navigate("/", { replace: true });
    })();
  }, [params, navigate]);

  return (
    <div className="noir" style={style}>
      {error ? (
        <div style={{ display: "grid", gap: 12, maxWidth: 420 }}>
          <p style={{ letterSpacing: 2 }}>SIGN-IN FAILED</p>
          <p style={{ opacity: 0.7 }}>{error}</p>
          <Link to="/login" style={{ textDecoration: "underline" }}>
            Send a new link
          </Link>
        </div>
      ) : (
        <p style={{ letterSpacing: 2 }}>SIGNING YOU IN…</p>
      )}
    </div>
  );
}
