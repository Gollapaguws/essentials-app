"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { session } from "@/lib/session";
import { InfoTip } from "@/components/Tooltip";

/**
 * Privileged roles must reach aal2 before any data endpoint answers.
 * Existing factors are challenged; otherwise a new TOTP factor is enrolled.
 * A single-use recovery code can stand in for the authenticator when it is lost.
 * Both happen through the API, so the session tokens stay on the server.
 */
export default function MfaPage() {
  const router = useRouter();
  const [qr, setQr] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [factorId, setFactorId] = useState<string | null>(null);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [generated, setGenerated] = useState<string[] | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        await session.me();
      } catch {
        router.replace("/login");
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
  }, [router]);

  const done = async () => {
    const me = await session.me();
    if (!me.mfaRequired) {
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

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await session.generateRecovery();
      setGenerated(res.codes);
      setRemaining(res.codes.length);
      setBusy(false);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  };

  return (
    <main className="min-h-screen grid place-items-center px-6 py-10">
      <div className="w-full max-w-md border border-line bg-surface rounded-2xl p-8 space-y-4">
        <h1 className="text-neon text-2xl font-black tracking-widest">TWO-STEP VERIFICATION</h1>
        <p className="text-neutral-400 text-sm">
          Privileged accounts need an authenticator app before reaching the dashboard.
        </p>

        {qr && (
          <div className="space-y-2">
            {/* data: URL from the qrcode package — next/image cannot optimise it */}
            <img src={qr} alt="TOTP QR code" className="mx-auto rounded-lg bg-white p-2" />
            <div className="flex items-center gap-2 text-neutral-500 text-xs break-all">
              <span>
                Manual key: <span className="font-mono text-neutral-300">{secret}</span>
              </span>
              <InfoTip label="Use this if the camera cannot scan the QR code: type the key into your authenticator app by hand." />
            </div>
          </div>
        )}

        {!showRecovery ? (
          <form className="space-y-3" onSubmit={verify}>
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-neutral-500">
              <label htmlFor="totp">Authenticator code</label>
              <InfoTip label="The 6 digits your authenticator app (Google Authenticator, 1Password, Authy) shows for ESSENTIALS. It changes every 30 seconds." />
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
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-neutral-500">
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
          className="w-full text-[11px] uppercase tracking-widest text-neutral-500 hover:text-neutral-300"
        >
          {showRecovery ? "Use authenticator code instead" : "Lost your authenticator? Use a recovery code"}
        </button>

        <div className="border-t border-line pt-4 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-[11px] uppercase tracking-widest text-neutral-500">
              Recovery codes {remaining !== null ? `· ${remaining} left` : ""}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={generate}
              className="text-[11px] uppercase tracking-widest text-neon disabled:opacity-50"
            >
              {generated || remaining ? "Replace codes" : "Generate codes"}
            </button>
          </div>
          <p className="text-neutral-500 text-xs">
            Save these somewhere safe. Each works once if you lose your authenticator; generating a new set retires the old one.
          </p>
          {generated && (
            <div className="bg-bg border border-line rounded-lg p-3">
              <p className="text-amber-300 text-xs mb-2">Copy these now — they will not be shown again.</p>
              <div className="grid grid-cols-2 gap-1 font-mono text-sm text-neutral-200">
                {generated.map((c) => <span key={c}>{c}</span>)}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}
      </div>
    </main>
  );
}
