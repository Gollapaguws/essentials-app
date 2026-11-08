import { useState } from "react";
import { Link } from "react-router-dom";
import { openDashboard, signInWithPassword, signInWithGoogle } from "@/lib/auth";
import { authCallbackUrl } from "@/lib/supabase";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await signInWithPassword(email, password);
      // Signing in here is only half the job: the dashboard reads its own
      // cookie, so swap the Supabase session for it, then hand over.
      await openDashboard();
    } catch {
      setError("That email and password do not match an account. Check both, or use Google.");
    } finally {
      setBusy(false);
    }
  };

  const google = () => {
    setError(null);
    signInWithGoogle(authCallbackUrl).catch(() =>
      setError("Google sign-in did not finish. Try again, or use your email and password."),
    );
  };

  return (
    <AuthLayout
      title="SIGN IN"
      subtitle="Your guest list and door pass are behind this door."
      footer={
        <div className="noir-auth-foot noir-auth-foot--split">
          <Link to="/forgot-password" className="noir-quiet-link">
            Forgot password?
          </Link>
          <Link to="/register" className="noir-quiet-link noir-quiet-link--gold">
            Create an account
          </Link>
        </div>
      }
    >
      <div className="noir-auth-stack">
        <button type="button" onClick={google} className="noir-auth-google">
          <GoogleIcon className="w-4 h-4" />
          Continue with Google
        </button>
        <p className="noir-auth-note">
          Uses the Google account already in this browser. First time here? It creates your guest account.
        </p>

        <div className="noir-auth-or">or use your email</div>

        <form onSubmit={submit} className="noir-auth-stack">
          <div className="noir-fieldgroup">
            <label className="noir-label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="noir-field"
              type="email"
              required
              autoFocus
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="noir-fieldgroup">
            <div className="noir-labelrow">
              <label className="noir-label" htmlFor="password">
                Password
              </label>
              <button
                type="button"
                className="noir-quiet-link"
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <input
              id="password"
              className="noir-field"
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              placeholder="Your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && (
            <p className="noir-auth-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" disabled={busy} className="noir-auth-primary">
            {busy ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="noir-auth-note">
          Promoters, venues and admins add the 6-digit authenticator code after signing in.
        </p>
      </div>
    </AuthLayout>
  );
}
