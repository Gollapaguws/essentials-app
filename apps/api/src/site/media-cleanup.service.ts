import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Interval } from "@nestjs/schedule";
import { prisma } from "@essentials/db";
import { readdirSync, rmSync, statSync } from "fs";
import { join } from "path";

/** Filenames this API generates: <timestamp>-<hex>.<ext>. Anything else is not ours to touch. */
const UPLOAD_NAME = /^\d+-[a-f0-9]{8}\.(?:jpe?g|png|webp|avif)$/i;

/** An upload can sit unsaved while a form is open; only sweep files older than a day. */
export const ORPHAN_GRACE_MS = 24 * 60 * 60 * 1000;

/**
 * Hourly sweep of the shared media directory: photos no DJ profile, account or
 * front-page record points at are removed. The grace window keeps a photo that
 * was uploaded but not yet saved from being deleted underneath the editor.
 */
@Injectable()
export class MediaCleanupService {
  private readonly logger = new Logger(MediaCleanupService.name);

  constructor(private readonly config: ConfigService) {}

  @Interval(3_600_000)
  async sweep() {
    try {
      const { deleted } = await this.removeOrphans();
      if (deleted) this.logger.log(`media cleanup: removed ${deleted} unreferenced upload(s)`);
    } catch (e) {
      this.logger.warn(`media cleanup failed: ${(e as Error).message}`);
    }
  }

  /** Delete generated uploads no record references. `now` is injectable for tests. */
  async removeOrphans(now = Date.now()) {
    const mediaDir = this.config.get<string>("MEDIA_DIR") ?? "/var/www/essentialsedm/media";
    let names: string[];
    try {
      names = readdirSync(mediaDir).filter((name) => UPLOAD_NAME.test(name));
    } catch {
      // No media directory yet (fresh install): nothing to clean.
      return { scanned: 0, deleted: 0, kept: 0 };
    }
    if (!names.length) return { scanned: 0, deleted: 0, kept: 0 };

    const referenced = await this.referencedFiles();
    let deleted = 0;

    for (const name of names) {
      if (referenced.has(name)) continue;
      const path = join(mediaDir, name);
      try {
        if (now - statSync(path).mtimeMs < ORPHAN_GRACE_MS) continue;
        rmSync(path, { force: true });
        deleted++;
      } catch {
        // Another process removed it first, or the file cannot be read: skip.
      }
    }

    return { scanned: names.length, deleted, kept: names.length - deleted };
  }

  /**
   * Every filename still in use. Site content shares the media directory (the
   * front-page editor uploads through it), so its URLs count too.
   */
  private async referencedFiles() {
    const [profiles, users, siteRows, posts] = await Promise.all([
      prisma.artistProfile.findMany({ where: { imageUrl: { not: null } }, select: { imageUrl: true } }),
      prisma.user.findMany({ where: { avatar: { not: null } }, select: { avatar: true } }),
      prisma.siteContent.findMany({ select: { value: true } }),
      prisma.socialPost.findMany({ where: { mediaUrl: { not: null } }, select: { mediaUrl: true } }),
    ]);

    const referenced = new Set<string>();
    for (const profile of profiles) this.remember(profile.imageUrl, referenced);
    for (const user of users) this.remember(user.avatar, referenced);
    for (const row of siteRows) this.collect(row.value, referenced);
    for (const post of posts) this.remember(post.mediaUrl, referenced);
    return referenced;
  }

  /** Track a URL only when its basename is one of our generated uploads. */
  private remember(url: string | null, into: Set<string>) {
    if (!url) return;
    const name = this.fileName(url);
    if (name) into.add(name);
  }

  /** Front-page content is free-form JSON, so walk it for uploaded URLs. */
  private collect(value: unknown, into: Set<string>) {
    if (typeof value === "string") {
      this.remember(value, into);
    } else if (Array.isArray(value)) {
      for (const item of value) this.collect(item, into);
    } else if (value && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) this.collect(item, into);
    }
  }

  private fileName(url: string) {
    try {
      const name = decodeURIComponent(new URL(url, "http://local").pathname.split("/").pop() ?? "");
      return UPLOAD_NAME.test(name) ? name : "";
    } catch {
      return "";
    }
  }
}
