import { BadRequestException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { prisma } from "@essentials/db";
import type { Request } from "express";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { JwtUser } from "../common/roles.guard";
import { ArtistsController } from "./artists.controller";
import { ArtistsService, MAX_PROFILE_IMAGE_BYTES, PROFILE_IMAGE_EXTENSIONS } from "./artists.service";
import type { DjBookingService } from "./dj-booking.service";

jest.mock("@essentials/db", () => ({
  ArtistBookingStatus: {},
  prisma: { artistProfile: { findUnique: jest.fn(), update: jest.fn(), create: jest.fn() } },
}));

const ORIGIN = "https://api.example.com";

function mockConfig(values: Record<string, string | undefined> = {}) {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

/** Only the fields saveProfileImage reads are set. */
function upload(over: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    originalname: "photo.jpg",
    mimetype: "image/jpeg",
    buffer: Buffer.from("jpeg-bytes"),
    size: 10,
    ...over,
  } as Express.Multer.File;
}

function mockRequest(): Request {
  return { protocol: "https", get: () => "api.example.com" } as unknown as Request;
}

function controllerFor(service: Partial<ArtistsService>) {
  return new ArtistsController(
    service as unknown as ArtistsService,
    {} as unknown as DjBookingService,
  );
}

describe("ArtistsService.saveProfileImage", () => {
  let mediaDir: string;
  let service: ArtistsService;

  beforeEach(() => {
    mediaDir = mkdtempSync(join(tmpdir(), "essentials-media-"));
    service = new ArtistsService(mockConfig({ MEDIA_DIR: mediaDir }));
  });

  afterEach(() => {
    rmSync(mediaDir, { recursive: true, force: true });
  });

  it.each(PROFILE_IMAGE_EXTENSIONS)("accepts a %s image and writes it to the media directory", (ext) => {
    const result = service.saveProfileImage(upload({ originalname: `photo${ext}` }), ORIGIN);

    expect(result.ok).toBe(true);
    expect(result.url).toMatch(/^https:\/\/api\.example\.com\/media\/.+$/);
    expect(result.url.endsWith(ext)).toBe(true);

    const name = result.url.split("/").pop()!;
    expect(readdirSync(mediaDir)).toEqual([name]);
    expect(readFileSync(join(mediaDir, name), "utf8")).toBe("jpeg-bytes");
  });

  it("gives two uploads of the same file distinct names", () => {
    const first = service.saveProfileImage(upload(), ORIGIN);
    const second = service.saveProfileImage(upload(), ORIGIN);

    expect(first.url).not.toBe(second.url);
    expect(readdirSync(mediaDir)).toHaveLength(2);
  });

  it("rejects a non-image mimetype even with an allowed extension", () => {
    expect(() =>
      service.saveProfileImage(upload({ originalname: "photo.jpg", mimetype: "application/pdf" }), ORIGIN),
    ).toThrow(BadRequestException);
    expect(readdirSync(mediaDir)).toEqual([]);
  });

  it("rejects an image extension outside the allowed list", () => {
    expect(() =>
      service.saveProfileImage(upload({ originalname: "photo.gif", mimetype: "image/gif" }), ORIGIN),
    ).toThrow("Only jpg/png/webp/avif images are supported");
    expect(readdirSync(mediaDir)).toEqual([]);
  });

  it(`rejects a photo over ${MAX_PROFILE_IMAGE_BYTES} bytes without writing it`, () => {
    expect(() =>
      service.saveProfileImage(upload({ size: MAX_PROFILE_IMAGE_BYTES + 1, buffer: Buffer.alloc(1) }), ORIGIN),
    ).toThrow("Photos must be 5 MB or smaller");
    expect(readdirSync(mediaDir)).toEqual([]);
  });

  it("accepts a photo exactly at the 5 MB limit", () => {
    const result = service.saveProfileImage(
      upload({ size: MAX_PROFILE_IMAGE_BYTES, buffer: Buffer.alloc(1) }),
      ORIGIN,
    );
    expect(result.url).toContain("/media/");
  });

  it("uses an absolute PUBLIC_MEDIA_URL instead of the request origin", () => {
    const cdn = new ArtistsService(
      mockConfig({ MEDIA_DIR: mediaDir, PUBLIC_MEDIA_URL: "https://cdn.example.com/photos" }),
    );

    const { url } = cdn.saveProfileImage(upload(), ORIGIN);

    expect(url.startsWith("https://cdn.example.com/photos/")).toBe(true);
    expect(url).not.toContain("api.example.com");
  });
});

describe("ArtistsController.uploadProfileImage", () => {
  it("rejects a request with no file attached", () => {
    expect(() => controllerFor({}).uploadProfileImage(undefined, mockRequest())).toThrow(BadRequestException);
  });

  it("forwards the file and the request origin to the service", () => {
    const saveProfileImage = jest.fn().mockReturnValue({ ok: true, url: "https://api.example.com/media/x.jpg" });
    const file = upload();

    const result = controllerFor({ saveProfileImage }).uploadProfileImage(file, mockRequest());

    expect(result).toEqual({ ok: true, url: "https://api.example.com/media/x.jpg" });
    expect(saveProfileImage).toHaveBeenCalledWith(file, "https://api.example.com");
  });
});

describe("ArtistsService.upsertProfile photo cleanup", () => {
  const user = { sub: "artist-user" } as JwtUser;
  const profiles = (prisma as unknown as {
    artistProfile: { findUnique: jest.Mock; update: jest.Mock; create: jest.Mock };
  }).artistProfile;

  let mediaDir: string;
  let service: ArtistsService;

  beforeEach(() => {
    mediaDir = mkdtempSync(join(tmpdir(), "essentials-media-"));
    service = new ArtistsService(mockConfig({ MEDIA_DIR: mediaDir }));
    profiles.findUnique.mockReset();
    profiles.update.mockReset();
    profiles.create.mockReset();
  });

  afterEach(() => {
    rmSync(mediaDir, { recursive: true, force: true });
  });

  /** Upload a real file so the old photo exists exactly as it would in production. */
  function storedPhoto() {
    const { url } = service.saveProfileImage(upload(), ORIGIN);
    return { url, file: join(mediaDir, url.split("/").pop()!) };
  }

  function profileCurrentlyAt(imageUrl: string | null) {
    profiles.findUnique.mockResolvedValue({ imageUrl });
  }

  it("deletes the previous photo when the DJ replaces it", async () => {
    const old = storedPhoto();
    profileCurrentlyAt(old.url);
    profiles.update.mockResolvedValue({ imageUrl: "https://api.example.com/media/new.jpg" });

    await service.upsertProfile(
      user,
      { stageName: "Nandi", imageUrl: "https://api.example.com/media/new.jpg" },
      ORIGIN,
    );

    expect(existsSync(old.file)).toBe(false);
  });

  it("deletes the previous photo when the DJ removes it", async () => {
    const old = storedPhoto();
    profileCurrentlyAt(old.url);
    profiles.update.mockResolvedValue({ imageUrl: null });

    await service.upsertProfile(user, { stageName: "Nandi", imageUrl: "" }, ORIGIN);

    expect(existsSync(old.file)).toBe(false);
  });

  it("keeps the photo when the saved URL is unchanged", async () => {
    const old = storedPhoto();
    profileCurrentlyAt(old.url);
    profiles.update.mockResolvedValue({ imageUrl: old.url });

    await service.upsertProfile(user, { stageName: "Nandi", imageUrl: old.url }, ORIGIN);

    expect(existsSync(old.file)).toBe(true);
  });

  it("keeps the photo when the update does not touch imageUrl", async () => {
    const old = storedPhoto();
    profileCurrentlyAt(old.url);
    profiles.update.mockResolvedValue({ imageUrl: old.url });

    await service.upsertProfile(user, { stageName: "Nandi" }, ORIGIN);

    expect(existsSync(old.file)).toBe(true);
  });

  it("leaves a hand-linked external image alone", async () => {
    const local = storedPhoto();
    // Same generated name, different host: not a file this API stored for the profile.
    const external = `https://images.example.net/media/${local.url.split("/").pop()}`;
    profileCurrentlyAt(external);
    profiles.update.mockResolvedValue({ imageUrl: null });

    await service.upsertProfile(user, { stageName: "Nandi", imageUrl: "" }, ORIGIN);

    expect(existsSync(local.file)).toBe(true);
  });

  it("cannot reach outside the media directory", async () => {
    const escapee = join(mediaDir, "escape.jpg");
    writeFileSync(escapee, "keep me");
    profileCurrentlyAt("https://api.example.com/media/../escape.jpg");
    profiles.update.mockResolvedValue({ imageUrl: null });

    await service.upsertProfile(user, { stageName: "Nandi", imageUrl: "" }, ORIGIN);

    expect(existsSync(escapee)).toBe(true);
  });
});
