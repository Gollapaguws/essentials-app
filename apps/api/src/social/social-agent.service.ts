import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

/** Content generation via the LOCAL agent (Ollama on the VPS). */
@Injectable()
export class SocialAgentService {
  private readonly logger = new Logger(SocialAgentService.name);
  private inFlight = false;

  constructor(private config: ConfigService) {}

  private ollamaUrl() {
    return this.config.get("OLLAMA_URL") ?? "http://127.0.0.1:11434";
  }

  private model() {
    return this.config.get("OLLAMA_MODEL") ?? "qwen2.5:7b";
  }

  private async ollama(prompt: string): Promise<string> {
    const res = await fetch(`${this.ollamaUrl()}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model(), prompt, stream: false }),
    });
    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
    const json: any = await res.json();
    return String(json.response ?? "").trim();
  }

  /** Generate platform-tailored copy for an event/announcement. */
  async generate(
    user: JwtUser,
    data: { topic: string; platforms: string[]; tone?: string; includeHashtags?: boolean; eventDate?: string; venue?: string },
  ) {
    if (this.inFlight) throw new Error("The agent is already writing — try again in a moment");
    this.inFlight = true;
    try {
      return await this.generateInner(user, data);
    } finally {
      this.inFlight = false;
    }
  }

  private async generateInner(
    user: JwtUser,
    data: { topic: string; platforms: string[]; tone?: string; includeHashtags?: boolean; eventDate?: string; venue?: string },
  ) {
    const tone = data.tone ?? "hype, energetic nightlife brand voice";
    const platformList = data.platforms.length ? data.platforms.join(", ") : "all platforms";
    const hashtagRule = data.includeHashtags === false ? "No hashtags." : "Add 2-4 punchy hashtags at the end.";
    const prompt = `You write social media copy for ESSENTIALS, a South African nightlife / music events brand (underground rooms, house, techno, amapiano, hip-hop).

Write ONE post for each of these platforms: ${platformList}.
Topic: ${data.topic}
${data.eventDate ? `Event date: ${data.eventDate}` : ""}
${data.venue ? `Venue: ${data.venue}` : ""}
Tone: ${tone}. ${hashtagRule}
Keep each post under 280 characters if the platform is X, otherwise under 500.

Respond in EXACTLY this format (no extra commentary):
PLATFORM: <platform name>
<post text>

PLATFORM: <next platform name>
<post text>`;

    const raw = await this.ollama(prompt);
    const posts: Record<string, string> = {};
    const blocks = raw.split(/PLATFORM:\s*/i).filter((b) => b.trim());
    for (const block of blocks) {
      const nl = block.indexOf("\n");
      if (nl === -1) continue;
      const platform = block.slice(0, nl).trim().toLowerCase().replace(/[^a-z]/g, "");
      const text = block.slice(nl + 1).trim();
      if (platform && text) posts[platform] = text;
    }
    if (!Object.keys(posts).length) {
      // fallback: one generic post for the first platform
      const first = data.platforms[0] ?? "all";
      posts[first] = raw.slice(0, 600);
    }
    this.logger.log(`generated copy for ${Object.keys(posts).length} platform(s) via ${this.model()}`);
    return { posts, raw };
  }
}
