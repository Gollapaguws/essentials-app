import { API_BASE } from "@/lib/apiBase";
const API = API_BASE;
const WS_BASE = (window.location.origin ?? "https://essentialsedm.com").replace(/^http/, "ws");

const token = () => localStorage.getItem("essentials_token") ?? "";

export async function viewerUrl() {
  const res = await fetch(`${API}/live/viewer-url`, { headers: { Authorization: `Bearer ${token()}` } });
  if (!res.ok) throw new Error("viewer-url");
  const d = await res.json();
  return d.url;
}

export async function liveStatus() {
  const res = await fetch(`${API}/live/status`);
  if (!res.ok) throw new Error("status");
  return res.json();
}

/** Public schedule: who is on air, who is next, and the upcoming DJ windows. */
export async function liveSchedule() {
  const res = await fetch(`${API}/live/schedule`);
  if (!res.ok) throw new Error("schedule");
  return res.json();
}

export async function setLiveSource(url) {
  const res = await fetch(`${API}/live/source`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ url }),
  });
  if (!res.ok) throw new Error((await res.json()).message ?? "source");
  return res.json();
}

export async function stopLiveSource() {
  const res = await fetch(`${API}/live/source`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!res.ok) throw new Error("stop");
  return res.json();
}

function pickMimeType() {
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm;codecs=vp9",
    "video/webm",
  ];
  for (const c of candidates) {
    if (window.MediaRecorder && MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

/**
 * Screen+mic → live RTSP.
 * getDisplayMedia → MediaRecorder (WebM container) → WebSocket → ffmpeg → MediaMTX → RTSP.
 * Returns { stop }. Works in Chrome/Edge.
 */
export async function startScreenIngest() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("Screen capture is not supported in this browser (use Chrome or Edge)");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    // 720p keeps the server's single transcoder within budget.
    video: { width: { max: 1280 }, height: { max: 720 }, frameRate: { ideal: 30, max: 30 } },
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  if (!stream.getVideoTracks().length) {
    stream.getTracks().forEach((t) => t.stop());
    throw new Error("No video track — share a screen or window, not just a tab");
  }

  // Send the JWT as a WebSocket subprotocol, not a query parameter: URLs are
  // written to nginx access logs and browser history, tokens should not be.
  const bearer = token();
  const ws = bearer
    ? new WebSocket(`${WS_BASE}/live/ingest`, ["bearer", bearer])
    : new WebSocket(`${WS_BASE}/live/ingest`);
  const closeCode = new Promise((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error("WS connect failed (admin login + MFA required)"));
    ws.onclose = (e) => { if (e.code === 4401 || e.code === 4403) reject(new Error("Not authorized — admin login required")); else resolve(); };
  });
  await closeCode.catch(() => { throw new Error("Connection refused by server (admin + MFA required)"); });

  const rec = new MediaRecorder(stream, { mimeType: pickMimeType(), videoBitsPerSecond: 800_000, audioBitsPerSecond: 96_000 });
  const queue = [];
  let closed = false;

  rec.ondataavailable = (e) => {
    if (!e.data || !e.data.size || closed) return;
    if (ws.readyState === 1) ws.send(e.data);
  };
  ws.onclose = () => { closed = true; };

  rec.start(500); // flush every 500ms

  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    try { rec.stop(); } catch {}
    closed = true;
    try { ws.close(); } catch {}
    stream.getTracks().forEach((t) => t.stop());
  };

  // auto-stop when the user clicks "stop sharing"
  stream.getVideoTracks()[0].addEventListener("ended", stop);

  return { stop };
}
