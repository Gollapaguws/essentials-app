import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { signUpWithPassword, signInWithGoogle } from "@/lib/auth";
import { authCallbackUrl } from "@/lib/supabase";
import AuthLayout from "@/components/AuthLayout";
import GoogleIcon from "@/components/GoogleIcon";

/** Public sign-up. The role starts as guest; an admin assigns DJ/venue/promoter. */
export default function Register() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
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
      setError(err.message || "Could not create the account. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const google = () => {
    setError(null);
    signInWithGoogle(authCallbackUrl).catch(() =>
      setError("Google sign-up did not finish. Try again, or use your email and password."),
    );
  };

  return (
    <AuthLayout
      title="JOIN THE LIST"
      subtitle="Create a guest account. Your name goes on the door for every night you book."
      footer={
        <div className="noir-auth-foot">
          <span>Already have an account?</span>
          <Link to="/login" className="noir-quiet-link noir-quiet-link--gold">
            Sign in
          </Link>
        </div>
      }
    >
      {sent ? (
        <div className="noir-auth-stack">
          <p className="noir-auth-note">
            We sent a confirmation link to <strong>{email}</strong>. Open it, then sign in.
          </p>
          <Link to="/login" className="noir-auth-primary">
            Go to sign in
          </Link>
        </div>
      ) : (
        <div className="noir-auth-stack">
          <button type="button" onClick={google} className="noir-auth-google">
            <GoogleIcon className="w-4 h-4" />
            Continue with Google
          </button>
          <p className="noir-auth-note">
            One click, and your guest account is ready. An admin upgrades staff accounts later.
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
                minLength={8}
                autoComplete="new-password"
                placeholder="At least 8 characters"
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
              {busy ? "Creating account…" : "Create account"}
            </button>
          </form>

          <p className="noir-auth-note">We use this email only for your door pass and account notices.</p>
        </div>
      )}
    </AuthLayout>
  );
}
