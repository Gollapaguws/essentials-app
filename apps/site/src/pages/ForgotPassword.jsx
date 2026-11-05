import { useState } from "react";
import { Link } from "react-router-dom";
import { requestPasswordReset } from "@/lib/auth";
import { authCallbackUrl } from "@/lib/supabase";
import AuthLayout from "@/components/AuthLayout";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await requestPasswordReset(email, `${authCallbackUrl}?type=recovery`);
      setSent(true);
    } catch (err) {
      // A refused send must not read as "sent": the visitor would sit waiting for
      // an email that is never coming. Rate limiting gets its own wording, because
      // waiting is the actual fix there.
      const throttled =
        err?.status === 429 ||
        /rate limit|security purposes|only request this/i.test(err?.message ?? "");
      setError(
        throttled
          ? "Too many reset emails just now. Wait a minute, then try again."
          : "The reset email could not be sent. Try again in a moment.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout
      title="RESET PASSWORD"
      subtitle="Enter the email on your account and we'll send a link to set a new password."
      footer={
        <div className="noir-auth-foot">
          <Link to="/login" className="noir-quiet-link">
            Back to sign in
          </Link>
        </div>
      }
    >
      {sent ? (
        <div className="noir-auth-stack">
          <p className="noir-auth-note">
            If an account uses <strong>{email}</strong>, the reset link is on its way. It expires in an
            hour, and the spam folder is worth a look.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="noir-auth-stack">
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
          {error && (
            <p className="noir-auth-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="noir-auth-primary" disabled={loading}>
            {loading ? "Sending…" : "Send reset link"}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
