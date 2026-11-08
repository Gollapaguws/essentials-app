import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { fetchMe } from "@/lib/auth";
import { liveStatus, setLiveSource, stopLiveSource, startScreenIngest, viewerUrl } from "@/live/live";

/**
 * Held on the media box while the room is dark: a silent, looping reel so the
 * section reads as a channel between shows instead of a blank frame. Drop the
 * file at `apps/site/public/media/not-live.mp4`; if it is missing the box falls
 * back to the plain standby slate rather than showing a broken player.
 */
const IDLE_LOOP = "/media/not-live.mp4";

/**
 * LIVE section on the front page:
 * - restream: any RTSP/HTTP/HLS source set by an admin is played here (hls.js)
 * - GO LIVE: admin captures screen+audio → server FFmpeg → rtsp://essentialsedm.com:8554/essentials
 */
export default function LivePanel() {
  const [status, setStatus] = useState({ live: false, sourceUp: false, studioLive: false, hls: null, rtspUrl: "" });
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
    const tick = () => liveStatus().then(setStatus).catch(() => {});
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, []);

  const studioLive = !!status.studioLive;
  const hlsUrl = studioLive ? "https://essentialsedm.com/hls/live.m3u8" : status.hls;

  // player: attach hls.js when a restream is active
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !hlsUrl) return;
    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = hlsUrl;
    } else if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, liveDurationInfinity: true });
      hls.loadSource(hlsUrl);
      hls.attachMedia(video);
      hlsRef.current = hls;
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
          ) : idleMissing ? (
            <div className="noir-stream-empty">
              <span className="noir-micro">{casting ? "LINKING" : "STANDING BY"}</span>
              <span className="noir-frame-title">
                {casting ? "CONNECTING TO THE ROOM…" : "NO STREAM IN THE ROOM YET"}
              </span>
              <span className="noir-micro">THE FEED APPEARS HERE WHEN THE ROOM OPENS</span>
            </div>
          ) : (
            <video
              src={IDLE_LOOP}
              autoPlay
              loop
              muted
              playsInline
              // A missing reel must not leave a dead frame behind.
              onError={() => setIdleMissing(true)}
            />
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
          <span className="noir-micro">{showPlayer ? "MUTED BY DEFAULT" : "NO SIGNAL"}</span>
        </figcaption>
      </figure>

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
