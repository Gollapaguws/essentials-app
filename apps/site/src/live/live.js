const API = import.meta.env.VITE_API_URL ?? "https://essentialsedm.com/api";
const WS_BASE = (window.location.origin ?? "https://essentialsedm.com").replace(/^http/, "ws");

const token = () => localStorage.getItem("essentials_token") ?? "";

export async function liveStatus() {
  const res = await fetch(`${API}/live/status`);
  if (!res.ok) throw new Error("status");
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

/**
 * Screen+mic → live RTSP.
 * getDisplayMedia → WebCodecs (raw H.264 annexb + AAC ADTS) → WebSocket → ffmpeg → RTSP.
 * Works in Chrome/Edge. Returns { stop }.
 */
export async function startScreenIngest({ onStatus }) {
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30, max: 30 } },
    audio: { echoCancellation: true, noiseSuppression: true },
  });

  const ws = new WebSocket(`${WS_BASE}/live/ingest?token=${encodeURIComponent(token())}`);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("WS connect failed (admin only)"));
  });
  if (ws.closeCode === 4401) throw new Error("Not authorized — admin login required");

  const send = (type, data) => {
    if (ws.readyState !== 1) return;
    const out = new Uint8Array(data.byteLength + 1);
    out[0] = type;
    out.set(new Uint8Array(data), 1);
    ws.send(out);
  };
  const errors = [];

  // ---- video: canvas frames → VideoEncoder(h264) ----
  const videoEl = document.createElement("video");
  videoEl.srcObject = stream;
  videoEl.muted = true;
  videoEl.playsInline = true;
  await videoEl.play().catch(() => {});
  const width = videoEl.videoWidth || 1280;
  const height = videoEl.videoHeight || 720;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });

  const vEnc = new VideoEncoder({
    output: (chunk) => send(0x01, chunk.data),
    error: (e) => errors.push(String(e)),
  });
  vEnc.configure({ codec: "avc1.42001f", width, height, bitrate: 2_500_000, framerate: 30 });

  let lastT = 0;
  let stopped = false;
  const pump = (now, meta) => {
    if (stopped) return;
    if (now - lastT < 30) { videoEl.requestVideoFrameCallback(pump); return; }
    lastT = now;
    canvas.width = meta.width;
    canvas.height = meta.height;
    ctx.drawImage(videoEl, 0, 0, meta.width, meta.height);
    const frame = new VideoFrame(canvas, { timestamp: meta.mediaTime * 1e6, duration: 33_000 });
    vEnc.encode(frame, { keyFrame: meta.initiatingChange !== "none" });
    frame.close();
    videoEl.requestVideoFrameCallback(pump);
  };
  videoEl.requestVideoFrameCallback(pump);

  // ---- audio: worklet PCM → AudioEncoder(aac) ----
  let ac = null;
  let aEnc = null;
  const audioTrack = stream.getAudioTracks()[0];
  if (audioTrack && typeof AudioEncoder !== "undefined" && window.AudioWorklet) {
    try {
      ac = new AudioContext({ latencyHint: "interactive" });
      const workletSrc = `
class PCMProc extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) this.port.postMessage(ch.slice(0), [ch.buffer]);
    return true;
  }
}
registerProcessor("pcmproc", PCMProc);`;
      await ac.audioWorklet.addModule(
        URL.createObjectURL(new Blob([workletSrc], { type: "application/javascript" })),
      );
      const srcNode = ac.createMediaStreamSource(new MediaStream([audioTrack]));
      const workletNode = new AudioWorkletNode(ac, "pcmproc", { numberOfChannels: 1, outputChannelCount: [1] });
      srcNode.connect(workletNode);

      const queue = [];
      workletNode.port.onmessage = (e) => queue.push(e.data);

      aEnc = new AudioEncoder({ output: (chunk) => send(0x02, chunk.data), error: (e) => errors.push(String(e)) });
      aEnc.configure({ codec: "mp4a.40.2", sampleRate: 44100, numberOfChannels: 1, bitrate: 96_000 });

      const FRAMES = 1024;
      let pending = new Float32Array(0);
      (async function pumpAudio() {
        while (!stopped) {
          let chunk = null;
          while (queue.length && pending.length + queue[0].length < FRAMES) pending = mergeFloat(pending, queue.shift());
          if (queue.length) chunk = queue.shift();
          if (chunk) pending = mergeFloat(pending, chunk);
          if (pending.length >= FRAMES) {
            const slice = pending.slice(0, FRAMES);
            pending = pending.slice(FRAMES);
            aEnc.encode(slice);
          }
          await new Promise((r) => setTimeout(r, 10));
        }
      })();
    } catch (e) {
      console.warn("audio ingest disabled:", e);
    }
  }

  onStatus?.({ state: "live", errors });

  const stop = () => {
    stopped = true;
    try { vEnc.flush?.(); } catch {}
    try { vEnc.close(); } catch {}
    try { aEnc?.close(); } catch {}
    try { ac?.close(); } catch {}
    try { videoEl.pause(); } catch {}
    stream.getTracks().forEach((t) => t.stop());
    try { ws.close(); } catch {}
  };

  // auto-stop when the user closes the share tab / clicks "stop sharing"
  stream.getVideoTracks()[0].addEventListener("ended", stop);

  return { stop, errors };
}

function mergeFloat(a, b) {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
