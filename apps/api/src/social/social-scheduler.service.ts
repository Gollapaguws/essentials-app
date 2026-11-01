import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { prisma } from "@essentials/db";
import { SocialPublishService } from "../social/social-publish.service";
import type { Platform } from "../social/social-publish.service";

/** Publishes scheduled posts when their time arrives. */
@Injectable()
export class SocialSchedulerService {
  private readonly logger = new Logger(SocialSchedulerService.name);

  constructor(private publish: SocialPublishService) {}

  @Interval(60_000)
  async sweep() {
    const due = await prisma.socialPost.findMany({
      where: { status: "scheduled", scheduledAt: { lte: new Date() } },
      take: 10,
    });
    for (const post of due) {
      await this.publishNow(post.id, post.content, post.platforms as Platform[], post.mediaUrl ?? undefined);
    }
  }

  /** Publish a post to all its platforms, recording per-platform results. */
  async publishNow(postId: string, content: string, platforms: Platform[], mediaUrl?: string) {
    await prisma.socialPost.update({ where: { id: postId }, data: { status: "publishing" } });
    const results: Record<string, { status: string; detail: string }> = {};
    for (const platform of platforms) {
      const r = await this.publish.publishTo(platform, content, mediaUrl);
      results[platform] = { status: r.ok ? "published" : "failed", detail: r.detail };
    }
    const values = Object.values(results);
    const status = values.every((v) => v.status === "published")
      ? "published"
      : values.some((v) => v.status === "published")
        ? "partial"
        : "failed";
    await prisma.socialPost.update({ where: { id: postId }, data: { status, results: results as object } });
    return { status, results };
  }
}
