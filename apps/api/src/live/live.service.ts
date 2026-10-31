import { Injectable, OnModuleDestroy, Logger } from "@nestjs/common";
import { spawn, type ChildProcess } from "child_process";

// RTSP is served by a dedicated MediaMTX server (ffmpeg 6.1 on Ubuntu cannot
// bind its own RTSP muxer). ffmpeg pushes as a client; MediaMTX serves it
// on 0.0.0.0:8554 to any number of viewers.
const RTSP_PUSH = "rtsp://127.0.0.1:8554/essentials";
const RTSP_PUBLIC = "rtsp://essentialsedm.com:8554/essentials";
const HLS_DIR = process.env.HLS_DIR ?? "/var/www/essentialsedm/hls";
const HLS_PLAYLIST = `${HLS_DIR}/stream.m3u8`;

/**
 * Live media engine.
 * - INGEST (screen → RTSP): the site streams raw H.264 (annexb) + AAC (ADTS)
 *   frames over a WebSocket; ffmpeg muxes them straight into a live RTSP output.
 * - SOURCE (restreaming): any RTSP/HTTP/HLS input URL is transcoded to a
 *   low-latency HLS playlist that the front page plays (hls.js).
 */
@Injectable()
export class LiveService implements OnModuleDestroy {
  private readonly logger = new Logger(LiveService.name);
  private ingestProc: ChildProcess | null = null;
  private ingestDead = false;
  private sourceProc: ChildProcess | null = null;
  private sourceUrl: string | null = null;

  /** Start the ingest ffmpeg (idempotent). Called on WS connect. */
  startIngest(): boolean {
    if (this.ingestProc && !this.ingestProc.killed) return false;
    this.ingestDead = false;
    const proc = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error",
        "-f", "h264", "-i", "pipe:0",
        "-f", "aac", "-i", "pipe:1",
        "-c:v", "copy",
        "-c:a", "aac", "-ar", "44100", "-ac", "2",
        "-tune", "zerolatency", "-fflags", "+flush_packets",
        "-muxdelay", "0",
        "-f", "rtsp", "-rtsp_transport", "tcp",
        RTSP_PUSH,
      ],
      { stdio: ["pipe", "ignore", "pipe"] },
    );
    proc.stdin?.on("error", (e: NodeJS.ErrnoException) => {
      // ffmpeg exiting mid-cast must never crash the API process
      if (e.code !== "EPIPE" && e.code !== "ERR_STREAM_DESTROYED") {
        this.logger.warn(`ingest stdin: ${e.code}`);
      }
    });
    proc.stderr?.on("data", () => {}); // drain
    proc.on("error", (e) => {
      this.ingestDead = true;
      this.logger.error(`ingest ffmpeg: ${e.message}`);
    });
    proc.on("exit", (code) => { this.ingestDead = true; this.ingestProc = null; this.logger.log(`ingest ffmpeg exited: ${code}`); });
    this.ingestProc = proc;
    this.logger.log("ingest ffmpeg started → " + RTSP_PUSH);
    return true;
  }

  /** Write a raw frame. stream: 0 = video (h264), 1 = audio (aac/adts). */
  writeIngest(stream: 0 | 1, chunk: Buffer) {
    const proc = this.ingestProc;
    if (!proc || proc.killed || this.ingestDead || !proc.stdin) return;
    proc.stdin.write(chunk, (e) => {
      if (e && e.code !== "EPIPE" && e.code !== "ERR_STREAM_DESTROYED") {
        this.logger.warn(`ingest write: ${e.code}`);
      }
    });
  }

  stopIngest() {
    if (this.ingestProc && !this.ingestProc.killed) {
      try { this.ingestProc.stdin?.end(); } catch {}
      this.ingestProc.kill("SIGTERM");
      this.ingestProc = null;
      this.logger.log("ingest ffmpeg stopped");
    }
  }

  /** Start restreaming a source URL → HLS. "testsrc" generates a test pattern. */
  startSource(url: string): { ok: true } {
    this.stopSource();
    const input =
      url === "testsrc"
        ? ["-f", "lavfi", "-i", "testsrc=duration=0:size=1280x720:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=0"]
        : url.startsWith("rtsp")
          ? ["-rtsp_transport", "tcp", "-i", url]
          : ["-i", url];

    const proc = spawn(
      "ffmpeg",
      [
        "-hide_banner", "-loglevel", "error",
        "-reconnect", "1", "-reconnect_streamed", "1",
        ...input,
        "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
        "-b:v", "2500k", "-maxrate", "3000k", "-bufsize", "5000k", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "96k", "-ar", "44100", "-ac", "2",
        "-f", "hls", "-hls_time", "2", "-hls_list_size", "3", "-hls_flags", "delete_segments",
        HLS_PLAYLIST,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    proc.on("error", (e) => this.logger.error(`source ffmpeg: ${e.message}`));
    proc.on("exit", (code) => {
      if (this.sourceProc === proc) {
        this.sourceProc = null;
        this.sourceUrl = null;
        this.logger.log(`source ffmpeg exited: ${code}`);
      }
    });
    this.sourceProc = proc;
    this.sourceUrl = url;
    this.logger.log(`source ffmpeg started: ${url} → ${HLS_PLAYLIST}`);
    return { ok: true };
  }

  stopSource(): { ok: true } {
    if (this.sourceProc && !this.sourceProc.killed) this.sourceProc.kill("SIGTERM");
    this.sourceProc = null;
    this.sourceUrl = null;
    return { ok: true };
  }

  status() {
    return {
      live: !!(this.ingestProc && !this.ingestProc.killed),
      rtspUrl: RTSP_PUBLIC,
      source: this.sourceUrl,
      sourceUp: !!(this.sourceProc && !this.sourceProc.killed),
      hls: this.sourceUrl ? "https://essentialsedm.com/hls/stream.m3u8" : null,
    };
  }

  onModuleDestroy() {
    this.stopIngest();
    this.stopSource();
  }
}
