import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { MediaCleanupService, ORPHAN_GRACE_MS } from "./media-cleanup.service";

jest.mock("@essentials/db", () => ({
  prisma: {
    artistProfile: { findMany: jest.fn() },
    user: { findMany: jest.fn() },
    siteContent: { findMany: jest.fn() },
    socialPost: { findMany: jest.fn() },
  },
}));

const db = prisma as unknown as {
  artistProfile: { findMany: jest.Mock };
  user: { findMany: jest.Mock };
  siteContent: { findMany: jest.Mock };
  socialPost: { findMany: jest.Mock };
};

const ORIGIN = "https://api.example.com";
const OLD_UPLOAD = "1730000000000-abcdef12.jpg";
const OTHER_UPLOAD = "1730000000001-12345678.png";

describe("MediaCleanupService", () => {
  let mediaDir: string;
  let service: MediaCleanupService;

  beforeEach(() => {
    mediaDir = mkdtempSync(join(tmpdir(), "essentials-cleanup-"));
    service = new MediaCleanupService(
      { get: (key: string) => (key === "MEDIA_DIR" ? mediaDir : undefined) } as unknown as ConfigService,
    );
    db.artistProfile.findMany.mockResolvedValue([]);
    db.user.findMany.mockResolvedValue([]);
    db.siteContent.findMany.mockResolvedValue([]);
    db.socialPost.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    rmSync(mediaDir, { recursive: true, force: true });
  });

  /** Create an upload with an old mtime so it is past the grace window. */
  function addUpload(name: string, ageMs = ORPHAN_GRACE_MS + 60_000) {
    const path = join(mediaDir, name);
    writeFileSync(path, "image-bytes");
    const mtime = new Date(Date.now() - ageMs);
    utimesSync(path, mtime, mtime);
    return path;
  }

  it("deletes an upload no record references", async () => {
    addUpload(OLD_UPLOAD);

    await expect(service.removeOrphans()).resolves.toEqual({ scanned: 1, deleted: 1, kept: 0 });
    expect(readdirSync(mediaDir)).toEqual([]);
  });

  it("keeps a DJ profile photo", async () => {
    addUpload(OLD_UPLOAD);
    db.artistProfile.findMany.mockResolvedValue([{ imageUrl: `${ORIGIN}/media/${OLD_UPLOAD}` }]);

    await expect(service.removeOrphans()).resolves.toEqual({ scanned: 1, deleted: 0, kept: 1 });
    expect(readdirSync(mediaDir)).toEqual([OLD_UPLOAD]);
  });

  it("keeps account avatars and front-page images", async () => {
    addUpload(OLD_UPLOAD);
    addUpload(OTHER_UPLOAD);
    db.user.findMany.mockResolvedValue([{ avatar: `${ORIGIN}/media/${OLD_UPLOAD}` }]);
    db.siteContent.findMany.mockResolvedValue([
      { value: { heroSlides: [`${ORIGIN}/media/${OTHER_UPLOAD}`], visuals: [] } },
    ]);

    await expect(service.removeOrphans()).resolves.toEqual({ scanned: 2, deleted: 0, kept: 2 });
    expect(readdirSync(mediaDir).sort()).toEqual([OLD_UPLOAD, OTHER_UPLOAD].sort());
  });

  it("keeps media referenced by a scheduled social post", async () => {
    addUpload(OLD_UPLOAD);
    db.socialPost.findMany.mockResolvedValue([{ mediaUrl: `${ORIGIN}/media/${OLD_UPLOAD}` }]);

    await expect(service.removeOrphans()).resolves.toEqual({ scanned: 1, deleted: 0, kept: 1 });
  });

  it("keeps a recent upload even when nothing references it yet", async () => {
    addUpload(OLD_UPLOAD, 60_000);

    await expect(service.removeOrphans()).resolves.toEqual({ scanned: 1, deleted: 0, kept: 1 });
    expect(readdirSync(mediaDir)).toEqual([OLD_UPLOAD]);
  });

  it("ignores files it did not generate", async () => {
    writeFileSync(join(mediaDir, "manual-photo.jpg"), "not ours");
    writeFileSync(join(mediaDir, "notes.txt"), "not ours");

    await expect(service.removeOrphans()).resolves.toEqual({ scanned: 0, deleted: 0, kept: 0 });
    expect(readdirSync(mediaDir).sort()).toEqual(["manual-photo.jpg", "notes.txt"]);
  });

  it("does nothing when the media directory does not exist yet", async () => {
    rmSync(mediaDir, { recursive: true, force: true });

    await expect(service.removeOrphans()).resolves.toEqual({ scanned: 0, deleted: 0, kept: 0 });
  });

  it("sweeps without throwing", async () => {
    addUpload(OLD_UPLOAD);
    await expect(service.sweep()).resolves.toBeUndefined();
    expect(readdirSync(mediaDir)).toEqual([]);
  });
});
