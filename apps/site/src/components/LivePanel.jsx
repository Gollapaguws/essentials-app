import { useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import { fetchMe } from "@/lib/auth";
import { liveStatus, setLiveSource, stopLiveSource, startScreenIngest, viewerUrl } from "@/live/live";

/**
 * LIVE section on the front page:
 * - restream: any RTSP/HTTP/HLS source set by an admin is played here (hls.js)
 * - GO LIVE: admin captures screen+audio → server FFmpeg → rtsp://essentialsedm.com:8554/essentials
 */
export default function LivePanel() {
  const [status, setStatus] = useState({ live: false, sourceUp: false, hls: null, rtspUrl: "" });
  const [me, setMe] = useState(null);
  const [casting, setCasting] = useState(false);
  const [unmuted, setUnmuted] = useState(false);
  const [error, setError] = useState(null);
  const [srcUrl, setSrcUrl] = useState("");
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
      video.src = status.hls;
    } else if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true, liveDurationInfinity: true });
      hls.loadSource(status.hls);
      hls.attachMedia(video);
      hlsRef.current = hls;
    }
    video.play().catch(() => {});
    return () => { if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; } };
  }, [hlsUrl]);

  const goLive = async () => {
    setError(null);
    try {
      const handle = await startScreenIngest({});
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

      <div style={{ position: "relative", width: "100%", maxWidth: 960, margin: "0 auto", aspectRatio: "16/9", background: "#000", border: "1px solid rgba(255,255,255,.12)" }}>
        {showPlayer ? (
          <video ref={videoRef} muted playsInline style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <div style={{ display: "grid", placeItems: "center", height: "100%", color: "rgba(255,255,255,.35)" }}>
            {casting ? "CONNECTING TO THE ROOM…" : studioLive ? "LIVE FROM THE STUDIO" : "NO STREAM IN THE ROOM YET"}
          </div>
        )}
        {(casting || showPlayer) && (
          <span style={{ position: "absolute", top: 10, left: 10, background: "#e11d48", color: "#fff", fontWeight: 900, letterSpacing: 2, fontSize: 12, padding: "4px 10px" }}>
            ● LIVE
          </span>
        )}
        {showPlayer && (
          <button
            onClick={() => { const v = videoRef.current; if (v) { v.muted = !v.muted; setUnmuted(!v.muted); } }}
            style={{ position: "absolute", bottom: 10, right: 10, background: "rgba(0,0,0,.6)", color: "#fff", border: "1px solid rgba(255,255,255,.3)", padding: "6px 12px", cursor: "pointer", fontWeight: 700 }}
          >
            {unmuted ? "🔇 MUTE" : "🔊 UNMUTE"}
          </button>
        )}
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
