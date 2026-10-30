"use client";

import { useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { api, setToken } from "@essentials/api-client";

/** Magic-link callback: exchanges ?token= for a session and enters the dashboard. */
export default function AuthVerify() {
  const params = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"verifying" | "ok" | "expired" | "invalid">("verifying");

  useEffect(() => {
    const token = params.get("token");
    if (!token) return setStatus("invalid");
    api
      .post<{ accessToken: string }>("/auth/verify", { token })
      .then((res) => {
        setToken(res.accessToken);
        localStorage.setItem("essentials_token", res.accessToken);
        setStatus("ok");
        setTimeout(() => router.replace("/dashboard"), 800);
      })
      .catch(() => setStatus("expired"));
  }, [params, router]);

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="text-center">
        <h1 className="text-neon text-2xl font-black tracking-widest">ESSENTIALS</h1>
        <p className="text-neutral-400 mt-4">
          {status === "verifying" && "VERIFYING…"}
          {status === "ok" && "SIGNED IN — ENTERING THE DASHBOARD →"}
          {status === "expired" && (
            <>
              Link expired or invalid.{" "}
              <a href="/dashboard" className="text-neon underline">
                Request a new one
              </a>
              .
            </>
          )}
          {status === "invalid" && (
            <>
              Missing token.{" "}
              <a href="/dashboard" className="text-neon underline">
                Back to sign in
              </a>
              .
            </>
          )}
        </p>
      </div>
    </main>
  );
}
