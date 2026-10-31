import React, { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UserPlus, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import AuthLayout from "@/components/AuthLayout";
import { useAuth } from "@/lib/AuthContext";
import { redeemInvite } from "@/lib/auth";

/** ESSENTIALS is invite-only: sign in first, then redeem the code. */
export default function Register() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoadingAuth, user } = useAuth();
  const [code, setCode] = useState(localStorage.getItem("essentials_invite") ?? "");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await redeemInvite(code.trim().toUpperCase());
      localStorage.removeItem("essentials_invite");
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "That invite code could not be redeemed");
    } finally {
      setLoading(false);
    }
  };

  if (isLoadingAuth) {
    return (
      <AuthLayout icon={UserPlus} title="Loading" subtitle="Checking your session">
        <div className="flex justify-center py-6">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </AuthLayout>
    );
  }

  if (!isAuthenticated) {
    return (
      <AuthLayout
        icon={UserPlus}
        title="Invite only"
        subtitle="Sign in with your email first, then enter your invite code"
        footer={
          <Link to="/login" className="text-primary font-medium hover:underline">
            Back to log in
          </Link>
        }
      >
        <Button className="w-full h-12 font-medium" onClick={() => navigate("/login")}>
          Sign in
        </Button>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      icon={KeyRound}
      title="Enter your invite code"
      subtitle={`Finishing setup for ${user?.email ?? "your account"}`}
      footer={
        <Link to="/login" className="text-primary font-medium hover:underline">
          Not you?
        </Link>
      }
    >
      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 text-destructive text-sm">{error}</div>
      )}
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="code">Invite code</Label>
          <Input
            id="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            autoFocus
            required
            className="h-12 tracking-widest"
          />
        </div>
        <Button type="submit" className="w-full h-12 font-medium" disabled={loading || code.trim().length < 4}>
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Joining...
            </>
          ) : (
            "Join ESSENTIALS"
          )}
        </Button>
      </form>
    </AuthLayout>
  );
}
