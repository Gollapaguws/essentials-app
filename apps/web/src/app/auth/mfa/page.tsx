"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { api } from "@essentials/api-client";
import type { MeResponse } from "@essentials/auth";
import { supabase } from "@/lib/supabase";

/**
 * Privileged roles must reach aal2 before any data endpoint answers.
 * Existing factors are challenged; otherwise a new TOTP factor is enrolled.
 */
export default function MfaPage() {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: session } = await supabase.auth.getSession();
      if (!session.session) return router.replace("/");

      const { data: factors } = await supabase.auth.mfa.listFactors();
      const existing = factors?.totp?.[0];

      if (existing) {
        const { data: challenge, error: challengeError } = await supabase.auth.mfa.challenge({
          factorId: existing.id,
        });
        if (challengeError) {
          setError(challengeError.message);
          setBusy(false);
          return;
        }
        setFactorId(existing.id);
        setChallengeId(challenge.id);
        setBusy(false);
        return;
      }

      const { data: enrolled, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
      });
      if (enrollError) {
        setError(enrollError.message);
        setBusy(false);
        return;
      }
      setFactorId(enrolled.id);
      setSecret(enrolled.totp.secret);
      setQr(await QRCode.toDataURL(enrolled.totp.uri, { margin: 1, width: 240 }));

      const { data: challenge } = await supabase.auth.mfa.challenge({ factorId: enrolled.id });
      setChallengeId(challenge?.id ?? null);
      setBusy(false);
    })();
  }, [router]);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || !challengeId) return;
    setBusy(true);
    setError(null);

    // One challenge was issued on load; verifying it activates a fresh factor too.
    const { error: verifyError } = await supabase.auth.mfa.verify({
      factorId,
      challengeId,
      code: code.trim(),
    });
    if (verifyError) {
      setBusy(false);
      setError("That code did not work. Check your authenticator and try again.");
      return;
    }

    await supabase.auth.refreshSession();
    try {
      const me = await api.get<MeResponse>("/auth/me");
      if (!("inviteRequired" in me) && !me.mfaRequired) {
        router.replace("/dashboard");
        return;
      }
    } catch {
      // fall through to the error state
    }
    setBusy(false);
    setError("Two-step verification is not active yet. Try again.");
  };

  return (
    <main className="min-h-screen grid place-items-center px-6">
      <div className="w-full max-w-md border border-line bg-surface rounded-2xl p-8 space-y-4">
        <h1 className="text-neon text-2xl font-black tracking-widest">TWO-STEP VERIFICATION</h1>
        <p className="text-neutral-400 text-sm">
          Privileged accounts need an authenticator app before reaching the dashboard.
        </p>

        {qr && (
          <div className="space-y-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qr} alt="TOTP QR code" className="mx-auto rounded-lg bg-white p-2" />
            <p className="text-neutral-500 text-xs break-all">
              Manual key: <span className="font-mono text-neutral-300">{secret}</span>
            </p>
          </div>
        )}

        <form className="space-y-3" onSubmit={verify}>
          <input
            className="w-full bg-bg border border-line rounded-lg px-4 py-3 outline-none focus:border-neon font-mono tracking-widest text-center"
            placeholder="123456"
            inputMode="numeric"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
          />
          <button
            disabled={busy || code.length !== 6}
            className="w-full bg-neon text-bg font-black tracking-widest rounded-lg py-3 disabled:opacity-50"
          >
            {busy ? "CHECKING…" : "VERIFY"}
          </button>
        </form>

        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
    </main>
  );
}
