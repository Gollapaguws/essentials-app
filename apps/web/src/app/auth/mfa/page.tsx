"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { session } from "@/lib/session";
import { useAuth } from "@/components/AuthProvider";
import { InfoTip } from "@/components/Tooltip";

/**
 * Privileged roles must reach aal2 before any data endpoint answers.
 * Existing factors are challenged; otherwise a new TOTP factor is enrolled.
 * A single-use recovery code can stand in for the authenticator when it is lost.
 * Both happen through the API, so the session tokens stay on the server.
 */
export default function MfaPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      // Read the identity through the provider as well: its cached copy is what
      // the dashboard layout checks, so it must not stay behind this page's
      // successful verification.
      const me = await refresh();
      if (!me) {
        router.replace("/login");
        return;
      }
      // A session that already reached aal2 has nothing to do here (this is
      // what escapes a stale redirect loop).
      if (!me.mfaRequired) {
        router.replace("/");
        return;
      }

      try {
        const [{ totp }, status] = await Promise.all([session.factors(), session.recoveryStatus()]);
        setRemaining(status.remaining);
        const existing = totp[0];

        if (existing) {
          const challenge = await session.challenge(existing.id);
          setFactorId(existing.id);
          setChallengeId(challenge.id);
          setBusy(false);
          return;
        }

        const enrolled = await session.enroll();
        setFactorId(enrolled.id);
        setSecret(enrolled.secret);
        setQr(await QRCode.toDataURL(enrolled.uri, { margin: 1, width: 240 }));

        const challenge = await session.challenge(enrolled.id);
        setChallengeId(challenge.id);
        setBusy(false);
      } catch (e) {
        setError((e as Error).message);
        setBusy(false);
      }
    })();
  }, [refresh, router]);

  const done = async () => {
    const me = await refresh();
    if (me && !me.mfaRequired) {
      router.replace("/");
      return true;
    }
    return false;
  };

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId || !challengeId) return;
    setBusy(true);
    setError(null);
    try {
      // One challenge was issued on load; verifying it activates a fresh factor too.
      await session.verify(factorId, challengeId, code.trim());
      if (await done()) return;
      setBusy(false);
      setError("Two-step verification is not active yet. Try again.");
    } catch {
      setBusy(false);
      setError("That code did not work. Check your authenticator and try again.");
    }
  };

  const useRecovery = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await session.consumeRecovery(recovery.trim());
      if (await done()) return;
      setBusy(false);
      setError("Two-step verification is not active yet. Try again.");
    } catch {
      setBusy(false);
      setError("That recovery code is not valid, or it has already been used.");
    }
  };

  return (
    <main className="min-h-screen grid place-items-center px-6 py-10">
      <div className="w-full max-w-md border border-line bg-surface rounded-2xl p-8 space-y-4">
        <h1 className="text-neon text-2xl font-black tracking-widest">TWO-STEP VERIFICATION</h1>
        <p className="text-muted text-sm">
          Privileged accounts need an authenticator app before reaching the dashboard.
        </p>

        {qr && (
          <div className="space-y-2">
            {/* data: URL from the qrcode package — next/image cannot optimise it */}
            <img src={qr} alt="TOTP QR code" className="mx-auto rounded-lg bg-surface p-2" />
            <div className="flex items-center gap-2 text-muted text-xs break-all">
              <span>
                Manual key: <span className="font-mono text-fg">{secret}</span>
              </span>
              <InfoTip label="Use this if the camera cannot scan the QR code: type the key into your authenticator app by hand." />
            </div>
          </div>
        )}

        {!showRecovery ? (
          <form className="space-y-3" onSubmit={verify}>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted">
              <label htmlFor="totp">Authenticator code</label>
              <InfoTip label="The 6 digits your authenticator app (Google Authenticator, 1Password, Authy) shows for SONUS. It changes every 30 seconds." />
            </div>
            <input
              id="totp"
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
        ) : (
          <form className="space-y-3" onSubmit={useRecovery}>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted">
              <label htmlFor="recovery">Recovery code</label>
              <InfoTip label="A single-use backup code you saved when you set up two-step verification. Each code works once." />
            </div>
            <input
              id="recovery"
              className="w-full bg-bg border border-line rounded-lg px-4 py-3 outline-none focus:border-neon font-mono tracking-widest text-center"
              placeholder="ABCDE-FGHIJ"
              required
              value={recovery}
              onChange={(e) => setRecovery(e.target.value.toUpperCase())}
            />
            <button
              disabled={busy || recovery.trim().length < 8}
              className="w-full bg-neon text-bg font-black tracking-widest rounded-lg py-3 disabled:opacity-50"
            >
              {busy ? "CHECKING…" : "USE RECOVERY CODE"}
            </button>
          </form>
        )}

        <button
          type="button"
          onClick={() => { setShowRecovery((v) => !v); setError(null); }}
          className="w-full text-[11px] uppercase tracking-widest text-muted hover:text-fg"
        >
          {showRecovery ? "Use authenticator code instead" : "Lost your authenticator? Use a recovery code"}
        </button>

        <div className="border-t border-line pt-4 space-y-2">
          <p className="text-[11px] uppercase tracking-widest text-muted">
            Recovery codes {remaining !== null ? `· ${remaining} left` : ""}
          </p>
          <p className="text-muted text-xs">
            Each code works once if you lose your authenticator. Generate or replace them from{" "}
            <Link href="/account" className="text-neon hover:underline">
              Account
            </Link>{" "}
            after two-step is active.
          </p>
        </div>

        {error && <p className="text-alert text-sm">{error}</p>}
      </div>
    </main>
  );
}
