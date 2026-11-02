import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import type { JwtUser } from "../common/roles.guard";

export type Platform = "x" | "telegram" | "discord" | "facebook" | "youtube" | "tiktok" | "instagram" | "mixcloud" | "webhook";

/** Platforms with server-side auto-publish configured (env credentials). */
export function autoPublishPlatforms(cfg: ConfigService): Platform[] {
  const out: Platform[] = [];
  if (cfg.get("X_ACCESS_TOKEN") && cfg.get("X_API_KEY")) out.push("x");
  if (cfg.get("TELEGRAM_BOT_TOKEN") && cfg.get("TELEGRAM_CHAT_ID")) out.push("telegram");
  if (cfg.get("DISCORD_WEBHOOK_URL")) out.push("discord");
  if (cfg.get("FACEBOOK_PAGE_TOKEN") && cfg.get("FACEBOOK_PAGE_ID")) out.push("facebook");
  if (cfg.get("GENERIC_WEBHOOK_URL")) out.push("webhook");
  return out;
}

export const MANUAL_PLATFORMS: Platform[] = ["youtube", "tiktok", "instagram", "mixcloud"];

/** Deep link to the platform's own upload/composer page (manual workflow). */
export const COMPOSER_LINKS: Record<string, string> = {
  youtube: "https://studio.youtube.com/channel/upload",
  tiktok: "https://www.tiktok.com/upload",
  instagram: "https://www.instagram.com/",
  mixcloud: "https://www.mixcloud.com/upload/",
  facebook: "https://www.facebook.com/",
};

@Injectable()
export class SocialPublishService {
  private readonly logger = new Logger(SocialPublishService.name);

  constructor(private config: ConfigService) {}

  /** Publish content to one platform. Returns { ok, detail }. Never throws. */
  async publishTo(platform: Platform, content: string, mediaUrl?: string): Promise<{ ok: boolean; detail: string }> {
    try {
      switch (platform) {
        case "x":
          return await this.publishX(content, mediaUrl);
        case "telegram":
          return await this.publishTelegram(content);
        case "discord":
          return await this.publishDiscord(content, mediaUrl);
        case "facebook":
          return await this.publishFacebook(content, mediaUrl);
        case "webhook":
          return await this.publishWebhook(content, mediaUrl);
        default:
          return { ok: false, detail: "Manual platform — use the composer link and copy the text" };
      }
    } catch (e) {
      this.logger.warn(`publish ${platform} failed: ${(e as Error).message}`);
      return { ok: false, detail: (e as Error).message };
    }
  }

  private async publishX(content: string, mediaUrl?: string) {
    const key = this.config.get("X_API_KEY")!;
    const secret = this.config.get("X_API_SECRET")!;
    const token = this.config.get("X_ACCESS_TOKEN")!;
    const tokenSecret = this.config.get("X_ACCESS_TOKEN_SECRET")!;
    // OAuth 1.0a signing done via percent-encode + HMAC — implemented inline to avoid deps
    const url = "https://api.twitter.com/2/tweets";
    const payload = mediaUrl ? `${content}\n${mediaUrl}` : content;
    const oauth = this.xAuthHeader("POST", url, { key, secret, token, tokenSecret });
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: oauth, "Content-Type": "application/json" },
      body: JSON.stringify({ text: payload.slice(0, 280) }),
    });
    const body: any = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, detail: `tweet ${body?.data?.id ?? ""}` } : { ok: false, detail: body?.detail ?? `HTTP ${res.status}` };
  }

  private xAuthHeader(method: string, url: string, c: { key: string; secret: string; token: string; tokenSecret: string }) {
    const { createHmac, randomBytes, createHash } = require("crypto") as typeof import("crypto");
    const u = new URL(url);
    const oauth = {
      oauth_consumer_key: c.key,
      oauth_nonce: randomBytes(16).toString("hex"),
      oauth_signature_method: "HMAC-SHA256",
      oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
      oauth_token: c.token,
      oauth_version: "1.0",
    };
    const enc = (s: string) => encodeURIComponent(s);
    const params = Object.keys(oauth).sort().map((k) => `${k}=${enc(oauth[k as keyof typeof oauth])}`).join("&");
    const base = [method.toUpperCase(), enc(url), enc(params)].join("&");
    const sig = createHmac("sha256", `${enc(c.secret)}&${enc(c.tokenSecret)}`).update(base).digest("base64");
    oauth["oauth_signature" as keyof typeof oauth] = sig as never;
    return `OAuth ${Object.keys(oauth).map((k) => `${k}="${enc(oauth[k as keyof typeof oauth])}"`).join(", ")}`;
  }

  private async publishTelegram(content: string) {
    const token = this.config.get("TELEGRAM_BOT_TOKEN")!;
    const chat = this.config.get("TELEGRAM_CHAT_ID")!;
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chat, text: content }),
    });
    return res.ok ? { ok: true, detail: "telegram message sent" } : { ok: false, detail: `telegram HTTP ${res.status}` };
  }

  private async publishDiscord(content: string, mediaUrl?: string) {
    const url = this.config.get("DISCORD_WEBHOOK_URL")!;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: mediaUrl ? `${content}\n${mediaUrl}` : content }),
    });
    return res.ok ? { ok: true, detail: "discord posted" } : { ok: false, detail: `discord HTTP ${res.status}` };
  }

  private async publishFacebook(content: string, mediaUrl?: string) {
    const token = this.config.get("FACEBOOK_PAGE_TOKEN")!;
    const pageId = this.config.get("FACEBOOK_PAGE_ID")!;
    const endpoint = mediaUrl ? `https://graph.facebook.com/v19.0/${pageId}/photos` : `https://graph.facebook.com/v19.0/${pageId}/feed`;
    const body = new URLSearchParams({ message: content, access_token: token });
    if (mediaUrl) body.set("url", mediaUrl);
    const res = await fetch(endpoint, { method: "POST", body });
    const json: any = await res.json().catch(() => ({}));
    return res.ok ? { ok: true, detail: `facebook post ${json?.id ?? ""}` } : { ok: false, detail: json?.error?.message ?? `HTTP ${res.status}` };
  }

  private async publishWebhook(content: string, mediaUrl?: string) {
    const url = this.config.get("GENERIC_WEBHOOK_URL")!;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: content, mediaUrl, source: "essentials" }),
    });
    return res.ok ? { ok: true, detail: "webhook delivered" } : { ok: false, detail: `webhook HTTP ${res.status}` };
  }
}
