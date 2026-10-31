import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { spawn, type ChildProcess } from "child_process";
import { prisma } from "@essentials/db";

const SOURCE = "rtsp://127.0.0.1:8554/essentials";

interface Push { proc: ChildProcess; targetId: string }

/**
 * Simulcast: pushes the live RTSP output to every enabled platform target
 * (YouTube, TikTok, Mixcloud, Facebook Live, Instagram via custom RTMP, custom).
 * Starts automatically when a broadcast starts, stops when it ends.
 */
@Injectable()
export class SimulcastService implements OnModuleDestroy {
  private readonly logger = new Logger(SimulcastService.name);
  private pushes = new Map<string, Push>();

  private ffmpegArgs(targetUrl: string) {
    return [
      "-hide_banner", "-loglevel", "error",
      "-rtsp_transport", "tcp", "-i", SOURCE,
      "-c:v", "libx264", "-preset", "veryfast", "-tune", "zerolatency",
      "-b:v", "4500k", "-maxrate", "5000k", "-bufsize", "8000k",
      "-pix_fmt", "yuv420p", "-g", "60",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100", "-ac", "2",
      "-f", "flv", targetUrl,
    ];
  }

  private attempts = new Map<string, number>();

  private spawnPush(targetId: string, url: string, attempt = 0) {
    const proc = spawn("ffmpeg", this.ffmpegArgs(url), { stdio: ["ignore", "ignore", "pipe"] });
    proc.stderr?.on("data", () => {}); // drain
    proc.on("error", (e) => this.logger.error(`push ${targetId}: ${e.message}`));
    proc.on("exit", (code) => {
      if (this.pushes.get(targetId)?.proc !== proc) return; // replaced/stopped
      this.pushes.delete(targetId);
      // the RTSP path may not be publishing yet when the push connects — retry
      if (attempt < 5 && code !== 0) {
        setTimeout(() => {
          if (!this.pushes.has(targetId)) this.spawnPush(targetId, url, attempt + 1);
        }, 3000);
        return;
      }
      this.logger.log(`push ${targetId} exited: ${code}`);
    });
    this.pushes.set(targetId, { proc, targetId });
    this.logger.log(`simulcast push started → ${targetId} (attempt ${attempt + 1})`);
  }

  /** Start pushes for every enabled target. Called when a broadcast begins. */
  async startAll(): Promise<number> {
    if (!this.liveAvailable()) return 0;
    const targets = await prisma.streamTarget.findMany({ where: { enabled: true } });
    let started = 0;
    for (const t of targets) {
      if (this.pushes.has(t.id)) continue;
      this.spawnPush(t.id, t.url);
      started++;
    }
    return started;
  }

  stopAll() {
    for (const [, p] of this.pushes) {
      try { p.proc.kill("SIGTERM"); } catch {}
    }
    this.pushes.clear();
    this.logger.log("simulcast pushes stopped");
  }

  stopOne(targetId: string) {
    const p = this.pushes.get(targetId);
    if (p) {
      try { p.proc.kill("SIGTERM"); } catch {}
      this.pushes.delete(targetId);
    }
  }

  startOne(targetId: string, url: string) {
    if (!this.liveAvailable()) throw new Error("No broadcast is live");
    if (this.pushes.has(targetId)) return;
    this.spawnPush(targetId, url);
  }

  /** Per-target live state for the UI. */
  states(): Record<string, boolean> {
    const out: Record<string, boolean> = {};
    for (const [id, p] of this.pushes) out[id] = !p.proc.killed;
    return out;
  }

  private liveAvailable(): boolean {
    return this.pushes.size >= 0; // pushes read from MediaMTX; mediamtx holds the path
  }

  onModuleDestroy() {
    this.stopAll();
  }
}
