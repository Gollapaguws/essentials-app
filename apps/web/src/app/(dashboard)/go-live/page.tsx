"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { TopNav } from "@/components/TopNav";
import { useAuth } from "@/components/AuthProvider";
import { API_URL } from "@essentials/api-client";
import { errorMessage } from "@/lib/errors";
import { useResource } from "@/hooks/useResource";

interface LiveStatus {
  live: boolean;
  simulcast: Record<string, boolean>;
}

interface ActiveBooking {
  id: string;
  title: string | null;
  startsAt: string;
  endsAt: string;
}

interface ActiveBookingResponse {
  required: boolean;
  booking: ActiveBooking | null;
}

type Phase = "idle" | "preview" | "connecting" | "live";

/** The ingest WebSocket sits on the API origin, outside the `/api` prefix. */
const WS_URL = (() => {
  try {
    const url = new URL(API_URL);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    url.pathname = "/live/ingest";
    url.search = "";
    return url.toString();
  } catch {
    return "wss://sonus.essentialsedm.com/live/ingest";
  }
})();

/** VP8 + Opus is the container ffmpeg ingests most reliably on a live pipe. */
function pickMimeType(): string {
  const candidates = [
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9,opus",
    "video/webm",
  ];
  for (const candidate of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return "";
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Input level for the preview and the broadcast, read from the mic track being sent. */
function AudioMeter({
  stream,
  live,
  onLevel,
}: {
  stream: MediaStream | null;
  live: boolean;
  onLevel?: (db: number) => void;
}) {
  const [level, setLevel] = useState(0);
  const [db, setDb] = useState(-Infinity);

  useEffect(() => {
    if (!stream || stream.getAudioTracks().length === 0) {
      setLevel(0);
      setDb(-Infinity);
      return;
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let frame = 0;
    let last = 0;
    const tick = (now: number) => {
      frame = requestAnimationFrame(tick);
      // 20 updates a second is smooth enough and keeps the page cheap.
      if (now - last < 50) return;
      last = now;
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      const rms = Math.sqrt(sum / samples.length);
      const decibels = 20 * Math.log10(Math.max(rms, 1e-6));
      // -60 dB counts as silence; 0 dB is full scale.
      setLevel(Math.max(0, Math.min(1, (decibels + 60) / 60)));
      setDb(decibels);
      onLevel?.(decibels);
    };
    frame = requestAnimationFrame(tick);
    // Autoplay rules can leave a fresh context suspended until this call.
    void ctx.resume().catch(() => undefined);
    return () => {
      cancelAnimationFrame(frame);
      source.disconnect();
      void ctx.close().catch(() => undefined);
    };
  }, [stream, onLevel]);

  const bars = 28;
  const clipping = db > -1;

  return (
    <div className="flex items-center gap-3">
      <span className="text-[10px] tracking-widest text-neutral-500 shrink-0">
        {live ? "AUDIO · LIVE" : "AUDIO"}
      </span>
      <div
        className="flex-1 flex items-center gap-[2px] h-3"
        role="meter"
        aria-label="Microphone level"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(level * 100)}
      >
        {Array.from({ length: bars }, (_, i) => {
          const position = (i + 0.5) / bars;
          // Green through yellow, red at the top so clipping is obvious.
          const colour = position > 0.92 ? "bg-red-500" : position > 0.75 ? "bg-yellow-400" : "bg-neon";
          return (
            <span
              key={i}
              className={`flex-1 rounded-sm ${level >= position ? colour : "bg-neutral-800 h-1/3"}`}
            />
          );
        })}
      </div>
      <span
        className={`font-mono text-[11px] w-16 text-right ${clipping ? "text-red-400" : "text-neutral-500"}`}
      >
        {!stream ? "NO AUDIO" : clipping ? "CLIP" : db > -60 ? `${Math.round(db)} dB` : "—"}
      </span>
    </div>
  );
}

function clock(total: number): string {
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * DJ studio: camera or screen plus the mixer's input device, straight from the
 * browser. MediaRecorder → WebSocket → the same RTSP/HLS pipeline the public
 * broadcast plays, so no OBS or restream key is needed.
 */
export default function GoLive() {
  const { me } = useAuth();
  const role = me?.user.role ?? "guest";
  const allowed = role === "artist" || role === "admin";

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const previewRef = useRef<MediaStream | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const recRef = useRef<MediaRecorder | null>(null);
  const startedRef = useRef(0);

  const [phase, setPhase] = useState<Phase>("idle");
  const [source, setSource] = useState<"camera" | "screen">("camera");
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState("");
  const [micId, setMicId] = useState("");
  const [audioReady, setAudioReady] = useState(false);
  const [meterStream, setMeterStream] = useState<MediaStream | null>(null);
  // Polled: one broadcast runs at a time, so this page shows whether somebody
  // else owns it, and whether the DJ's booking window is open right now.
  const statusSource = useResource<LiveStatus>("/live/status");
  const status = statusSource.data;
  const gateSource = useResource<ActiveBookingResponse>(me ? "/live/bookings/active" : null);
  const gate =
    gateSource.data ??
    (gateSource.error ? { required: role !== "admin", booking: null } : null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [signalSeen, setSignalSeen] = useState(false);
  const signalSeenRef = useRef(false);

  // The meter updates 20 times a second; only a state change when sound first
  // appears is worth re-rendering the checklist.
  const noteLevel = useCallback((db: number) => {
    if (db > -45 && !signalSeenRef.current) {
      signalSeenRef.current = true;
      setSignalSeen(true);
    }
  }, []);

  // A booking can start while this page is open, and another browser can take the
  // broadcast; both are re-read on a timer rather than fetched once.
  const pollGate = gateSource.reload;
  useEffect(() => {
    const id = setInterval(pollGate, 30_000);
    return () => clearInterval(id);
  }, [pollGate]);

  const pollStatus = statusSource.reload;
  useEffect(() => {
    const id = setInterval(pollStatus, 5000);
    return () => clearInterval(id);
  }, [pollStatus]);

  useEffect(() => {
    if (phase !== "live") return;
    const id = setInterval(
      () => setElapsed(Math.floor((Date.now() - startedRef.current) / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, [phase]);

  // Closing the page must not leave the camera or the encoder running.
  useEffect(
    () => () => {
      try {
        if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
      } catch {
        // Recorder already stopped.
      }
      try {
        wsRef.current?.close();
      } catch {
        // Socket already gone.
      }
      previewRef.current?.getTracks().forEach((track) => track.stop());
      micRef.current?.getTracks().forEach((track) => track.stop());
    },
    [],
  );

  function stopStream(ref: { current: MediaStream | null }) {
    ref.current?.getTracks().forEach((track) => track.stop());
    ref.current = null;
  }

  /** Drop the microphone, its meter and the audio flag together. */
  function stopMic() {
    stopStream(micRef);
    setMeterStream(null);
    setAudioReady(false);
  }

  function resetSignal() {
    signalSeenRef.current = false;
    setSignalSeen(false);
  }

  function showPreview(stream: MediaStream | null) {
    const el = videoRef.current;
    if (!el) return;
    el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }

  function teardown() {
    try {
      if (recRef.current && recRef.current.state !== "inactive") recRef.current.stop();
    } catch {
      // Recorder already stopped.
    }
    recRef.current = null;
    const ws = wsRef.current;
    wsRef.current = null;
    try {
      if (ws && ws.readyState <= WebSocket.OPEN) ws.close();
    } catch {
      // Socket already gone.
    }
    stopStream(previewRef);
    stopMic();
    resetSignal();
    showPreview(null);
    setElapsed(0);
    setPhase("idle");
  }

  async function startMic(deviceId: string) {
    stopStream(micRef);
    setMeterStream(null);
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          // A mixer is already a clean line-in; browser processing would pump and duck it.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      micRef.current = mic;
      setAudioReady(mic.getAudioTracks().length > 0);
      setMeterStream(mic);
      const settings = mic.getAudioTracks()[0]?.getSettings();
      if (!deviceId && settings?.deviceId) setMicId(settings.deviceId);
    } catch {
      // A silent broadcast is still useful for a visual set; say so instead of failing.
      setAudioReady(false);
      setNotice(
        "No microphone — the broadcast will be video only. Allow microphone access, then preview again.",
      );
    }
  }

  async function refreshDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setCameras(devices.filter((device) => device.kind === "videoinput"));
      setMics(devices.filter((device) => device.kind === "audioinput"));
    } catch {
      // Labels stay blank until the browser has been granted access.
    }
  }

  async function startPreview() {
    if (!allowed) return;
    setError(null);
    setNotice(null);
    resetSignal();
    if (!navigator.mediaDevices) {
      setError("This browser cannot capture audio and video. Use Chrome or Edge.");
      return;
    }
    try {
      let video: MediaStream;
      if (source === "screen") {
        if (!navigator.mediaDevices.getDisplayMedia) {
          throw new Error("Screen sharing is not available in this browser. Use Chrome or Edge.");
        }
        video = await navigator.mediaDevices.getDisplayMedia({
          // Capture at 720p: a full 1080p screen share costs the server a core
          // it does not have and showed up as dropouts on the front page.
          video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { ideal: 30, max: 30 } },
          audio: false,
        });
        if (!video.getVideoTracks().length) {
          throw new Error("No screen was shared. Pick a screen or window.");
        }
        // "Stop sharing" in the browser bar ends the broadcast too.
        video.getVideoTracks()[0]?.addEventListener("ended", () => teardown());
      } else {
        video = await navigator.mediaDevices.getUserMedia({
          video: {
            ...(cameraId ? { deviceId: { exact: cameraId } } : {}),
            width: { ideal: 1280, max: 1280 },
            height: { ideal: 720, max: 720 },
            frameRate: { ideal: 30, max: 30 },
          },
          audio: false,
        });
      }
      stopStream(previewRef);
      previewRef.current = video;
      showPreview(video);
      await startMic(micId);
      setPhase("preview");
      void refreshDevices();
    } catch (e) {
      teardown();
      setError(errorMessage(e));
    }
  }

  async function goLive() {
    if (role === "artist" && !gate?.booking) {
      setError("Book a live session first — Go Live unlocks inside your booking window.");
      return;
    }
    if (!previewRef.current) {
      setError("Start the preview first.");
      return;
    }
    setError(null);
    setNotice(null);
    setPhase("connecting");

    const stream = new MediaStream([
      ...previewRef.current.getVideoTracks(),
      ...(micRef.current?.getAudioTracks() ?? []),
    ]);
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("The streaming server did not answer. Try again.")),
          10_000,
        );
        ws.onopen = () => {
          clearTimeout(timeout);
          resolve();
        };
        ws.onerror = () => {
          clearTimeout(timeout);
          reject(new Error("Could not reach the streaming server."));
        };
        ws.onclose = (event) => {
          clearTimeout(timeout);
          reject(new Error(event.reason || "The streaming server refused the connection."));
        };
      });

      const mime = pickMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mime ? { mimeType: mime } : {}),
        videoBitsPerSecond: 800_000,
        audioBitsPerSecond: 96_000,
      });
      recorder.ondataavailable = (event) => {
        if (event.data.size && ws.readyState === WebSocket.OPEN) ws.send(event.data);
      };
      recorder.start(500); // a cluster every half second keeps latency low
      recRef.current = recorder;
      startedRef.current = Date.now();
      setElapsed(0);
      setPhase("live");

      ws.onclose = (event) => {
        if (!wsRef.current) return; // this page ended it
        wsRef.current = null;
        recRef.current = null;
        try {
          recorder.stop();
        } catch {
          // Recorder already stopped.
        }
        stopStream(previewRef);
        stopMic();
        showPreview(null);
        setPhase("idle");
        setError(event.reason || "The broadcast ended. Preview again to go back live.");
      };
    } catch (e) {
      try {
        ws.close();
      } catch {
        // Socket already gone.
      }
      // A stop pressed while connecting already reset the page; don't reopen preview.
      if (wsRef.current === ws) {
        wsRef.current = null;
        setPhase("preview");
        setError(errorMessage(e));
      }
    }
  }

  if (!me) {
    return (
      <>
        <TopNav />
        <main className="max-w-4xl mx-auto px-6 py-8">
          <p className="text-neutral-500 text-sm tracking-widest">LOADING…</p>
        </main>
      </>
    );
  }

  if (!allowed) {
    return (
      <>
        <TopNav />
        <main className="max-w-4xl mx-auto px-6 py-8 space-y-4">
          <h1 className="text-2xl font-black tracking-wide">GO LIVE</h1>
          <p className="border border-line bg-surface rounded-xl p-4 text-neutral-400 text-sm">
            Broadcasting is for DJ accounts. An admin can set your role on the Users page.
          </p>
        </main>
      </>
    );
  }

  const busy = phase === "connecting";
  const live = phase === "live";
  const blocked = role === "artist" && !gate?.booking;
  const restreamCount = Object.values(status?.simulcast ?? {}).filter(Boolean).length;
  const input = "w-full bg-bg border border-line rounded-lg px-3 py-2 text-sm disabled:opacity-50";

  // Pre-flight is advisory, not a second gate: a visual set with no microphone
  // is allowed, and only the booking and channel checks can refuse GO LIVE.
  const videoReady = phase !== "idle";
  const channelFree = status === null ? null : !status.live;
  const checks: { label: string; state: "ok" | "warn" | "fail" | "wait"; detail: string }[] = [
    {
      label: "Camera / screen",
      state: videoReady ? "ok" : "wait",
      detail: videoReady
        ? source === "screen"
          ? "Screen shared"
          : "Camera connected"
        : "Start preview",
    },
    {
      label: "Microphone",
      state: audioReady ? "ok" : videoReady ? "warn" : "wait",
      detail: audioReady
        ? "Mixer input connected"
        : videoReady
          ? "No input — broadcast will be video only"
          : "Start preview",
    },
    {
      label: "Audio level",
      state: !audioReady ? "wait" : signalSeen ? "ok" : "warn",
      detail: !audioReady
        ? "Waiting for a microphone"
        : signalSeen
          ? "Signal detected"
          : "Play a track and watch the meter",
    },
    {
      label: "Live session",
      state: role === "admin" ? "ok" : gate === null ? "wait" : gate.booking ? "ok" : "fail",
      detail:
        role === "admin"
          ? "Admin — no booking needed"
          : gate === null
            ? "Checking your sessions…"
            : gate.booking
              ? `Booked until ${timeLabel(gate.booking.endsAt)}`
              : "Book a live session on the calendar",
    },
    {
      label: "Broadcast channel",
      state: channelFree === null ? "wait" : channelFree ? "ok" : "fail",
      detail:
        channelFree === null
          ? "Checking…"
          : channelFree
            ? "Ready to go live"
            : "Another broadcast is live",
    },
  ];
  const readyCount = checks.filter((check) => check.state === "ok").length;
  const dot = {
    ok: "bg-neon",
    warn: "bg-yellow-400",
    fail: "bg-red-500",
    wait: "bg-neutral-700",
  } as const;

  return (
    <>
      <TopNav />
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-black tracking-wide">GO LIVE</h1>
          <p className="text-neutral-500 text-xs mt-1">
            Broadcast from this browser — no OBS, no stream key. Use your camera or share your
            screen, and pick the input your mixer is plugged into.
          </p>
        </div>

        {error && <p className="text-red-400 text-sm">{error}</p>}
        {notice && <p className="text-yellow-400 text-sm">{notice}</p>}

        {role === "artist" &&
          (gate?.booking ? (
            <div className="border border-neon/40 bg-neon/5 rounded-xl p-4 text-sm">
              <span className="text-neon font-bold text-xs tracking-widest">BOOKED SESSION</span>
              <p className="text-neutral-300 mt-1">
                {gate.booking.title || "Live session"} · {timeLabel(gate.booking.startsAt)}–
                {timeLabel(gate.booking.endsAt)}
              </p>
            </div>
          ) : (
            <p className="border border-yellow-500/40 bg-yellow-500/5 rounded-xl p-4 text-sm text-neutral-300">
              {gate ? "No live session is booked right now." : "Checking your booked sessions…"}{" "}
              {gate && (
                <>
                  <Link href="/bookings" className="text-neon hover:underline">
                    Book one on the Live Calendar
                  </Link>{" "}
                  to unlock Go Live.
                </>
              )}
            </p>
          ))}
        {role === "admin" && (
          <p className="text-neutral-600 text-xs">
            Admin account — no live-session booking is required to broadcast.
          </p>
        )}

        {live && (
          <div className="border border-neon/40 bg-neon/5 rounded-xl p-4 flex flex-wrap items-center gap-3">
            <span className="text-neon font-black tracking-widest">● LIVE</span>
            <span className="font-mono text-sm">{clock(elapsed)}</span>
            <span className="text-neutral-400 text-xs">
              {audioReady ? "video + audio" : "video only"}
              {restreamCount > 0 ? ` · restreaming to ${restreamCount} platform(s)` : ""}
            </span>
          </div>
        )}

        {!live && status?.live && (
          <p className="border border-line bg-surface rounded-xl p-4 text-neutral-400 text-sm">
            A broadcast is already live. Only one can run at a time — going live will be refused
            until it ends.
          </p>
        )}

        {!live && (
          <section
            aria-label="Pre-flight checks"
            className={`border rounded-xl p-4 ${
              readyCount === checks.length ? "border-neon/40 bg-neon/5" : "border-line bg-surface"
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-black tracking-widest text-neutral-300">PRE-FLIGHT</span>
              <span
                className={`text-xs font-mono ${
                  readyCount === checks.length ? "text-neon" : "text-neutral-500"
                }`}
              >
                {readyCount}/{checks.length} READY
              </span>
            </div>
            <ul className="mt-3 grid sm:grid-cols-2 gap-x-6 gap-y-2">
              {checks.map((check) => (
                <li key={check.label} className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 size-2 rounded-full shrink-0 ${dot[check.state]}`}
                    aria-hidden
                  />
                  <div className="min-w-0">
                    <span className="text-neutral-300 text-xs font-bold">{check.label}</span>
                    <span className="block text-neutral-600 text-[11px] leading-snug">
                      {check.detail}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
            {phase === "preview" && !signalSeen && (
              <p className="mt-3 text-[11px] text-yellow-400/90">
                Audio level has not moved yet — play a track, or check the selected input before
                going live.
              </p>
            )}
          </section>
        )}

        <section className="border border-line bg-surface rounded-xl p-4 space-y-4">
          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <span className="text-xs text-neutral-400 uppercase tracking-wider">Video source</span>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  disabled={phase !== "idle" && phase !== "preview"}
                  onClick={() => {
                    if (source === "camera") return;
                    teardown();
                    setSource("camera");
                  }}
                  className={`flex-1 rounded-lg py-2 text-xs font-black tracking-widest border ${
                    source === "camera" ? "border-neon text-neon" : "border-line text-neutral-400"
                  } disabled:opacity-40`}
                >
                  CAMERA
                </button>
                <button
                  type="button"
                  disabled={phase !== "idle" && phase !== "preview"}
                  onClick={() => {
                    if (source === "screen") return;
                    teardown();
                    setSource("screen");
                  }}
                  className={`flex-1 rounded-lg py-2 text-xs font-black tracking-widest border ${
                    source === "screen" ? "border-neon text-neon" : "border-line text-neutral-400"
                  } disabled:opacity-40`}
                >
                  SCREEN
                </button>
              </div>
            </div>

            <div>
              <span className="text-xs text-neutral-400 uppercase tracking-wider">Camera</span>
              <select
                className={`${input} mt-2`}
                value={cameraId}
                disabled={source === "screen" || phase === "live" || phase === "connecting"}
                onChange={(e) => setCameraId(e.target.value)}
              >
                <option value="">Default camera</option>
                {cameras.map((camera, index) => (
                  <option key={camera.deviceId || index} value={camera.deviceId}>
                    {camera.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="md:col-span-2">
              <span className="text-xs text-neutral-400 uppercase tracking-wider">
                Microphone / mixer input
              </span>
              <select
                className={`${input} mt-2`}
                value={micId}
                disabled={phase === "live" || phase === "connecting"}
                onChange={(e) => {
                  setMicId(e.target.value);
                  if (phase === "preview") void startMic(e.target.value);
                }}
              >
                <option value="">Default input</option>
                {mics.map((mic, index) => (
                  <option key={mic.deviceId || index} value={mic.deviceId}>
                    {mic.label || `Input ${index + 1}`}
                  </option>
                ))}
              </select>
              <p className="text-neutral-500 text-[11px] mt-1">
                Browsers list devices only after you allow access, so press Preview once if the list
                is empty.
              </p>
            </div>
          </div>

          <div className="relative rounded-xl overflow-hidden border border-line bg-black aspect-video">
            <video
              ref={videoRef}
              muted
              playsInline
              className="w-full h-full object-contain"
            />
            {phase === "idle" && (
              <p className="absolute inset-0 grid place-items-center text-neutral-600 text-xs tracking-widest">
                NO PREVIEW YET
              </p>
            )}
          </div>

          {(phase === "preview" || phase === "connecting" || live) && (
            <AudioMeter stream={meterStream} live={live} onLevel={noteLevel} />
          )}

          <div className="flex flex-wrap gap-3">
            {(phase === "idle" || phase === "preview") && (
              <button
                type="button"
                onClick={() => void startPreview()}
                className="border border-line text-neutral-300 rounded-lg px-4 py-2 text-xs font-black tracking-widest"
              >
                {phase === "preview" ? "PREVIEW AGAIN" : "START PREVIEW"}
              </button>
            )}
            {phase === "preview" && (
              <button
                type="button"
                disabled={blocked || status?.live === true}
                onClick={() => void goLive()}
                title={
                  blocked
                    ? "Book a live session on the Live Calendar first"
                    : status?.live
                      ? "Another broadcast is already live"
                      : "Start broadcasting"
                }
                className="bg-neon text-bg font-black rounded-lg px-5 py-2 text-xs tracking-widest disabled:opacity-40"
              >
                GO LIVE
              </button>
            )}
            {busy && <span className="text-neutral-500 text-xs tracking-widest self-center">CONNECTING…</span>}
            {(phase === "preview" || phase === "connecting" || live) && (
              <button
                type="button"
                onClick={teardown}
                className="border border-red-500/50 text-red-400 rounded-lg px-4 py-2 text-xs font-black tracking-widest ml-auto"
              >
                {live ? "END BROADCAST" : "STOP PREVIEW"}
              </button>
            )}
          </div>
        </section>

        <section className="text-neutral-500 text-xs space-y-2">
          <p>
            The stream is pushed to every enabled platform on the admin{" "}
            <Link href="/simulcast" className="text-neon hover:underline">
              Streaming
            </Link>{" "}
            page, and plays on the public front page. Keep this tab open — closing it ends the
            broadcast.
          </p>
          <p>
            Use Chrome or Edge on a laptop or desktop. Your camera and microphone stay in the
            browser; only the encoded stream is sent to the server.
          </p>
          <p>
            {status?.live
              ? "A broadcast is live right now."
              : "No broadcast is live right now."}{" "}
            DJs must book the stream window on the Live Calendar; a venue gig is not part of
            that.
          </p>
        </section>
      </main>
    </>
  );
}
