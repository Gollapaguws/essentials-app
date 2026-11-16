import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { fetchMe } from "@/lib/auth";
import { liveStatus, liveSchedule, setLiveSource, stopLiveSource, startScreenIngest, viewerUrl } from "@/live/live";

/**
 * LIVE section on the front page:
 * - restream: any RTSP/HTTP/HLS source set by an admin is played here (hls.js)
 * - GO LIVE: admin captures screen+audio → server FFmpeg → rtsp://essentialsedm.com:8554/essentials
 */
const scheduleWhen = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
};

export default function LivePanel({ idleLoop = "" }) {
  const [status, setStatus] = useState({ live: false, sourceUp: false, studioLive: false, hls: null, rtspUrl: "" });
  const [schedule, setSchedule] = useState(null);
  const [me, setMe] = useState(null);
  const [casting, setCasting] = useState(false);
  const [unmuted, setUnmuted] = useState(false);
  const [error, setError] = useState(null);
  const [srcUrl, setSrcUrl] = useState("");
  const [idleMissing, setIdleMissing] = useState(false);
  const videoRef = useRef(null);
  const hlsRef = useRef(null);
  const ingestRef = useRef(null);

  useEffect(() => {
    fetchMe().then(setMe);
    const tick = () => {
      liveStatus().then(setStatus).catch(() => {});
      liveSchedule().then(setSchedule).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  const studioLive = !!status.studioLive;
  const hlsUrl = studioLive ? "https://essentialsedm.com/hls/live.m3u8" : status.hls;
  const showIdleLoop = !!idleLoop && !idleMissing;

  // A newly uploaded reel must get a fresh chance to load.
  useEffect(() => setIdleMissing(false), [idleLoop]);

  // player: attach hls.js when a restream is active
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    // Prefer hls.js wherever MSE exists. Some Chromium builds answer "maybe"
    // to canPlayType() but their native demuxer cannot parse MediaMTX's fMP4
    // playlist (it 404s on the EXT-X-GAP filler), which left a black screen.
    if (Hls.isSupported()) {
      const hls = new Hls({
        // Normal mode buffers whole segments instead of chasing 200ms parts:
        // a few seconds behind live, but a short encoder or network hiccup is
        // absorbed by the buffer instead of freezing the feed.
        lowLatencyMode: false,
        liveDurationInfinity: true,
        // MediaMTX keeps a ~7 segment window, so staying 3 segments behind
        // leaves headroom on both sides instead of hugging the evicted edge.
        liveSyncDurationCount: 3,
        liveMaxLatencyDurationCount: 6,
        maxBufferLength: 40,
        backBufferLength: 30,
        // 1x: never chase the live edge by speeding playback up, which is what
        // makes the picture visibly stutter and jump.
        maxLiveSyncPlaybackRate: 1,
      });
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return;
        // A live playlist can hiccup as the publisher starts; retry rather than
        // freezing on the first network or media error.
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
        else hls.startLoad();
      });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
    }
    video.play().catch(() => {});
    return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } };
  }, [hlsUrl]);

  const goLive = async () => {
    setError(null);
    try {
      const handle = await startScreenIngest();
      ingestRef.current = handle;
      setCasting(true);
      setTimeout(() => liveStatus().then(setStatus).catch(() => {}), 3000);
    } catch (e) {
      setError(e.message ?? "Capture failed (use Chrome/Edge on desktop)");
    }
  };

  const stopCasting = () => {
    ingestRef.current?.stop();
    ingestRef.current = null;
    setCasting(false);
  };

  const sourceSet = async (e) => {
    e.preventDefault();
    setError(null);
    try { await setLiveSource(srcUrl.trim()); liveStatus().then(setStatus).catch(() => {}); }
    catch (err) { setError(err.message ?? "Failed to start source"); }
  };

  const isAdmin = me?.role === "admin";
  const showPlayer = !!hlsUrl;

  return (
    <section id="live" className="noir-sec" style={{ borderTop: "1px solid rgba(255,255,255,.08)" }}>
      <div className="noir-sec-head">
        <span className="noir-micro">{casting ? "BROADCASTING" : "LIVE ROOM"}</span>
        <h2 className="noir-h2">THE ROOM</h2>
      </div>

      <figure className="noir-stream">
        <div className="noir-stream-slate">
          <span className="noir-micro">ROLL 07</span>
          <span className="noir-micro">
            {casting ? "BROADCASTING" : showPlayer ? "SIGNAL LIVE" : "STANDBY"}
          </span>
          <span className="noir-micro">24 FPS</span>
        </div>

        <div className="noir-stream-screen">
          {showPlayer ? (
            <video ref={videoRef} muted playsInline />
          ) : showIdleLoop ? (
            <video
              src={idleLoop}
              autoPlay
              loop
              muted
              playsInline
              onError={() => setIdleMissing(true)}
            />
          ) : (
            <div className="noir-stream-empty">
              <span className="noir-micro">{casting ? "LINKING" : "STANDING BY"}</span>
              <span className="noir-frame-title">
                {casting ? "CONNECTING TO THE ROOM…" : "NO STREAM IN THE ROOM YET"}
              </span>
              <span className="noir-micro">THE FEED APPEARS HERE WHEN THE ROOM OPENS</span>
            </div>
          )}

          <span className="noir-scan" aria-hidden="true" />

          {(casting || showPlayer) && <span className="noir-stream-live">LIVE</span>}

          {showPlayer && (
            <button
              className="noir-stream-btn"
              onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setUnmuted(!v.muted); } }}
            >
              {unmuted ? "Sound off" : "Sound on"}
            </button>
          )}
        </div>

        <figcaption className="noir-stream-foot">
          <span className="noir-micro">ESSENTIALS — ROOM FEED</span>
          <span className="noir-micro">{showPlayer ? "MUTED BY DEFAULT" : showIdleLoop ? "REEL" : "NO SIGNAL"}</span>
        </figcaption>
      </figure>

      <div className="noir-schedule" aria-live="polite">
        <div className="noir-schedule-cell">
          <span className="noir-micro">LIVE NOW</span>
          <p className="noir-schedule-name">
            {schedule?.now?.stageName ?? (status.live || status.studioLive ? "ON AIR" : "NOBODY ON AIR")}
          </p>
          <p className="noir-schedule-meta">
            {schedule?.now?.title ?? (status.live || status.studioLive ? "Broadcasting now" : "The room is standing by")}
          </p>
        </div>
        <div className="noir-schedule-cell">
          <span className="noir-micro">NEXT UP</span>
          <p className="noir-schedule-name">
            {schedule?.next?.stageName ?? "NO SESSION BOOKED"}
          </p>
          <p className="noir-schedule-meta">
            {schedule?.next
              ? [scheduleWhen(schedule.next.startsAt), schedule.next.title].filter(Boolean).join(" · ")
              : "Check back for the next live window"}
          </p>
        </div>
      </div>

      {isAdmin && (
        <div style={{ maxWidth: 960, margin: "14px auto 0", display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
          {!casting ? (
            <button onClick={goLive} className="noir-btn">GO LIVE (SCREEN + AUDIO)</button>
          ) : (
            <button onClick={stopCasting} className="noir-btn" style={{ background: "#e11d48", color: "#fff" }}>STOP BROADCAST</button>
          )}
          {casting && (
            <button
              onClick={async () => { try { await navigator.clipboard?.writeText(await viewerUrl()); } catch {} }}
              style={{ background: "none", border: "1px solid rgba(255,255,255,.3)", color: "#fff", padding: "10px 16px", cursor: "pointer" }}
            >
              COPY RTSP LINK (with key)
            </button>
          )}
          <form onSubmit={sourceSet} style={{ display: "flex", gap: 8, flex: "1 1 320px", minWidth: 280 }}>
            <input
              value={srcUrl}
              onChange={(e) => setSrcUrl(e.target.value)}
              placeholder="Restream source: rtsp://…  https://…  m3u8  (testsrc)"
              style={{ flex: 1, background: "transparent", border: "1px solid rgba(255,255,255,.25)", color: "#fff", padding: "10px 12px" }}
            />
            <button type="submit" className="noir-btn">SET SOURCE</button>
            {status.sourceUp && <button type="button" className="noir-btn" onClick={() => stopLiveSource().then(() => liveStatus().then(setStatus).catch(() => {}))}>STOP</button>}
          </form>
        </div>
      )}

      {error && <p style={{ color: "#ff5b7f", textAlign: "center", marginTop: 10 }}>{error}</p>}
    </section>
  );
}
