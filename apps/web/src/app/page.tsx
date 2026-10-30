"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken } from "@essentials/api-client";

/** Magic-link sign-in for promoters/admins. */
export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [token, setToken] = useState("");
  const router = useRouter();

  // already signed in (site or dashboard) with a privileged role? go straight in
  useEffect(() => {
    if (!localStorage.getItem("essentials_token")) return;
    api
      .get<{ user: { role: string } }>("/auth/me")
      .then(({ user }) => {
        if (["promoter", "admin", "venue_manager", "artist"].includes(user.role)) router.replace("/dashboard");
        else localStorage.removeItem("essentials_token");
      })
      .catch(() => localStorage.removeItem("essentials_token"));
  }, [router]);

  const verify = async () => {
    const res = await api.post<{ accessToken: string; user: { role: string } }>("/auth/verify", { token });
    if (!["promoter", "admin", "venue_manager"].includes(res.user.role)) {
      alert("Dashboard is for promoters, venue managers and admins.");
      return;
    }
    setToken(res.accessToken);
    localStorage.setItem("essentials_token", res.accessToken);
    router.push("/dashboard");
  };

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-md border border-line bg-surface rounded-2xl p-8">
        <h1 className="text-neon text-3xl font-black tracking-widest">ESSENTIALS</h1>
        <p className="text-neutral-500 mt-2 text-sm">Promoter dashboard — sign in with a magic link.</p>
        {!sent ? (
          <form
            className="mt-6 space-y-3"
            onSubmit={async (e) => {
              e.preventDefault();
              await api.post("/auth/magic-link", { email });
              setSent(true);
            }}
          >
            <input
              className="w-full bg-bg border border-line rounded-lg px-4 py-3 outline-none focus:border-neon"
              placeholder="you@essentials.example"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <button className="w-full bg-neon text-bg font-black tracking-widest rounded-lg py-3 hover:opacity-90">
              SEND MAGIC LINK
            </button>
          </form>
        ) : (
          <div className="mt-6 space-y-3">
            <p className="text-neutral-400 text-sm">Link sent. Paste the token from the email:</p>
            <input
              className="w-full bg-bg border border-line rounded-lg px-4 py-3 outline-none focus:border-neon font-mono text-xs"
              placeholder="token"
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
            <button onClick={verify} className="w-full bg-neon text-bg font-black tracking-widest rounded-lg py-3">
              SIGN IN
            </button>
          </div>
        )}
      </div>
    </main>
  );
}
