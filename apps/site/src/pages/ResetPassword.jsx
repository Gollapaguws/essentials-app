import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { hasSession, updatePassword } from "@/lib/auth";
import AuthLayout from "@/components/AuthLayout";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  // Supabase recovery links land on /auth/callback which forwards here once the
  // session is established; the marker keeps the page honest about that state.
  const recovery = searchParams.get("recovery");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // A used, expired or lost recovery link leaves no session behind. Showing the
  // form then would let a visitor type a password that can never be saved, so
  // fall back to the screen that offers a fresh link.
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!recovery) return;
    let cancelled = false;
    hasSession().then((live) => {
      if (!cancelled && !live) setExpired(true);
    });
    return () => {
      cancelled = true;
    };
  }, [recovery]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword !== confirmPassword) {
      setError("Those two passwords are different. Type the same one twice.");
      return;
    }
    setLoading(true);
    try {
      await updatePassword(newPassword);
      window.location.href = "/";
    } catch (err) {
      // The session behind a recovery link can be spent or timed out between the
      // click and the save; then there is nothing to update and no way forward
      // from this form.
      if (!(await hasSession())) {
        setExpired(true);
        return;
      }
      setError(err.message || "The password could not be changed. Try again.");
    } finally {
      setLoading(false);
    }
  };

  if (!recovery || expired) {
    return (
      <AuthLayout
        title="LINK EXPIRED"
        subtitle="This reset link is incomplete, already used, or has expired."
        footer={
          <div className="noir-auth-foot">
            <Link to="/forgot-password" className="noir-quiet-link">
              Request a new link
            </Link>
          </div>
        }
      >
        <p className="noir-auth-note">
          Open the newest reset email and use that link, or ask for another one — each link works once.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title="NEW PASSWORD" subtitle="Choose a new password. Your other devices stay signed in.">
      <form onSubmit={handleSubmit} className="noir-auth-stack">
        <div className="noir-fieldgroup">
          <label className="noir-label" htmlFor="password">
            New password
          </label>
          <input
            id="password"
            className="noir-field"
            type="password"
            autoComplete="new-password"
            autoFocus
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </div>

        <div className="noir-fieldgroup">
          <label className="noir-label" htmlFor="confirm">
            New password again
          </label>
          <input
            id="confirm"
            className="noir-field"
            type="password"
            autoComplete="new-password"
            placeholder="Same password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <p className="noir-auth-error" role="alert">
            {error}
          </p>
        )}

        <button type="submit" className="noir-auth-primary" disabled={loading}>
          {loading ? "Saving…" : "Save new password"}
        </button>
      </form>
    </AuthLayout>
  );
}
